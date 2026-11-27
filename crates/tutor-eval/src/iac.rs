//! The IaC pipeline, the reviewed plan, drift and the state (r23 F4b, docs/v2/AUDIT-r23.md §4.4 —
//! P01–P05).
//!
//! - **Pipeline (P01):** init → fmt → validate → the built-in rules → tflint → checkov → trivy →
//!   secrets kept in the state → plan → drift → conftest → infracost. Each stage is `ok`, `failed`,
//!   `not_installed` (with how to install it — never a green stage), `not_connected` or `skipped`.
//!   A failed stage blocks the apply, and the rule lives here: [`apply_command`] refuses a plan whose
//!   run was blocked.
//! - **The reviewed plan:** the plan file is kept in the app's data folder, named by its SHA-256, with
//!   the hash of the configuration it was made from. Applying applies THAT file (`apply <file>`), never
//!   a new plan; a plan whose file or configuration changed since, or older than a day, is refused.
//! - **Findings (P03):** the built-in rules (`iacfind`) and the scanners' JSON, each with a stable key
//!   (source, rule, file, and the text of the line or the resource) so a human can accept the risk
//!   with a reason for 30 days (stored by the caller; this module gets the accepted keys).
//! - **Drift (P04):** what the plan read as changed outside the code; it blocks the apply until it is
//!   reverted (a targeted run), written into the code, or ignored with a reason.
//! - **State (P05):** addresses and ids only, read with `state pull`; the lock and the backup of a
//!   local state. Secret values are read in memory to find where they are and never serialized.
//!
//! The tools are run through a factory the caller passes (the desktop resolves them in the login
//! shell's environment). Nothing here applies anything: the human runs the apply in a terminal.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::ops::{self, IacPlan};

/// How long a reviewed plan can be applied.
pub const PLAN_TTL: Duration = Duration::from_secs(24 * 3600);
/// How long an accepted risk (or an ignored drift) lasts.
pub const ACCEPT_DAYS: i64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    Ok,
    Failed,
    NotInstalled,
    NotConnected,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// `built-in` | `validate` | `fmt` | `tflint` | `checkov` | `trivy` | `state` | `drift` | `conftest`
    pub source: String,
    pub rule: String,
    /// relative to the project root (`/` separators); the folder when there is no file
    pub file: String,
    /// 1-based; 0 when the tool does not say
    pub line: u32,
    /// `error` (blocks unless accepted) | `warning`
    pub severity: String,
    pub message: String,
    /// the resource the tool names, when it does
    pub resource: Option<String>,
    /// what an acceptance is stored under
    pub key: String,
    pub accepted: bool,
}

