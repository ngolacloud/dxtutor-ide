//! The metrics source (r23, NOTAS-r23 point 3; docs/v2/AUDIT-r23.md §4.5 — sources, deploy SLO gate, PR review
//! capacity and error budget, incident confidence): Prometheus, read-only.
//!
//! - **Where:** `.dxtutor/metrics.json` — the URL and how to authenticate: `none` (a local Prometheus or a
//!   port-forward), `keychain` (a bearer token kept in the OS keychain, set from Ops) or `vault` (a KV v2 key read
//!   here, in the backend: the token never reaches the UI and joins the redaction).
//! - **SLOs:** `.dxtutor/slo.json`, reviewed in pull requests like the code: per service, the objective (percent),
//!   the window (`30d`) and two PromQL queries — the errors and the total — with `$window` where the range goes.
//! - **Error budget:** `1 − error_ratio / (1 − objective)` over the window (negative = overspent); the burn rate is
//!   the last hour's error ratio over the allowed one. No requests in the window: no number, said so.
//! - **Capacity:** the cluster's requested CPU and memory over the allocatable (kube-state-metrics); without those
//!   series it says that kube-state-metrics is not scraped — never a guess.
//! - **Incidents:** the error ratio of each SLO in the hour before an incident opened and since then.
//!
//! Only GETs on `/api/v1/…`; nothing here writes to Prometheus.

use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::keychain::Store;
use crate::sources::Source;
use crate::vault;

pub const METRICS_FILE: &str = ".dxtutor/metrics.json";
pub const SLO_FILE: &str = ".dxtutor/slo.json";

/// The configuration hint shown wherever the source is not configured.
pub const CONFIGURE_HINT: &str = "Create .dxtutor/metrics.json: {\"prometheus\": {\"url\": \"http://localhost:9090\", \"auth\": {\"kind\": \"none\"}}} — auth kind \"keychain\" (set the token in Ops › Data sources) or \"vault\" (addr, mount, path, field)";

// ───── configuration ─────

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub prometheus: Option<Endpoint>,
    /// logs (Loki) — read by the incidents' log check
    pub loki: Option<Endpoint>,
    pub capacity: CapacityCfg,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CapacityCfg {
    /// above this share of the allocatable, the capacity check fails
    pub max_percent: f64,
}

