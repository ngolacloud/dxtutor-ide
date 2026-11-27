//! H4 (docs/v2/AUDIT-harness.md §4): the Platform, SRE and DevOps actions of `ide` — runbooks, incidents, the
//! queue, IaC, Kubernetes, the guided deploy and the data sources. Each action has its LEVEL, decided here:
//!
//! - **read** — runs at once (nothing changes; the person's own tools, read-only, with the kubeconfig the person
//!   uses — never one the model names, since a kubeconfig can run a program);
//! - **reviewed** — `runbook.check` runs a check step (the runbook's rule: read-only commands only) at once only when
//!   the runbook is what the team reviewed: committed, unchanged, its last change on a remote branch, not a link.
//!   Otherwise (the model may have written it) it asks the human, like an action;
//! - **act** — always asks the human (every mode, no «allow always»: `permissions::decide`) and the call goes to the
//!   audit log: what changes a record (an incident) or runs a tool of the project with the person's credentials
//!   (`tofu plan` can run a program through an `external` data source; the deploy plan runs the drift's plan);
//! - **human** — never the model's: an action step, mitigating or resolving an incident, applying IaC, rolling out,
//!   approving a PR, Vault, changing a cluster. Asking for one answers with the exact place in the IDE.

use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tutor_agent::ToolCtx;
use tutor_board::project::incidents;
use tutor_board::project::ProjectStore;
use tutor_platform::runbook::{self, Kind};

use super::{pretty, IdeTool};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level {
    Read,
    Reviewed,
    Act,
}

/// The actions of toolset 14, with their level and arguments.
pub const ACTIONS: &[(&str, Level, &str)] = &[
    ("runbook.list", Level::Read, "the project's runbooks (runbooks/*.md): steps, kinds, which checks may run"),
    ("runbook.show", Level::Read, "one runbook with its steps (args: path — runbooks/<file>.md)"),
    ("runbook.check", Level::Reviewed, "runs one `check` step and records it (args: path, step, run? — the run id that groups steps); read-only commands only"),
    ("incident.list", Level::Read, "the project's local incidents"),
    ("incident.show", Level::Read, "one incident: timeline (evidence, checks run and not run, notes), confidence, Co-Dev's precision (args: id)"),
    ("incident.open", Level::Act, "opens a local incident (args: title, severity SEV-1…SEV-4)"),
    ("incident.add", Level::Act, "adds to an incident's timeline (args: id, kind evidence|checked|not-checked|note, text, reason — required for not-checked)"),
    ("incident.metrics", Level::Act, "checks each SLO's error ratio before and since the incident opened and records it as checks (args: id)"),
    ("queue.items", Level::Read, "the person's Platform queue: review requests, blocking IaC findings, due runbooks, incidents, failed deploys"),
    ("sources.status", Level::Read, "the data sources: CI/CD, metrics and logs, cost, inventory — connected or how to connect"),
    ("iac.dirs", Level::Read, "the project's folders with .tf files"),
    ("iac.plan", Level::Act, "`init` + `plan` (or `plan -refresh-only` for drift) in one folder (args: dir, refreshOnly?)"),
    ("kube.state", Level::Read, "pods, services, deployments and events of a namespace (args: context, namespace)"),
    ("kube.history", Level::Read, "the rollout revisions of a deployment (args: context, namespace, deployment)"),
    ("deploy.plan", Level::Act, "the guided deploy's plan: every preflight check and what blocks (args: env, context, namespace, stagingContext?, stagingNamespace?)"),
];

/// What is never the model's, and where the person does it (a name ending in `.` covers the actions under it).
pub const HUMAN: &[(&str, &str)] = &[
    ("runbook.action", "an action step runs from Ops → Runbooks, with the person's approval and reason"),
    ("runbook.decide", "a decision step is recorded by a person in Ops → Runbooks"),
    ("incident.status", "mitigating or resolving an incident is the commander's: Platform → the incident"),
    ("incident.mitigate", "mitigating or resolving an incident is the commander's: Platform → the incident"),
    ("incident.resolve", "mitigating or resolving an incident is the commander's: Platform → the incident"),
    ("incident.feedback", "whether the top cause was right is the person's judgement: Platform → the incident"),
    ("iac.apply", "applying is the reviewed plan's, from Ops → IaC → Plan, approved by the person"),
    ("deploy.rollout", "a rollout runs from the guided deploy (Infra → Promote/Redeploy), approved by the person"),
    ("pr.", "approving or requesting changes on a PR is the reviewer's: Platform → the PR"),
    ("queue.verify", "an item is marked done from the person's queue: Platform → My queue"),
    ("queue.handover", "handing an item over is the person's: Platform → My queue"),
    ("vault.", "Vault secrets never reach the model; the person uses the Vault view or a terminal"),
    ("kube.", "scaling, restarting, rolling back or deleting is the person's: say the exact kubectl command"),
];

