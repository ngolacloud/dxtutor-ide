//! The guided deploy (r23 F4c2, docs/v2/AUDIT-r23.md §4.4 — D01–D04, K03): a plan with every check a
//! deploy to staging or production must pass, the rule that blocks it, and the rollout itself.
//!
//! - **Target:** the environment, its cluster (context, namespace), and the version — the commit at
//!   HEAD; a dirty working tree is refused (a deploy carries a commit).
//! - **Identity:** who deploys — git, the cluster (`kubectl auth whoami`), Vault.
//! - **Secrets:** never values. The manifests' `Secret` objects are NOT applied (the cluster reads its
//!   secrets from Vault through the Vault Secrets Operator); the check is that each Secret the
//!   workloads expect exists in the namespace (`kubectl get secret … -o name`: names only) and that the
//!   environment's Vault path exists (metadata only). `dx-secret-check` (K03) is «not available» until
//!   its image exists.
//! - **Preflight:** SBOM (syft), signature (cosign verify), vulnerabilities (trivy/grype), IaC drift,
//!   the cluster's admission policy (`apply --dry-run=server`), the SLO budget, the change window,
//!   migrations, staging's health (production) and a second approver (production: the commit is in a
//!   merged pull request approved by someone else, through `gh`).
//! - **The rule** ([`blockers`]): a failed check always blocks; in production «not installed» and «not
//!   connected» block too, unless waived with a reason. It is checked again when the rollout starts,
//!   with the HEAD, the manifests and the plan's age.
//! - **Rollout:** rolling (canary/blue-green later): the namespace, `kubectl apply -f -` of the
//!   manifests without the Secrets, the version annotation, `rollout status` of each Deployment.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::keychain::Store;
use crate::vault;

/// How long a plan can be rolled out.
pub const PLAN_TTL: Duration = Duration::from_secs(30 * 60);
pub const ANN_VER: &str = "dxtutor.io/version";
pub const ANN_AT: &str = "dxtutor.io/deployed-at";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Failed,
    NotInstalled,
    NotConnected,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    /// `version` | `sbom` | `signature` | `vulns` | `secrets` | `secret-check` | `drift` | `admission`
    /// | `slo` | `window` | `migrations` | `staging` | `approver`
    pub id: String,
    pub status: Status,
    pub summary: String,
    pub detail: String,
    pub hint: Option<String>,
}

impl Gate {
    fn new(id: &str, status: Status, summary: impl Into<String>) -> Self {
        Gate {
            id: id.into(),
            status,
            summary: summary.into(),
            detail: String::new(),
            hint: None,
        }
    }
    fn hint(mut self, h: &str) -> Self {
        self.hint = Some(h.into());
        self
    }
    fn detail(mut self, d: impl Into<String>) -> Self {
        self.detail = d.into();
        self
    }
}

/// The project's deploy settings (`.dxtutor/deploy.json`): everything optional — a missing setting
/// makes its check «not connected» or «skipped», never green.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// the manifests' folder (default `deploy/k8s`)
    pub manifests: Option<String>,
    pub environments: HashMap<String, EnvConfig>,
    pub cosign: Option<Cosign>,
    pub windows: Vec<Window>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EnvConfig {
    /// the environment's IaC folder (the drift check)
    pub iac: Option<String>,
    /// the environment's KV path in Vault (`apps/shop/production`)
    pub vault_path: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Cosign {
    /// a public key (relative to the project) — or keyless:
    pub key: Option<String>,
    pub identity: Option<String>,
    pub issuer: Option<String>,
}

/// When production deploys are allowed: days (`mon`…`sun`) and a UTC time span (`09:00`–`16:00`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Window {
    pub days: Vec<String>,
    pub from: String,
    pub to: String,
}

pub fn load_config(root: &Path) -> Result<Config, String> {
    match std::fs::read_to_string(root.join(".dxtutor/deploy.json")) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!(".dxtutor/deploy.json: {e}")),
        Err(_) => Ok(Config::default()),
    }
}

/// Where a deploy goes.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Target {
    /// `staging` | `production`
    pub env: String,
    pub context: String,
    pub namespace: String,
    pub kubeconfig: Option<String>,
    /// production: staging's cluster (its health and version)
    pub staging: Option<(String, String)>,
    /// the Vault the secrets live in (its token from the keychain)
    pub vault: Option<vault::Target>,
    pub kv_mount: Option<String>,
}

/// The tools, as the caller resolves them (the desktop: the login shell's environment).
pub struct Tools<'a> {
    pub cmd: &'a dyn Fn(&str) -> Command,
    pub has: &'a dyn Fn(&str) -> bool,
    pub store: &'a dyn Store,
}

