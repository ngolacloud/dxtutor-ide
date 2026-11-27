//! The GitHub CLI (r23 F3, UI-SCM-14 and the commit lifecycle): whether `gh` is installed and signed in,
//! the open pull requests that need the person (theirs, review requested, all), the CI runs of a commit
//! and the pull request that contains it. Always `--json`. Without `gh` every call says so («not
//! installed», with how to install it) — the UI never invents a value.
//!
//! One call writes to GitHub: [`create_pr_with`] (Multi Co-Dev, phase 5 — the caller approved and audited
//! it first). Nothing here merges a pull request, and nothing ever runs `gh auth login`: a `gh` that is not
//! signed in is reported, never fixed on the owner's behalf.

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

/// [`run`] with `input` on stdin (the body of a pull request: `--body-file -`).
fn run_with_input(
    program: &str,
    root: &Path,
    args: &[&str],
    input: &str,
) -> Result<(bool, String, String), String> {
    use std::io::Write;
    let mut cmd = Command::new(program);
    cmd.current_dir(root)
        .args(args)
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_COLOR", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("gh is not installed. {INSTALL_HINT}"))
        }
        Err(e) => return Err(format!("could not start gh: {e}")),
    };
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("could not write to gh: {e}"))?;
    }
    let o = child
        .wait_with_output()
        .map_err(|e| format!("gh failed: {e}"))?;
    Ok((
        o.status.success(),
        String::from_utf8_lossy(&o.stdout).to_string(),
        String::from_utf8_lossy(&o.stderr).trim().to_string(),
    ))
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
    let full = full_sha(root, check_sha(sha)?);
    let sha = full.as_str();
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

/* ───── Multi Co-Dev, phase 5: the pull request of an issue ───── */

/// A pull request just opened.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub number: u64,
    pub url: String,
}

/// The number of a pull request from its URL (`…/pull/42`).
pub fn number_of(url: &str) -> Option<u64> {
    url.trim()
        .trim_end_matches('/')
        .rsplit_once("/pull/")
        .and_then(|(_, n)| n.parse().ok())
}

fn check_branch_name(b: &str) -> Result<&str, String> {
    let b = b.trim();
    if b.is_empty() || b.starts_with('-') || b.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("not a branch name: {b:?}"));
    }
    Ok(b)
}

/// The exact `gh` command that opens the pull request (for the approval dialog and the audit log;
/// the body goes on stdin).
pub fn create_pr_command(program: &str, base: &str, head: &str, title: &str) -> String {
    let q = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    format!(
        "{program} pr create --base {} --head {} --title {} --body-file -   # the body: the gate's evidence",
        q(base),
        q(head),
        q(title)
    )
}

/// Opens a pull request of `head` into `base` with `title` and `body` (Markdown). Asks `gh` only
/// when it is installed and signed in — it never logs in. The caller pushed `head` first and
/// audited both.
pub fn create_pr_with(
    program: &str,
    root: &Path,
    base: &str,
    head: &str,
    title: &str,
    body: &str,
) -> Result<Created, String> {
    let base = check_branch_name(base)?;
    let head = check_branch_name(head)?;
    let st = status_with(program);
    if !st.installed {
        return Err(st.notes);
    }
    if !st.signed_in {
        return Err(
            "gh is not signed in: run `gh auth login` yourself (dxtutor never logs in for you)"
                .into(),
        );
    }
    let title: String = title.trim().chars().take(240).collect();
    let (ok, out, err) = run_with_input(
        program,
        root,
        &[
            "pr",
            "create",
            "--base",
            base,
            "--head",
            head,
            "--title",
            &title,
            "--body-file",
            "-",
        ],
        body,
    )?;
    if !ok {
        return Err(if err.is_empty() {
            "gh pr create failed".into()
        } else {
            format!("gh pr create: {err}")
        });
    }
    let url = out
        .lines()
        .map(str::trim)
        .rfind(|l| l.contains("/pull/"))
        .unwrap_or("")
        .to_string();
    let number = number_of(&url).ok_or_else(|| {
        format!(
            "gh pr create did not say which pull request it opened: {}",
            out.trim()
        )
    })?;
    Ok(Created { number, url })
}

/// A pull request as GitHub has it now (read-only).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrLive {
    pub number: u64,
    pub url: String,
    /// `OPEN`, `CLOSED`, `MERGED`
    pub state: String,
    pub draft: bool,
    /// `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED` or empty
    pub review: String,
    pub checks: Checks,
    pub head: String,
    pub head_oid: String,
    pub base: String,
    pub merged_at: String,
}