/// Why `action` is the person's, if it is.
pub fn human(action: &str) -> Option<&'static str> {
    HUMAN
        .iter()
        .find(|(p, _)| match p.strip_suffix('.') {
            Some(base) => action == base || action.starts_with(p),
            None => action == *p,
        })
        .map(|h| h.1)
}

pub fn level(action: &str) -> Option<Level> {
    ACTIONS.iter().find(|a| a.0 == action).map(|a| a.1)
}

fn str_arg<'a>(args: &'a Value, k: &str) -> Result<&'a str, String> {
    args[k]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("needs `{k}`"))
}

fn id_arg(args: &Value) -> Result<i64, String> {
    args["id"]
        .as_i64()
        .or_else(|| args["id"].as_str().and_then(|s| s.trim().parse().ok()))
        .ok_or_else(|| "needs `id` (the incident's number, see incident.list)".into())
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let o = crate::shellenv::command("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Whether the runbook at `path` is the one the team reviewed — `Err` says why not (and then the check asks).
pub fn reviewed(root: &Path, path: &str) -> Result<(), String> {
    let p = root.join(path);
    let meta = std::fs::symlink_metadata(&p).map_err(|e| format!("{path}: {e}"))?;
    if meta.file_type().is_symlink() {
        return Err(format!("{path} is a link"));
    }
    git(root, &["ls-files", "--error-unmatch", "--", path])
        .map_err(|_| format!("{path} is not committed"))?;
    if git(root, &["diff", "--quiet", "HEAD", "--", path]).is_err() {
        return Err(format!("{path} changed since the last commit"));
    }
    let last = git(root, &["log", "-1", "--format=%H", "--", path])?;
    let remote = git(root, &["branch", "-r", "--contains", &last]).unwrap_or_default();
    if remote.is_empty() {
        return Err(format!(
            "the last change to {path} is not on a remote branch (not pushed, so not reviewed)"
        ));
    }
    Ok(())
}

/// Whether this call only reads (the loop allows it at once; otherwise the human is asked).
pub fn read_only_for(tool: &IdeTool, action: &str, args: &Value) -> bool {
    match level(action) {
        Some(Level::Read) | None => true, // an unknown or human action only answers with text
        Some(Level::Act) => false,
        Some(Level::Reviewed) => match args["path"].as_str() {
            Some(p) => reviewed(&tool.root, p.trim()).is_ok(),
            None => true, // refused for the missing argument, nothing runs
        },
    }
}

fn actor(root: &Path) -> String {
    format!(
        "Co-Dev ({})",
        crate::board::actor(&root.display().to_string())
    )
}

impl IdeTool {
    fn store(&self) -> Result<ProjectStore, String> {
        let db = self
            .db
            .as_ref()
            .ok_or("the Project store is not available in this session")?;
        ProjectStore::open(db)
    }

    fn key(&self) -> String {
        self.root.display().to_string()
    }

    fn runbook_check(&self, args: &Value) -> Result<String, String> {
        let path = str_arg(args, "path")?;
        let n = args["step"]
            .as_u64()
            .ok_or("needs `step` (the step's number)")? as u32;
        let rb = runbook::load(&self.root, path)?;
        let step = rb
            .steps
            .iter()
            .find(|s| s.n == n)
            .cloned()
            .ok_or_else(|| format!("{path} has no step {n}"))?;
        if step.kind != Kind::Check {
            let which = if step.kind == Kind::Action {
                "runbook.action"
            } else {
                "runbook.decide"
            };
            return Err(format!(
                "step {n} is not a check: {}",
                human(which).unwrap_or_default()
            ));
        }
        runbook::may_run(&step, false)?;
        let out = runbook::run(
            &crate::shellenv::command,
            &self.root,
            &step,
            &[],
            Duration::from_secs(300),
        );
        let run_id: String = args["run"]
            .as_str()
            .map(|s| s.chars().take(64).collect())
            .unwrap_or_else(|| format!("codev-{}", crate::board::now_ms()));
        let recorded = match &self.db {
            None => "not recorded (no Project store in this session)".to_string(),
            Some(_) => {
                let rec = tutor_board::project::runbooks::RunbookStepRun {
                    run_id: run_id.clone(),
                    path: path.into(),
                    runbook: rb.title.clone(),
                    n,
                    title: step.title.clone(),
                    kind: "check".into(),
                    command: step.command.clone(),
                    exit_code: Some(out.exit_code),
                    output: out.output.clone(),
                    expect: step.expect.clone(),
                    matched: out.matched,
                    actor: actor(&self.root),
                    at: crate::board::now_ms(),
                    ms: out.ms as i64,
                    ..Default::default()
                };
                self.store()?
                    .record_runbook_step(&self.key(), &rec)
                    .map_err(|e| e.message)?;
                format!("recorded in run {run_id}")
            }
        };
        pretty(&json!({
            "step": n, "title": step.title, "command": step.command, "exitCode": out.exit_code,
            "expect": step.expect,
            "matched": out.matched, // null: a prose expectation — judge it yourself and say so
            "output": out.output, "ms": out.ms, "record": recorded,
        }))
    }

    fn incident_show(&self, args: &Value) -> Result<String, String> {
        let id = id_arg(args)?;
        let s = self.store()?;
        let (inc, ev) = incidents::get(s.conn(), &self.key(), id)
            .map_err(|e| e.message)?
            .ok_or("no such incident")?;
        let precision = incidents::precision(s.conn(), &self.key()).map_err(|e| e.message)?;
        let has_metrics =
            tutor_platform::metrics::live(crate::commands::metrics::store(), &self.root).is_ok();
        pretty(&json!({
            "incident": inc, "timeline": ev,
            "confidence": incidents::confidence(&ev, has_metrics),
            "codevPrecision": {"right": precision.0, "judged": precision.1},
            "postmortem": format!("docs/postmortems/{}.md", inc.key),
        }))
    }

    fn incident_metrics(&self, args: &Value) -> Result<String, String> {
        let id = id_arg(args)?;
        let s = self.store()?;
        let inc = incidents::get(s.conn(), &self.key(), id)
            .map_err(|e| e.message)?
            .ok_or("no such incident")?
            .0;
        let live = tutor_platform::metrics::live(crate::commands::metrics::store(), &self.root)
            .map_err(|u| {
                format!(
                    "no metrics source: {} — record it as a check not run",
                    u.notes
                )
            })?;
        if live.slos.is_empty() {
            return Err(format!(
                "no SLOs in {}: nothing to check",
                tutor_platform::metrics::SLO_FILE
            ));
        }
        let now = crate::board::now_ms();
        let lines = tutor_platform::metrics::incident_lines(&live, inc.opened_at, now);
        let who = actor(&self.root);
        for l in &lines {
            incidents::add(s.conn(), &self.key(), id, "checked", l, None, &who, now)
                .map_err(|e| e.message)?;
        }
        Ok(lines.join("\n"))
    }

    fn deploy_plan(&self, args: &Value) -> Result<String, String> {
        let t = crate::commands::deploy::TargetArg {
            env: str_arg(args, "env")?.into(),
            context: str_arg(args, "context")?.into(),
            namespace: str_arg(args, "namespace")?.into(),
            kubeconfig: None,
            staging_context: args["stagingContext"].as_str().map(String::from),
            staging_namespace: args["stagingNamespace"].as_str().map(String::from),
            ..Default::default()
        };
        let plan = tutor_platform::deploy::plan(
            &crate::commands::deploy::tools(),
            &self.root,
            &t.target()?,
        )?;
        pretty(&plan)
    }

    /// Runs an H4 action; `None` when `action` is not one of them.
    pub(super) fn run_ops(
        &self,
        action: &str,
        args: &Value,
        _ctx: &ToolCtx,
    ) -> Option<Result<String, String>> {
        let k = self.key();
        Some(match action {
            "runbook.list" => pretty(&runbook::list(&self.root)),
            "runbook.show" => str_arg(args, "path")
                .and_then(|p| runbook::load(&self.root, p))
                .and_then(|r| pretty(&r)),
            "runbook.check" => self.runbook_check(args),
            "incident.list" => self
                .store()
                .and_then(|s| incidents::list(s.conn(), &k).map_err(|e| e.message))
                .and_then(|v| pretty(&v)),
            "incident.show" => self.incident_show(args),
            "incident.open" => (|| {
                let title = str_arg(args, "title")?;
                let sev = str_arg(args, "severity")?
                    .to_ascii_uppercase()
                    .replace("SEV", "SEV-")
                    .replace("--", "-");
                let i = incidents::open(
                    self.store()?.conn(),
                    &k,
                    title,
                    &sev,
                    &actor(&self.root),
                    crate::board::now_ms(),
                )
                .map_err(|e| e.message)?;
                pretty(&i)
            })(),
            "incident.add" => (|| {
                let id = id_arg(args)?;
                let kind = str_arg(args, "kind")?;
                let text = str_arg(args, "text")?;
                incidents::add(
                    self.store()?.conn(),
                    &k,
                    id,
                    kind,
                    text,
                    args["reason"].as_str(),
                    &actor(&self.root),
                    crate::board::now_ms(),
                )
                .map_err(|e| e.message)?;
                Ok(format!("added to the incident's timeline as {kind}"))
            })(),
            "incident.metrics" => self.incident_metrics(args),
            "queue.items" => self
                .store()
                .and_then(|s| crate::commands::platform::queue_in(&s, &k))
                .and_then(|q| pretty(&q)),
            "sources.status" => pretty(&tutor_platform::sources::status(
                &crate::shellenv::command,
                &crate::shellenv::has,
                crate::commands::metrics::store(),
                &self.root,
            )),
            "iac.dirs" => pretty(&tutor_eval::ops::iac_dirs(&self.root)),
            "iac.plan" => str_arg(args, "dir").and_then(|d| {
                pretty(&tutor_eval::ops::iac_plan(
                    &self.root,
                    d,
                    args["refreshOnly"].as_bool().unwrap_or(false),
                ))
            }),
            "kube.state" => (|| {
                pretty(&tutor_eval::ops::kube_state(
                    None,
                    str_arg(args, "context")?,
                    str_arg(args, "namespace")?,
                ))
            })(),
            "kube.history" => (|| {
                tutor_eval::ops::kube_history(
                    None,
                    str_arg(args, "context")?,
                    str_arg(args, "namespace")?,
                    str_arg(args, "deployment")?,
                )
                .and_then(|r| pretty(&r))
            })(),
            "deploy.plan" => self.deploy_plan(args),
            other => Err(format!(
                "«{other}» is never yours: {}. Tell the person what to do and why.",
                human(other)?
            )),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_agent::Tool;

    const RUNBOOK: &str = "# checkout: errors above the SLO

## 1. Count the errors of the last log [check]
```sh
grep -c ERROR logs/app.log
```
expect: /^[0-9]+$/

## 2. Show the failing upstream [check]
```sh
grep -o 'upstream=[a-z-]*' logs/app.log | sort | uniq -c
```
expect: the upstream that fails most

## 3. Roll back the release [action]
```sh
kubectl -n shop rollout undo deploy/checkout
```
expect: rolled back
";

    fn git(r: &Path, a: &[&str]) {
        let o = std::process::Command::new("git")
            .arg("-C")
            .arg(r)
            .args(a)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@e")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@e")
            .output()
            .unwrap();
        assert!(
            o.status.success(),
            "git {a:?}: {}",
            String::from_utf8_lossy(&o.stderr)
        );
    }

    fn ctx(root: &Path) -> ToolCtx {
        ToolCtx {
            root: root.to_path_buf(),
            cancel: Default::default(),
        }
    }

    fn call(tool: &IdeTool, action: &str, args: Value) -> (bool, tutor_agent::ToolOutput) {
        let input = json!({"action": action, "args": args});
        (
            tool.read_only_for(&input),
            tool.run(&input, &ctx(&tool.root)),
        )
    }

    /// The acceptance of H4 (docs/v2/AUDIT-harness.md §6): an incident of a fixture — Co-Dev opens it, tries the
    /// metrics, runs the runbook's checks and records them, and the timeline is what the postmortem is written from.
    #[test]
    fn an_incident_is_opened_investigated_with_the_runbook_checks_and_kept_on_its_timeline() {
        let d = tempfile::tempdir().unwrap();
        let remote = d.path().join("remote.git");
        let r = d.path().join("shop");
        std::fs::create_dir_all(r.join("runbooks")).unwrap();
        std::fs::create_dir_all(r.join("logs")).unwrap();
        git(
            d.path(),
            &["init", "-q", "--bare", remote.to_str().unwrap()],
        );
        git(&r, &["init", "-q", "--initial-branch=main"]);
        std::fs::write(r.join("runbooks/checkout.md"), RUNBOOK).unwrap();
        std::fs::write(
            r.join("logs/app.log"),
            "INFO ok\nERROR upstream=payments-gw timeout\nERROR upstream=payments-gw timeout\nERROR upstream=stock 503\n",
        )
        .unwrap();
        git(&r, &["add", "-A"]);
        git(&r, &["commit", "-q", "-m", "runbook"]);
        let db = d.path().join("board.sqlite3");
        let tool = IdeTool {
            root: r.clone(),
            db: Some(db.clone()),
            ops: true,
        };
        assert!(!tool.read_only(), "toolset 14 has actions");
        assert!(!tool.mutates_files(), "records, never the project's files");

        // committed but not pushed: the check asks the person first
        let check1 = json!({"path": "runbooks/checkout.md", "step": 1, "run": "r1"});
        let ro = tool.read_only_for(&json!({"action": "runbook.check", "args": check1}));
        assert!(!ro, "not pushed: asks");
        assert!(reviewed(&r, "runbooks/checkout.md")
            .unwrap_err()
            .contains("not on a remote branch"));
        git(&r, &["remote", "add", "origin", remote.to_str().unwrap()]);
        git(&r, &["push", "-q", "-u", "origin", "main"]);
        assert_eq!(reviewed(&r, "runbooks/checkout.md"), Ok(()));

        // reads run at once
        let (ro, list) = call(&tool, "runbook.list", json!({}));
        assert!(
            ro && !list.is_error && list.content.contains("checkout: errors above the SLO"),
            "{}",
            list.content
        );

        // opening an incident asks (and the severity is read as the person writes it)
        let (ro, open) = call(
            &tool,
            "incident.open",
            json!({"title": "checkout 500s", "severity": "sev2"}),
        );
        assert!(!ro, "an action asks");
        assert!(!open.is_error, "{}", open.content);
        let inc: Value = serde_json::from_str(&open.content).unwrap();
        assert_eq!(inc["key"], "INC-1");
        assert_eq!(inc["severity"], "SEV-2");
        assert!(inc["commander"].as_str().unwrap().starts_with("Co-Dev ("));
        let id = inc["id"].as_i64().unwrap();

        // no metrics source: said, and recorded as a check not run (with why)
        let (ro, m) = call(&tool, "incident.metrics", json!({"id": id}));
        assert!(
            !ro && m.is_error && m.content.contains("no metrics source"),
            "{}",
            m.content
        );
        let (_, nc) = call(
            &tool,
            "incident.add",
            json!({"id": id, "kind": "not-checked", "text": "SLO error ratio", "reason": "no metrics source is connected"}),
        );
        assert!(!nc.is_error, "{}", nc.content);

        // the reviewed runbook's checks run at once and are recorded
        let (ro, c1) = call(&tool, "runbook.check", check1.clone());
        assert!(ro, "pushed and unchanged: a read");
        assert!(!c1.is_error, "{}", c1.content);
        let v: Value = serde_json::from_str(&c1.content).unwrap();
        assert_eq!(v["output"].as_str().unwrap().trim(), "3");
        assert_eq!(v["matched"], true);
        assert!(v["record"].as_str().unwrap().contains("r1"));
        let (_, c2) = call(
            &tool,
            "runbook.check",
            json!({"path": "runbooks/checkout.md", "step": 2, "run": "r1"}),
        );
        assert!(c2.content.contains("payments-gw"), "{}", c2.content);
        let runs = ProjectStore::open(&db)
            .unwrap()
            .runbook_runs(&r.display().to_string(), None, 0, i64::MAX)
            .unwrap();
        assert_eq!(runs.len(), 2);
        assert!(runs
            .iter()
            .all(|x| x.actor.starts_with("Co-Dev (") && x.run_id == "r1"));
        let (_, ev) = call(
            &tool,
            "incident.add",
            json!({"id": id, "kind": "checked", "text": "runbook checkout step 2: 2× upstream=payments-gw"}),
        );
        assert!(!ev.is_error);
        let (_, ev) = call(
            &tool,
            "incident.add",
            json!({"id": id, "kind": "evidence", "text": "logs/app.log: payments-gw timeouts"}),
        );
        assert!(!ev.is_error);

        // an action step is never the model's; nor is resolving, nor changing a cluster
        let (_, a) = call(
            &tool,
            "runbook.check",
            json!({"path": "runbooks/checkout.md", "step": 3}),
        );
        assert!(
            a.is_error && a.content.contains("not a check"),
            "{}",
            a.content
        );
        for h in [
            "incident.resolve",
            "incident.status",
            "kube.scale",
            "vault.reveal",
            "pr.approve",
            "iac.apply",
        ] {
            let (ro, o) = call(&tool, h, json!({"id": id}));
            assert!(ro, "{h}: nothing runs");
            assert!(
                o.is_error && o.content.contains("is never yours"),
                "{h}: {}",
                o.content
            );
        }

        // the timeline the postmortem is written from
        let (ro, show) = call(&tool, "incident.show", json!({"id": id}));
        assert!(ro && !show.is_error, "{}", show.content);
        let v: Value = serde_json::from_str(&show.content).unwrap();
        let kinds: Vec<&str> = v["timeline"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["kind"].as_str().unwrap())
            .collect();
        assert_eq!(kinds, ["status", "not-checked", "checked", "evidence"]);
        assert_eq!(
            v["confidence"]["level"], "low",
            "no metrics source: never above low"
        );
        assert_eq!(v["postmortem"], "docs/postmortems/INC-1.md");

        // the runbook changed in the working tree (Co-Dev could have written it): the check asks again
        std::fs::write(
            r.join("runbooks/checkout.md"),
            RUNBOOK.replace("grep -c", "grep -ci"),
        )
        .unwrap();
        assert!(!tool.read_only_for(&json!({"action": "runbook.check", "args": check1})));
        assert!(reviewed(&r, "runbooks/checkout.md")
            .unwrap_err()
            .contains("changed"));
        // a runbook never committed asks too
        std::fs::write(r.join("runbooks/new.md"), RUNBOOK).unwrap();
        assert!(reviewed(&r, "runbooks/new.md")
            .unwrap_err()
            .contains("not committed"));
    }

    #[test]
    fn toolset_13_keeps_its_tool_and_14_lists_every_action_with_a_level() {
        let t13 = IdeTool {
            root: "/p".into(),
            db: None,
            ops: false,
        };
        let t14 = IdeTool {
            root: "/p".into(),
            db: None,
            ops: true,
        };
        // 13: byte for byte the tool of H3 (its sessions' request prefix)
        assert_eq!(
            t13.description(),
            "Read what the IDE knows about this project, by action: workspace.projects, project.board, project.issue, \
             git.refs, git.log, gh.prs, gh.runs, deps.report, codebase.map, arch.conformance, slo.status. Every action \
             here only reads. The built-in skills say which actions fit which work; load one with `skill` first."
        );
        assert_eq!(
            t13.input_schema()["properties"]["action"]["enum"]
                .as_array()
                .unwrap()
                .len(),
            11
        );
        assert!(t13.read_only() && t13.read_only_for(&json!({"action": "incident.open"})));
        let out = t13.run(&json!({"action": "incident.list"}), &ctx(Path::new("/p")));
        assert!(out.is_error && out.content.contains("unknown action"));
        // 14: every action is in the schema and named in the description, by its level
        let schema = t14.input_schema();
        let names = schema["properties"]["action"]["enum"].as_array().unwrap();
        assert_eq!(names.len(), 11 + ACTIONS.len());
        for (a, lvl, _) in ACTIONS {
            if *lvl == Level::Act {
                assert!(
                    t14.description().contains(a),
                    "{a}: the description says it asks"
                );
            }
            let ro = t14.read_only_for(&json!({"action": a, "args": {}}));
            assert_eq!(ro, *lvl != Level::Act, "{a}");
        }
        for (h, _) in HUMAN {
            assert!(
                level(h.trim_end_matches('.')).is_none(),
                "{h} is not an action"
            );
        }
    }
}
