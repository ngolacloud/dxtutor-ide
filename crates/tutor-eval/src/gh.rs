//! The GitHub CLI, read-only (r23 F3, UI-SCM-14 and the commit lifecycle): whether `gh` is installed and
//! signed in, the open pull requests that need the person (theirs, review requested, all), the CI runs of a
//! commit and the pull request that contains it. Always `--json`; nothing is written to GitHub. Without `gh`
//! every call says so («not installed», with how to install it) — the UI never invents a value.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const INSTALL_HINT: &str =
    "Install the GitHub CLI (https://cli.github.com) and run `gh auth login`.";

fn run(
    program: &str,
    root: Option<&Path>,
    args: &[&str],
) -> Result<(bool, String, String), String> {
    let mut cmd = Command::new(program);
    if let Some(r) = root {
        cmd.current_dir(r);
    }
    cmd.args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::null());
    match cmd.output() {
        Ok(o) => Ok((
            o.status.success(),
            String::from_utf8_lossy(&o.stdout).to_string(),
            String::from_utf8_lossy(&o.stderr).trim().to_string(),
        )),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Err(format!("gh is not installed. {INSTALL_HINT}"))
        }
        Err(e) => Err(format!("could not start gh: {e}")),
    }
}

fn json(program: &str, root: &Path, args: &[&str]) -> Result<Value, String> {
    let (ok, out, err) = run(program, Some(root), args)?;
    if !ok {
        return Err(if err.is_empty() {
            "gh failed".into()
        } else {
            err
        });
    }
    serde_json::from_str(&out).map_err(|e| format!("gh returned something that is not JSON: {e}"))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhStatus {
    pub installed: bool,
    pub version: String,
    pub signed_in: bool,
    pub notes: String,
}

pub fn status_with(program: &str) -> GhStatus {
    match run(program, None, &["--version"]) {
        Err(e) => GhStatus {
            installed: false,
            version: String::new(),
            signed_in: false,
            notes: e,
        },
        Ok((_, out, _)) => {
            let version = out.lines().next().unwrap_or("").trim().to_string();
            let signed_in = matches!(
                run(program, None, &["auth", "status", "--active"]),
                Ok((true, _, _))
            );
            GhStatus {
                installed: true,
                version,
                signed_in,
                notes: if signed_in {
                    String::new()
                } else {
                    "Not signed in: run `gh auth login`.".into()
                },
            }
        }
    }
}
pub fn status() -> GhStatus {
    status_with("gh")
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrFilter {
    /// open pull requests asking me for a review
    Review,
    /// my open pull requests
    Mine,
    /// every open pull request
    Open,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Checks {
    pub passed: u32,
    pub failed: u32,
    pub pending: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub url: String,
    pub draft: bool,
    pub state: String,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or empty
    pub review: String,
    pub checks: Checks,
    pub updated_at: String,
}

const PR_FIELDS: &str = "number,title,author,headRefName,baseRefName,url,isDraft,state,reviewDecision,statusCheckRollup,updatedAt";

/// `statusCheckRollup` entries: check runs (`status`/`conclusion`) and commit statuses (`state`).
pub fn checks_of(v: &Value) -> Checks {
    let mut c = Checks::default();
    for e in v.as_array().into_iter().flatten() {
        let concl = e.get("conclusion").and_then(Value::as_str).unwrap_or("");
        let state = e.get("state").and_then(Value::as_str).unwrap_or("");
        let status = e.get("status").and_then(Value::as_str).unwrap_or("");
        match (concl, state, status) {
            ("SUCCESS" | "NEUTRAL" | "SKIPPED", _, _) | (_, "SUCCESS", _) => c.passed += 1,
            (
                "FAILURE" | "TIMED_OUT" | "CANCELLED" | "ACTION_REQUIRED" | "STARTUP_FAILURE",
                _,
                _,
            )
            | (_, "FAILURE" | "ERROR", _) => c.failed += 1,
            _ => c.pending += 1,
        }
    }
    c
}

pub fn parse_prs(v: &Value) -> Vec<Pr> {
    let s = |p: &Value, k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    v.as_array()
        .into_iter()
        .flatten()
        .map(|p| Pr {
            number: p.get("number").and_then(Value::as_u64).unwrap_or(0),
            title: s(p, "title"),
            author: p
                .get("author")
                .and_then(|a| a.get("login"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            head: s(p, "headRefName"),
            base: s(p, "baseRefName"),
            url: s(p, "url"),
            draft: p.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
            state: s(p, "state"),
            review: s(p, "reviewDecision"),
            checks: checks_of(p.get("statusCheckRollup").unwrap_or(&Value::Null)),
            updated_at: s(p, "updatedAt"),
        })
        .collect()
}

pub fn prs_with(program: &str, root: &Path, filter: PrFilter) -> Result<Vec<Pr>, String> {
    let mut args = vec![
        "pr", "list", "--state", "open", "--limit", "50", "--json", PR_FIELDS,
    ];
    match filter {
        PrFilter::Review => args.extend(["--search", "review-requested:@me"]),
        PrFilter::Mine => args.extend(["--author", "@me"]),
        PrFilter::Open => {}
    }
    Ok(parse_prs(&json(program, root, &args)?))
}
pub fn prs(root: &Path, filter: PrFilter) -> Result<Vec<Pr>, String> {
    prs_with("gh", root, filter)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: u64,
    pub name: String,
    /// `queued`, `in_progress`, `completed`
    pub status: String,
    /// `success`, `failure`, … (empty until completed)
    pub conclusion: String,
    pub url: String,
    pub created_at: String,
}

fn check_sha(sha: &str) -> Result<&str, String> {
    if sha.len() >= 7 && sha.len() <= 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(sha)
    } else {
        Err(format!("not a commit hash: {sha:?}"))
    }
}

/// The full hash of a (short) commit hash in `root` (GitHub matches runs on the full one).
fn full_sha(root: &Path, sha: &str) -> String {
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{sha}^{{commit}}"),
        ])
        .stdin(Stdio::null())
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| s.len() == 40)
        .unwrap_or_else(|| sha.to_string())
}

pub fn parse_runs(v: &Value) -> Vec<Run> {
    let s = |p: &Value, k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    v.as_array()
        .into_iter()
        .flatten()
        .map(|r| Run {
            id: r.get("databaseId").and_then(Value::as_u64).unwrap_or(0),
            name: s(r, "name"),
            status: s(r, "status"),
            conclusion: s(r, "conclusion"),
            url: s(r, "url"),
            created_at: s(r, "createdAt"),
        })
        .collect()
}

/// The CI runs (GitHub Actions) of one commit.
pub fn runs_for_with(program: &str, root: &Path, sha: &str) -> Result<Vec<Run>, String> {
    let sha = check_sha(sha)?;
    Ok(parse_runs(&json(
        program,
        root,
        &[
            "run",
            "list",
            "--commit",
            sha,
            "--limit",
            "20",
            "--json",
            "databaseId,name,status,conclusion,url,createdAt",
        ],
    )?))
}
pub fn runs_for(root: &Path, sha: &str) -> Result<Vec<Run>, String> {
    runs_for_with("gh", root, sha)
}

/// The pull requests (any state) that contain one commit.
pub fn prs_for_with(program: &str, root: &Path, sha: &str) -> Result<Vec<Pr>, String> {
    let sha = check_sha(sha)?;
    Ok(parse_prs(&json(
        program,
        root,
        &[
            "pr", "list", "--state", "all", "--search", sha, "--limit", "5", "--json", PR_FIELDS,
        ],
    )?))
}
pub fn prs_for(root: &Path, sha: &str) -> Result<Vec<Pr>, String> {
    prs_for_with("gh", root, sha)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake `gh` that prints `out` for any arguments and exits with `code` (and logs its arguments).
    fn fake(dir: &Path, out: &str, code: i32) -> String {
        let p = dir.join("gh");
        std::fs::write(
            &p,
            format!(
                "#!/bin/sh\necho \"$@\" >> \"{}/args\"\ncat <<'JSON'\n{out}\nJSON\nexit {code}\n",
                dir.display()
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        p.display().to_string()
    }

    #[test]
    fn pull_requests_with_their_checks_and_review() {
        let d = tempfile::tempdir().unwrap();
        let gh = fake(
            d.path(),
            r#"[{"number":42,"title":"feat: paginate (DX-12)","author":{"login":"ana"},"headRefName":"feature/page","baseRefName":"develop","url":"https://x/42","isDraft":false,"state":"OPEN","reviewDecision":"CHANGES_REQUESTED","updatedAt":"2026-11-25T10:00:00Z","statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS"},{"status":"COMPLETED","conclusion":"FAILURE"},{"status":"IN_PROGRESS","conclusion":""},{"state":"SUCCESS"}]}]"#,
            0,
        );
        let p = prs_with(&gh, d.path(), PrFilter::Review).unwrap();
        assert_eq!(
            (
                p[0].number,
                p[0].author.as_str(),
                p[0].head.as_str(),
                p[0].review.as_str()
            ),
            (42, "ana", "feature/page", "CHANGES_REQUESTED")
        );
        assert_eq!(
            p[0].checks,
            Checks {
                passed: 2,
                failed: 1,
                pending: 1
            }
        );
        let args = std::fs::read_to_string(d.path().join("args")).unwrap();
        assert!(
            args.contains("review-requested:@me") && args.contains("--json"),
            "{args}"
        );
    }

    #[test]
    fn runs_and_prs_of_a_commit_and_the_errors() {
        let d = tempfile::tempdir().unwrap();
        let gh = fake(
            d.path(),
            r#"[{"databaseId":7,"name":"CI","status":"completed","conclusion":"success","url":"https://x/r/7","createdAt":"2026-11-25T10:00:00Z"}]"#,
            0,
        );
        let r = runs_for_with(&gh, d.path(), "abc1234").unwrap();
        assert_eq!((r[0].id, r[0].conclusion.as_str()), (7, "success"));
        assert!(runs_for_with(&gh, d.path(), "--x").is_err());
        let bad = fake(d.path(), "", 1);
        assert!(prs_for_with(&bad, d.path(), "abc1234").is_err());
        let none = prs_with("/nonexistent/gh-xyz", d.path(), PrFilter::Mine).unwrap_err();
        assert!(none.contains("not installed"), "{none}");
        assert!(!status_with("/nonexistent/gh-xyz").installed);
    }
}
