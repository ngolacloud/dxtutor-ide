//! Multi Co-Dev, phase 3 — the use case behind the Co-Dev worktrees and file claims (independent of
//! Tauri; `commands::codev_worktree` is the thin adapter).
//!
//! - The worktree of an issue checks out the issue's branch: the one recorded on the issue, or the
//!   Project's name for it (`tutor_board::project::branches::branch_name`), which is then recorded.
//! - Creating one and cleaning a leftover up change the repository: they run only the exact commands
//!   the human approved, and go to the audit log BEFORE they run (one that cannot be recorded does
//!   not run) and again with the result. A commit in a worktree is the human's (the strip's
//!   «Commit»): local, on the issue's branch, after the secret scan, and audited.
//! - A worktree a live session works in is never removed from here (the session removes it when it
//!   closes, if it is clean).

use std::path::Path;

use tutor_board::project::{claims::Claim, ProjectStore};
use tutor_eval::gitwork::codev::{self as wt, FilePair, Removal, WorktreeInfo, WorktreePlan};

use crate::board::{actor, ide_audit_entry, now_ms, IdeAudit};

fn store(db: &Path) -> Result<ProjectStore, String> {
    ProjectStore::open(db)
}

/// The branch of issue `key`, and whether it is recorded on the issue already.
fn issue_branch(db: &Path, root: &str, key: &str) -> Result<(String, bool), String> {
    let p = store(db)?.load(root, now_ms()).map_err(|e| e.message)?;
    let i = p
        .issues
        .iter()
        .find(|i| i.key == key)
        .ok_or_else(|| format!("a issue {key} não existe"))?;
    Ok(match i.branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => (b.to_string(), true),
        None => (
            tutor_board::project::branches::branch_name(&i.key, &i.title, &i.kind),
            false,
        ),
    })
}

/// One row of the audit log for a worktree operation (origin `ide`, feature `codev`).
#[allow(clippy::too_many_arguments)]
fn record(
    db: &Path,
    root: &str,
    action: &str,
    command: &str,
    scope: &str,
    outcome: &str,
    reason: Option<String>,
    decided_at: Option<i64>,
) -> Result<(), String> {
    let redactor = tutor_agent::redact::Redactor::for_root(Path::new(root));
    let e = ide_audit_entry(
        &IdeAudit {
            feature: "codev".into(),
            action: action.into(),
            command: command.into(),
            scope: Some(scope.into()),
            approved: true,
            reason,
            outcome: Some(outcome.into()),
            decided_at,
        },
        &actor(root),
        now_ms(),
        &redactor,
    )
    .map_err(|e| e.message)?;
    store(db)?.record_audit(root, &e).map_err(|e| e.message)
}

/// What starting a Co-Dev session on `key` needs (read-only).
pub fn plan(db: &Path, base: &Path, root: &str, key: &str) -> Result<WorktreePlan, String> {
    let (branch, _) = issue_branch(db, root, key)?;
    wt::plan(Path::new(root), base, key, &branch)
}

/// Creates the worktree of `key` with the approved `command`; an existing one is returned as it is.
pub fn create(
    db: &Path,
    base: &Path,
    root: &str,
    key: &str,
    command: &str,
    decided_at: Option<i64>,
) -> Result<WorktreeInfo, String> {
    let (branch, recorded) = issue_branch(db, root, key)?;
    let dir = Path::new(root);
    let p = wt::plan(dir, base, key, &branch)?;
    if !p.available {
        return Err(p
            .reason
            .unwrap_or_else(|| "sem worktrees nesta pasta".into()));
    }
    if p.exists {
        return wt::find(dir, base, key)?.ok_or_else(|| format!("a worktree de {key} sumiu"));
    }
    if p.command != command.trim() {
        // nothing runs, so nothing to record: the human approves the new plan instead
        return Err(format!(
            "o repositório mudou desde a aprovação: os comandos são agora\n{}",
            p.command
        ));
    }
    let scope = format!("worktree {} · branch {}", p.path, p.branch);
    record(db, root, "worktree.create", command, &scope, "sent", None, decided_at).map_err(
        |e| format!("não foi feito: o registo de auditoria não o gravou ({e})"),
    )?;
    let r = wt::create(dir, base, key, &branch, command);
    let _ = record(
        db,
        root,
        "worktree.create",
        command,
        &scope,
        if r.is_ok() { "ok" } else { "failed" },
        r.as_ref().err().cloned(),
        decided_at,
    );
    let info = r?;
    if !recorded {
        // the issue keeps the branch its Co-Dev works on (as «Create branch» does)
        let op = serde_json::from_value(serde_json::json!({"op": "update_issue", "key": key, "branch": branch}))
            .map_err(|e| e.to_string())?;
        let _ = store(db).and_then(|mut st| {
            st.apply(root, &actor(root), now_ms(), op)
                .map(|_| ())
                .map_err(|e| e.message)
        });
    }
    Ok(info)
}

