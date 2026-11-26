//! The data sources of the Platform activity (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — RF-BK-Q03): CI/CD,
//! cloud cost, metrics and logs, cloud inventory. Always read-only, connected explicitly; without one the
//! state is «not connected», never an estimated number. Here, CI/CD is GitHub through `gh` (signed in,
//! read verbs only) and metrics are Prometheus (`crate::metrics`, `.dxtutor/metrics.json`); the others have no
//! connector yet and say how one would be connected.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// `cicd` | `cost` | `obs` | `cloud`
    pub kind: String,
    pub connected: bool,
    /// how it is read when connected (`gh, read-only`)
    pub via: Option<String>,
    pub notes: String,
    /// how to connect it
    pub hint: Option<String>,
}

fn out(cmd: &dyn Fn(&str) -> Command, root: &Path, program: &str, args: &[&str]) -> Option<String> {
    let o = cmd(program)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    o.status
        .success()
        .then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// The sources, as this machine and project have them.
pub fn status(
    cmd: &dyn Fn(&str) -> Command,
    has: &dyn Fn(&str) -> bool,
    store: &dyn crate::keychain::Store,
    root: &Path,
) -> Vec<Source> {
    let cicd = if !has("gh") {
        Source {
            kind: "cicd".into(),
            connected: false,
            via: None,
            notes: "gh is not installed".into(),
            hint: Some("Install the GitHub CLI and run `gh auth login`".into()),
        }
    } else {
        let user = out(cmd, root, "gh", &["api", "user", "-q", ".login"]);
        let remote = out(cmd, root, "git", &["remote", "get-url", "origin"]).unwrap_or_default();
        match user {
            None => Source {
                kind: "cicd".into(),
                connected: false,
                via: None,
                notes: "gh is not signed in".into(),
                hint: Some("gh auth login".into()),
            },
            Some(_) if !remote.contains("github.com") => Source {
                kind: "cicd".into(),
                connected: false,
                via: None,
                notes: if remote.is_empty() {
                    "this project has no origin".into()
                } else {
                    "the origin is not on GitHub".into()
                },
                hint: None,
            },
            Some(u) => Source {
                kind: "cicd".into(),
                connected: true,
                via: Some(format!("gh as {u}, read-only (runs, pull requests)")),
                notes: String::new(),
                hint: None,
            },
        }
    };
    let none = |kind: &str, hint: &str| Source {
        kind: kind.into(),
        connected: false,
        via: None,
        notes: "not connected".into(),
        hint: Some(hint.into()),
    };
    vec![
        cicd,
        none("cost", "A read-only cost source (AWS Cost Explorer, GCP Billing export, Azure Cost Management, or Kubecost) with credentials from Vault — no connector yet"),
        crate::metrics::source(store, root),
        none("cloud", "A read-only cloud inventory with short-lived credentials from Vault (e.g. vault read aws/creds/inventory-readonly) — no connector yet"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_a_source_nothing_is_connected() {
        let d = tempfile::tempdir().unwrap();
        let cmd = |p: &str| Command::new(p);
        let s = status(
            &cmd,
            &|_| false,
            &crate::keychain::MemStore::default(),
            d.path(),
        );
        assert_eq!(
            s.iter()
                .map(|x| (x.kind.as_str(), x.connected))
                .collect::<Vec<_>>(),
            vec![
                ("cicd", false),
                ("cost", false),
                ("obs", false),
                ("cloud", false)
            ]
        );
        assert!(s.iter().all(|x| x.hint.is_some()));
        assert_eq!(s[0].notes, "gh is not installed");
    }
}