impl Default for CapacityCfg {
    fn default() -> Self {
        CapacityCfg { max_percent: 85.0 }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Endpoint {
    pub url: String,
    pub auth: Auth,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Auth {
    #[default]
    None,
    /// a bearer token in the OS keychain (account [`token_account`])
    Keychain,
    /// a bearer token in Vault KV v2, read with the Vault session of the keychain
    Vault {
        addr: String,
        #[serde(default)]
        namespace: Option<String>,
        mount: String,
        path: String,
        field: String,
    },
}

impl Auth {
    pub fn kind(&self) -> &'static str {
        match self {
            Auth::None => "none",
            Auth::Keychain => "keychain",
            Auth::Vault { .. } => "vault",
        }
    }
}

/// `.dxtutor/metrics.json`; `None` when the project has none.
pub fn load_config(root: &Path) -> Result<Option<Config>, String> {
    match std::fs::read_to_string(root.join(METRICS_FILE)) {
        Ok(t) => serde_json::from_str(&t)
            .map(Some)
            .map_err(|e| format!("{METRICS_FILE}: {e}")),
        Err(_) => Ok(None),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slo {
    pub name: String,
    /// percent of good requests, e.g. 99.9
    pub objective: f64,
    /// the SLO window, e.g. `30d`
    #[serde(default = "default_window")]
    pub window: String,
    /// PromQL: the errors over `$window`
    pub errors: String,
    /// PromQL: every request over `$window`
    pub total: String,
    /// the Deployments this SLO covers (none: the Deployment named like the service)
    #[serde(default)]
    pub deployments: Vec<String>,
}

fn default_window() -> String {
    "30d".into()
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SloFile {
    services: Vec<Slo>,
}

/// A Prometheus duration (`5m`, `1h`, `30d`).
pub fn valid_window(w: &str) -> bool {
    let (n, u) = w.split_at(w.len().saturating_sub(1));
    !n.is_empty()
        && n.chars().all(|c| c.is_ascii_digit())
        && matches!(u, "s" | "m" | "h" | "d" | "w" | "y")
}

/// `.dxtutor/slo.json` (empty when the project has none), checked: a name, an objective strictly between 0 and
/// 100, a Prometheus window, both queries.
pub fn load_slos(root: &Path) -> Result<Vec<Slo>, String> {
    let text = match std::fs::read_to_string(root.join(SLO_FILE)) {
        Ok(t) => t,
        Err(_) => return Ok(vec![]),
    };
    let f: SloFile = serde_json::from_str(&text).map_err(|e| format!("{SLO_FILE}: {e}"))?;
    for s in &f.services {
        if s.name.trim().is_empty() {
            return Err(format!("{SLO_FILE}: a service without a name"));
        }
        if !(s.objective > 0.0 && s.objective < 100.0) {
            return Err(format!(
                "{SLO_FILE}: {}: the objective is a percent between 0 and 100 (e.g. 99.9), not {}",
                s.name, s.objective
            ));
        }
        if !valid_window(&s.window) {
            return Err(format!(
                "{SLO_FILE}: {}: {:?} is not a Prometheus duration (e.g. 30d)",
                s.name, s.window
            ));
        }
        if s.errors.trim().is_empty() || s.total.trim().is_empty() {
            return Err(format!(
                "{SLO_FILE}: {}: both queries (errors and total) are needed",
                s.name
            ));
        }
    }
    Ok(f.services)
}

/// The SLOs that cover these Deployments.
pub fn slos_for<'a>(slos: &'a [Slo], deployments: &[String]) -> Vec<&'a Slo> {
    slos.iter()
        .filter(|s| {
            deployments.iter().any(|d| {
                if s.deployments.is_empty() {
                    &s.name == d
                } else {
                    s.deployments.contains(d)
                }
            })
        })
        .collect()
}

// ───── the token ─────

pub fn token_account(url: &str) -> String {
    format!("metrics:{}", url.trim().trim_end_matches('/'))
}

fn check_url(url: &str) -> Result<String, String> {
    let u = url.trim().trim_end_matches('/').to_string();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err(format!("not a URL: {u:?} (http(s)://host:port)"));
    }
    Ok(u)
}

/// Keeps the read token of `url` in the keychain (never returned).
pub fn set_token(store: &dyn Store, url: &str, token: &str) -> Result<(), String> {
    let u = check_url(url)?;
    let tok = token.trim();
    if tok.is_empty() {
        return Err("the token is empty".into());
    }
    tutor_protect::redact::learn_values([tok.to_string()]);
    store.set(&token_account(&u), tok)
}

pub fn clear_token(store: &dyn Store, url: &str) -> Result<(), String> {
    store.delete(&token_account(&check_url(url)?))
}

// ───── the client ─────

/// Why the source is not connected, and how to connect it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Unconnected {
    pub notes: String,
    pub hint: Option<String>,
}

fn off(notes: impl Into<String>, hint: Option<&str>) -> Unconnected {
    Unconnected {
        notes: notes.into(),
        hint: hint.map(String::from),
    }
}

/// A read-only HTTP API (Prometheus, Loki) with its token. The token is never serialised.
pub struct Api {
    pub url: String,
    pub auth: &'static str,
    token: Option<String>,
}

impl std::fmt::Debug for Api {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Api({}, auth {})", self.url, self.auth)
    }
}

/// The client for an endpoint: its token from the keychain or Vault (here, in the backend).
pub fn connect(store: &dyn Store, ep: &Endpoint, what: &str) -> Result<Api, Unconnected> {
    let url = check_url(&ep.url)
        .map_err(|e| off(format!("{METRICS_FILE}: {what}: {e}"), Some(CONFIGURE_HINT)))?;
    let token = match &ep.auth {
        Auth::None => None,
        Auth::Keychain => match store.get(&token_account(&url)) {
            Ok(Some(t)) => Some(t),
            Ok(None) => {
                return Err(off(
                    format!("no token for {url} in the keychain"),
                    Some("Ops › Data sources › «Set token…»"),
                ))
            }
            Err(e) => return Err(off(e, None)),
        },
        Auth::Vault {
            addr,
            namespace,
            mount,
            path,
            field,
        } => {
            let t = vault::Target::new(addr, namespace.as_deref()).map_err(|e| off(e, None))?;
            match vault::credential(store, &t, mount, path, field) {
                Ok(v) => Some(v),
                Err(e) => {
                    return Err(off(
                        format!("the {what} token could not be read from Vault: {e}"),
                        Some("Sign in to Vault (the Vault tab), and check mount, path and field in .dxtutor/metrics.json"),
                    ))
                }
            }
        }
    };
    if let Some(t) = &token {
        tutor_protect::redact::learn_values([t.clone()]);
    }
    Ok(Api {
        url,
        auth: ep.auth.kind(),
        token,
    })
}

