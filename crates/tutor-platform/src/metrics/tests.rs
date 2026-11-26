use std::net::TcpListener;
use std::process::{Child, Command, Stdio};
use std::time::Instant;

use super::testkit::*;
use super::*;
use crate::keychain::MemStore;

fn slo(name: &str) -> Slo {
    Slo {
        name: name.into(),
        objective: 99.0,
        window: "30d".into(),
        errors: "sum(increase(errs[$window]))".into(),
        total: "sum(increase(reqs[$window]))".into(),
        deployments: vec![],
    }
}

#[test]
fn slo_files_and_windows() {
    assert!(valid_window("30d") && valid_window("5m") && valid_window("1h"));
    assert!(!valid_window("d") && !valid_window("30") && !valid_window("3x") && !valid_window(""));
    let d = tempfile::tempdir().unwrap();
    assert_eq!(load_slos(d.path()).unwrap(), vec![]);
    assert_eq!(load_config(d.path()).unwrap(), None);
    std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
    let w = |t: &str| std::fs::write(d.path().join(SLO_FILE), t).unwrap();
    w(
        r#"{"services":[{"name":"web","objective":99.9,"errors":"e[$window]","total":"t[$window]"}]}"#,
    );
    let s = load_slos(d.path()).unwrap();
    assert_eq!((s[0].window.as_str(), s[0].objective), ("30d", 99.9));
    w(r#"{"services":[{"name":"web","objective":0.999,"errors":"e","total":"t"}]}"#);
    assert!(load_slos(d.path()).is_ok(), "0.999 is a percent, if odd");
    w(r#"{"services":[{"name":"web","objective":100,"errors":"e","total":"t"}]}"#);
    assert!(load_slos(d.path())
        .unwrap_err()
        .contains("between 0 and 100"));
    w(r#"{"services":[{"name":"web","objective":99,"window":"month","errors":"e","total":"t"}]}"#);
    assert!(load_slos(d.path())
        .unwrap_err()
        .contains("not a Prometheus duration"));
    w(r#"{"services":[{"name":"web","objective":99,"errors":"","total":"t"}]}"#);
    assert!(load_slos(d.path()).unwrap_err().contains("both queries"));
    // which SLO covers a Deployment
    let mut api = slo("api");
    api.deployments = vec!["api-v2".into()];
    let all = vec![slo("web"), api];
    let names = |ds: &[&str]| {
        slos_for(&all, &ds.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .iter()
            .map(|s| s.name.clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&["web"]), vec!["web"]);
    assert_eq!(names(&["api"]), Vec::<String>::new());
    assert_eq!(names(&["api-v2", "web"]), vec!["web", "api"]);
}

#[test]
fn the_budget_and_the_capacity_from_the_queries() {
    let url = fake(|path, q, _| match path {
        "/api/v1/status/buildinfo" => (200, BUILD.into()),
        _ if q == "bad(" => (
            400,
            "{\"status\":\"error\",\"errorType\":\"bad_data\",\"error\":\"parse error\"}".into(),
        ),
        _ if q.contains("errs[30d]") => (200, vector(30.0)),
        _ if q.contains("reqs[30d]") => (200, vector(10_000.0)),
        _ if q.contains("errs[1h]") => (200, vector(2.0)),
        _ if q.contains("reqs[1h]") => (200, vector(100.0)),
        _ if q.contains("idle[") => (200, vector(0.0)),
        _ if q == Q_CPU_ALLOC => (200, vector(8.0)),
        _ if q == Q_CPU_REQ => (200, vector(7.2)),
        _ if q == Q_MEM_ALLOC => (200, vector(32e9)),
        _ if q == Q_MEM_REQ => (200, vector(8e9)),
        _ => (200, EMPTY.into()),
    });
    let p = Api::plain(&url);
    assert_eq!(p.version().unwrap(), "3.16.0");
    // 30 errors in 10 000 at 99%: 0.3% of the 1% allowed is spent → 70% left; the last hour burns 2×
    let b = budget(&p, &slo("web")).unwrap();
    assert!((b.error_ratio.unwrap() - 0.003).abs() < 1e-12);
    assert!((b.remaining.unwrap() - 0.7).abs() < 1e-9, "{b:?}");
    assert!((b.burn_1h.unwrap() - 2.0).abs() < 1e-9);
    assert!(!b.exhausted);
    assert_eq!(
        budget_line(&b),
        "web: 70% of the 30d budget left (burn 2.0× in the last hour)"
    );
    assert_eq!(b.queries[0], "sum(increase(errs[30d]))");
    // 2% errors at 99%: overspent
    let mut hot = slo("hot");
    hot.objective = 99.9;
    let b = budget(&p, &hot).unwrap();
    assert!(b.exhausted && b.remaining.unwrap() < 0.0);
    assert!(budget_line(&b).contains("overspent"), "{}", budget_line(&b));
    // no requests: no number
    let mut idle = slo("idle");
    idle.errors = "sum(idle[$window])".into();
    idle.total = "sum(idle[$window])".into();
    let b = budget(&p, &idle).unwrap();
    assert_eq!((b.remaining, b.exhausted), (None, false));
    assert_eq!(budget_line(&b), "idle: no requests in the last 30d");
    // a bad query: Prometheus' own words
    let e = p.scalar("bad(", None).unwrap_err();
    assert!(e.contains("400") && e.contains("parse error"), "{e}");
    // capacity: CPU 90% > 85%
    let c = capacity(&p, &CapacityCfg::default()).unwrap();
    assert!((c.cpu.percent - 90.0).abs() < 1e-9 && (c.memory.percent - 25.0).abs() < 1e-9);
    assert!(c.over);
    assert_eq!(
        capacity_line(&c),
        "CPU 90% · memory 25% of the allocatable requested (limit 85%)"
    );
    assert!(
        !capacity(&p, &CapacityCfg { max_percent: 95.0 })
            .unwrap()
            .over
    );
    // without kube-state-metrics: said so
    let bare = Api::plain(&fake(|_, _, _| (200, EMPTY.into())));
    assert!(capacity(&bare, &CapacityCfg::default())
        .unwrap_err()
        .contains("kube-state-metrics is not scraped"));
}

#[test]
fn the_token_comes_from_the_keychain_and_never_shows() {
    let url = fake(|path, _, auth| {
        if auth != "Bearer s3cr3t-read-token" {
            return (
                401,
                "{\"status\":\"error\",\"errorType\":\"unauthorized\",\"error\":\"no\"}".into(),
            );
        }
        match path {
            "/api/v1/status/buildinfo" => (200, BUILD.into()),
            _ => (200, vector(1.0)),
        }
    });
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
    std::fs::write(
        d.path().join(METRICS_FILE),
        format!(r#"{{"prometheus": {{"url": "{url}/", "auth": {{"kind": "keychain"}}}}}}"#),
    )
    .unwrap();
    let store = MemStore::default();
    let u = live(&store, d.path()).unwrap_err();
    assert!(u.notes.contains("no token") && u.hint.unwrap().contains("Set token"));
    let s = source(&store, d.path());
    assert!(!s.connected);
    set_token(&store, &url, "s3cr3t-read-token").unwrap();
    let l = live(&store, d.path()).unwrap();
    assert_eq!((l.version.as_str(), l.prom.auth), ("3.16.0", "keychain"));
    assert!(!format!("{l:?}").contains("s3cr3t"));
    let s = source(&store, d.path());
    assert!(s.connected, "{s:?}");
    assert_eq!(
        s.via.unwrap(),
        format!("Prometheus 3.16.0 at {url}, read-only (token in the keychain)")
    );
    let o = overview(&store, d.path());
    assert!(o.connected && o.notes.contains("no SLOs"));
    assert!(!serde_json::to_string(&o).unwrap().contains("s3cr3t"));
    // the token joined the redaction
    assert!(!tutor_protect::redact::current()
        .mask("token s3cr3t-read-token")
        .contains("s3cr3t-read-token"));
    clear_token(&store, &url).unwrap();
    assert!(live(&store, d.path()).is_err());
    // not configured / bad URL
    let none = tempfile::tempdir().unwrap();
    let s = source(&store, none.path());
    assert_eq!(
        (s.connected, s.hint.as_deref()),
        (false, Some(CONFIGURE_HINT))
    );
    assert!(set_token(&store, "localhost:9090", "x").is_err());
}

/// A real Prometheus (when it is on the PATH), scraping itself: its own query API is the service — the bad
/// queries are the errors.
fn real_prometheus() -> Option<(Child, String, tempfile::TempDir)> {
    let on = Command::new("sh")
        .args(["-c", "command -v prometheus"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !on {
        return None;
    }
    let d = tempfile::tempdir().unwrap();
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    std::fs::write(
        d.path().join("prom.yml"),
        format!("global: {{scrape_interval: 1s, evaluation_interval: 1s}}\nscrape_configs:\n  - job_name: self\n    static_configs: [{{targets: [\"127.0.0.1:{port}\"]}}]\n"),
    )
    .unwrap();
    let child = Command::new("prometheus")
        .arg(format!(
            "--config.file={}",
            d.path().join("prom.yml").display()
        ))
        .arg(format!(
            "--storage.tsdb.path={}",
            d.path().join("data").display()
        ))
        .arg(format!("--web.listen-address=127.0.0.1:{port}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    Some((child, format!("http://127.0.0.1:{port}"), d))
}

#[test]
fn a_real_prometheus() {
    let Some((mut child, url, _d)) = real_prometheus() else {
        eprintln!("skipped: no prometheus");
        return;
    };
    let p = Api::plain(&url);
    let t0 = Instant::now();
    let up = || p.scalar("up", None).ok().flatten() == Some(1.0);
    while !up() && t0.elapsed() < Duration::from_secs(60) {
        std::thread::sleep(Duration::from_millis(300));
    }
    assert!(up(), "prometheus did not scrape itself");
    assert!(p.version().unwrap().starts_with('3') || p.version().is_ok());
    // two waves, so the 400 series exists before it is counted
    let hit = |q: &str| {
        let _ = ureq::get(&format!("{url}/api/v1/query"))
            .query("query", q)
            .call();
    };
    hit("bad(");
    hit("up");
    std::thread::sleep(Duration::from_secs(3));
    for _ in 0..10 {
        hit("bad(");
        hit("up");
        hit("up");
    }
    std::thread::sleep(Duration::from_secs(4));
    let s = Slo {
        name: "prometheus-api".into(),
        objective: 99.0,
        window: "5m".into(),
        errors: "sum(increase(prometheus_http_requests_total{handler=\"/api/v1/query\",code=~\"4..|5..\"}[$window]))".into(),
        total: "sum(increase(prometheus_http_requests_total{handler=\"/api/v1/query\"}[$window]))".into(),
        deployments: vec![],
    };
    let b = budget(&p, &s).unwrap();
    let _ = child.kill();
    let r = b.error_ratio.expect("requests were counted");
    // roughly 10 bad of 30+ (and the test's own polling): far over 1%
    assert!(r > 0.05 && r < 0.6, "{b:?}");
    assert!(b.exhausted && b.remaining.unwrap() < 0.0, "{b:?}");
    // kube-state-metrics is not there: said so
    assert!(capacity(&p, &CapacityCfg::default()).is_err());
}