struct Out {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run(t: &Tools, program: &str, args: &[&str], cwd: &Path, stdin: Option<&str>) -> Out {
    let mut c = (t.cmd)(program);
    c.args(args)
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    c.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    let child = c.spawn();
    let mut child = match child {
        Ok(ch) => ch,
        Err(e) => {
            return Out {
                code: -1,
                stdout: String::new(),
                stderr: e.to_string(),
            }
        }
    };
    if let (Some(s), Some(mut w)) = (stdin, child.stdin.take()) {
        let _ = w.write_all(s.as_bytes());
    }
    match child.wait_with_output() {
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

fn last_words(s: &str) -> String {
    let t = s.trim();
    let t = if t.len() > 1500 {
        let mut i = t.len() - 1500;
        while !t.is_char_boundary(i) {
            i += 1;
        }
        &t[i..]
    } else {
        t
    };
    tutor_protect::redact::current().mask(t)
}

// ───── manifests ─────

/// The manifests as the rollout applies them: every document but the `Secret`s, the Deployments, the
/// images, and the Secrets left to Vault.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Manifests {
    pub files: Vec<String>,
    pub text: String,
    pub deployments: Vec<String>,
    pub images: Vec<String>,
    /// the `Secret` objects not applied (the cluster gets them from Vault)
    pub secrets: Vec<String>,
}

fn kind_and_name(doc: &str) -> (Option<String>, Option<String>) {
    let mut kind = None;
    let mut name = None;
    let mut in_meta = false;
    for l in doc.lines() {
        if let Some(k) = l.strip_prefix("kind:") {
            kind = Some(k.trim().to_string());
        }
        if l.starts_with("metadata:") {
            in_meta = true;
            continue;
        }
        if in_meta {
            if let Some(n) = l.strip_prefix("  name:") {
                name.get_or_insert(n.trim().trim_matches('"').to_string());
            } else if !l.starts_with(' ') && !l.trim().is_empty() {
                in_meta = false;
            }
        }
    }
    (kind, name)
}

pub fn read_manifests(root: &Path, dir: &str) -> Result<Manifests, String> {
    let d = root.join(dir);
    let mut files: Vec<PathBuf> = std::fs::read_dir(&d)
        .map_err(|_| format!("no manifests in {dir}"))?
        .flatten()
        .map(|e| e.path())
        .filter(|p| matches!(p.extension().and_then(|x| x.to_str()), Some("yaml" | "yml")))
        .collect();
    files.sort();
    if files.is_empty() {
        return Err(format!("no manifests in {dir}"));
    }
    let mut m = Manifests::default();
    let mut docs = vec![];
    for f in &files {
        m.files.push(format!(
            "{dir}/{}",
            f.file_name().unwrap_or_default().to_string_lossy()
        ));
        let text = std::fs::read_to_string(f).map_err(|e| e.to_string())?;
        let mut cur = String::new();
        for l in text.lines().chain(std::iter::once("---")) {
            if l.trim_end() == "---" {
                let doc = std::mem::take(&mut cur);
                if doc.trim().is_empty() {
                    continue;
                }
                let (kind, name) = kind_and_name(&doc);
                match kind.as_deref() {
                    Some("Secret") => m.secrets.push(name.unwrap_or_default()),
                    Some(k) => {
                        if k == "Deployment" {
                            if let Some(n) = &name {
                                m.deployments.push(n.clone());
                            }
                        }
                        for l in doc.lines() {
                            if let Some(img) = l.trim().strip_prefix("image:") {
                                let img =
                                    img.trim().trim_matches('"').trim_matches('\'').to_string();
                                if !img.is_empty() && !m.images.contains(&img) {
                                    m.images.push(img);
                                }
                            }
                        }
                        docs.push(doc.trim_end().to_string());
                    }
                    None => {}
                }
            } else {
                cur.push_str(l);
                cur.push('\n');
            }
        }
    }
    m.text = docs
        .iter()
        .map(|d| format!("{d}\n"))
        .collect::<Vec<_>>()
        .join("---\n");
    Ok(m)
}

/// The Secrets the workloads expect (`secretRef`/`secretKeyRef`/`secretName`), besides the ones the
/// manifests declare.
pub fn expected_secrets(m: &Manifests) -> Vec<String> {
    let mut out: Vec<String> = m.secrets.clone();
    let lines: Vec<&str> = m.text.lines().collect();
    for (i, l) in lines.iter().enumerate() {
        let t = l.trim();
        if let Some(n) = t.strip_prefix("secretName:") {
            out.push(n.trim().trim_matches('"').to_string());
        }
        if t.starts_with("secretRef:") || t.starts_with("secretKeyRef:") {
            if let Some(n) = lines
                .get(i + 1)
                .and_then(|n| n.trim().strip_prefix("name:"))
            {
                out.push(n.trim().trim_matches('"').to_string());
            }
        }
    }
    out.retain(|s| !s.is_empty());
    out.sort();
    out.dedup();
    out
}

// ───── pure rules ─────

/// The issue a commit message names (`SHOP-42`).
pub fn issue_of(message: &str) -> Option<String> {
    message
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .find(|w| {
            let mut p = w.splitn(2, '-');
            let (a, b) = (p.next().unwrap_or(""), p.next().unwrap_or(""));
            a.len() >= 2
                && a.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                && a.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && !b.is_empty()
                && b.chars().all(|c| c.is_ascii_digit())
        })
        .map(String::from)
}

/// Is `(weekday 0=mon, minutes since 00:00 UTC)` inside one of the windows?
pub fn in_window(windows: &[Window], weekday: u32, minute: u32) -> bool {
    const DAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    let hm = |s: &str| -> Option<u32> {
        let (h, m) = s.split_once(':')?;
        Some(h.trim().parse::<u32>().ok()? * 60 + m.trim().parse::<u32>().ok()?)
    };
    windows.iter().any(|w| {
        let day_ok = w.days.is_empty()
            || w.days.iter().any(|d| {
                d.to_ascii_lowercase()
                    .starts_with(DAYS[weekday as usize % 7])
            });
        match (hm(&w.from), hm(&w.to)) {
            (Some(a), Some(b)) => day_ok && minute >= a && minute < b,
            _ => false,
        }
    })
}

fn utc_now() -> (u32, u32) {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // 1970-01-01 was a Thursday (3 with Monday = 0)
    (((s / 86400 + 3) % 7) as u32, ((s % 86400) / 60) as u32)
}

/// The production checks no waiver lifts (owner decision, 2026-11-26): the second approver (no `gh`, or no
/// approved pull request, keeps production closed) and staging (production only takes a version that ran there).
pub const NOT_WAIVABLE: &[&str] = &["approver", "staging", "version"];

/// Which checks block, given the waivers: a failed check always; in production, «not installed» and
/// «not connected» too unless waived (and never for [`NOT_WAIVABLE`]).
pub fn blockers(env: &str, gates: &[Gate], waived: &[String]) -> Vec<String> {
    gates
        .iter()
        .filter(|g| match g.status {
            Status::Failed => true,
            Status::NotInstalled | Status::NotConnected => {
                env == "production"
                    && (NOT_WAIVABLE.contains(&g.id.as_str()) || !waived.contains(&g.id))
            }
            _ => false,
        })
        .map(|g| g.id.clone())
        .collect()
}

/// The checks a human can waive (with a reason): production's «not installed» / «not connected».
pub fn waivable(env: &str, gates: &[Gate]) -> Vec<String> {
    if env != "production" {
        return vec![];
    }
    gates
        .iter()
        .filter(|g| matches!(g.status, Status::NotInstalled | Status::NotConnected))
        .filter(|g| !NOT_WAIVABLE.contains(&g.id.as_str()))
        .map(|g| g.id.clone())
        .collect()
}

/// Production's own confirmation: `production` typed and a reason (staging needs neither).
pub fn confirmed(env: &str, confirm: Option<&str>, reason: Option<&str>) -> Result<(), String> {
    if env != "production" {
        return Ok(());
    }
    if confirm.map(str::trim) != Some("production") {
        return Err("type production to confirm a production deploy".into());
    }
    if reason.map(|r| r.trim().chars().count() < 3).unwrap_or(true) {
        return Err("a production deploy needs a reason".into());
    }
    Ok(())
}

/// The second approver from `gh pr list --json number,url,author,reviews`: an approval by someone
/// other than `me` on a merged pull request with this commit.
pub fn approver_of(prs_json: &str, me: &str) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(prs_json).ok()?;
    for pr in v.as_array()? {
        for r in pr["reviews"].as_array().into_iter().flatten() {
            let who = r["author"]["login"].as_str().unwrap_or("");
            if r["state"].as_str() == Some("APPROVED")
                && !who.is_empty()
                && !who.eq_ignore_ascii_case(me)
            {
                return Some((
                    who.to_string(),
                    pr["url"].as_str().unwrap_or("").to_string(),
                ));
            }
        }
    }
    None
}

// ───── the plan ─────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub git: String,
    pub cluster: Option<String>,
    pub vault: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeployPlan {
    pub id: String,
    pub env: String,
    pub context: String,
    pub namespace: String,
    pub version: String,
    pub subject: String,
    pub issue: Option<String>,
    pub identity: Identity,
    pub manifests: Vec<String>,
    pub deployments: Vec<String>,
    pub images: Vec<String>,
    /// the `Secret` objects not applied (the cluster reads them from Vault)
    pub secrets_from_vault: Vec<String>,
    pub gates: Vec<Gate>,
    /// `rolling` (canary and blue-green come later)
    pub strategy: String,
    pub blockers: Vec<String>,
    pub waivable: Vec<String>,
    /// the exact commands the rollout runs
    pub commands: Vec<String>,
    /// the second approver (production)
    pub approver: Option<String>,
    pub notes: String,
}

struct Kept {
    plan: DeployPlan,
    root: PathBuf,
    target: Target,
    manifests: String,
    at: Instant,
}

fn plans() -> &'static Mutex<HashMap<String, Kept>> {
    static P: std::sync::OnceLock<Mutex<HashMap<String, Kept>>> = std::sync::OnceLock::new();
    P.get_or_init(|| Mutex::new(HashMap::new()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn kube_args(t: &Target) -> Vec<String> {
    let mut a = vec![];
    if let Some(k) = t.kubeconfig.as_deref().filter(|k| !k.trim().is_empty()) {
        a.extend(["--kubeconfig".to_string(), k.trim().to_string()]);
    }
    a.extend(["--context".to_string(), t.context.clone()]);
    a
}

fn kubectl(t: &Tools, target: &Target, args: &[&str], root: &Path, stdin: Option<&str>) -> Out {
    let mut all: Vec<String> = kube_args(target);
    all.extend(args.iter().map(|s| s.to_string()));
    let refs: Vec<&str> = all.iter().map(String::as_str).collect();
    run(t, "kubectl", &refs, root, stdin)
}

fn shown_kubectl(target: &Target, args: &str) -> String {
    let mut a = kube_args(target).join(" ");
    if !a.is_empty() {
        a.push(' ');
    }
    format!("kubectl {a}{args}")
}

fn version_gate(t: &Tools, root: &Path) -> (Gate, String, String) {
    let head = run(t, "git", &["rev-parse", "HEAD"], root, None);
    if head.code != 0 {
        return (
            Gate::new(
                "version",
                Status::Failed,
                "not a git repository with a commit",
            ),
            String::new(),
            String::new(),
        );
    }
    let sha = head.stdout.trim().to_string();
    let subject = run(t, "git", &["log", "-1", "--format=%s"], root, None)
        .stdout
        .trim()
        .to_string();
    let dirty = run(
        t,
        "git",
        &["status", "--porcelain", "--untracked-files=no"],
        root,
        None,
    );
    let g = if !dirty.stdout.trim().is_empty() {
        Gate::new("version", Status::Failed, "the working tree has uncommitted changes: commit them first (a deploy carries a commit)")
            .detail(dirty.stdout.trim().to_string())
    } else {
        Gate::new(
            "version",
            Status::Ok,
            format!("{} {subject}", &sha[..sha.len().min(10)]),
        )
    };
    (g, sha, subject)
}

fn missing(id: &str, tool: &str, hint: &str) -> Gate {
    Gate::new(id, Status::NotInstalled, format!("{tool} is not installed")).hint(hint)
}

fn sbom_gate(t: &Tools, root: &Path, images: &[String]) -> Gate {
    if !(t.has)("syft") {
        return missing("sbom", "syft", "Install syft (github.com/anchore/syft): curl -sSfL https://raw.githubusercontent.com/anchore/syft/main/install.sh | sh -s -- -b ~/.local/bin");
    }
    let mut detail = vec![];
    for img in images {
        let o = run(t, "syft", &[img, "-q", "-o", "json"], root, None);
        if o.code != 0 {
            return Gate::new("sbom", Status::Failed, format!("no SBOM for {img}"))
                .detail(last_words(&o.stderr));
        }
        let n = serde_json::from_str::<Value>(&o.stdout)
            .ok()
            .and_then(|v| v["artifacts"].as_array().map(Vec::len))
            .unwrap_or(0);
        detail.push(format!("{img}: {n} packages"));
    }
    Gate::new("sbom", Status::Ok, format!("{} image(s)", images.len())).detail(detail.join("\n"))
}

fn signature_gate(t: &Tools, root: &Path, cfg: &Config, images: &[String]) -> Gate {
    if !(t.has)("cosign") {
        return missing(
            "signature",
            "cosign",
            "Install cosign (docs.sigstore.dev/cosign/system_config/installation)",
        );
    }
    let Some(c) = &cfg.cosign else {
        return Gate::new("signature", Status::NotConnected, "no signing policy: set cosign.key, or cosign.identity and cosign.issuer, in .dxtutor/deploy.json")
            .hint("{\"cosign\": {\"identity\": \"https://github.com/org/repo/.github/workflows/release.yml@refs/heads/main\", \"issuer\": \"https://token.actions.githubusercontent.com\"}}");
    };
    for img in images {
        let mut args: Vec<String> = vec!["verify".into()];
        if let Some(k) = &c.key {
            args.extend(["--key".into(), root.join(k).to_string_lossy().to_string()]);
        } else {
            args.extend([
                "--certificate-identity".into(),
                c.identity.clone().unwrap_or_default(),
                "--certificate-oidc-issuer".into(),
                c.issuer.clone().unwrap_or_default(),
            ]);
        }
        args.push(img.clone());
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let o = run(t, "cosign", &refs, root, None);
        if o.code != 0 {
            return Gate::new(
                "signature",
                Status::Failed,
                format!("{img} is not signed as the policy says"),
            )
            .detail(last_words(&o.stderr));
        }
    }
    Gate::new(
        "signature",
        Status::Ok,
        format!("{} image(s) verified", images.len()),
    )
}

fn vulns_gate(t: &Tools, root: &Path, images: &[String]) -> Gate {
    let (tool, args): (&str, Vec<&str>) = if (t.has)("trivy") {
        (
            "trivy",
            vec![
                "image",
                "--quiet",
                "--severity",
                "HIGH,CRITICAL",
                "--exit-code",
                "1",
                "--format",
                "json",
            ],
        )
    } else if (t.has)("grype") {
        ("grype", vec!["--fail-on", "high", "-q", "-o", "json"])
    } else {
        return missing(
            "vulns",
            "trivy (or grype)",
            "Install Trivy (apt install trivy) or Grype",
        );
    };
    for img in images {
        let mut a = args.clone();
        a.push(img);
        let o = run(t, tool, &a, root, None);
        if o.code != 0 {
            return Gate::new(
                "vulns",
                Status::Failed,
                format!("{img} has HIGH or CRITICAL vulnerabilities ({tool})"),
            )
            .detail(last_words(&o.stderr));
        }
    }
    Gate::new(
        "vulns",
        Status::Ok,
        format!("no HIGH/CRITICAL in {} image(s) ({tool})", images.len()),
    )
}

fn secrets_gate(
    t: &Tools,
    root: &Path,
    target: &Target,
    cfg: &Config,
    m: &Manifests,
    reachable: bool,
) -> Gate {
    let want = expected_secrets(m);
    let mut notes = vec![];
    let mut status = Status::Ok;
    if !reachable {
        return Gate::new(
            "secrets",
            Status::NotConnected,
            format!("cluster {} not reachable", target.context),
        );
    }
    if !want.is_empty() {
        let mut args = vec![
            "-n",
            &target.namespace,
            "get",
            "secret",
            "-o",
            "name",
            "--ignore-not-found",
        ];
        let names: Vec<&str> = want.iter().map(String::as_str).collect();
        args.extend(names.iter());
        let o = kubectl(t, target, &args, root, None);
        let present: Vec<String> = o
            .stdout
            .lines()
            .map(|l| l.trim().trim_start_matches("secret/").to_string())
            .collect();
        let absent: Vec<&String> = want.iter().filter(|w| !present.contains(w)).collect();
        if !absent.is_empty() {
            status = Status::Failed;
            notes.push(format!(
                "missing in {}: {} (the Vault Secrets Operator creates them from Vault)",
                target.namespace,
                absent
                    .iter()
                    .map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        } else {
            notes.push(format!(
                "{} Secret(s) present in {} (names only)",
                want.len(),
                target.namespace
            ));
        }
    }
    let path = cfg
        .environments
        .get(&target.env)
        .and_then(|e| e.vault_path.clone());
    match (&target.vault, path) {
        (Some(vt), Some(p)) => match vault::kv_meta(
            t.store,
            vt,
            target.kv_mount.as_deref().unwrap_or("secret"),
            &p,
        ) {
            Ok(meta) if meta.exists || !meta.children.is_empty() => {
                notes.push(format!("Vault {p}: present (metadata only)"))
            }
            Ok(_) => {
                status = Status::Failed;
                notes.push(format!("Vault {p}: nothing there"));
            }
            Err(e) => {
                if status == Status::Ok {
                    status = Status::NotConnected;
                }
                notes.push(format!("Vault: {e}"));
            }
        },
        _ => {
            if status == Status::Ok {
                status = Status::NotConnected;
            }
            notes.push("Vault: not connected (sign in to Vault, and set environments.<env>.vaultPath in .dxtutor/deploy.json)".into());
        }
    }
    Gate::new("secrets", status, notes.join(" · "))
}

fn drift_gate(t: &Tools, root: &Path, target: &Target, cfg: &Config) -> Gate {
    let dir = cfg
        .environments
        .get(&target.env)
        .and_then(|e| e.iac.clone());
    let Some(dir) = dir else {
        return if tutor_eval::ops::iac_dirs(root).is_empty() {
            Gate::new(
                "drift",
                Status::Skipped,
                "no infrastructure as code in this project",
            )
        } else {
            Gate::new(
                "drift",
                Status::NotConnected,
                format!(
                    "say which IaC folder is {}'s: environments.{}.iac in .dxtutor/deploy.json",
                    target.env, target.env
                ),
            )
        };
    };
    let accepted = std::collections::HashSet::new();
    let plans = std::env::temp_dir();
    let c = tutor_eval::iac::Ctx {
        root,
        dir: &dir,
        target: None,
        plans: &plans,
        accepted: &accepted,
        cmd: t.cmd,
        has: t.has,
    };
    match tutor_eval::iac::drift(&c) {
        Ok(d) if d.is_empty() => Gate::new("drift", Status::Ok, format!("{dir}: no drift")),
        Ok(d) => Gate::new(
            "drift",
            Status::Failed,
            format!("{dir}: {} resource(s) changed outside the code", d.len()),
        )
        .detail(d.join("\n")),
        Err(e) => Gate::new(
            "drift",
            Status::NotConnected,
            format!("{dir}: the drift could not be read"),
        )
        .detail(e),
    }
}

fn admission_gate(t: &Tools, root: &Path, target: &Target, m: &Manifests, reachable: bool) -> Gate {
    if !reachable {
        return Gate::new(
            "admission",
            Status::NotConnected,
            format!("cluster {} not reachable", target.context),
        );
    }
    let o = kubectl(
        t,
        target,
        &[
            "-n",
            &target.namespace,
            "apply",
            "--dry-run=server",
            "-f",
            "-",
        ],
        root,
        Some(&m.text),
    );
    if o.code == 0 {
        Gate::new(
            "admission",
            Status::Ok,
            "the cluster accepts the manifests (server-side dry run)",
        )
    } else if o.stderr.contains("namespaces") && o.stderr.contains("not found") {
        Gate::new(
            "admission",
            Status::NotConnected,
            format!(
                "namespace {} does not exist yet: the rollout creates it",
                target.namespace
            ),
        )
        .detail(last_words(&o.stderr))
    } else {
        Gate::new(
            "admission",
            Status::Failed,
            "the cluster refuses the manifests",
        )
        .detail(last_words(&o.stderr))
    }
}

fn migrations_gate(root: &Path) -> Gate {
    let dirs = [
        "migrations",
        "db/migrate",
        "prisma/migrations",
        "alembic/versions",
        "src/main/resources/db/migration",
        "migrate",
    ];
    let found: Vec<String> = dirs
        .iter()
        .filter_map(|d| {
            let n = std::fs::read_dir(root.join(d)).ok()?.count();
            (n > 0).then(|| format!("{d} ({n})"))
        })
        .collect();
    if found.is_empty() {
        Gate::new(
            "migrations",
            Status::Skipped,
            "no migrations in this project",
        )
    } else {
        Gate::new(
            "migrations",
            Status::NotConnected,
            format!(
                "migrations in {}: which ones ran needs the database (not connected)",
                found.join(", ")
            ),
        )
    }
}

fn staging_gate(t: &Tools, root: &Path, target: &Target, version: &str) -> Gate {
    let Some((ctx, ns)) = target
        .staging
        .clone()
        .filter(|(c, n)| !c.is_empty() && !n.is_empty())
    else {
        return Gate::new(
            "staging",
            Status::NotConnected,
            "choose staging's cluster in Environments",
        );
    };
    let st = Target {
        context: ctx.clone(),
        namespace: ns.clone(),
        ..target.clone()
    };
    let o = kubectl(
        t,
        &st,
        &["-n", &ns, "get", "deploy", "-o", "json"],
        root,
        None,
    );
    if o.code != 0 {
        return Gate::new(
            "staging",
            Status::NotConnected,
            format!("staging {ctx}/{ns} not reachable"),
        )
        .detail(last_words(&o.stderr));
    }
    let v: Value = serde_json::from_str(&o.stdout).unwrap_or(Value::Null);
    let items = v["items"].as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return Gate::new(
            "staging",
            Status::Failed,
            "nothing runs in staging: deploy this version to staging first",
        );
    }
    let not_ready: Vec<String> = items
        .iter()
        .filter(|d| {
            d["status"]["readyReplicas"].as_u64().unwrap_or(0)
                < d["spec"]["replicas"].as_u64().unwrap_or(1)
        })
        .map(|d| d["metadata"]["name"].as_str().unwrap_or("?").to_string())
        .collect();
    let versions: Vec<String> = items
        .iter()
        .filter_map(|d| {
            d["metadata"]["annotations"][ANN_VER]
                .as_str()
                .map(String::from)
        })
        .collect();
    if !not_ready.is_empty() {
        return Gate::new(
            "staging",
            Status::Failed,
            format!("staging is not healthy: {} not ready", not_ready.join(", ")),
        );
    }
    if !versions
        .iter()
        .any(|x| version.starts_with(x.as_str()) || x.starts_with(version))
    {
        return Gate::new(
            "staging",
            Status::Failed,
            format!(
                "staging runs {} — production only takes a version that ran in staging",
                versions
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "an unknown version".into())
            ),
        );
    }
    Gate::new(
        "staging",
        Status::Ok,
        format!(
            "staging is healthy and runs this version ({} workload(s))",
            items.len()
        ),
    )
}

fn approver_gate(t: &Tools, root: &Path, version: &str) -> (Gate, Option<String>) {
    if !(t.has)("gh") {
        return (
            missing(
                "approver",
                "gh",
                "Install the GitHub CLI and run `gh auth login`",
            ),
            None,
        );
    }
    let me = run(t, "gh", &["api", "user", "-q", ".login"], root, None);
    if me.code != 0 {
        return (
            Gate::new(
                "approver",
                Status::NotConnected,
                "gh is not signed in (gh auth login)",
            )
            .detail(last_words(&me.stderr)),
            None,
        );
    }
    let prs = run(
        t,
        "gh",
        &[
            "pr",
            "list",
            "--state",
            "merged",
            "--search",
            version,
            "--json",
            "number,url,author,reviews",
        ],
        root,
        None,
    );
    if prs.code != 0 {
        return (
            Gate::new(
                "approver",
                Status::NotConnected,
                "gh could not read the pull requests (is the origin on GitHub?)",
            )
            .detail(last_words(&prs.stderr)),
            None,
        );
    }
    match approver_of(&prs.stdout, me.stdout.trim()) {
        Some((who, url)) => (
            Gate::new("approver", Status::Ok, format!("approved by {who}")).detail(url),
            Some(who),
        ),
        None => (
            Gate::new(
                "approver",
                Status::Failed,
                "no merged pull request with this commit was approved by someone else",
            ),
            None,
        ),
    }
}

/// Builds the plan: every check, the rule, and the exact commands. Kept for [`rollout`].
pub fn plan(t: &Tools, root: &Path, target: &Target) -> Result<DeployPlan, String> {
    if !matches!(target.env.as_str(), "staging" | "production") {
        return Err(format!("not an environment to deploy to: {:?}", target.env));
    }
    if target.context.trim().is_empty() || target.namespace.trim().is_empty() {
        return Err(format!(
            "choose {}'s cluster (context and namespace) in Environments",
            target.env
        ));
    }
    let cfg = load_config(root)?;
    let dir = cfg.manifests.clone().unwrap_or_else(|| "deploy/k8s".into());
    let m = read_manifests(root, &dir)?;
    let (version_g, sha, subject) = version_gate(t, root);
    let reachable = (t.has)("kubectl")
        && kubectl(t, target, &["version", "--request-timeout=5s"], root, None).code == 0;
    let identity = Identity {
        git: run(t, "git", &["config", "user.name"], root, None)
            .stdout
            .trim()
            .to_string(),
        cluster: if reachable {
            let o = kubectl(
                t,
                target,
                &[
                    "auth",
                    "whoami",
                    "-o",
                    "jsonpath={.status.userInfo.username}",
                ],
                root,
                None,
            );
            (o.code == 0 && !o.stdout.trim().is_empty()).then(|| o.stdout.trim().to_string())
        } else {
            None
        },
        vault: target.vault.as_ref().and_then(|v| {
            let s = vault::status(t.store, v);
            s.signed_in.then(|| s.display_name.unwrap_or_default())
        }),
    };
    let mut gates = vec![version_g];
    if m.images.is_empty() {
        for id in ["sbom", "signature", "vulns"] {
            gates.push(Gate::new(
                id,
                Status::Skipped,
                "the manifests name no image",
            ));
        }
    } else {
        gates.push(sbom_gate(t, root, &m.images));
        gates.push(signature_gate(t, root, &cfg, &m.images));
        gates.push(vulns_gate(t, root, &m.images));
    }
    gates.push(secrets_gate(t, root, target, &cfg, &m, reachable));
    gates.push(Gate::new("secret-check", Status::NotConnected, "dx-secret-check is not available: its image does not exist yet (it would read the mounted secrets in the cluster and say only exists / non-empty / host resolves / login ok)"));
    gates.push(drift_gate(t, root, target, &cfg));
    gates.push(admission_gate(t, root, target, &m, reachable));
    gates.push(Gate::new(
        "slo",
        Status::NotConnected,
        "no SLO source connected (an error budget needs metrics)",
    ));
    gates.push(if cfg.windows.is_empty() {
        Gate::new(
            "window",
            Status::Skipped,
            "no change window configured (windows in .dxtutor/deploy.json)",
        )
    } else {
        let (d, min) = utc_now();
        if in_window(&cfg.windows, d, min) {
            Gate::new("window", Status::Ok, "inside a change window")
        } else {
            Gate::new(
                "window",
                Status::Failed,
                "outside every change window (UTC)",
            )
        }
    });
    gates.push(migrations_gate(root));
    let mut approver = None;
    if target.env == "production" {
        gates.push(staging_gate(t, root, target, &sha));
        let (g, who) = approver_gate(t, root, &sha);
        approver = who;
        gates.push(g);
    }
    let blockers = blockers(&target.env, &gates, &[]);
    let waivable = waivable(&target.env, &gates);
    let ver = sha.chars().take(12).collect::<String>();
    let mut commands = vec![
        format!(
            "{} | {}",
            shown_kubectl(
                target,
                &format!(
                    "create namespace {} --dry-run=client -o yaml",
                    target.namespace
                )
            ),
            shown_kubectl(target, "apply -f -")
        ),
        format!(
            "{}   # {} without the Secrets ({})",
            shown_kubectl(target, &format!("-n {} apply -f -", target.namespace)),
            m.files.join(", "),
            if m.secrets.is_empty() {
                "none".into()
            } else {
                m.secrets.join(", ")
            }
        ),
    ];
    // only this deploy's Deployments carry its version (`--all` would mark the namespace's others too)
    if !m.deployments.is_empty() {
        let names: Vec<String> = m
            .deployments
            .iter()
            .map(|d| format!("deploy/{d}"))
            .collect();
        commands.push(shown_kubectl(
            target,
            &format!(
                "-n {} annotate {} {ANN_VER}={ver} {ANN_AT}=<now> --overwrite",
                target.namespace,
                names.join(" ")
            ),
        ));
    }
    for d in &m.deployments {
        commands.push(shown_kubectl(
            target,
            &format!(
                "-n {} rollout status deploy/{d} --timeout=180s",
                target.namespace
            ),
        ));
    }
    let mut h = Sha256::new();
    h.update(format!(
        "{}|{}|{}|{}|{}",
        target.env, target.context, target.namespace, sha, m.text
    ));
    let id = hex(&h.finalize())[..24].to_string();
    let p = DeployPlan {
        id: id.clone(),
        env: target.env.clone(),
        context: target.context.clone(),
        namespace: target.namespace.clone(),
        issue: issue_of(&subject),
        version: sha,
        subject,
        identity,
        manifests: m.files.clone(),
        deployments: m.deployments.clone(),
        images: m.images.clone(),
        secrets_from_vault: m.secrets.clone(),
        gates,
        strategy: "rolling".into(),
        blockers,
        waivable,
        commands,
        approver,
        notes: String::new(),
    };
    let mut all = plans().lock().unwrap();
    all.retain(|_, k| k.at.elapsed() < PLAN_TTL);
    all.insert(
        id,
        Kept {
            plan: p.clone(),
            root: root.to_path_buf(),
            target: target.clone(),
            manifests: m.text,
            at: Instant::now(),
        },
    );
    Ok(p)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Rollout {
    pub ok: bool,
    pub plan: DeployPlan,
    /// the waived checks and their reasons
    pub waivers: Vec<(String, String)>,
    pub failed_step: Option<String>,
}

/// The plan a rollout would use, checked again: still kept, same HEAD, same manifests, and not blocked
/// with these waivers (each waiver needs a reason and must be waivable).
pub fn check(
    id: &str,
    t: &Tools,
    waivers: &[(String, String)],
) -> Result<(DeployPlan, PathBuf, Target, String), String> {
    let (p, root, target, manifests, at) = {
        let all = plans().lock().unwrap();
        let k = all
            .get(id)
            .ok_or("this plan is no longer kept: plan the deploy again")?;
        (
            k.plan.clone(),
            k.root.clone(),
            k.target.clone(),
            k.manifests.clone(),
            k.at,
        )
    };
    if at.elapsed() > PLAN_TTL {
        return Err("this plan is more than 30 minutes old: plan the deploy again".into());
    }
    for (g, why) in waivers {
        if !p.waivable.contains(g) {
            return Err(format!("{g} cannot be waived"));
        }
        if why.trim().chars().count() < 3 {
            return Err(format!("waiving {g} needs a reason"));
        }
    }
    let waived: Vec<String> = waivers.iter().map(|(g, _)| g.clone()).collect();
    let still = blockers(&p.env, &p.gates, &waived);
    if !still.is_empty() {
        return Err(format!("blocked by: {}", still.join(", ")));
    }
    let head = run(t, "git", &["rev-parse", "HEAD"], &root, None)
        .stdout
        .trim()
        .to_string();
    if head != p.version {
        return Err("HEAD moved after this plan: plan the deploy again".into());
    }
    let cfg = load_config(&root)?;
    let now = read_manifests(&root, &cfg.manifests.unwrap_or_else(|| "deploy/k8s".into()))?;
    if now.text != manifests {
        return Err("the manifests changed after this plan: plan the deploy again".into());
    }
    Ok((p, root, target, manifests))
}

/// Rolls the plan out (after [`check`]), telling `on` each line. The plan is used once.
pub fn rollout(
    id: &str,
    t: &Tools,
    waivers: &[(String, String)],
    on: &mut dyn FnMut(&str),
) -> Result<Rollout, String> {
    let (p, root, target, manifests) = check(id, t, waivers)?;
    plans().lock().unwrap().remove(id);
    let mut out = Rollout {
        ok: false,
        plan: p.clone(),
        waivers: waivers.to_vec(),
        failed_step: None,
    };
    let mut step =
        |name: &str, args: &[&str], stdin: Option<&str>, on: &mut dyn FnMut(&str)| -> bool {
            on(&format!("$ {}", shown_kubectl(&target, &args.join(" "))));
            let o = kubectl(t, &target, args, &root, stdin);
            for l in format!("{}{}", o.stdout, o.stderr)
                .lines()
                .filter(|l| !l.trim().is_empty())
            {
                on(&tutor_protect::redact::current().mask(l));
            }
            if o.code != 0 {
                out.failed_step = Some(name.into());
            }
            o.code == 0
        };
    let ns = kubectl(
        t,
        &target,
        &[
            "create",
            "namespace",
            &target.namespace,
            "--dry-run=client",
            "-o",
            "yaml",
        ],
        &root,
        None,
    );
    let ver = p.version.chars().take(12).collect::<String>();
    let at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
        .to_string();
    let ann_ver = format!("{ANN_VER}={ver}");
    let ann_at = format!("{ANN_AT}={at}");
    let ok = ns.code == 0
        && step("namespace", &["apply", "-f", "-"], Some(&ns.stdout), on)
        && step(
            "apply",
            &["-n", &target.namespace, "apply", "-f", "-"],
            Some(&manifests),
            on,
        )
        && (p.deployments.is_empty() || {
            // only this deploy's Deployments carry its version
            let names: Vec<String> = p
                .deployments
                .iter()
                .map(|d| format!("deploy/{d}"))
                .collect();
            let mut args: Vec<&str> = vec!["-n", &target.namespace, "annotate"];
            args.extend(names.iter().map(String::as_str));
            args.extend([ann_ver.as_str(), ann_at.as_str(), "--overwrite"]);
            step("annotate", &args, None, on)
        })
        && p.deployments.iter().all(|d| {
            let r = format!("deploy/{d}");
            step(
                "rollout",
                &[
                    "-n",
                    &target.namespace,
                    "rollout",
                    "status",
                    &r,
                    "--timeout=180s",
                ],
                None,
                on,
            )
        });
    if ns.code != 0 {
        out.failed_step = Some("namespace".into());
        on(&last_words(&ns.stderr));
    }
    out.ok = ok;
    Ok(out)
}

#[cfg(test)]
mod tests;