/// A Co-Dev worktree and the open session that works in it (`None`: kept, or left by a crash).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listed {
    #[serde(flatten)]
    pub info: WorktreeInfo,
    pub session: Option<String>,
    /// the exact command that cleans it up (for the approval dialog)
    pub remove: String,
}

fn canon(p: &str) -> std::path::PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| Path::new(p).to_path_buf())
}

/// The Co-Dev worktrees of the project's repository, each with the open session working in it.
pub fn list(base: &Path, root: &str) -> Result<Vec<Listed>, String> {
    let live = crate::codev_agent::live_sessions();
    Ok(wt::list(Path::new(root), base)?
        .into_iter()
        .map(|info| {
            let here = canon(&info.dir);
            let session = live
                .iter()
                .find(|s| s.worktree.as_deref().map(canon).as_ref() == Some(&here))
                .map(|s| s.id.clone());
            let remove = wt::remove_command(Path::new(root), &info);
            Listed {
                info,
                session,
                remove,
            }
        })
        .collect())
}

/// Cleans up the worktree of `key` (a leftover: no open session) with the approved `command`:
/// removed when it has no uncommitted changes, kept otherwise. The branch always stays.
pub fn remove(
    db: &Path,
    base: &Path,
    root: &str,
    key: &str,
    command: &str,
    decided_at: Option<i64>,
) -> Result<Removal, String> {
    if let Some(l) = list(base, root)?.into_iter().find(|l| l.info.key == key) {
        if let Some(s) = l.session {
            return Err(format!(
                "a worktree de {key} é a da sessão Co-Dev {s}, que está aberta: fecha-a primeiro"
            ));
        }
    }
    let scope = format!("worktree of {key}");
    record(db, root, "worktree.remove", command, &scope, "sent", None, decided_at).map_err(
        |e| format!("não foi feito: o registo de auditoria não o gravou ({e})"),
    )?;
    let r = wt::remove(Path::new(root), base, key, Some(command));
    let (outcome, reason) = match &r {
        Ok(x) if x.removed => ("ok", None),
        Ok(x) => (
            "failed",
            Some(format!("fica: alterações por commitar ({})", x.dirty.join(", "))),
        ),
        Err(e) => ("failed", Some(e.clone())),
    };
    let _ = record(
        db,
        root,
        "worktree.remove",
        command,
        &scope,
        outcome,
        reason,
        decided_at,
    );
    r
}

/// A file of the worktree of `key`, read-only (never a state file, as in the editor).
pub fn file(base: &Path, root: &str, key: &str, path: &str) -> Result<FilePair, String> {
    if crate::workspace::is_state_file(path) {
        return Err(format!(
            "{path} é um ficheiro de estado: guarda segredos, não se abre no IDE"
        ));
    }
    wt::file(Path::new(root), base, key, path)
}

/// Commits everything the worktree of `key` has on its branch (the human's «Commit»).
pub fn commit(
    db: &Path,
    base: &Path,
    root: &str,
    key: &str,
    message: &str,
) -> Result<String, String> {
    let r = wt::commit(Path::new(root), base, key, message);
    let shown = format!("git commit -m {:?} (worktree of {key})", message.trim());
    let _ = record(
        db,
        root,
        "worktree.commit",
        &shown,
        &format!("worktree of {key}"),
        if r.is_ok() { "ok" } else { "failed" },
        r.as_ref()
            .err()
            .map(|e| tutor_protect::scan::summary(e)),
        None,
    );
    r
}