pub fn parse_pr_live(v: &Value) -> Option<PrLive> {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    Some(PrLive {
        number: v.get("number").and_then(Value::as_u64)?,
        url: s("url"),
        state: s("state"),
        draft: v.get("isDraft").and_then(Value::as_bool).unwrap_or(false),
        review: s("reviewDecision"),
        checks: checks_of(v.get("statusCheckRollup").unwrap_or(&Value::Null)),
        head: s("headRefName"),
        head_oid: s("headRefOid"),
        base: s("baseRefName"),
        merged_at: s("mergedAt"),
    })
}

/// Pull request `number` now (read-only: `gh pr view --json`).
pub fn pr_view_with(program: &str, root: &Path, number: u64) -> Result<PrLive, String> {
    let n = number.to_string();
    let v = json(
        program,
        root,
        &[
            "pr",
            "view",
            &n,
            "--json",
            "number,url,state,isDraft,reviewDecision,statusCheckRollup,headRefName,headRefOid,baseRefName,mergedAt",
        ],
    )?;
    parse_pr_live(&v).ok_or_else(|| "gh pr view returned no pull request".to_string())
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

    /// GitHub matches runs on the full hash: a short one from the graph is resolved first.
    #[test]
    fn runs_are_asked_with_the_full_hash() {
        let d = tempfile::tempdir().unwrap();
        let repo = d.path().join("r");
        std::fs::create_dir(&repo).unwrap();
        let git = |a: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(&repo)
                    .args(a)
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{a:?}"
            );
        };
        git(&["init", "-q"]);
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@x",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "one",
        ]);
        let out = Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap();
        let full = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let gh = fake(d.path(), "[]", 0);
        runs_for_with(&gh, &repo, &full[..7]).unwrap();
        let args = std::fs::read_to_string(d.path().join("args")).unwrap();
        assert!(args.contains(&format!("--commit {full}")), "{args}");
    }
    #[test]
    fn a_pull_request_is_opened_with_the_body_on_stdin_and_never_a_login() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("gh");
        std::fs::write(
            &p,
            format!(
                "#!/bin/sh\necho \"$@\" >> \"{0}/args\"\ncase \"$1 $2\" in\n  \"--version \") echo 'gh version 2.0.0 (fake)';;\n  \"auth status\") exit 0;;\n  \"pr create\") cat > \"{0}/body\"; echo 'https://github.com/o/r/pull/42';;\n  \"pr view\") echo '{{\"number\":42,\"url\":\"https://github.com/o/r/pull/42\",\"state\":\"OPEN\",\"isDraft\":false,\"reviewDecision\":\"\",\"statusCheckRollup\":[{{\"conclusion\":\"SUCCESS\"}}],\"headRefName\":\"feature/x\",\"headRefOid\":\"abc\",\"baseRefName\":\"main\",\"mergedAt\":\"\"}}';;\nesac\n",
                d.path().display()
            ),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let gh = p.display().to_string();
        let c = create_pr_with(
            &gh,
            d.path(),
            "main",
            "feature/x",
            "DX-1: pay",
            "## evidence\n",
        )
        .unwrap();
        assert_eq!(
            c,
            Created {
                number: 42,
                url: "https://github.com/o/r/pull/42".into()
            }
        );
        assert_eq!(
            std::fs::read_to_string(d.path().join("body")).unwrap(),
            "## evidence\n"
        );
        let args = std::fs::read_to_string(d.path().join("args")).unwrap();
        assert!(
            args.contains("pr create --base main --head feature/x --title DX-1: pay --body-file -"),
            "{args}"
        );
        assert!(
            !args.contains("auth login") && !args.contains("merge"),
            "{args}"
        );
        let live = pr_view_with(&gh, d.path(), 42).unwrap();
        assert_eq!(
            (live.state.as_str(), live.checks.passed, live.base.as_str()),
            ("OPEN", 1, "main")
        );
        // option-looking branches are refused before gh runs
        assert!(create_pr_with(&gh, d.path(), "--repo=x", "feature/x", "t", "b").is_err());
        assert_eq!(number_of("https://github.com/o/r/pull/7/"), Some(7));
        assert!(create_pr_command("gh", "main", "feature/x", "it's").contains("--title 'it'\\''s'"));
    }

    #[test]
    fn not_installed_or_not_signed_in_is_said_and_nothing_is_created() {
        let d = tempfile::tempdir().unwrap();
        let e = create_pr_with("/nonexistent/gh-xyz", d.path(), "main", "f", "t", "b").unwrap_err();
        assert!(e.contains("not installed"), "{e}");
        // signed out: `auth status` fails, and `pr create` is never run
        let gh = fake(d.path(), "", 1);
        let e = create_pr_with(&gh, d.path(), "main", "f", "t", "b").unwrap_err();
        assert!(e.contains("not signed in"), "{e}");
        let args = std::fs::read_to_string(d.path().join("args")).unwrap();
        assert!(
            !args.contains("pr create") && !args.contains("login"),
            "{args}"
        );
    }
}
