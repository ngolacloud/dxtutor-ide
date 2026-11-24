//! DevOps, read-only by default (A9, docs/v2/UI-AUDIT.md item 10).
//!
//! - IaC (OPS-03): the folders with `.tf` files, and a `plan` (or a `plan -refresh-only`, the drift)
//!   run with OpenTofu or Terraform, read from `show -json` into a per-resource, per-attribute diff.
//!   The plan file goes to a temporary folder (nothing is left in the project but the `.terraform`
//!   cache `init` always makes); nothing is applied — applying is a command the human runs.
//! - Kubernetes (OPS-05): pods (phase, ready, restarts, the reason a container is stuck), services,
//!   deployments, recent warning events, and a deployment's rollout history (its ReplicaSets) — from
//!   `kubectl … -o json`, always with an explicit context and namespace.
//! - Cloud (OPS-01): whether `aws` / `gcloud` / `az` are installed and which profile or account their
//!   local configuration uses, and a read-only inventory through the official CLIs.
//!
//! Every function runs the real tool; without it, the result says what is missing. Nothing invented.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;

fn has(tool: &str) -> bool {
    Command::new(tool)
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok()
        || Command::new(tool)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
}

struct Out {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn run(cmd: &mut Command) -> Out {
    match cmd.stdin(Stdio::null()).output() {
        Ok(o) => Out {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => Out {
            ok: false,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

fn tail(s: &str, n: usize) -> String {
    let t = s.trim();
    if t.len() <= n {
        return t.to_string();
    }
    let mut i = t.len() - n;
    while !t.is_char_boundary(i) {
        i += 1;
    }
    format!("…{}", &t[i..])
}

// ───── IaC ─────

/// The IaC tool on PATH: OpenTofu first, then Terraform.
pub fn iac_tool() -> Option<&'static str> {
    ["tofu", "terraform"].into_iter().find(|t| has(t))
}

/// The folders (relative to `root`, `.` for the root) that hold `.tf` files, up to 4 levels deep.
pub fn iac_dirs(root: &Path) -> Vec<String> {
    let mut out = vec![];
    fn walk(root: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
        let Ok(rd) = std::fs::read_dir(dir) else {
            return;
        };
        let mut has_tf = false;
        let mut subs = vec![];
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if p.is_dir() {
                if depth < 4 && !name.starts_with('.') && name != "node_modules" && name != "target"
                {
                    subs.push(p);
                }
            } else if name.ends_with(".tf") {
                has_tf = true;
            }
        }
        if has_tf {
            let rel = dir
                .strip_prefix(root)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push(if rel.is_empty() { ".".into() } else { rel });
        }
        subs.sort();
        for s in subs {
            walk(root, &s, depth + 1, out);
        }
    }
    walk(root, root, 0, &mut out);
    out
}

/// One attribute that changes (values as JSON text; `unknown` = known only after apply).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrChange {
    pub name: String,
    pub before: Option<String>,
    pub after: Option<String>,
    pub unknown: bool,
    pub sensitive: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceChange {
    pub address: String,
    /// create | update | delete | replace | read | no-op
    pub action: String,
    pub attrs: Vec<AttrChange>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IacPlan {
    pub ok: bool,
    pub tool: String,
    pub dir: String,
    pub refresh_only: bool,
    pub add: usize,
    pub change: usize,
    pub destroy: usize,
    pub changes: Vec<ResourceChange>,
    /// what changed outside the IaC (refresh-only, or found while planning)
    pub drift: Vec<ResourceChange>,
    /// the command the human runs to apply this plan
    pub apply_command: String,
    pub notes: String,
}

fn action_of(actions: &[Value]) -> String {
    let a: Vec<&str> = actions.iter().filter_map(|v| v.as_str()).collect();
    match a.as_slice() {
        ["create"] => "create",
        ["delete"] => "delete",
        ["update"] => "update",
        ["read"] => "read",
        ["no-op"] => "no-op",
        ["delete", "create"] | ["create", "delete"] => "replace",
        _ => "update",
    }
    .to_string()
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn attr_diff(change: &Value) -> Vec<AttrChange> {
    let before = change["before"].as_object().cloned().unwrap_or_default();
    let after = change["after"].as_object().cloned().unwrap_or_default();
    let unknown = change["after_unknown"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let sens_b = change["before_sensitive"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let sens_a = change["after_sensitive"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let mut keys: Vec<String> = before
        .keys()
        .chain(after.keys())
        .chain(unknown.keys())
        .cloned()
        .collect();
    keys.sort();
    keys.dedup();
    keys.into_iter()
        .filter_map(|k| {
            let b = before.get(&k).filter(|v| !v.is_null());
            let a = after.get(&k).filter(|v| !v.is_null());
            let unk = unknown
                .get(&k)
                .map(|v| v == &Value::Bool(true))
                .unwrap_or(false);
            if b == a && !unk {
                return None;
            }
            let sensitive = sens_b
                .get(&k)
                .map(|v| v == &Value::Bool(true))
                .unwrap_or(false)
                || sens_a
                    .get(&k)
                    .map(|v| v == &Value::Bool(true))
                    .unwrap_or(false);
            Some(AttrChange {
                name: k,
                before: if sensitive {
                    b.map(|_| "(sensitive)".into())
                } else {
                    b.map(text)
                },
                after: if sensitive {
                    a.map(|_| "(sensitive)".into())
                } else {
                    a.map(text)
                },
                unknown: unk,
                sensitive,
            })
        })
        .collect()
}

/// Reads `show -json` of a plan into the per-resource diff.
pub fn parse_plan(json: &str) -> Result<(Vec<ResourceChange>, Vec<ResourceChange>), String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("plan JSON: {e}"))?;
    let read = |key: &str| -> Vec<ResourceChange> {
        v[key]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|r| {
                let action = action_of(
                    r["change"]["actions"]
                        .as_array()
                        .map(Vec::as_slice)
                        .unwrap_or(&[]),
                );
                ResourceChange {
                    address: r["address"].as_str().unwrap_or("").to_string(),
                    attrs: attr_diff(&r["change"]),
                    action,
                }
            })
            .collect()
    };
    let changes: Vec<ResourceChange> = read("resource_changes")
        .into_iter()
        .filter(|c| c.action != "no-op" && c.action != "read")
        .collect();
    Ok((changes, read("resource_drift")))
}

/// `init` + `plan` (+ `show -json`) in `root/dir`. Nothing is applied.
pub fn iac_plan(root: &Path, dir: &str, refresh_only: bool) -> IacPlan {
    let Some(tool) = iac_tool() else {
        return IacPlan {
            dir: dir.into(),
            refresh_only,
            notes: "Neither OpenTofu (tofu) nor Terraform is installed.".into(),
            ..Default::default()
        };
    };
    let base = IacPlan {
        tool: tool.into(),
        dir: dir.into(),
        refresh_only,
        ..Default::default()
    };
    if dir.starts_with('/') || dir.split('/').any(|c| c == "..") {
        return IacPlan {
            notes: format!("folder outside the project: {dir}"),
            ..base
        };
    }
    let wd: PathBuf = if dir == "." {
        root.to_path_buf()
    } else {
        root.join(dir)
    };
    if !wd.is_dir() {
        return IacPlan {
            notes: format!("no such folder: {dir}"),
            ..base
        };
    }
    let tmp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => {
            return IacPlan {
                notes: e.to_string(),
                ..base
            }
        }
    };
    let plan_file = tmp.path().join("plan.bin");
    let cmd = |args: &[&str]| {
        let mut c = Command::new(tool);
        c.args(args)
            .current_dir(&wd)
            .env("TF_IN_AUTOMATION", "1")
            .env("TF_INPUT", "0")
            .env("NO_COLOR", "1");
        c
    };
    let init = run(&mut cmd(&["init", "-input=false", "-no-color"]));
    if !init.ok {
        return IacPlan {
            notes: format!("{tool} init failed:\n{}", tail(&init.stderr, 4000)),
            ..base
        };
    }
    let out = format!("-out={}", plan_file.display());
    let mut args = vec![
        "plan",
        "-input=false",
        "-no-color",
        "-lock=false",
        out.as_str(),
    ];
    if refresh_only {
        args.push("-refresh-only");
    }
    let plan = run(&mut cmd(&args));
    if !plan.ok {
        return IacPlan {
            notes: format!("{tool} plan failed:\n{}", tail(&plan.stderr, 4000)),
            ..base
        };
    }
    let show = run(&mut cmd(&[
        "show",
        "-json",
        plan_file.to_str().unwrap_or("plan.bin"),
    ]));
    if !show.ok {
        return IacPlan {
            notes: tail(&show.stderr, 4000),
            ..base
        };
    }
    match parse_plan(&show.stdout) {
        Ok((changes, drift)) => {
            let n = |a: &str| changes.iter().filter(|c| c.action == a).count();
            let (add, change, destroy) = (
                n("create") + n("replace"),
                n("update"),
                n("delete") + n("replace"),
            );
            IacPlan {
                ok: true,
                add,
                change,
                destroy,
                apply_command: if refresh_only {
                    format!("{tool} apply -refresh-only")
                } else {
                    format!("{tool} plan -out=tfplan && {tool} apply tfplan")
                },
                notes: if changes.is_empty() && drift.is_empty() {
                    "No changes: the infrastructure matches the configuration.".into()
                } else {
                    String::new()
                },
                changes,
                drift,
                ..base
            }
        }
        Err(e) => IacPlan { notes: e, ..base },
    }
}

// ───── Kubernetes ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pod {
    pub name: String,
    pub phase: String,
    pub ready: String,
    pub restarts: u32,
    pub node: String,
    pub created: String,
    /// why a container is waiting or terminated (CrashLoopBackOff, ImagePullBackOff, OOMKilled…)
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub name: String,
    pub kind: String,
    pub cluster_ip: String,
    pub ports: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Deployment {
    pub name: String,
    pub ready: String,
    pub images: Vec<String>,
    pub revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub kind: String,
    pub reason: String,
    pub object: String,
    pub message: String,
    pub count: u32,
    pub last: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KubeState {
    pub ok: bool,
    pub context: String,
    pub namespace: String,
    pub pods: Vec<Pod>,
    pub services: Vec<Service>,
    pub deployments: Vec<Deployment>,
    /// warnings first, newest first
    pub events: Vec<Event>,
    pub notes: String,
}

pub fn parse_pods(v: &Value) -> Vec<Pod> {
    v["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|p| {
            let cs = p["status"]["containerStatuses"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let ready = cs
                .iter()
                .filter(|c| c["ready"].as_bool().unwrap_or(false))
                .count();
            let reason = cs.iter().find_map(|c| {
                c["state"]["waiting"]["reason"]
                    .as_str()
                    .or(c["state"]["terminated"]["reason"].as_str())
                    .or(c["lastState"]["terminated"]["reason"]
                        .as_str()
                        .filter(|_| !c["ready"].as_bool().unwrap_or(false)))
                    .map(String::from)
            });
            Pod {
                name: p["metadata"]["name"].as_str().unwrap_or("").into(),
                phase: p["status"]["phase"].as_str().unwrap_or("").into(),
                ready: format!(
                    "{ready}/{}",
                    cs.len().max(
                        p["spec"]["containers"]
                            .as_array()
                            .map(|a| a.len())
                            .unwrap_or(0)
                    )
                ),
                restarts: cs
                    .iter()
                    .map(|c| c["restartCount"].as_u64().unwrap_or(0) as u32)
                    .sum(),
                node: p["spec"]["nodeName"].as_str().unwrap_or("").into(),
                created: p["metadata"]["creationTimestamp"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
                reason,
            }
        })
        .collect()
}

pub fn parse_services(v: &Value) -> Vec<Service> {
    v["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| Service {
            name: s["metadata"]["name"].as_str().unwrap_or("").into(),
            kind: s["spec"]["type"].as_str().unwrap_or("").into(),
            cluster_ip: s["spec"]["clusterIP"].as_str().unwrap_or("").into(),
            ports: s["spec"]["ports"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .map(|p| {
                    let port = p["port"].as_u64().unwrap_or(0);
                    let tgt = text(&p["targetPort"]);
                    let node = p["nodePort"]
                        .as_u64()
                        .map(|n| format!(":{n}"))
                        .unwrap_or_default();
                    format!(
                        "{port}→{tgt}{node}/{}",
                        p["protocol"].as_str().unwrap_or("TCP")
                    )
                })
                .collect(),
        })
        .collect()
}

pub fn parse_deployments(v: &Value) -> Vec<Deployment> {
    v["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|d| Deployment {
            name: d["metadata"]["name"].as_str().unwrap_or("").into(),
            ready: format!(
                "{}/{}",
                d["status"]["readyReplicas"].as_u64().unwrap_or(0),
                d["spec"]["replicas"].as_u64().unwrap_or(0)
            ),
            images: d["spec"]["template"]["spec"]["containers"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|c| c["image"].as_str().map(String::from))
                .collect(),
            revision: d["metadata"]["annotations"]["deployment.kubernetes.io/revision"]
                .as_str()
                .map(String::from),
        })
        .collect()
}

pub fn parse_events(v: &Value) -> Vec<Event> {
    let mut ev: Vec<Event> = v["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|e| Event {
            kind: e["type"].as_str().unwrap_or("").into(),
            reason: e["reason"].as_str().unwrap_or("").into(),
            object: format!(
                "{}/{}",
                e["involvedObject"]["kind"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase(),
                e["involvedObject"]["name"].as_str().unwrap_or("")
            ),
            message: e["message"].as_str().unwrap_or("").trim().into(),
            count: e["count"].as_u64().unwrap_or(1) as u32,
            last: e["lastTimestamp"]
                .as_str()
                .or(e["eventTime"].as_str())
                .or(e["metadata"]["creationTimestamp"].as_str())
                .unwrap_or("")
                .into(),
        })
        .collect();
    ev.sort_by(|a, b| {
        (b.kind == "Warning")
            .cmp(&(a.kind == "Warning"))
            .then(b.last.cmp(&a.last))
    });
    ev.truncate(40);
    ev
}

fn kubectl(kubeconfig: Option<&str>, context: &str, namespace: &str, args: &[&str]) -> Out {
    let mut c = Command::new("kubectl");
    if let Some(k) = kubeconfig {
        c.env("KUBECONFIG", k);
    }
    if !context.is_empty() {
        c.args(["--context", context]);
    }
    if !namespace.is_empty() {
        c.args(["-n", namespace]);
    }
    c.args(["--request-timeout=10s"]).args(args);
    run(&mut c)
}

fn check_name(s: &str) -> Result<&str, String> {
    if s.is_empty()
        || s.len() > 253
        || !s
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._@:/".contains(c))
        || s.starts_with('-')
    {
        return Err(format!("invalid name: {s:?}"));
    }
    Ok(s)
}

/// The workloads of one namespace of one context (read-only).
pub fn kube_state(kubeconfig: Option<&str>, context: &str, namespace: &str) -> KubeState {
    let base = KubeState {
        context: context.into(),
        namespace: namespace.into(),
        ..Default::default()
    };
    if !has("kubectl") {
        return KubeState {
            notes: "kubectl is not installed.".into(),
            ..base
        };
    }
    if let Err(e) = check_name(context).and(check_name(namespace)) {
        return KubeState { notes: e, ..base };
    }
    let get = |kind: &str| kubectl(kubeconfig, context, namespace, &["get", kind, "-o", "json"]);
    let pods = get("pods");
    if !pods.ok {
        return KubeState {
            notes: tail(&pods.stderr, 2000),
            ..base
        };
    }
    let j = |o: &Out| serde_json::from_str::<Value>(&o.stdout).unwrap_or(Value::Null);
    let (svc, dep, ev) = (get("services"), get("deployments"), get("events"));
    KubeState {
        ok: true,
        pods: parse_pods(&j(&pods)),
        services: if svc.ok {
            parse_services(&j(&svc))
        } else {
            vec![]
        },
        deployments: if dep.ok {
            parse_deployments(&j(&dep))
        } else {
            vec![]
        },
        events: if ev.ok { parse_events(&j(&ev)) } else { vec![] },
        ..base
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub revision: u32,
    pub replica_set: String,
    pub images: Vec<String>,
    pub created: String,
    pub replicas: u32,
}

/// A deployment's ReplicaSets by revision, newest first (what `rollout undo` can go back to).
pub fn parse_history(v: &Value, deployment: &str) -> Vec<Revision> {
    let mut out: Vec<Revision> = v["items"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|rs| {
            rs["metadata"]["ownerReferences"]
                .as_array()
                .map(|o| {
                    o.iter()
                        .any(|r| r["kind"] == "Deployment" && r["name"] == deployment)
                })
                .unwrap_or(false)
        })
        .filter_map(|rs| {
            Some(Revision {
                revision: rs["metadata"]["annotations"]["deployment.kubernetes.io/revision"]
                    .as_str()?
                    .parse()
                    .ok()?,
                replica_set: rs["metadata"]["name"].as_str().unwrap_or("").into(),
                images: rs["spec"]["template"]["spec"]["containers"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|c| c["image"].as_str().map(String::from))
                    .collect(),
                created: rs["metadata"]["creationTimestamp"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
                replicas: rs["status"]["replicas"].as_u64().unwrap_or(0) as u32,
            })
        })
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.revision));
    out
}

pub fn kube_history(
    kubeconfig: Option<&str>,
    context: &str,
    namespace: &str,
    deployment: &str,
) -> Result<Vec<Revision>, String> {
    check_name(context)?;
    check_name(namespace)?;
    check_name(deployment)?;
    let o = kubectl(
        kubeconfig,
        context,
        namespace,
        &["get", "replicasets", "-o", "json"],
    );
    if !o.ok {
        return Err(tail(&o.stderr, 2000));
    }
    let v: Value = serde_json::from_str(&o.stdout).map_err(|e| e.to_string())?;
    Ok(parse_history(&v, deployment))
}

// ───── Cloud CLIs ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCli {
    /// aws | gcloud | az
    pub provider: String,
    pub installed: bool,
    pub version: String,
    /// the profile / project / subscription the local configuration points at
    pub account: Option<String>,
    pub notes: String,
}

fn first_line(s: &str) -> String {
    s.lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// What each official cloud CLI says about itself, from its local configuration only (no network).
pub fn cloud_status() -> Vec<CloudCli> {
    let aws = if has("aws") {
        let v = run(Command::new("aws").arg("--version"));
        let prof = std::env::var("AWS_PROFILE").ok().or_else(|| {
            let p = run(Command::new("aws").args(["configure", "list-profiles"]));
            p.ok.then(|| first_line(&p.stdout))
                .filter(|s| !s.is_empty())
        });
        CloudCli {
            provider: "aws".into(),
            installed: true,
            version: first_line(&(v.stdout + &v.stderr)),
            account: prof,
            notes: String::new(),
        }
    } else {
        CloudCli {
            provider: "aws".into(),
            installed: false,
            version: String::new(),
            account: None,
            notes: "Install the AWS CLI v2 and run `aws configure sso` (or `aws configure`)."
                .into(),
        }
    };
    let gcloud = if has("gcloud") {
        let v = run(Command::new("gcloud").args(["version", "--format=json"]));
        let cfg = run(Command::new("gcloud").args(["config", "list", "--format=json"]));
        let c: Value = serde_json::from_str(&cfg.stdout).unwrap_or(Value::Null);
        let ver: Value = serde_json::from_str(&v.stdout).unwrap_or(Value::Null);
        let account = c["core"]["project"]
            .as_str()
            .map(|p| format!("{} ({})", p, c["core"]["account"].as_str().unwrap_or("?")));
        CloudCli {
            provider: "gcloud".into(),
            installed: true,
            version: ver["Google Cloud SDK"].as_str().unwrap_or("").into(),
            account,
            notes: String::new(),
        }
    } else {
        CloudCli {
            provider: "gcloud".into(),
            installed: false,
            version: String::new(),
            account: None,
            notes: "Install the Google Cloud CLI and run `gcloud init`.".into(),
        }
    };
    let az = if has("az") {
        let v = run(Command::new("az").args(["version", "-o", "json"]));
        let acc = run(Command::new("az").args(["account", "show", "-o", "json"]));
        let a: Value = serde_json::from_str(&acc.stdout).unwrap_or(Value::Null);
        let ver: Value = serde_json::from_str(&v.stdout).unwrap_or(Value::Null);
        CloudCli {
            provider: "az".into(),
            installed: true,
            version: ver["azure-cli"].as_str().unwrap_or("").into(),
            account: a["name"].as_str().map(String::from),
            notes: if acc.ok {
                String::new()
            } else {
                "Run `az login`.".into()
            },
        }
    } else {
        CloudCli {
            provider: "az".into(),
            installed: false,
            version: String::new(),
            account: None,
            notes: "Install the Azure CLI and run `az login`.".into(),
        }
    };
    vec![aws, gcloud, az]
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudResource {
    pub provider: String,
    pub kind: String,
    pub name: String,
    pub region: String,
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudInventory {
    pub ok: bool,
    pub provider: String,
    pub resources: Vec<CloudResource>,
    /// the read-only commands that were run
    pub commands: Vec<String>,
    pub notes: String,
}

pub fn parse_aws_lambda(v: &Value, region: &str) -> Vec<CloudResource> {
    v["Functions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|f| CloudResource {
            provider: "aws".into(),
            kind: "lambda".into(),
            name: f["FunctionName"].as_str().unwrap_or("").into(),
            region: region.into(),
            status: f["Runtime"].as_str().unwrap_or("").into(),
        })
        .collect()
}

pub fn parse_aws_ec2(v: &Value, region: &str) -> Vec<CloudResource> {
    v["Reservations"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .flat_map(|r| r["Instances"].as_array().cloned().unwrap_or_default())
        .map(|i| {
            let name = i["Tags"]
                .as_array()
                .and_then(|t| t.iter().find(|t| t["Key"] == "Name"))
                .and_then(|t| t["Value"].as_str())
                .unwrap_or(i["InstanceId"].as_str().unwrap_or(""))
                .to_string();
            CloudResource {
                provider: "aws".into(),
                kind: "ec2".into(),
                name,
                region: i["Placement"]["AvailabilityZone"]
                    .as_str()
                    .unwrap_or(region)
                    .into(),
                status: i["State"]["Name"].as_str().unwrap_or("").into(),
            }
        })
        .collect()
}

pub fn parse_gcloud_run(v: &Value) -> Vec<CloudResource> {
    v.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|s| {
            let ready = s["status"]["conditions"]
                .as_array()
                .and_then(|c| c.iter().find(|c| c["type"] == "Ready"))
                .and_then(|c| c["status"].as_str())
                .unwrap_or("");
            CloudResource {
                provider: "gcloud".into(),
                kind: "run".into(),
                name: s["metadata"]["name"].as_str().unwrap_or("").into(),
                region: s["metadata"]["labels"]["cloud.googleapis.com/location"]
                    .as_str()
                    .unwrap_or("")
                    .into(),
                status: if ready == "True" {
                    "ready".into()
                } else {
                    ready.to_lowercase()
                },
            }
        })
        .collect()
}

pub fn parse_az_resources(v: &Value) -> Vec<CloudResource> {
    v.as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .map(|r| CloudResource {
            provider: "az".into(),
            kind: r["type"]
                .as_str()
                .unwrap_or("")
                .rsplit('/')
                .next()
                .unwrap_or("")
                .into(),
            name: r["name"].as_str().unwrap_or("").into(),
            region: r["location"].as_str().unwrap_or("").into(),
            status: r["properties"]["provisioningState"]
                .as_str()
                .unwrap_or("")
                .into(),
        })
        .collect()
}

/// Reads one CLI's JSON (and the region it ran against) into resources.
type Parser = fn(&Value, &str) -> Vec<CloudResource>;

/// A read-only inventory through the provider's official CLI and its current profile/project/subscription.
pub fn cloud_inventory(provider: &str) -> CloudInventory {
    let base = CloudInventory {
        provider: provider.into(),
        ..Default::default()
    };
    let tool = match provider {
        "aws" | "gcloud" | "az" => provider,
        other => {
            return CloudInventory {
                notes: format!("unknown provider: {other}"),
                ..base
            }
        }
    };
    if !has(tool) {
        return CloudInventory {
            notes: format!("{tool} is not installed."),
            ..base
        };
    }
    let calls: Vec<(Vec<&str>, Parser)> = match tool {
        "aws" => vec![
            (
                vec!["lambda", "list-functions", "--output", "json"],
                parse_aws_lambda,
            ),
            (
                vec!["ec2", "describe-instances", "--output", "json"],
                parse_aws_ec2,
            ),
        ],
        "gcloud" => vec![(vec!["run", "services", "list", "--format=json"], |v, _| {
            parse_gcloud_run(v)
        })],
        _ => vec![(vec!["resource", "list", "-o", "json"], |v, _| {
            parse_az_resources(v)
        })],
    };
    let region = std::env::var("AWS_REGION")
        .or_else(|_| std::env::var("AWS_DEFAULT_REGION"))
        .unwrap_or_default();
    let mut out = CloudInventory { ok: true, ..base };
    for (args, parse) in calls {
        out.commands.push(format!("{tool} {}", args.join(" ")));
        let o = run(Command::new(tool).args(&args));
        if !o.ok {
            out.ok = false;
            out.notes.push_str(&format!(
                "{tool} {}: {}\n",
                args[..2.min(args.len())].join(" "),
                tail(&o.stderr, 600)
            ));
            continue;
        }
        let v: Value = serde_json::from_str(&o.stdout).unwrap_or(Value::Null);
        out.resources.extend(parse(&v, &region));
    }
    out.notes = out.notes.trim_end().to_string();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_iac_folders() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("infra/prod")).unwrap();
        std::fs::create_dir_all(d.path().join(".terraform/modules")).unwrap();
        std::fs::write(d.path().join("main.tf"), "").unwrap();
        std::fs::write(d.path().join("infra/prod/x.tf"), "").unwrap();
        std::fs::write(d.path().join(".terraform/modules/y.tf"), "").unwrap();
        assert_eq!(iac_dirs(d.path()), vec![".", "infra/prod"]);
    }

    #[test]
    fn real_plan_with_opentofu_create_update_and_no_changes() {
        let Some(tool) = iac_tool() else {
            eprintln!("skipped: no tofu/terraform");
            return;
        };
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("infra");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.tf"), "resource \"terraform_data\" \"web\" {\n  input = { image = \"nginx:1.27\", replicas = 2 }\n}\n").unwrap();
        let p = iac_plan(d.path(), "infra", false);
        assert!(p.ok, "{}", p.notes);
        assert_eq!((p.add, p.change, p.destroy), (1, 0, 0));
        assert_eq!(p.changes[0].address, "terraform_data.web");
        assert_eq!(p.changes[0].action, "create");
        assert!(p.changes[0]
            .attrs
            .iter()
            .any(|a| a.name == "input" && a.after.as_deref().unwrap_or("").contains("nginx:1.27")));
        assert!(p.changes[0]
            .attrs
            .iter()
            .any(|a| a.name == "id" && a.unknown));
        assert!(!dir.join("plan.bin").exists());
        // apply it here (a local state only), then change the input: an update... replace for terraform_data
        assert!(Command::new(tool)
            .args(["apply", "-auto-approve", "-input=false", "-no-color"])
            .current_dir(&dir)
            .output()
            .unwrap()
            .status
            .success());
        let same = iac_plan(d.path(), "infra", false);
        assert!(same.ok && same.changes.is_empty(), "{:?}", same.changes);
        assert!(same.notes.contains("No changes"));
        std::fs::write(dir.join("main.tf"), "resource \"terraform_data\" \"web\" {\n  input = { image = \"nginx:1.28\", replicas = 2 }\n}\n").unwrap();
        let upd = iac_plan(d.path(), "infra", false);
        assert!(upd.ok, "{}", upd.notes);
        assert_eq!(upd.changes.len(), 1);
        let input = upd.changes[0]
            .attrs
            .iter()
            .find(|a| a.name == "input")
            .unwrap();
        assert!(
            input.before.as_deref().unwrap().contains("1.27")
                && input.after.as_deref().unwrap().contains("1.28")
        );
        assert!(iac_plan(d.path(), "../etc", false)
            .notes
            .contains("outside"));
        let bad = {
            std::fs::write(dir.join("main.tf"), "resource \"terraform_data\" {").unwrap();
            iac_plan(d.path(), "infra", false)
        };
        assert!(!bad.ok && !bad.notes.is_empty());
    }

    #[test]
    fn parses_kubernetes_objects() {
        let pods = json!({"items": [
            {"metadata": {"name": "web-1", "creationTimestamp": "2026-11-24T10:00:00Z"}, "spec": {"nodeName": "n1", "containers": [{}]}, "status": {"phase": "Running", "containerStatuses": [{"ready": false, "restartCount": 6, "state": {"waiting": {"reason": "CrashLoopBackOff"}}}]}},
            {"metadata": {"name": "db-0"}, "spec": {"containers": [{}, {}]}, "status": {"phase": "Running", "containerStatuses": [{"ready": true, "restartCount": 0, "state": {"running": {}}}, {"ready": true, "restartCount": 1, "state": {"running": {}}}]}}
        ]});
        let p = parse_pods(&pods);
        assert_eq!(p[0].reason.as_deref(), Some("CrashLoopBackOff"));
        assert_eq!((p[0].ready.as_str(), p[0].restarts), ("0/1", 6));
        assert_eq!(
            (p[1].ready.as_str(), p[1].restarts, p[1].reason.clone()),
            ("2/2", 1, None)
        );
        let svc = parse_services(
            &json!({"items": [{"metadata": {"name": "web"}, "spec": {"type": "NodePort", "clusterIP": "10.0.0.5", "ports": [{"port": 80, "targetPort": 8080, "nodePort": 30080, "protocol": "TCP"}]}}]}),
        );
        assert_eq!(svc[0].ports, vec!["80→8080:30080/TCP"]);
        let dep = parse_deployments(
            &json!({"items": [{"metadata": {"name": "web", "annotations": {"deployment.kubernetes.io/revision": "3"}}, "spec": {"replicas": 3, "template": {"spec": {"containers": [{"image": "web:1.2"}]}}}, "status": {"readyReplicas": 2}}]}),
        );
        assert_eq!(
            (dep[0].ready.as_str(), dep[0].revision.as_deref()),
            ("2/3", Some("3"))
        );
        let ev = parse_events(&json!({"items": [
            {"type": "Normal", "reason": "Pulled", "involvedObject": {"kind": "Pod", "name": "a"}, "message": "ok", "lastTimestamp": "2026-11-24T10:05:00Z"},
            {"type": "Warning", "reason": "BackOff", "involvedObject": {"kind": "Pod", "name": "web-1"}, "message": "Back-off restarting", "count": 9, "lastTimestamp": "2026-11-24T10:01:00Z"}
        ]}));
        assert_eq!(
            (ev[0].kind.as_str(), ev[0].object.as_str(), ev[0].count),
            ("Warning", "pod/web-1", 9)
        );
        let hist = parse_history(
            &json!({"items": [
                {"metadata": {"name": "web-a", "annotations": {"deployment.kubernetes.io/revision": "1"}, "ownerReferences": [{"kind": "Deployment", "name": "web"}]}, "spec": {"template": {"spec": {"containers": [{"image": "web:1.0"}]}}}, "status": {"replicas": 0}},
                {"metadata": {"name": "web-b", "annotations": {"deployment.kubernetes.io/revision": "2"}, "ownerReferences": [{"kind": "Deployment", "name": "web"}]}, "spec": {"template": {"spec": {"containers": [{"image": "web:1.1"}]}}}, "status": {"replicas": 3}},
                {"metadata": {"name": "api-a", "annotations": {"deployment.kubernetes.io/revision": "5"}, "ownerReferences": [{"kind": "Deployment", "name": "api"}]}, "spec": {}, "status": {}}
            ]}),
            "web",
        );
        assert_eq!(
            hist.iter()
                .map(|r| (r.revision, r.images[0].as_str()))
                .collect::<Vec<_>>(),
            vec![(2, "web:1.1"), (1, "web:1.0")]
        );
    }

    #[test]
    fn kubectl_against_an_empty_kubeconfig_says_so() {
        if !has("kubectl") {
            eprintln!("skipped: no kubectl");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let cfg = d.path().join("config");
        std::fs::write(
            &cfg,
            "apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n",
        )
        .unwrap();
        let s = kube_state(Some(cfg.to_str().unwrap()), "nowhere", "default");
        assert!(!s.ok);
        assert!(s.notes.contains("nowhere"), "{}", s.notes);
        assert!(kube_state(None, "--all", "default")
            .notes
            .contains("invalid"));
    }

    #[test]
    fn parses_cloud_cli_json() {
        let l = parse_aws_lambda(
            &json!({"Functions": [{"FunctionName": "resize", "Runtime": "nodejs20.x"}]}),
            "eu-west-1",
        );
        assert_eq!(
            (
                l[0].name.as_str(),
                l[0].status.as_str(),
                l[0].region.as_str()
            ),
            ("resize", "nodejs20.x", "eu-west-1")
        );
        let e = parse_aws_ec2(
            &json!({"Reservations": [{"Instances": [{"InstanceId": "i-1", "Tags": [{"Key": "Name", "Value": "bastion"}], "State": {"Name": "running"}, "Placement": {"AvailabilityZone": "eu-west-1a"}}]}]}),
            "",
        );
        assert_eq!(
            (
                e[0].name.as_str(),
                e[0].status.as_str(),
                e[0].region.as_str()
            ),
            ("bastion", "running", "eu-west-1a")
        );
        let r = parse_gcloud_run(
            &json!([{"metadata": {"name": "api", "labels": {"cloud.googleapis.com/location": "europe-west1"}}, "status": {"conditions": [{"type": "Ready", "status": "True"}]}}]),
        );
        assert_eq!((r[0].name.as_str(), r[0].status.as_str()), ("api", "ready"));
        let a = parse_az_resources(
            &json!([{"name": "web-app", "type": "Microsoft.Web/sites", "location": "westeurope", "properties": {"provisioningState": "Succeeded"}}]),
        );
        assert_eq!(
            (a[0].kind.as_str(), a[0].status.as_str()),
            ("sites", "Succeeded")
        );
        // this machine has none of the three CLIs: the status says how to install them
        for c in cloud_status() {
            if !c.installed {
                assert!(!c.notes.is_empty());
            }
        }
        assert!(cloud_inventory("ibm").notes.contains("unknown"));
    }
}