impl Finding {
    pub fn blocks(&self) -> bool {
        self.severity == "error" && !self.accepted
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    /// `init` | `fmt` | `validate` | `rules` | `tflint` | `checkov` | `trivy` | `state` | `plan` |
    /// `drift` | `conftest` | `infracost`
    pub id: String,
    pub status: Status,
    /// one line: what it found, or why it did not run
    pub summary: String,
    /// the tool's own words (the tail, secrets masked)
    pub detail: String,
    /// how to install the tool (`not_installed`) or connect the source (`not_connected`)
    pub hint: Option<String>,
    /// the command it ran (or would run)
    pub command: String,
    pub findings: Vec<Finding>,
    pub ms: u64,
}

impl Stage {
    fn new(id: &str, status: Status, summary: impl Into<String>) -> Self {
        Stage {
            id: id.into(),
            status,
            summary: summary.into(),
            detail: String::new(),
            hint: None,
            command: String::new(),
            findings: vec![],
            ms: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PipelineRun {
    /// the plan's id (the SHA-256 of its file); empty without a plan
    pub id: String,
    pub tool: String,
    pub dir: String,
    /// the address a targeted run (a drift revert) plans
    pub target: Option<String>,
    pub stages: Vec<Stage>,
    #[serde(skip_deserializing)]
    pub plan: Option<IacPlan>,
    /// a stage failed: the plan cannot be applied
    pub blocked: bool,
    /// the stages that block
    pub blockers: Vec<String>,
    pub notes: String,
}

/// What a run needs from the caller.
pub struct Ctx<'a> {
    pub root: &'a Path,
    /// relative to the root, `.` for the root
    pub dir: &'a str,
    /// a targeted plan (`-target=<address>`)
    pub target: Option<&'a str>,
    /// where reviewed plans are kept (the app's data folder)
    pub plans: &'a Path,
    /// the keys of the accepted risks and ignored drift still in force
    pub accepted: &'a HashSet<String>,
    /// builds a command for a tool (the desktop: in the login shell's environment)
    pub cmd: &'a dyn Fn(&str) -> Command,
    /// is the tool installed?
    pub has: &'a dyn Fn(&str) -> bool,
}

/// How to install each tool (the hint of a `not_installed` stage).
pub fn install_hint(tool: &str) -> &'static str {
    match tool {
        "tofu" => "Install OpenTofu (opentofu.org/docs/intro/install) or Terraform.",
        "tflint" => "Install TFLint: curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash",
        "checkov" => "Install Checkov: pipx install checkov",
        "trivy" => "Install Trivy (aquasecurity.github.io/trivy): apt install trivy, or brew install trivy",
        "conftest" => "Install conftest (conftest.dev/install) and write Rego policies in policy/",
        "infracost" => "Install infracost (infracost.io/docs) and run `infracost auth login`",
        _ => "",
    }
}

/// infracost is installed but has no API key (the `not_connected` hint).
pub const CONNECT_INFRACOST: &str =
    "Run `infracost auth login` (a free API key) or set INFRACOST_API_KEY; prices are fetched from infracost's service.";

/// The tool on PATH as the caller resolves it: OpenTofu first, then Terraform.
pub fn tool_of(has: &dyn Fn(&str) -> bool) -> Option<&'static str> {
    ["tofu", "terraform"].into_iter().find(|t| has(t))
}

// ───── running the tools ─────

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

fn exec(mut c: Command, wd: &Path) -> Out {
    c.current_dir(wd)
        .env("TF_IN_AUTOMATION", "1")
        .env("TF_INPUT", "0")
        .env("NO_COLOR", "1")
        .env("CHECKOV_RUN_SCA_PACKAGE_SCAN_V2", "false")
        .stdin(Stdio::null());
    match c.output() {
        Ok(o) => Out {
            code: o.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => Out {
            code: -1,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

/// The tail of a tool's output, secrets masked.
fn words(s: &str) -> String {
    let t = s.trim();
    let n = 3000;
    let t = if t.len() > n {
        let mut i = t.len() - n;
        while !t.is_char_boundary(i) {
            i += 1;
        }
        format!("…{}", &t[i..])
    } else {
        t.to_string()
    };
    tutor_protect::redact::current().mask(&t)
}

// ───── infracost: never interactive ─────
//
// infracost 2.x without credentials starts a sign-in (a browser page, or a device code) and waits
// for a human; `breakdown` runs `scan`, which does the same. The pipeline must never do that: without
// credentials the stage is `not_connected` and infracost does not run; with them it runs with no
// terminal and nothing that can show a page, is stopped at a sign-in prompt, and has a deadline.

/// How long infracost may run (it fetches prices over the network).
pub const INFRACOST_TIMEOUT: Duration = Duration::from_secs(180);

/// The variables infracost takes a key or a token from.
const INFRACOST_KEY_VARS: [&str; 3] = [
    "INFRACOST_API_KEY",
    "INFRACOST_CLI_AUTHENTICATION_TOKEN",
    "INFRACOST_CLI_PRICING_API_KEY",
];

/// The value a command will see for `name`: what the factory set on it, else the app's own.
fn env_of(c: &Command, name: &str) -> Option<String> {
    match c.get_envs().find(|(k, _)| *k == name) {
        Some((_, v)) => v.map(|v| v.to_string_lossy().into_owned()),
        None => std::env::var(name).ok(),
    }
}

/// Does infracost have credentials, without running it? A key in the environment, the token
/// `infracost auth login` caches (2.x: `token.json`, or `INFRACOST_CLI_OAUTH_TOKEN_CACHE_PATH`), or
/// the `api_key` of `credentials.yml` (0.10) — under the HOME the command gets.
pub fn infracost_signed_in(env: &dyn Fn(&str) -> Option<String>) -> bool {
    let set = |k: &str| env(k).is_some_and(|v| !v.trim().is_empty());
    if INFRACOST_KEY_VARS.iter().any(|k| set(k)) {
        return true;
    }
    let mut dirs: Vec<PathBuf> = vec![];
    if let Some(x) = env("XDG_CONFIG_HOME").filter(|x| !x.trim().is_empty()) {
        dirs.push(PathBuf::from(x).join("infracost"));
    }
    if let Some(h) = env("HOME").filter(|h| !h.trim().is_empty()) {
        dirs.push(PathBuf::from(h).join(".config").join("infracost"));
    }
    let tokens: Vec<PathBuf> = match env("INFRACOST_CLI_OAUTH_TOKEN_CACHE_PATH") {
        Some(t) if !t.trim().is_empty() => vec![PathBuf::from(t)],
        _ => dirs.iter().map(|d| d.join("token.json")).collect(),
    };
    if tokens
        .iter()
        .any(|t| std::fs::metadata(t).is_ok_and(|m| m.is_file() && m.len() > 0))
    {
        return true;
    }
    dirs.iter().any(|d| {
        std::fs::read_to_string(d.join("credentials.yml")).is_ok_and(|t| {
            t.lines().any(|l| {
                l.trim()
                    .strip_prefix("api_key:")
                    .is_some_and(|v| !v.trim().trim_matches(['"', '\'']).is_empty())
            })
        })
    })
}

/// The variables through which a program reaches the desktop session. Measured: with only DISPLAY
/// pointing at an Xvfb, `xdg-open` (GNOME mode) still asked the session's `systemd --user` over the
/// bus at `$XDG_RUNTIME_DIR/bus`, and the browser opened on the user's real desktop.
const DESKTOP_VARS: [&str; 6] = [
    "DISPLAY",
    "WAYLAND_DISPLAY",
    "DBUS_SESSION_BUS_ADDRESS",
    "XDG_RUNTIME_DIR",
    "XDG_CURRENT_DESKTOP",
    "DESKTOP_SESSION",
];

/// What infracost runs with: no terminal (stdin is null) and nothing that can show a sign-in page —
/// no display, no session bus, no desktop (so `xdg-open` falls back to `$BROWSER`), a browser that
/// fails, the device flow (no local callback port) — and no update check or coding-agent check (2.x
/// otherwise writes into the HOME's agent settings).
fn infracost_command(mut cmd: Command) -> Command {
    for k in DESKTOP_VARS {
        cmd.env_remove(k);
    }
    cmd.env("BROWSER", "false")
        .env("INFRACOST_CLI_OAUTH_USE_DEVICE_FLOW", "true")
        .env("INFRACOST_SKIP_UPDATE_CHECK", "true")
        .env("INFRACOST_SKIP_AGENT_CHECK", "true")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null());
    cmd
}

/// infracost is asking a human to sign in (2.x prints a device code and waits).
fn asks_to_sign_in(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "to log in",
        "login.infracost.io",
        "enter the code",
        "auth login",
    ]
    .iter()
    .any(|w| t.contains(w))
}

struct Bounded {
    out: Out,
    timed_out: bool,
    sign_in: bool,
}

/// Runs infracost hardened ([`infracost_command`]) in its own process group, which is killed at a
/// sign-in prompt or after `timeout`.
fn exec_infracost(cmd: Command, wd: &Path, timeout: Duration) -> Bounded {
    use std::io::Read;
    use std::sync::{Arc, Mutex};
    let mut cmd = infracost_command(cmd);
    cmd.current_dir(wd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Bounded {
                out: Out {
                    code: -1,
                    stdout: String::new(),
                    stderr: e.to_string(),
                },
                timed_out: false,
                sign_in: false,
            }
        }
    };
    fn pump(
        r: Option<impl Read + Send + 'static>,
    ) -> (Arc<Mutex<Vec<u8>>>, std::thread::JoinHandle<()>) {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let b = buf.clone();
        let h = std::thread::spawn(move || {
            let Some(mut r) = r else { return };
            let mut chunk = [0u8; 8192];
            while let Ok(n) = r.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                if let Ok(mut b) = b.lock() {
                    b.extend_from_slice(&chunk[..n]);
                }
            }
        });
        (buf, h)
    }
    let text = |b: &Arc<Mutex<Vec<u8>>>| {
        b.lock()
            .map(|b| String::from_utf8_lossy(&b).into_owned())
            .unwrap_or_default()
    };
    let (out, ho) = pump(child.stdout.take());
    let (err, he) = pump(child.stderr.take());
    let start = Instant::now();
    let (mut timed_out, mut sign_in) = (false, false);
    let code = loop {
        if let Ok(Some(st)) = child.try_wait() {
            break st.code().unwrap_or(-1);
        }
        sign_in = asks_to_sign_in(&text(&out)) || asks_to_sign_in(&text(&err));
        timed_out = !sign_in && start.elapsed() > timeout;
        if sign_in || timed_out {
            #[cfg(unix)]
            // SAFETY: the child leads its own process group (process_group(0) above)
            unsafe {
                libc::killpg(child.id() as libc::pid_t, libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            break -1;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    // the readers end when the pipes close; a helper that kept them open is not waited for
    let t0 = Instant::now();
    while !(ho.is_finished() && he.is_finished()) && t0.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(20));
    }
    Bounded {
        out: Out {
            code,
            stdout: text(&out),
            stderr: text(&err),
        },
        timed_out,
        sign_in,
    }
}

/// The infracost stage and each resource's monthly cost: `not_connected` without credentials
/// (infracost is not run), otherwise `breakdown` of the plan's JSON, never interactive.
fn infracost_stage(
    c: &Ctx,
    wd: &Path,
    plan_json: &Path,
    timeout: Duration,
) -> (Stage, HashMap<String, f64>) {
    let id = "infracost";
    let command = shown(
        "infracost",
        &["breakdown", "--path", "<plan.json>", "--format", "json"],
    );
    let not_connected = |detail: String| Stage {
        command: command.clone(),
        // installed but not signed in: the hint is the sign-in, not the install
        hint: Some(CONNECT_INFRACOST.into()),
        detail,
        ..Stage::new(id, Status::NotConnected, "infracost has no API key")
    };
    let probe = (c.cmd)("infracost");
    if !infracost_signed_in(&|k| env_of(&probe, k)) {
        return (not_connected(String::new()), HashMap::new());
    }
    let jp = plan_json.to_string_lossy().to_string();
    let args = [
        "breakdown",
        "--path",
        jp.as_str(),
        "--format",
        "json",
        "--no-color",
        "--log-level=error",
    ];
    let r = exec_infracost(with(c, "infracost", &args), wd, timeout);
    let o = r.out;
    let low = o.stderr.to_lowercase();
    if r.sign_in
        || (o.code != 0
            && (low.contains("api_key") || low.contains("api key") || low.contains("auth login")))
    {
        // the sign-in prompt's words carry a device code: only the tool's errors are shown
        let detail = if r.sign_in {
            "infracost asked to sign in; it was stopped".to_string()
        } else {
            words(&o.stderr)
        };
        return (not_connected(detail), HashMap::new());
    }
    if r.timed_out {
        return (
            Stage {
                command,
                detail: words(&o.stderr),
                ..Stage::new(
                    id,
                    Status::Failed,
                    format!("infracost did not finish in {} s", timeout.as_secs()),
                )
            },
            HashMap::new(),
        );
    }
    if o.code != 0 {
        return (
            Stage {
                command,
                detail: words(&o.stderr),
                ..Stage::new(id, Status::Failed, "infracost failed")
            },
            HashMap::new(),
        );
    }
    let (costs, total, currency) = parse_infracost(&o.stdout);
    (
        Stage {
            command,
            ..Stage::new(
                id,
                Status::Ok,
                match total {
                    Some(t) => format!("{t:.2} {currency}/month"),
                    None => "no cost data".into(),
                },
            )
        },
        costs,
    )
}

/// POSIX single-quoting, only when needed.
pub fn q(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./:=@%+,-".contains(c))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

fn shown(tool: &str, args: &[&str]) -> String {
    std::iter::once(tool.to_string())
        .chain(args.iter().map(|a| q(a)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// The folder a run works in, refused when it leaves the project.
pub fn work_dir(root: &Path, dir: &str) -> Result<PathBuf, String> {
    if dir.starts_with('/') || dir.split('/').any(|c| c == "..") {
        return Err(format!("folder outside the project: {dir}"));
    }
    let wd = if dir == "." || dir.is_empty() {
        root.to_path_buf()
    } else {
        root.join(dir)
    };
    if !wd.is_dir() {
        return Err(format!("no such folder: {dir}"));
    }
    Ok(wd)
}

/// A file of the folder as the project sees it (`infra` + `main.tf` → `infra/main.tf`).
fn rel(dir: &str, file: &str) -> String {
    let f = file.trim_start_matches("./").trim_start_matches('/');
    if dir == "." || dir.is_empty() {
        f.to_string()
    } else if f.is_empty() {
        dir.to_string()
    } else {
        format!("{dir}/{f}")
    }
}

/// The key an acceptance is stored under: the source, the rule, the file and what the finding is
/// about — the resource, or the text of the line (so moving the line keeps it).
pub fn finding_key(root: &Path, f: &Finding) -> String {
    let what = match &f.resource {
        Some(r) if !r.is_empty() => r.clone(),
        _ => std::fs::read_to_string(root.join(&f.file))
            .ok()
            .and_then(|t| {
                t.lines()
                    .nth(f.line.saturating_sub(1) as usize)
                    .map(|l| l.split_whitespace().collect::<Vec<_>>().join(" "))
            })
            .unwrap_or_else(|| f.line.to_string()),
    };
    format!(
        "{}:{}:{}:{}",
        f.source,
        f.rule,
        f.file,
        &sha256_hex(what.as_bytes())[..16]
    )
}

fn keyed(root: &Path, accepted: &HashSet<String>, mut v: Vec<Finding>) -> Vec<Finding> {
    for f in v.iter_mut() {
        if f.key.is_empty() {
            f.key = finding_key(root, f);
        }
        f.accepted = accepted.contains(&f.key);
    }
    v
}

/// A stage made of findings: failed when one blocks.
fn judged(mut s: Stage) -> Stage {
    let errors = s.findings.iter().filter(|f| f.severity == "error").count();
    let warnings = s.findings.len() - errors;
    let accepted = s.findings.iter().filter(|f| f.accepted).count();
    s.status = if s.findings.iter().any(Finding::blocks) {
        Status::Failed
    } else {
        Status::Ok
    };
    s.summary = if s.findings.is_empty() {
        "no findings".into()
    } else {
        let mut parts = vec![];
        if errors > 0 {
            parts.push(format!("{errors} error(s)"));
        }
        if warnings > 0 {
            parts.push(format!("{warnings} warning(s)"));
        }
        if accepted > 0 {
            parts.push(format!("{accepted} accepted"));
        }
        parts.join(", ")
    };
    s
}

// ───── the scanners' JSON ─────

fn sev(s: &str) -> String {
    match s.to_ascii_lowercase().as_str() {
        "error" | "critical" | "high" => "error",
        _ => "warning",
    }
    .into()
}

/// `validate -json`: the diagnostics.
pub fn parse_validate(json: &str, dir: &str) -> Vec<Finding> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v["diagnostics"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|d| Finding {
            source: "validate".into(),
            rule: "validate".into(),
            file: rel(dir, d["range"]["filename"].as_str().unwrap_or("")),
            line: d["range"]["start"]["line"].as_u64().unwrap_or(0) as u32,
            severity: sev(d["severity"].as_str().unwrap_or("error")),
            message: [d["summary"].as_str(), d["detail"].as_str()]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(": "),
            ..Default::default()
        })
        .collect()
}

/// `tflint --format=json`: the issues (`error`/`warning`/`notice`) and the errors it hit.
pub fn parse_tflint(json: &str, dir: &str) -> Vec<Finding> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let issues = v["issues"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|i| Finding {
            source: "tflint".into(),
            rule: i["rule"]["name"].as_str().unwrap_or("tflint").into(),
            file: rel(dir, i["range"]["filename"].as_str().unwrap_or("")),
            line: i["range"]["start"]["line"].as_u64().unwrap_or(0) as u32,
            severity: sev(i["rule"]["severity"].as_str().unwrap_or("warning")),
            message: i["message"].as_str().unwrap_or("").into(),
            ..Default::default()
        });
    let errors = v["errors"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| Finding {
            source: "tflint".into(),
            rule: "tflint-error".into(),
            file: rel(dir, e["range"]["filename"].as_str().unwrap_or("")),
            line: e["range"]["start"]["line"].as_u64().unwrap_or(0) as u32,
            severity: "error".into(),
            message: e["message"].as_str().unwrap_or("").into(),
            ..Default::default()
        });
    issues.chain(errors).collect()
}

/// `checkov -o json`: the failed checks (one object, or one per framework). Checkov's open-source
/// checks have no severity: a failed check is an error, as checkov's own exit code says.
pub fn parse_checkov(json: &str, dir: &str) -> Vec<Finding> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let reports: Vec<&Value> = match &v {
        Value::Array(a) => a.iter().collect(),
        Value::Object(_) => vec![&v],
        _ => vec![],
    };
    reports
        .into_iter()
        .flat_map(|r| {
            r["results"]["failed_checks"]
                .as_array()
                .into_iter()
                .flatten()
        })
        .map(|c| Finding {
            source: "checkov".into(),
            rule: c["check_id"].as_str().unwrap_or("checkov").into(),
            file: rel(dir, c["file_path"].as_str().unwrap_or("")),
            line: c["file_line_range"][0].as_u64().unwrap_or(0) as u32,
            severity: c["severity"]
                .as_str()
                .map(sev)
                .unwrap_or_else(|| "error".into()),
            message: c["check_name"].as_str().unwrap_or("").into(),
            resource: c["resource"].as_str().map(String::from),
            ..Default::default()
        })
        .collect()
}

/// `trivy config --format json`: the failed misconfigurations (CRITICAL/HIGH are errors).
pub fn parse_trivy(json: &str, dir: &str) -> Vec<Finding> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    v["Results"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|r| {
            let target = r["Target"].as_str().unwrap_or("").to_string();
            r["Misconfigurations"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|m| m["Status"].as_str().unwrap_or("FAIL") == "FAIL")
                .map(move |m| Finding {
                    source: "trivy".into(),
                    rule: m["AVDID"]
                        .as_str()
                        .or(m["ID"].as_str())
                        .unwrap_or("trivy")
                        .into(),
                    file: rel(dir, &target),
                    line: m["CauseMetadata"]["StartLine"].as_u64().unwrap_or(0) as u32,
                    severity: sev(m["Severity"].as_str().unwrap_or("")),
                    message: [m["Title"].as_str(), m["Message"].as_str()]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(": "),
                    resource: m["CauseMetadata"]["Resource"].as_str().map(String::from),
                    ..Default::default()
                })
        })
        .collect()
}

/// `conftest test --output json`: the failures (errors) and warnings of the policies.
pub fn parse_conftest(json: &str, dir: &str) -> Vec<Finding> {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let mut out = vec![];
    for r in v.as_array().into_iter().flatten() {
        let ns = r["namespace"].as_str().unwrap_or("conftest");
        for (key, severity) in [("failures", "error"), ("warnings", "warning")] {
            for f in r[key].as_array().into_iter().flatten() {
                out.push(Finding {
                    source: "conftest".into(),
                    rule: f["metadata"]["query"].as_str().unwrap_or(ns).into(),
                    file: dir.into(),
                    severity: severity.into(),
                    message: f["msg"].as_str().unwrap_or("").into(),
                    resource: Some(f["msg"].as_str().unwrap_or("").into()),
                    ..Default::default()
                });
            }
        }
    }
    out
}

/// `infracost breakdown --format json`: the monthly cost of each resource, and the total.
pub fn parse_infracost(json: &str) -> (HashMap<String, f64>, Option<f64>, String) {
    let v: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    let num = |x: &Value| -> Option<f64> {
        x.as_str()
            .and_then(|s| s.parse().ok())
            .or_else(|| x.as_f64())
    };
    let mut costs = HashMap::new();
    for p in v["projects"].as_array().into_iter().flatten() {
        for r in p["breakdown"]["resources"].as_array().into_iter().flatten() {
            if let (Some(n), Some(c)) = (r["name"].as_str(), num(&r["monthlyCost"])) {
                costs.insert(n.to_string(), c);
            }
        }
    }
    (
        costs,
        num(&v["totalMonthlyCost"]),
        v["currency"].as_str().unwrap_or("USD").to_string(),
    )
}

// ───── the state ─────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateResource {
    pub address: String,
    /// the resource type (`aws_s3_bucket`)
    pub kind: String,
    /// `managed` | `data`
    pub mode: String,
    pub module: Option<String>,
    /// the `id` attribute, unless it is sensitive
    pub id: Option<String>,
    /// the names of the sensitive attributes the state keeps (never their values)
    pub sensitive: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockInfo {
    pub id: String,
    pub who: String,
    pub operation: String,
    pub created: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IacState {
    pub ok: bool,
    pub tool: String,
    pub dir: String,
    /// `local`, `s3`, `gcs`, `remote`…
    pub backend: String,
    pub serial: Option<u64>,
    pub lineage: Option<String>,
    pub resources: Vec<StateResource>,
    /// the lock a local state holds; none when free — or when the backend does not show it (`notes`)
    pub lock: Option<LockInfo>,
    /// whether the backend's lock can be read here (the local one only)
    pub lock_readable: bool,
    /// the serial of the local state's backup (the version before the last write)
    pub backup_serial: Option<u64>,
    pub notes: String,
}

fn index_key(k: &Value) -> String {
    match k {
        Value::Null => String::new(),
        Value::Number(n) => format!("[{n}]"),
        Value::String(s) => format!("[\"{s}\"]"),
        other => format!("[{other}]"),
    }
}

/// The names of the sensitive attributes of an instance (`sensitive_attributes`: paths of steps,
/// the first step's name).
fn sensitive_names(inst: &Value) -> Vec<String> {
    let mut out: Vec<String> = inst["sensitive_attributes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let first = p.as_array().and_then(|a| a.first()).unwrap_or(p);
            first["value"].as_str().map(String::from)
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// A state as read: serial, lineage and the resources.
pub type ParsedState = (Option<u64>, Option<String>, Vec<StateResource>);

/// Reads `state pull` (state format 4): serial, lineage and each instance's address, id and the
/// names of its sensitive attributes. Values are read here and dropped.
pub fn parse_state(json: &str) -> Result<ParsedState, String> {
    if json.trim().is_empty() {
        return Ok((None, None, vec![]));
    }
    let v: Value = serde_json::from_str(json).map_err(|e| format!("state JSON: {e}"))?;
    let mut out = vec![];
    for r in v["resources"].as_array().into_iter().flatten() {
        let mode = r["mode"].as_str().unwrap_or("managed").to_string();
        let kind = r["type"].as_str().unwrap_or("").to_string();
        let name = r["name"].as_str().unwrap_or("");
        let module = r["module"].as_str().map(String::from);
        let base = format!(
            "{}{}{kind}.{name}",
            module
                .as_deref()
                .map(|m| format!("{m}."))
                .unwrap_or_default(),
            if mode == "data" { "data." } else { "" }
        );
        for inst in r["instances"].as_array().into_iter().flatten() {
            let sensitive = sensitive_names(inst);
            let id = if sensitive.iter().any(|s| s == "id") {
                None
            } else {
                inst["attributes"]["id"].as_str().map(String::from)
            };
            out.push(StateResource {
                address: format!("{base}{}", index_key(&inst["index_key"])),
                kind: kind.clone(),
                mode: mode.clone(),
                module: module.clone(),
                id,
                sensitive,
            });
        }
    }
    Ok((
        v["serial"].as_u64(),
        v["lineage"].as_str().map(String::from),
        out,
    ))
}

/// The backend the folder was initialised with (`.terraform/terraform.tfstate`), `local` otherwise.
fn backend_of(wd: &Path) -> String {
    std::fs::read_to_string(wd.join(".terraform/terraform.tfstate"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["backend"]["type"].as_str().map(String::from))
        .unwrap_or_else(|| "local".into())
}

fn read_lock(wd: &Path) -> Option<LockInfo> {
    let t = std::fs::read_to_string(wd.join(".terraform.tfstate.lock.info")).ok()?;
    let v: Value = serde_json::from_str(&t).ok()?;
    Some(LockInfo {
        id: v["ID"].as_str().unwrap_or("").into(),
        who: v["Who"].as_str().unwrap_or("").into(),
        operation: v["Operation"].as_str().unwrap_or("").into(),
        created: v["Created"].as_str().unwrap_or("").into(),
    })
}

/// `state pull`, initialising the folder first when it asks for it.
fn pull(c: &Ctx, tool: &str, wd: &Path) -> Result<String, String> {
    let once = || exec(with(c, tool, &["state", "pull"]), wd);
    let mut out = once();
    if out.code != 0 && out.stderr.to_lowercase().contains("init") {
        let init = exec(with(c, tool, &["init", "-input=false", "-no-color"]), wd);
        if init.code != 0 {
            return Err(format!("{tool} init failed:\n{}", words(&init.stderr)));
        }
        out = once();
    }
    if out.code != 0 {
        return Err(format!("{tool} state pull failed:\n{}", words(&out.stderr)));
    }
    Ok(out.stdout)
}

fn with(c: &Ctx, tool: &str, args: &[&str]) -> Command {
    let mut cmd = (c.cmd)(tool);
    cmd.args(args);
    cmd
}

/// The state of a folder: addresses and ids, the backend, serial and lineage, the lock (local
/// backend) and the backup. Nothing secret leaves this function.
pub fn state(c: &Ctx) -> IacState {
    let Some(tool) = tool_of(c.has) else {
        return IacState {
            dir: c.dir.into(),
            notes: install_hint("tofu").into(),
            ..Default::default()
        };
    };
    let base = IacState {
        tool: tool.into(),
        dir: c.dir.into(),
        ..Default::default()
    };
    let wd = match work_dir(c.root, c.dir) {
        Ok(w) => w,
        Err(e) => return IacState { notes: e, ..base },
    };
    let backend = backend_of(&wd);
    let local = backend == "local";
    let pulled = match pull(c, tool, &wd) {
        Ok(p) => p,
        Err(e) => {
            return IacState {
                backend,
                notes: e,
                ..base
            }
        }
    };
    match parse_state(&pulled) {
        Ok((serial, lineage, resources)) => IacState {
            ok: true,
            backend: backend_of(&wd),
            lock: if local { read_lock(&wd) } else { None },
            lock_readable: local,
            backup_serial: if local {
                std::fs::read_to_string(wd.join("terraform.tfstate.backup"))
                    .ok()
                    .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                    .and_then(|v| v["serial"].as_u64())
            } else {
                None
            },
            notes: if serial.is_none() {
                "No state yet: nothing has been applied in this folder.".into()
            } else if !local {
                format!("The {backend} backend keeps its lock and its versions there: a locked state shows when a plan fails; versions need the backend's own console.")
            } else {
                String::new()
            },
            serial,
            lineage,
            resources,
            ..base
        },
        Err(e) => IacState { notes: e, ..base },
    }
}

/// The line that declares `type.name` in the folder's `.tf` files (root module), for the editor.
fn declared(dir: &str, wd: &Path, address: &str) -> (String, u32) {
    let a = ops::config_address(address);
    let parts: Vec<&str> = a.split('.').collect();
    let (kind, block) = match parts.as_slice() {
        ["data", t, n] => ((*t, *n), "data"),
        [t, n] => ((*t, *n), "resource"),
        _ => return (dir.into(), 0),
    };
    let needle = format!("{block} \"{}\" \"{}\"", kind.0, kind.1);
    for f in crate::iacfind::tf_files(wd) {
        if f.contains('/') {
            continue;
        }
        if let Ok(t) = std::fs::read_to_string(wd.join(&f)) {
            if let Some(i) = t.lines().position(|l| {
                l.split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .starts_with(&needle)
            }) {
                return (rel(dir, &f), i as u32 + 1);
            }
        }
    }
    (dir.into(), 0)
}

// ───── the reviewed plan ─────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PlanMeta {
    root: String,
    dir: String,
    tool: String,
    target: Option<String>,
    config: String,
    blocked: bool,
    destroy: usize,
}

/// The hash of the folder's configuration (`.tf`, `.tf.json`, `.tfvars`, the lock file), so a plan
/// made before an edit is not applied after it.
pub fn config_hash(wd: &Path) -> String {
    let mut files = vec![];
    fn walk(dir: &Path, base: &Path, out: &mut Vec<PathBuf>, depth: usize) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if depth < 6 && !name.starts_with('.') {
                    walk(&p, base, out, depth + 1);
                }
            } else if name.ends_with(".tf")
                || name.ends_with(".tf.json")
                || name.ends_with(".tfvars")
                || name == ".terraform.lock.hcl"
            {
                out.push(p.strip_prefix(base).unwrap_or(&p).to_path_buf());
            }
        }
    }
    walk(wd, wd, &mut files, 0);
    files.sort();
    let mut h = Sha256::new();
    for f in files {
        h.update(f.to_string_lossy().as_bytes());
        h.update([0]);
        h.update(std::fs::read(wd.join(&f)).unwrap_or_default());
        h.update([0]);
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

fn private_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(bytes)
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, bytes)
    }
}

/// Removes the plans older than [`PLAN_TTL`] (a plan file holds the values, secrets included).
fn sweep(plans: &Path) {
    let Ok(rd) = std::fs::read_dir(plans) else {
        return;
    };
    for e in rd.flatten() {
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|a| a > PLAN_TTL)
            .unwrap_or(false);
        if old {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

fn valid_target(t: &str) -> bool {
    !t.is_empty()
        && !t.starts_with('-')
        && t.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_.-[]\"/:".contains(c))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyInfo {
    /// the exact command the human approves and runs (from the project root)
    pub command: String,
    pub plan_file: String,
    pub tool: String,
    pub dir: String,
    pub destroy: usize,
}

/// The command that applies a reviewed plan — refused when its run was blocked, when the plan file
/// is not the one reviewed, when the configuration changed since, or when it is too old.
pub fn apply_command(root: &Path, dir: &str, id: &str, plans: &Path) -> Result<ApplyInfo, String> {
    if id.len() != 64 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("not a plan id".into());
    }
    let wd = work_dir(root, dir)?;
    let file = plans.join(format!("{id}.bin"));
    let meta: PlanMeta = std::fs::read_to_string(plans.join(format!("{id}.json")))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .ok_or("this plan is no longer kept: run the pipeline again")?;
    if meta.root != root.to_string_lossy() || meta.dir != dir {
        return Err("this plan belongs to another folder".into());
    }
    if meta.blocked {
        return Err(
            "the pipeline failed for this plan: fix (or accept) what blocks it, and run it again"
                .into(),
        );
    }
    let bytes =
        std::fs::read(&file).map_err(|_| "the plan file is gone: run the pipeline again")?;
    if sha256_hex(&bytes) != id {
        return Err("the plan file is not the one that was reviewed".into());
    }
    let age = std::fs::metadata(&file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.elapsed().ok())
        .unwrap_or_default();
    if age > PLAN_TTL {
        return Err("this plan is more than a day old: run the pipeline again".into());
    }
    if config_hash(&wd) != meta.config {
        return Err("the configuration changed after this plan: run the pipeline again".into());
    }
    let path = file.to_string_lossy().to_string();
    let cd = if dir == "." {
        String::new()
    } else {
        format!("cd {} && ", q(dir))
    };
    Ok(ApplyInfo {
        command: format!("{cd}{} apply -input=false {}", meta.tool, q(&path)),
        plan_file: path,
        tool: meta.tool,
        dir: dir.into(),
        destroy: meta.destroy,
    })
}

// ───── the pipeline ─────

const ORDER: &[&str] = &[
    "init",
    "fmt",
    "validate",
    "rules",
    "tflint",
    "checkov",
    "trivy",
    "state",
    "plan",
    "drift",
    "conftest",
    "infracost",
];

fn not_installed(id: &str, tool: &str) -> Stage {
    Stage {
        hint: Some(install_hint(tool).into()),
        ..Stage::new(id, Status::NotInstalled, format!("{tool} is not installed"))
    }
}

fn millis(t: Instant) -> u64 {
    t.elapsed().as_millis() as u64
}

/// What changed outside the code in a folder (`init` + `plan -refresh-only` + `show -json`): the
/// drifted addresses (r23 F4c2: the deploy's «plan applied without drift» gate). Nothing is kept.
pub fn drift(c: &Ctx) -> Result<Vec<String>, String> {
    let tool = tool_of(c.has).ok_or_else(|| install_hint("tofu").to_string())?;
    let wd = work_dir(c.root, c.dir)?;
    let init = exec(with(c, tool, &["init", "-input=false", "-no-color"]), &wd);
    if init.code != 0 {
        return Err(format!("{tool} init failed:\n{}", words(&init.stderr)));
    }
    let tmp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let out = tmp.path().join("drift.bin");
    let out_arg = format!("-out={}", out.display());
    let plan = exec(
        with(
            c,
            tool,
            &[
                "plan",
                "-refresh-only",
                "-input=false",
                "-no-color",
                "-lock=false",
                &out_arg,
            ],
        ),
        &wd,
    );
    if plan.code != 0 {
        return Err(format!(
            "{tool} plan -refresh-only failed:\n{}",
            words(&plan.stderr)
        ));
    }
    let file = out.to_string_lossy().to_string();
    let show = exec(with(c, tool, &["show", "-json", &file]), &wd);
    let (_, drift) = ops::parse_plan(&show.stdout)?;
    Ok(drift.into_iter().map(|d| d.address).collect())
}

/// Runs the pipeline in `ctx.dir`, telling `on` about each stage as it starts and ends. Keeps the
/// plan (when there is one) under its hash for [`apply_command`].
pub fn run(c: &Ctx, on: &mut dyn FnMut(&Stage)) -> PipelineRun {
    let mut run = PipelineRun {
        dir: c.dir.into(),
        target: c.target.map(String::from),
        ..Default::default()
    };
    let Some(tool) = tool_of(c.has) else {
        run.notes = install_hint("tofu").into();
        run.blocked = true;
        run.blockers = vec!["init".into()];
        return run;
    };
    run.tool = tool.into();
    let wd = match work_dir(c.root, c.dir) {
        Ok(w) => w,
        Err(e) => {
            run.notes = e;
            run.blocked = true;
            return run;
        }
    };
    if let Some(t) = c.target {
        if !valid_target(t) {
            run.notes = format!("not a resource address: {t}");
            run.blocked = true;
            return run;
        }
    }
    let config = config_hash(&wd);
    let tmp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => {
            run.notes = e.to_string();
            run.blocked = true;
            return run;
        }
    };
    let mut stages: Vec<Stage> = vec![];
    let mut plan: Option<IacPlan> = None;
    let mut plan_json: Option<PathBuf> = None;
    let mut plan_file: Option<PathBuf> = None;
    let mut state_pulled: Option<Result<String, String>> = None;
    let failed = |stages: &[Stage], id: &str| {
        stages
            .iter()
            .any(|s| s.id == id && s.status == Status::Failed)
    };
    for id in ORDER {
        on(&Stage::new(id, Status::Running, ""));
        let t0 = Instant::now();
        let skip_init = failed(&stages, "init");
        let mut s = match *id {
            "init" => {
                let args = ["init", "-input=false", "-no-color"];
                let o = exec(with(c, tool, &args), &wd);
                Stage {
                    command: shown(tool, &args),
                    detail: words(if o.code == 0 { &o.stdout } else { &o.stderr }),
                    ..Stage::new(
                        id,
                        if o.code == 0 {
                            Status::Ok
                        } else {
                            Status::Failed
                        },
                        if o.code == 0 {
                            "initialised"
                        } else {
                            "init failed"
                        },
                    )
                }
            }
            "fmt" => {
                let args = ["fmt", "-check", "-recursive", "-list=true", "-no-color"];
                let o = exec(with(c, tool, &args), &wd);
                let files: Vec<Finding> = o
                    .stdout
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty())
                    .map(|f| Finding {
                        source: "fmt".into(),
                        rule: "fmt".into(),
                        file: rel(c.dir, f),
                        severity: "error".into(),
                        message: format!("not formatted: run `{tool} fmt -recursive` in {}", c.dir),
                        resource: Some(f.into()),
                        ..Default::default()
                    })
                    .collect();
                if o.code != 0 && files.is_empty() {
                    Stage {
                        command: shown(tool, &args),
                        detail: words(&o.stderr),
                        ..Stage::new(id, Status::Failed, "fmt could not read the files")
                    }
                } else {
                    judged(Stage {
                        command: shown(tool, &args),
                        findings: keyed(c.root, c.accepted, files),
                        ..Stage::new(id, Status::Ok, "")
                    })
                }
            }
            "validate" if skip_init => Stage::new(id, Status::Skipped, "init failed"),
            "validate" => {
                let args = ["validate", "-json", "-no-color"];
                let o = exec(with(c, tool, &args), &wd);
                let f = parse_validate(&o.stdout, c.dir);
                if o.code != 0 && f.is_empty() {
                    Stage {
                        command: shown(tool, &args),
                        detail: words(&o.stderr),
                        ..Stage::new(id, Status::Failed, "validate failed")
                    }
                } else {
                    judged(Stage {
                        command: shown(tool, &args),
                        findings: keyed(c.root, &HashSet::new(), f),
                        ..Stage::new(id, Status::Ok, "")
                    })
                }
            }
            "rules" => {
                let found: Vec<Finding> = crate::iacfind::tf_files(&wd)
                    .iter()
                    .flat_map(|f| {
                        let t = std::fs::read_to_string(wd.join(f)).unwrap_or_default();
                        crate::iacfind::builtin(&rel(c.dir, f), &t)
                    })
                    .map(|x| Finding {
                        source: "built-in".into(),
                        rule: x.rule,
                        file: x.file,
                        line: x.line,
                        severity: x.severity,
                        message: x.message,
                        ..Default::default()
                    })
                    .collect();
                judged(Stage {
                    command: "dxtutor built-in rules".into(),
                    findings: keyed(c.root, c.accepted, found),
                    ..Stage::new(id, Status::Ok, "")
                })
            }
            "tflint" if !(c.has)("tflint") => not_installed(id, "tflint"),
            "tflint" => {
                let args = ["--format=json", "--no-color"];
                let o = exec(with(c, "tflint", &args), &wd);
                judged(Stage {
                    command: shown("tflint", &args),
                    detail: words(&o.stderr),
                    findings: keyed(c.root, c.accepted, parse_tflint(&o.stdout, c.dir)),
                    ..Stage::new(id, Status::Ok, "")
                })
            }
            "checkov" if !(c.has)("checkov") => not_installed(id, "checkov"),
            "checkov" => {
                let args = [
                    "-d",
                    ".",
                    "--framework",
                    "terraform",
                    "-o",
                    "json",
                    "--quiet",
                    "--compact",
                ];
                let o = exec(with(c, "checkov", &args), &wd);
                judged(Stage {
                    command: shown("checkov", &args),
                    detail: words(&o.stderr),
                    findings: keyed(c.root, c.accepted, parse_checkov(&o.stdout, c.dir)),
                    ..Stage::new(id, Status::Ok, "")
                })
            }
            "trivy" if !(c.has)("trivy") => not_installed(id, "trivy"),
            "trivy" => {
                let args = ["config", "--format", "json", "--quiet", "."];
                let o = exec(with(c, "trivy", &args), &wd);
                judged(Stage {
                    command: shown("trivy", &args),
                    detail: words(&o.stderr),
                    findings: keyed(c.root, c.accepted, parse_trivy(&o.stdout, c.dir)),
                    ..Stage::new(id, Status::Ok, "")
                })
            }
            "state" if skip_init => Stage::new(id, Status::Skipped, "init failed"),
            "state" => {
                let pulled = state_pulled
                    .get_or_insert_with(|| pull(c, tool, &wd))
                    .clone();
                match pulled.and_then(|p| parse_state(&p)) {
                    Err(e) => Stage {
                        command: shown(tool, &["state", "pull"]),
                        detail: e,
                        ..Stage::new(id, Status::Failed, "could not read the state")
                    },
                    Ok((None, _, _)) => Stage {
                        command: shown(tool, &["state", "pull"]),
                        ..Stage::new(id, Status::Skipped, "no state yet")
                    },
                    Ok((Some(_), _, resources)) => {
                        let found = resources
                            .iter()
                            .filter(|r| r.mode == "managed" && !r.sensitive.is_empty())
                            .map(|r| {
                                let (file, line) = declared(c.dir, &wd, &r.address);
                                Finding {
                                    source: "state".into(),
                                    rule: "secret-in-state".into(),
                                    file,
                                    line,
                                    severity: "error".into(),
                                    message: format!(
                                        "the state keeps the secret value of {} ({}): use write-only arguments or ephemeral values, or keep the state encrypted and access-controlled",
                                        r.address,
                                        r.sensitive.join(", ")
                                    ),
                                    resource: Some(r.address.clone()),
                                    ..Default::default()
                                }
                            })
                            .collect();
                        judged(Stage {
                            command: shown(tool, &["state", "pull"]),
                            findings: keyed(c.root, c.accepted, found),
                            ..Stage::new(id, Status::Ok, "")
                        })
                    }
                }
            }
            "plan" if skip_init || failed(&stages, "validate") => {
                Stage::new(id, Status::Skipped, "init or validate failed")
            }
            "plan" => {
                let out = tmp.path().join("plan.bin");
                let out_arg = format!("-out={}", out.display());
                let target_arg = c.target.map(|t| format!("-target={t}"));
                let mut args = vec!["plan", "-input=false", "-no-color", "-lock=false"];
                if let Some(t) = &target_arg {
                    args.push(t);
                }
                let shown_args: Vec<&str> = args.iter().copied().chain(["-out=<plan>"]).collect();
                args.push(&out_arg);
                let o = exec(with(c, tool, &args), &wd);
                let shown_cmd = shown(tool, &shown_args);
                if o.code != 0 {
                    Stage {
                        command: shown_cmd,
                        detail: words(&o.stderr),
                        ..Stage::new(id, Status::Failed, "plan failed")
                    }
                } else {
                    let file = out.to_string_lossy().to_string();
                    let show = exec(with(c, tool, &["show", "-json", &file]), &wd);
                    match ops::parse_plan(&show.stdout) {
                        Ok((changes, drift)) if show.code == 0 => {
                            let jp = tmp.path().join("plan.json");
                            let _ = private_write(&jp, show.stdout.as_bytes());
                            plan_json = Some(jp);
                            plan_file = Some(out.clone());
                            let n = |a: &str| changes.iter().filter(|x| x.action == a).count();
                            let p = IacPlan {
                                ok: true,
                                tool: tool.into(),
                                dir: c.dir.into(),
                                refresh_only: false,
                                add: n("create") + n("replace"),
                                change: n("update"),
                                destroy: n("delete") + n("replace"),
                                notes: if changes.is_empty() && drift.is_empty() {
                                    "No changes: the infrastructure matches the configuration."
                                        .into()
                                } else {
                                    String::new()
                                },
                                changes,
                                drift,
                            };
                            let summary = format!("+{} ~{} −{}", p.add, p.change, p.destroy);
                            plan = Some(p);
                            Stage {
                                command: shown_cmd,
                                ..Stage::new(id, Status::Ok, summary)
                            }
                        }
                        Ok(_) => Stage {
                            command: shown_cmd,
                            detail: words(&show.stderr),
                            ..Stage::new(id, Status::Failed, "show -json failed")
                        },
                        Err(e) => Stage {
                            command: shown_cmd,
                            detail: e,
                            ..Stage::new(id, Status::Failed, "could not read the plan")
                        },
                    }
                }
            }
            "drift" => match &plan {
                None => Stage::new(id, Status::Skipped, "no plan"),
                Some(p) => {
                    let found = p
                        .drift
                        .iter()
                        .map(|d| {
                            let (file, line) = declared(c.dir, &wd, &d.address);
                            Finding {
                                source: "drift".into(),
                                rule: "drift".into(),
                                file,
                                line,
                                severity: "error".into(),
                                message: format!(
                                    "{} changed outside the code ({}): revert it, write it into the code, or ignore it with a reason",
                                    d.address, d.action
                                ),
                                resource: Some(d.address.clone()),
                                key: drift_key(c.dir, &d.address),
                                ..Default::default()
                            }
                        })
                        .collect();
                    let mut s = judged(Stage {
                        command: "the plan's resource_drift".into(),
                        findings: keyed(c.root, c.accepted, found),
                        ..Stage::new(id, Status::Ok, "")
                    });
                    if s.findings.is_empty() {
                        s.summary = "no drift".into();
                    }
                    s
                }
            },
            "conftest" if !(c.has)("conftest") => not_installed(id, "conftest"),
            "conftest" => {
                let policy = [wd.join("policy"), c.root.join("policy")]
                    .into_iter()
                    .find(|p| p.is_dir());
                match (policy, &plan_json) {
                    (None, _) => {
                        Stage::new(id, Status::Skipped, "no policy folder (policy/*.rego)")
                    }
                    (_, None) => Stage::new(id, Status::Skipped, "no plan"),
                    (Some(pol), Some(jp)) => {
                        let pol = pol.to_string_lossy().to_string();
                        let jp = jp.to_string_lossy().to_string();
                        let args = [
                            "test",
                            "--no-color",
                            "--output",
                            "json",
                            "-p",
                            pol.as_str(),
                            jp.as_str(),
                        ];
                        let o = exec(with(c, "conftest", &args), &wd);
                        judged(Stage {
                            command: shown(
                                "conftest",
                                &["test", "--output", "json", "-p", &pol, "<plan.json>"],
                            ),
                            detail: words(&o.stderr),
                            findings: keyed(c.root, c.accepted, parse_conftest(&o.stdout, c.dir)),
                            ..Stage::new(id, Status::Ok, "")
                        })
                    }
                }
            }
            "infracost" if !(c.has)("infracost") => not_installed(id, "infracost"),
            "infracost" => match &plan_json {
                None => Stage::new(id, Status::Skipped, "no plan"),
                Some(jp) => {
                    let (stage, costs) = infracost_stage(c, &wd, jp, INFRACOST_TIMEOUT);
                    if let Some(p) = plan.as_mut() {
                        for ch in p.changes.iter_mut() {
                            ch.monthly_cost = costs.get(&ch.address).copied();
                        }
                    }
                    stage
                }
            },
            _ => Stage::new(id, Status::Skipped, ""),
        };
        s.ms = millis(t0);
        on(&s);
        stages.push(s);
    }
    run.blockers = stages
        .iter()
        .filter(|s| s.status == Status::Failed)
        .map(|s| s.id.clone())
        .collect();
    run.blocked = !run.blockers.is_empty() || plan.is_none();
    if let (Some(p), Some(f)) = (&plan, &plan_file) {
        let has_changes = !p.changes.is_empty();
        if let Ok(bytes) = std::fs::read(f) {
            let id = sha256_hex(&bytes);
            let _ = std::fs::create_dir_all(c.plans);
            sweep(c.plans);
            let meta = PlanMeta {
                root: c.root.to_string_lossy().to_string(),
                dir: c.dir.into(),
                tool: tool.into(),
                target: c.target.map(String::from),
                config: config.clone(),
                blocked: run.blocked || !has_changes,
                destroy: p.destroy,
            };
            let kept = private_write(&c.plans.join(format!("{id}.bin")), &bytes).and_then(|_| {
                private_write(
                    &c.plans.join(format!("{id}.json")),
                    serde_json::to_string(&meta).unwrap_or_default().as_bytes(),
                )
            });
            match kept {
                Ok(()) => run.id = id,
                Err(e) => run.notes = format!("could not keep the plan: {e}"),
            }
        }
    }
    run.stages = stages;
    run.plan = plan;
    run
}

/// The key an ignored drift is stored under.
pub fn drift_key(dir: &str, address: &str) -> String {
    format!("drift:{dir}:{address}")
}

/// Seconds since the epoch (the expiry of an acceptance is checked by the store).
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests;