impl Api {
    /// For tests and callers that built the URL themselves.
    pub fn plain(url: &str) -> Api {
        Api {
            url: url.trim_end_matches('/').to_string(),
            auth: "none",
            token: None,
        }
    }

    /// `GET <url><path>?params` → the `data` of a `{"status": "success"}` answer.
    pub fn get(&self, path: &str, params: &[(&str, &str)]) -> Result<Value, String> {
        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(15))
            .build();
        let mut r = agent.get(&format!("{}{path}", self.url));
        for (k, v) in params {
            r = r.query(k, v);
        }
        if let Some(t) = &self.token {
            r = r.set("Authorization", &format!("Bearer {t}"));
        }
        let mask = |s: String| tutor_protect::redact::current().mask(&s);
        let body: Value = match r.call() {
            Ok(resp) => resp
                .into_json()
                .map_err(|e| format!("{} answered something that is not JSON: {e}", self.url))?,
            Err(ureq::Error::Status(code, resp)) => {
                let b: Value = resp.into_json().unwrap_or(Value::Null);
                let words = b["error"].as_str().unwrap_or("");
                return Err(mask(if words.is_empty() {
                    format!("{} answered {code}", self.url)
                } else {
                    format!("{} answered {code}: {words}", self.url)
                }));
            }
            Err(e) => return Err(mask(format!("{} is not reachable: {e}", self.url))),
        };
        if body["status"] != "success" {
            return Err(mask(format!(
                "{}: {}",
                body["errorType"].as_str().unwrap_or("error"),
                body["error"].as_str().unwrap_or("the query failed")
            )));
        }
        Ok(body["data"].clone())
    }

    /// Prometheus' version (`/api/v1/status/buildinfo`).
    pub fn version(&self) -> Result<String, String> {
        Ok(self.get("/api/v1/status/buildinfo", &[])?["version"]
            .as_str()
            .unwrap_or("?")
            .to_string())
    }

    /// An instant query, the series added up (`None`: no series, or not a number). `at`: unix seconds.
    pub fn scalar(&self, q: &str, at: Option<f64>) -> Result<Option<f64>, String> {
        let time = at.map(|t| format!("{t:.3}"));
        let mut p = vec![("query", q)];
        if let Some(t) = &time {
            p.push(("time", t));
        }
        let d = self.get("/api/v1/query", &p)?;
        let num = |v: &Value| v[1].as_str().and_then(|s| s.parse::<f64>().ok());
        let total = match d["resultType"].as_str() {
            Some("scalar") => num(&d["result"]),
            _ => {
                let xs: Vec<f64> = d["result"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|s| num(&s["value"]))
                    .collect();
                (!xs.is_empty()).then(|| xs.iter().sum())
            }
        };
        Ok(total.filter(|x| x.is_finite()))
    }
}

// ───── what the project's metrics say ─────

/// Prometheus connected, with the project's SLOs.
#[derive(Debug)]
pub struct Live {
    pub prom: Api,
    pub version: String,
    pub cfg: Config,
    pub slos: Vec<Slo>,
}

/// The project's Prometheus, connected and answering.
pub fn live(store: &dyn Store, root: &Path) -> Result<Live, Unconnected> {
    let cfg = match load_config(root) {
        Ok(Some(c)) => c,
        Ok(None) => return Err(off("not connected", Some(CONFIGURE_HINT))),
        Err(e) => return Err(off(e, Some(CONFIGURE_HINT))),
    };
    let Some(ep) = cfg.prometheus.clone() else {
        return Err(off(
            format!("{METRICS_FILE} has no prometheus"),
            Some(CONFIGURE_HINT),
        ));
    };
    let prom = connect(store, &ep, "prometheus")?;
    let version = prom.version().map_err(|e| off(e, None))?;
    let slos = load_slos(root).map_err(|e| off(e, None))?;
    Ok(Live {
        prom,
        version,
        cfg,
        slos,
    })
}

