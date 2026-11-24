//! Dependencies: what is behind and what is vulnerable (A10, docs/v2/UI-AUDIT.md §3 «Actualizar dependências»).
//!
//! Per ecosystem found in the project, with the tool's own machine output:
//! - Cargo: `cargo update --dry-run --verbose` (offline first: the compatible updates and the newer
//!   majors the lock is behind), `cargo audit --json` (the local advisory database; fetched only when
//!   online is allowed) — vulnerabilities and warnings (unmaintained, unsound, yanked).
//! - npm: `npm outdated --json` and `npm audit --json` (they ask the registry: online only).
//! - Go: `go list -m -u -json all` (asks the module proxy: online only).
//!
//! Nothing is changed: updating is a command the human approves and runs in a terminal.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outdated {
    pub name: String,
    pub current: String,
    /// the newest version the manifest's requirement allows (a `cargo update` / `npm update` away)
    pub compatible: Option<String>,
    /// the newest version there is (may need a manifest change)
    pub latest: Option<String>,
    /// declared in the manifest (not only a transitive dependency)
    pub direct: bool,
    /// patch | minor | major — the jump to `latest` (or `compatible`)
    pub jump: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Vuln {
    pub id: String,
    pub package: String,
    pub version: String,
    /// low | moderate | high | critical, or the kind of warning (unmaintained, unsound, yanked)
    pub severity: String,
    pub title: String,
    pub url: String,
    pub fixed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Ecosystem {
    /// cargo | npm | go
    pub kind: String,
    /// the folder of the manifest, relative to the project (`.` for the root)
    pub dir: String,
    pub outdated: Vec<Outdated>,
    pub vulns: Vec<Vuln>,
    /// the read-only commands that were run
    pub commands: Vec<String>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DepsReport {
    pub ecosystems: Vec<Ecosystem>,
    pub online: bool,
}

fn has(tool: &str, probe: &[&str]) -> bool {
    Command::new(tool)
        .args(probe)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run(dir: &Path, tool: &str, args: &[&str]) -> Out {
    match Command::new(tool)
        .args(args)
        .current_dir(dir)
        .stdin(Stdio::null())
        .env("NO_COLOR", "1")
        .env("CARGO_TERM_COLOR", "never")
        .output()
    {
        Ok(o) => Out {
            code: o.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o.stdout).into(),
            stderr: String::from_utf8_lossy(&o.stderr).into(),
        },
        Err(e) => Out {
            code: -1,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

fn last_line(s: &str) -> String {
    s.lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// patch / minor / major between two semver-ish versions (`1.2.3`, `v0.22.1`).
pub fn jump(from: &str, to: &str) -> String {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split(['.', '-', '+'])
            .take(3)
            .map(|p| p.parse().unwrap_or(0))
            .collect()
    };
    let (a, b) = (parse(from), parse(to));
    let at = |v: &Vec<u64>, i: usize| v.get(i).copied().unwrap_or(0);
    // 0.x: a minor bump is breaking, like a major
    if at(&a, 0) != at(&b, 0) || (at(&a, 0) == 0 && at(&a, 1) != at(&b, 1)) {
        "major"
    } else if at(&a, 1) != at(&b, 1) {
        "minor"
    } else {
        "patch"
    }
    .into()
}

/// The direct dependencies a Cargo.toml declares (any `[*dependencies]` table, workspace ones too).
pub fn cargo_direct(toml: &str) -> Vec<String> {
    let mut out = vec![];
    let mut in_deps = false;
    for l in toml.lines() {
        let t = l.trim();
        if t.starts_with('[') {
            in_deps = t
                .trim_matches(|c| c == '[' || c == ']')
                .split('.')
                .any(|p| p.ends_with("dependencies"));
            // `[dependencies.serde]`
            if let Some(name) = t
                .trim_matches(|c| c == '[' || c == ']')
                .split('.')
                .skip_while(|p| !p.ends_with("dependencies"))
                .nth(1)
            {
                out.push(name.trim().to_string());
                in_deps = false;
            }
            continue;
        }
        if in_deps {
            if let Some((name, _)) = t.split_once('=') {
                let n = name.trim().trim_matches('"');
                if !n.is_empty() && !n.starts_with('#') {
                    out.push(n.to_string());
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Parses `cargo update --dry-run --verbose`: `Updating x v1 -> v2` (compatible) and
/// `Unchanged x v1 (available: v2)` (a newer version the requirement does not allow).
pub fn parse_cargo_update(text: &str, direct: &[String]) -> Vec<Outdated> {
    let mut out: Vec<Outdated> = vec![];
    for l in text.lines() {
        let t = l.trim();
        let mut w = t.split_whitespace();
        match (w.next(), w.next(), w.next(), w.next(), w.next()) {
            (Some("Updating"), Some(name), Some(cur), Some("->"), Some(new)) => {
                let (cur, new) = (cur.trim_start_matches('v'), new.trim_start_matches('v'));
                out.push(Outdated {
                    name: name.into(),
                    current: cur.into(),
                    compatible: Some(new.into()),
                    latest: None,
                    direct: direct.iter().any(|d| d == name),
                    jump: jump(cur, new),
                });
            }
            (Some("Unchanged"), Some(name), Some(cur), Some("(available:"), Some(av)) => {
                let (cur, av) = (
                    cur.trim_start_matches('v'),
                    av.trim_end_matches(')').trim_start_matches('v'),
                );
                out.push(Outdated {
                    name: name.into(),
                    current: cur.into(),
                    compatible: None,
                    latest: Some(av.into()),
                    direct: direct.iter().any(|d| d == name),
                    jump: jump(cur, av),
                });
            }
            _ => {}
        }
    }
    out.sort_by(|a, b| b.direct.cmp(&a.direct).then(a.name.cmp(&b.name)));
    out
}

/// Parses `cargo audit --json`: vulnerabilities and the warnings (unmaintained, unsound, yanked).
pub fn parse_cargo_audit(v: &Value) -> Vec<Vuln> {
    let mut out = vec![];
    for x in v["vulnerabilities"]["list"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let a = &x["advisory"];
        let sev = a["cvss"]
            .as_str()
            .map(cvss_severity)
            .unwrap_or_else(|| "high".into());
        out.push(Vuln {
            id: a["id"].as_str().unwrap_or("").into(),
            package: x["package"]["name"].as_str().unwrap_or("").into(),
            version: x["package"]["version"].as_str().unwrap_or("").into(),
            severity: sev,
            title: a["title"].as_str().unwrap_or("").trim().into(),
            url: a["url"]
                .as_str()
                .filter(|u| !u.is_empty())
                .map(String::from)
                .unwrap_or_else(|| {
                    format!(
                        "https://rustsec.org/advisories/{}",
                        a["id"].as_str().unwrap_or("")
                    )
                }),
            fixed: x["versions"]["patched"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect(),
        });
    }
    if let Some(w) = v["warnings"].as_object() {
        for (kind, list) in w {
            for x in list.as_array().cloned().unwrap_or_default() {
                let a = &x["advisory"];
                out.push(Vuln {
                    id: a["id"].as_str().unwrap_or("").into(),
                    package: x["package"]["name"].as_str().unwrap_or("").into(),
                    version: x["package"]["version"].as_str().unwrap_or("").into(),
                    severity: kind.clone(),
                    title: a["title"].as_str().unwrap_or(kind).trim().into(),
                    url: a["url"]
                        .as_str()
                        .filter(|u| !u.is_empty())
                        .map(String::from)
                        .unwrap_or_default(),
                    fixed: x["versions"]["patched"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .iter()
                        .filter_map(|p| p.as_str().map(String::from))
                        .collect(),
                });
            }
        }
    }
    out
}

/// A CVSS v3 vector's base severity (approximate: from the impact metrics).
fn cvss_severity(vector: &str) -> String {
    let high = |m: &str| vector.contains(&format!("{m}:H"));
    let n = ["C", "I", "A"].iter().filter(|m| high(m)).count();
    if n >= 2 && vector.contains("AV:N") {
        "critical"
    } else if n >= 1 {
        "high"
    } else if vector.contains(":L") {
        "moderate"
    } else {
        "low"
    }
    .into()
}

/// Parses `npm outdated --json`.
pub fn parse_npm_outdated(v: &Value, direct: &[String]) -> Vec<Outdated> {
    let mut out: Vec<Outdated> = v
        .as_object()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|(name, x)| {
            let cur = x["current"].as_str().unwrap_or("").to_string();
            let wanted = x["wanted"].as_str().map(String::from);
            let latest = x["latest"].as_str().map(String::from);
            let to = latest.clone().or(wanted.clone()).unwrap_or_default();
            Outdated {
                jump: jump(&cur, &to),
                compatible: wanted.filter(|w| *w != cur),
                latest: latest.filter(|l| *l != cur),
                direct: direct.contains(&name),
                current: cur,
                name,
            }
        })
        .collect();
    out.sort_by(|a, b| b.direct.cmp(&a.direct).then(a.name.cmp(&b.name)));
    out
}

/// Parses `npm audit --json` (v7+): one entry per vulnerable package.
pub fn parse_npm_audit(v: &Value) -> Vec<Vuln> {
    v["vulnerabilities"]
        .as_object()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|(name, x)| {
            let via = x["via"].as_array().cloned().unwrap_or_default();
            let first = via.iter().find(|e| e.is_object());
            Vuln {
                id: first
                    .and_then(|e| e["url"].as_str())
                    .and_then(|u| u.rsplit('/').next())
                    .unwrap_or("")
                    .to_string(),
                package: name,
                version: x["range"].as_str().unwrap_or("").into(),
                severity: x["severity"].as_str().unwrap_or("").into(),
                title: first.and_then(|e| e["title"].as_str()).unwrap_or("").into(),
                url: first.and_then(|e| e["url"].as_str()).unwrap_or("").into(),
                fixed: match &x["fixAvailable"] {
                    Value::Object(f) => vec![format!(
                        "{}@{}",
                        f.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                        f.get("version").and_then(|n| n.as_str()).unwrap_or("")
                    )],
                    Value::Bool(true) => vec!["npm audit fix".into()],
                    _ => vec![],
                },
            }
        })
        .collect()
}

/// Parses `go list -m -u -json all` (a stream of JSON objects): modules with an `Update`.
pub fn parse_go_list(text: &str) -> Vec<Outdated> {
    let mut out = vec![];
    for v in serde_json::Deserializer::from_str(text)
        .into_iter::<Value>()
        .flatten()
    {
        if v["Main"].as_bool().unwrap_or(false) {
            continue;
        }
        if let Some(up) = v["Update"]["Version"].as_str() {
            let cur = v["Version"]
                .as_str()
                .unwrap_or("")
                .trim_start_matches('v')
                .to_string();
            let up = up.trim_start_matches('v').to_string();
            out.push(Outdated {
                name: v["Path"].as_str().unwrap_or("").into(),
                jump: jump(&cur, &up),
                current: cur,
                compatible: None,
                latest: Some(up),
                direct: !v["Indirect"].as_bool().unwrap_or(false),
            });
        }
    }
    out
}

fn manifests(root: &Path) -> Vec<(String, String)> {
    let mut out = vec![];
    fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<(String, String)>) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        let rel = dir
            .strip_prefix(root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let rel = if rel.is_empty() { ".".to_string() } else { rel };
        let mut subs = vec![];
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let p = e.path();
            if p.is_dir() {
                if depth < 3
                    && !n.starts_with('.')
                    && !["node_modules", "target", "dist", "vendor", "build"].contains(&n.as_str())
                {
                    subs.push(p);
                }
            } else if n == "Cargo.lock" {
                out.push(("cargo".into(), rel.clone()));
            } else if n == "package-lock.json" || n == "npm-shrinkwrap.json" {
                out.push(("npm".into(), rel.clone()));
            } else if n == "go.mod" {
                out.push(("go".into(), rel.clone()));
            }
        }
        subs.sort();
        for s in subs {
            walk(root, &s, depth + 1, out);
        }
    }
    walk(root, root, 0, &mut out);
    out.dedup();
    out
}

fn cargo(root: &Path, dir: &str, online: bool) -> Ecosystem {
    let wd = if dir == "." {
        root.to_path_buf()
    } else {
        root.join(dir)
    };
    let mut e = Ecosystem {
        kind: "cargo".into(),
        dir: dir.into(),
        ..Default::default()
    };
    // the direct dependencies of every workspace member (`cargo metadata` reads the manifests, no build)
    let mut meta_args = vec!["metadata", "--no-deps", "--format-version", "1"];
    if !online {
        meta_args.push("--offline");
    }
    let meta = run(&wd, "cargo", &meta_args);
    let mut direct: Vec<String> = serde_json::from_str::<Value>(&meta.stdout)
        .map(|v| {
            v["packages"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .flat_map(|p| p["dependencies"].as_array().cloned().unwrap_or_default())
                .filter_map(|d| d["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_else(|_| {
            cargo_direct(&std::fs::read_to_string(wd.join("Cargo.toml")).unwrap_or_default())
        });
    direct.sort();
    direct.dedup();
    let mut args = vec!["update", "--dry-run", "--verbose"];
    if !online {
        args.push("--offline");
    }
    e.commands.push(format!("cargo {}", args.join(" ")));
    let u = run(&wd, "cargo", &args);
    if u.code == 0 {
        e.outdated = parse_cargo_update(&u.stderr, &direct);
    } else {
        e.notes
            .push(format!("cargo update: {}", last_line(&u.stderr)));
    }
    if has("cargo", &["audit", "--version"]) {
        let mut a = vec!["audit", "--json"];
        if !online {
            a.push("--no-fetch");
        }
        e.commands.push(format!("cargo {}", a.join(" ")));
        let o = run(&wd, "cargo", &a);
        match serde_json::from_str::<Value>(&o.stdout) {
            Ok(v) => e.vulns = parse_cargo_audit(&v),
            Err(_) => e
                .notes
                .push(format!("cargo audit: {}", last_line(&o.stderr))),
        }
    } else {
        e.notes.push("cargo-audit is not installed (`cargo install cargo-audit`): no vulnerability check for Rust.".into());
    }
    e
}

fn npm(root: &Path, dir: &str, online: bool) -> Ecosystem {
    let wd = if dir == "." {
        root.to_path_buf()
    } else {
        root.join(dir)
    };
    let mut e = Ecosystem {
        kind: "npm".into(),
        dir: dir.into(),
        ..Default::default()
    };
    if !online {
        e.notes.push(
            "npm asks the registry: check online to see what is outdated and vulnerable.".into(),
        );
        return e;
    }
    if !has("npm", &["--version"]) {
        e.notes.push("npm is not installed.".into());
        return e;
    }
    let pkg: Value =
        serde_json::from_str(&std::fs::read_to_string(wd.join("package.json")).unwrap_or_default())
            .unwrap_or(Value::Null);
    let direct: Vec<String> = ["dependencies", "devDependencies"]
        .iter()
        .flat_map(|k| {
            pkg[k]
                .as_object()
                .map(|o| o.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
        })
        .collect();
    e.commands.push("npm outdated --json".into());
    let o = run(&wd, "npm", &["outdated", "--json"]); // exit 1 when something is outdated
    match serde_json::from_str::<Value>(if o.stdout.trim().is_empty() {
        "{}"
    } else {
        &o.stdout
    }) {
        Ok(v) if v.get("error").is_none() => e.outdated = parse_npm_outdated(&v, &direct),
        _ => e
            .notes
            .push(format!("npm outdated: {}", last_line(&o.stderr))),
    }
    e.commands.push("npm audit --json".into());
    let a = run(&wd, "npm", &["audit", "--json"]);
    match serde_json::from_str::<Value>(&a.stdout) {
        Ok(v) if v.get("error").is_none() => e.vulns = parse_npm_audit(&v),
        _ => e.notes.push(format!("npm audit: {}", last_line(&a.stderr))),
    }
    e
}

fn golang(root: &Path, dir: &str, online: bool) -> Ecosystem {
    let wd = if dir == "." {
        root.to_path_buf()
    } else {
        root.join(dir)
    };
    let mut e = Ecosystem {
        kind: "go".into(),
        dir: dir.into(),
        ..Default::default()
    };
    if !online {
        e.notes
            .push("go asks the module proxy: check online to see the updates.".into());
        return e;
    }
    e.commands.push("go list -m -u -json all".into());
    let o = run(&wd, "go", &["list", "-m", "-u", "-json", "all"]);
    if o.code == 0 {
        e.outdated = parse_go_list(&o.stdout);
    } else {
        e.notes.push(format!("go list: {}", last_line(&o.stderr)));
    }
    e
}

/// What is behind and what is vulnerable, per ecosystem found under `root`.
pub fn report(root: &Path, online: bool) -> DepsReport {
    let ecosystems = manifests(root)
        .into_iter()
        .map(|(kind, dir)| match kind.as_str() {
            "cargo" => cargo(root, &dir, online),
            "npm" => npm(root, &dir, online),
            _ => golang(root, &dir, online),
        })
        .collect();
    DepsReport { ecosystems, online }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jumps_and_direct_dependencies() {
        assert_eq!(jump("1.2.3", "1.2.9"), "patch");
        assert_eq!(jump("1.2.3", "1.4.0"), "minor");
        assert_eq!(jump("1.2.3", "2.0.0"), "major");
        assert_eq!(jump("0.22.1", "0.23.1"), "major");
        assert_eq!(jump("v0.14.7", "v0.14.9"), "patch");
        let d = cargo_direct("[package]\nname = \"x\"\n[dependencies]\nserde = { version = \"1\" }\ntokio = \"1\"\n[dev-dependencies]\ntempfile = \"3\"\n[dependencies.rand]\nversion = \"0.8\"\n[workspace.dependencies]\nanyhow = \"1\"\n");
        assert_eq!(d, vec!["anyhow", "rand", "serde", "tempfile", "tokio"]);
    }

    #[test]
    fn parses_cargo_update_and_audit() {
        let t = "     Locking 3 packages\n   Unchanged base64 v0.22.1 (available: v0.23.1)\n    Updating bytes v1.12.1 -> v1.12.2\n    Updating hyper v1.12.0 -> v1.13.0\n";
        let o = parse_cargo_update(t, &["hyper".into()]);
        assert_eq!(o[0].name, "hyper");
        assert!(
            o[0].direct && o[0].jump == "minor" && o[0].compatible.as_deref() == Some("1.13.0")
        );
        let b = o.iter().find(|x| x.name == "base64").unwrap();
        assert_eq!(
            (b.latest.as_deref(), b.compatible.clone(), b.jump.as_str()),
            (Some("0.23.1"), None, "major")
        );
        let a = parse_cargo_audit(
            &json!({"vulnerabilities": {"list": [{"advisory": {"id": "RUSTSEC-2026-0367", "title": " Insecure SUID ", "cvss": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N", "url": ""}, "package": {"name": "zip", "version": "2.1.0"}, "versions": {"patched": [">=2.4.2"]}}]}, "warnings": {"unmaintained": [{"advisory": {"id": "RUSTSEC-2024-0001", "title": "x is unmaintained"}, "package": {"name": "x", "version": "0.1.0"}, "versions": {"patched": []}}]}}),
        );
        assert_eq!(
            (
                a[0].severity.as_str(),
                a[0].title.as_str(),
                a[0].fixed[0].as_str()
            ),
            ("critical", "Insecure SUID", ">=2.4.2")
        );
        assert!(a[0].url.ends_with("RUSTSEC-2026-0367"));
        assert_eq!(a[1].severity, "unmaintained");
    }

    #[test]
    fn parses_npm_and_go() {
        let o = parse_npm_outdated(
            &json!({"react": {"current": "18.2.0", "wanted": "18.3.1", "latest": "19.1.0"}, "lodash": {"current": "4.17.20", "wanted": "4.17.21", "latest": "4.17.21"}}),
            &["react".into()],
        );
        assert_eq!(
            (
                o[0].name.as_str(),
                o[0].jump.as_str(),
                o[0].compatible.as_deref()
            ),
            ("react", "major", Some("18.3.1"))
        );
        let a = parse_npm_audit(
            &json!({"vulnerabilities": {"minimist": {"severity": "critical", "range": "<1.2.6", "via": [{"title": "Prototype Pollution", "url": "https://github.com/advisories/GHSA-xvch-5gv4-984h"}], "fixAvailable": true}}}),
        );
        assert_eq!(
            (
                a[0].id.as_str(),
                a[0].severity.as_str(),
                a[0].fixed[0].as_str()
            ),
            ("GHSA-xvch-5gv4-984h", "critical", "npm audit fix")
        );
        let g = parse_go_list("{\"Path\":\"example.com/me\",\"Main\":true}\n{\"Path\":\"golang.org/x/net\",\"Version\":\"v0.20.0\",\"Update\":{\"Version\":\"v0.31.0\"}}\n{\"Path\":\"github.com/a/b\",\"Version\":\"v1.0.0\",\"Indirect\":true}\n");
        assert_eq!(g.len(), 1);
        assert_eq!(
            (g[0].name.as_str(), g[0].jump.as_str(), g[0].direct),
            ("golang.org/x/net", "major", true)
        );
    }

    #[test]
    fn real_cargo_report_offline() {
        if !has("cargo", &["--version"]) {
            eprintln!("skipped: no cargo");
            return;
        }
        // this repository itself: an offline dry run never changes the lock
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let lock_before = std::fs::read(root.join("Cargo.lock")).unwrap();
        let r = report(&root, false);
        let c = r
            .ecosystems
            .iter()
            .find(|e| e.kind == "cargo" && e.dir == ".")
            .expect("the root Cargo workspace");
        assert!(
            c.notes.iter().all(|n| !n.starts_with("cargo update")),
            "{:?}",
            c.notes
        );
        assert!(c.commands.iter().any(|x| x.contains("--offline")));
        assert_eq!(
            std::fs::read(root.join("Cargo.lock")).unwrap(),
            lock_before,
            "the lock must not change"
        );
        let npm = r.ecosystems.iter().find(|e| e.kind == "npm");
        if let Some(n) = npm {
            assert!(n.notes[0].contains("online"));
        }
    }
}