/// The project's file claims, without the abandoned ones (dropped on the way).
pub fn claims(db: &Path, root: &str) -> Result<Vec<Claim>, String> {
    let mut st = store(db)?;
    st.release_abandoned_claims(root, &crate::codev_agent::claim_abandoned)
        .map_err(|e| e.message)?;
    st.claims(root).map_err(|e| e.message)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn g(d: &Path, a: &[&str]) -> String {
        let o = Command::new("git").arg("-C").arg(d).args(a).output().unwrap();
        assert!(o.status.success(), "git {a:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    }

    /// A repository with one commit and a project with one Ready issue (DX-1, «Pagar com cartão»).
    fn setup() -> (tempfile::TempDir, tempfile::TempDir, std::path::PathBuf, String) {
        let r = tempfile::tempdir().unwrap();
        g(r.path(), &["init", "-q", "-b", "main"]);
        g(r.path(), &["config", "user.name", "Ana"]);
        g(r.path(), &["config", "user.email", "ana@example.com"]);
        std::fs::write(r.path().join("a.rs"), "fn a() {}\n").unwrap();
        g(r.path(), &["add", "."]);
        g(r.path(), &["commit", "-q", "-m", "init"]);
        let data = tempfile::tempdir().unwrap();
        let db = data.path().join("board.sqlite3");
        let root = r.path().display().to_string();
        let mut st = ProjectStore::open(&db).unwrap();
        let op = serde_json::from_value(
            serde_json::json!({"op": "create_issue", "title": "Pagar com cartão", "kind": "story"}),
        )
        .unwrap();
        st.apply(&root, "Ana", 1, op).unwrap();
        (r, data, db, root)
    }

    fn audit_rows(db: &Path, root: &str) -> Vec<(String, String)> {
        let st = ProjectStore::open(db).unwrap();
        let mut q = st
            .conn()
            .prepare("SELECT call, outcome FROM audit WHERE root = ?1 AND tool = 'codev' ORDER BY id")
            .unwrap();
        q.query_map([root], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn creating_a_worktree_is_audited_before_and_after_and_records_the_branch() {
        let (_r, data, db, root) = setup();
        let key = store(&db).unwrap().load(&root, 2).unwrap().issues[0].key.clone();
        let base = data.path().join("worktrees");
        let p = plan(&db, &base, &root, &key).unwrap();
        let want = format!("feature/{}-pagar-com-cartao", key.to_lowercase());
        assert_eq!(p.branch, want);
        assert!(p.available && !p.exists);
        // a command that is not the plan runs nothing
        assert!(create(&db, &base, &root, &key, "git worktree add x", None).is_err());
        let info = create(&db, &base, &root, &key, &p.command, Some(5)).unwrap();
        assert_eq!(info.branch.as_deref(), Some(want.as_str()));
        assert_eq!(
            audit_rows(&db, &root),
            [
                ("worktree.create".to_string(), "sent".to_string()),
                ("worktree.create".to_string(), "ok".to_string()),
            ]
        );
        // the issue keeps its branch
        let i = store(&db).unwrap().load(&root, 3).unwrap().issues[0].clone();
        assert_eq!(i.branch.as_deref(), Some(want.as_str()));
        // listed, with no open session; a file reads back; a state file never does
        let l = list(&base, &root).unwrap();
        assert_eq!((l.len(), l[0].session.clone()), (1, None));
        assert_eq!(file(&base, &root, &key, "a.rs").unwrap().now.as_deref(), Some("fn a() {}\n"));
        assert!(file(&base, &root, &key, "infra/terraform.tfstate").is_err());
        // a change, committed by the human on the issue's branch
        std::fs::write(Path::new(&info.dir).join("a.rs"), "fn a() { 1 }\n").unwrap();
        let sha = commit(&db, &base, &root, &key, &format!("{key}: pay")).unwrap();
        assert_eq!(g(Path::new(&root), &["rev-parse", "--short", &want]), sha);
        // cleaned up with the approved command; the branch stays
        let rm = wt::remove_plan(Path::new(&root), &base, &key).unwrap();
        let gone = remove(&db, &base, &root, &key, &rm.command, None).unwrap();
        assert!(gone.removed);
        assert!(list(&base, &root).unwrap().is_empty());
        assert!(audit_rows(&db, &root).ends_with(&[
            ("worktree.commit".to_string(), "ok".to_string()),
            ("worktree.remove".to_string(), "sent".to_string()),
            ("worktree.remove".to_string(), "ok".to_string()),
        ]));
        // the next plan reuses the recorded branch
        assert!(!plan(&db, &base, &root, &key).unwrap().new_branch);
    }

    #[test]
    fn an_unknown_issue_or_a_folder_without_git_never_gets_a_worktree() {
        let (_r, data, db, root) = setup();
        let base = data.path().join("worktrees");
        assert!(plan(&db, &base, &root, "NOPE-1").unwrap_err().contains("não existe"));
        let plain = tempfile::tempdir().unwrap();
        let proot = plain.path().display().to_string();
        let mut st = ProjectStore::open(&db).unwrap();
        let op = serde_json::from_value(serde_json::json!({"op": "create_issue", "title": "x", "kind": "story"})).unwrap();
        let p = st.apply(&proot, "Ana", 1, op).unwrap();
        let k = p.issues[0].key.clone();
        let pl = plan(&db, &base, &proot, &k).unwrap();
        assert!(!pl.available);
        assert!(create(&db, &base, &proot, &k, "", None).is_err());
    }
}