/// The `obs` data source as Ops shows it.
pub fn source(store: &dyn Store, root: &Path) -> Source {
    match live(store, root) {
        Ok(l) => Source {
            kind: "obs".into(),
            connected: true,
            via: Some(format!(
                "Prometheus {} at {}, read-only{}",
                l.version,
                l.prom.url,
                match l.prom.auth {
                    "keychain" => " (token in the keychain)",
                    "vault" => " (token from Vault)",
                    _ => "",
                }
            )),
            notes: String::new(),
            hint: None,
        },
        Err(u) => Source {
            kind: "obs".into(),
            connected: false,
            via: None,
            notes: u.notes,
            hint: u.hint,
        },
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budget {
    pub service: String,
    pub objective: f64,
    /// the SLO window (`30d`) — `period` on the wire: the UI's feature code never names `window` (A8)
    #[serde(rename = "period")]
    pub window: String,
    /// errors / total over the window; `None` without requests
    pub error_ratio: Option<f64>,
    /// the share of the budget left (1 = untouched, ≤ 0 = spent); `None` without requests
    pub remaining: Option<f64>,
    /// the last hour's error ratio over the allowed one (1 = spending exactly the budget)
    pub burn_1h: Option<f64>,
    pub exhausted: bool,
    /// the queries, as run
    pub queries: Vec<String>,
    pub notes: String,
}

fn at_window(q: &str, w: &str) -> String {
    q.replace("$window", w)
}

fn ratio(
    p: &Api,
    slo: &Slo,
    w: &str,
    at: Option<f64>,
) -> Result<(Option<f64>, [String; 2]), String> {
    let (eq, tq) = (at_window(&slo.errors, w), at_window(&slo.total, w));
    let errors = p.scalar(&eq, at)?;
    let total = p.scalar(&tq, at)?;
    let r = match total {
        Some(t) if t > 0.0 => Some(errors.unwrap_or(0.0) / t),
        _ => None,
    };
    Ok((r, [eq, tq]))
}

/// One SLO's error budget over its window, and the last hour's burn rate.
pub fn budget(p: &Api, slo: &Slo) -> Result<Budget, String> {
    let allowed = 1.0 - slo.objective / 100.0;
    let (r, [eq, tq]) = ratio(p, slo, &slo.window, None)?;
    let (r1, _) = ratio(p, slo, "1h", None)?;
    let remaining = r.map(|x| 1.0 - x / allowed);
    Ok(Budget {
        service: slo.name.clone(),
        objective: slo.objective,
        window: slo.window.clone(),
        error_ratio: r,
        remaining,
        burn_1h: r1.map(|x| x / allowed),
        exhausted: remaining.is_some_and(|x| x <= 0.0),
        queries: vec![eq, tq],
        notes: if r.is_none() {
            format!("no requests in the last {}", slo.window)
        } else {
            String::new()
        },
    })
}

/// `web: 72% of the 30d budget left (burn 0.4× in the last hour)`.
pub fn budget_line(b: &Budget) -> String {
    match b.remaining {
        None => format!("{}: {}", b.service, b.notes),
        Some(r) => format!(
            "{}: {} of the {} budget {}{}",
            b.service,
            pct(r.abs()),
            b.window,
            if r > 0.0 { "left" } else { "overspent" },
            b.burn_1h
                .map(|x| format!(" (burn {x:.1}× in the last hour)"))
                .unwrap_or_default()
        ),
    }
}

fn pct(x: f64) -> String {
    let p = x * 100.0;
    if p != 0.0 && p.abs() < 1.0 {
        format!("{p:.2}%")
    } else {
        format!("{p:.0}%")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub requested: f64,
    pub allocatable: f64,
    pub percent: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Capacity {
    pub cpu: Usage,
    pub memory: Usage,
    pub max_percent: f64,
    pub over: bool,
    pub queries: Vec<String>,
}

pub const Q_CPU_REQ: &str = "sum(kube_pod_container_resource_requests{resource=\"cpu\"})";
pub const Q_CPU_ALLOC: &str = "sum(kube_node_status_allocatable{resource=\"cpu\"})";
pub const Q_MEM_REQ: &str = "sum(kube_pod_container_resource_requests{resource=\"memory\"})";
pub const Q_MEM_ALLOC: &str = "sum(kube_node_status_allocatable{resource=\"memory\"})";

/// The cluster's requested CPU and memory over the allocatable (kube-state-metrics).
pub fn capacity(p: &Api, cfg: &CapacityCfg) -> Result<Capacity, String> {
    let use_of = |req: &str, alloc: &str| -> Result<Usage, String> {
        let a = p.scalar(alloc, None)?.filter(|a| *a > 0.0).ok_or(
            "kube-state-metrics is not scraped by this Prometheus (no kube_node_status_allocatable)",
        )?;
        let r = p.scalar(req, None)?.unwrap_or(0.0);
        Ok(Usage {
            requested: r,
            allocatable: a,
            percent: r / a * 100.0,
        })
    };
    let cpu = use_of(Q_CPU_REQ, Q_CPU_ALLOC)?;
    let memory = use_of(Q_MEM_REQ, Q_MEM_ALLOC)?;
    Ok(Capacity {
        over: cpu.percent > cfg.max_percent || memory.percent > cfg.max_percent,
        cpu,
        memory,
        max_percent: cfg.max_percent,
        queries: [Q_CPU_REQ, Q_CPU_ALLOC, Q_MEM_REQ, Q_MEM_ALLOC]
            .map(String::from)
            .to_vec(),
    })
}

pub fn capacity_line(c: &Capacity) -> String {
    format!(
        "CPU {:.0}% · memory {:.0}% of the allocatable requested (limit {:.0}%)",
        c.cpu.percent, c.memory.percent, c.max_percent
    )
}

/// What the metrics say about an incident opened at `opened_ms`: each SLO's error ratio in the hour before and
/// since then (from 15 minutes before it opened), against the allowed one. One line per SLO, for the timeline.
pub fn incident_lines(l: &Live, opened_ms: i64, now_ms: i64) -> Vec<String> {
    let opened = opened_ms as f64 / 1000.0;
    let since_s = ((now_ms - opened_ms) / 1000).max(0) + 900;
    let since = format!("{since_s}s");
    l.slos
        .iter()
        .map(|slo| {
            let allowed = 1.0 - slo.objective / 100.0;
            let before = ratio(&l.prom, slo, "1h", Some(opened - 900.0));
            let after = ratio(&l.prom, slo, &since, None);
            match (before, after) {
                (Ok((b, _)), Ok((a, _))) => {
                    let show = |x: Option<f64>| x.map(pct).unwrap_or_else(|| "no requests".into());
                    format!(
                        "metrics · {}: errors {} in the hour before, {} since 15 min before it opened{} (objective {}%, Prometheus {})",
                        slo.name,
                        show(b),
                        show(a),
                        a.map(|x| format!(" — {:.1}× the allowed rate", x / allowed)).unwrap_or_default(),
                        slo.objective,
                        l.prom.url
                    )
                }
                (Err(e), _) | (_, Err(e)) => format!("metrics · {}: the query failed: {e}", slo.name),
            }
        })
        .collect()
}

/// Everything Ops shows about the metrics source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub configured: bool,
    pub url: Option<String>,
    pub auth: Option<String>,
    pub connected: bool,
    pub version: Option<String>,
    pub notes: String,
    pub hint: Option<String>,
    pub budgets: Vec<Budget>,
    /// per-SLO query errors
    pub budget_errors: Vec<String>,
    pub capacity: Option<Capacity>,
    pub capacity_notes: String,
}

pub fn overview(store: &dyn Store, root: &Path) -> Overview {
    let cfg = load_config(root).ok().flatten();
    let ep = cfg.as_ref().and_then(|c| c.prometheus.clone());
    let mut o = Overview {
        configured: ep.is_some(),
        url: ep
            .as_ref()
            .map(|e| e.url.trim().trim_end_matches('/').to_string()),
        auth: ep.as_ref().map(|e| e.auth.kind().to_string()),
        ..Default::default()
    };
    let l = match live(store, root) {
        Ok(l) => l,
        Err(u) => {
            o.notes = u.notes;
            o.hint = u.hint;
            return o;
        }
    };
    o.connected = true;
    o.version = Some(l.version.clone());
    for s in &l.slos {
        match budget(&l.prom, s) {
            Ok(b) => o.budgets.push(b),
            Err(e) => o.budget_errors.push(format!("{}: {e}", s.name)),
        }
    }
    match capacity(&l.prom, &l.cfg.capacity) {
        Ok(c) => o.capacity = Some(c),
        Err(e) => o.capacity_notes = e,
    }
    if l.slos.is_empty() {
        o.notes = format!("no SLOs in {SLO_FILE}");
    }
    o
}

#[cfg(test)]
pub(crate) mod testkit;
#[cfg(test)]
mod tests;
