//! Multi Co-Dev, phase 3, against real git repositories: a session rooted in its worktree (nothing it
//! does reaches the main tree), file claims between two open sessions, and the worktree on close.

use super::*;
use std::process::Command;

fn key(k: &'static str) -> impl Fn(&str) -> Option<String> {
    move |_| Some(k.to_string())
}

fn g(d: &Path, a: &[&str]) -> String {
    let o = Command::new("git").arg("-C").arg(d).args(a).output().unwrap();
    assert!(
        o.status.success(),
        "git {a:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

/// A repository with `src/cart.rs` committed, the app's data folder (worktrees, project database)
/// and the worktree of DX-2 on its branch.
struct Fixture {
    repo: tempfile::TempDir,
    data: tempfile::TempDir,
    wt: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let repo = tempfile::tempdir().unwrap();
        let r = repo.path();
        g(r, &["init", "-q", "-b", "main"]);
        g(r, &["config", "user.name", "Ana"]);
        g(r, &["config", "user.email", "ana@example.com"]);
        std::fs::create_dir_all(r.join("src")).unwrap();
        std::fs::write(r.join("src/cart.rs"), "pub fn cart() {}\n").unwrap();
        g(r, &["add", "."]);
        g(r, &["commit", "-q", "-m", "init"]);
        let data = tempfile::tempdir().unwrap();
        let base = data.path().join("worktrees");
        let p = tutor_eval::gitwork::codev::plan(r, &base, "DX-2", "feature/dx-2-pay").unwrap();
        let w = tutor_eval::gitwork::codev::create(r, &base, "DX-2", "feature/dx-2-pay", &p.command)
            .unwrap();
        Fixture {
            wt: PathBuf::from(w.dir),
            repo,
            data,
        }
    }
    fn root(&self) -> String {
        self.repo.path().display().to_string()
    }
    fn db(&self) -> PathBuf {
        self.data.path().join("board.sqlite3")
    }
    fn spec(&self, issue: &str, worktree: bool) -> StartSpec {
        StartSpec {
            root: self.root(),
            sessions_base: Some(self.data.path().join("sessions")),
            issue_key: Some(issue.into()),
            change_log: Some(self.db()),
            worktree: worktree.then(|| self.wt.clone()),
            review_edits: false,
            ..Default::default()
        }
    }
    fn audit(&self) -> Vec<(String, String)> {
        let st = tutor_board::project::ProjectStore::open(&self.db()).unwrap();
        let mut q = st
            .conn()
            .prepare("SELECT event, outcome FROM audit WHERE root = ?1 ORDER BY id")
            .unwrap();
        q.query_map([self.root()], |r| {
            Ok((r.get(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default()))
        })
        .unwrap()
        .map(Result::unwrap)
        .collect()
    }
}

fn write_call(path: &str) -> PendingCall {
    PendingCall {
        id: format!("call-{path}"),
        name: "write".into(),
        input: serde_json::json!({"path": path, "content": "x\n"}),
        read_only: false,
        command: None,
        hunks: vec![],
    }
}

#[test]
fn a_worktree_session_works_in_its_worktree_and_nothing_reaches_the_main_tree() {
    let f = Fixture::new();
    let id = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    let s = get(&id).unwrap();
    let wt = std::fs::canonicalize(&f.wt).unwrap();
    assert_eq!(s.agent.ctx.root, wt);
    assert_eq!(s.project_root, f.repo.path());
    assert_eq!(s.worktree.as_deref(), Some(wt.as_path()));
    // the tools resolve inside the worktree, and refuse to leave it
    // the real `write` tool, run with the session's own context
    let tools = agent_tools(
        &ToolsetOptions::default(),
        TOOLSET_VERSION,
        &FlowState::default(),
        None,
        vec![],
    );
    let tool = tools.iter().find(|t| t.name() == "write").unwrap();
    let out = tool.run(
        &serde_json::json!({"path": "src/pay.rs", "content": "pub fn pay() {}\n"}),
        &s.agent.ctx,
    );
    assert!(!out.is_error, "{}", out.content);
    assert!(wt.join("src/pay.rs").exists());
    assert!(!f.repo.path().join("src/pay.rs").exists());
    for escape in ["../x.rs", &format!("{}/src/evil.rs", f.root())] {
        let out = tool.run(
            &serde_json::json!({"path": escape, "content": "x"}),
            &s.agent.ctx,
        );
        assert!(out.is_error, "{escape}: {}", out.content);
    }
    assert_eq!(g(f.repo.path(), &["status", "--porcelain", "-uall"]), "");
    // the policy's root is the worktree too (a shell path outside it is outside the project)
    assert_eq!(s.policy.lock().unwrap().root, wt);
    // the Agent map says where it works
    let live = live_sessions().into_iter().find(|l| l.id == id).unwrap();
    assert_eq!(live.root, f.root());
    assert_eq!(live.branch.as_deref(), Some("feature/dx-2-pay"));
    assert_eq!(live.worktree.as_deref(), Some(wt.display().to_string().as_str()));
    // a resume works there again
    assert!(close_keeping(&id, true));
    let resumed = StartSpec {
        resume: Some(id.clone()),
        worktree: None,
        ..f.spec("DX-2", false)
    };
    assert_eq!(start(resumed, &key("sk"), None).unwrap(), id);
    assert_eq!(get(&id).unwrap().agent.ctx.root, wt);
    close_keeping(&id, true);
}

#[test]
fn only_a_worktree_of_the_projects_repository_serves_an_issue_session() {
    let f = Fixture::new();
    // no issue: refused
    let mut spec = f.spec("DX-2", true);
    spec.issue_key = None;
    assert!(start(spec, &key("sk"), None).unwrap_err().contains("issue"));
    // the project folder itself, or another repository: refused
    let mut spec = f.spec("DX-2", true);
    spec.worktree = Some(f.repo.path().to_path_buf());
    assert!(start(spec, &key("sk"), None).is_err());
    let other = tempfile::tempdir().unwrap();
    g(other.path(), &["init", "-q", "-b", "main"]);
    let mut spec = f.spec("DX-2", true);
    spec.worktree = Some(other.path().to_path_buf());
    assert!(start(spec, &key("sk"), None)
        .unwrap_err()
        .contains("não é uma worktree"));
}

#[test]
fn a_file_another_open_session_claimed_is_refused_naming_it_until_it_closes() {
    let f = Fixture::new();
    let a = start(f.spec("DX-1", false), &key("sk"), None).unwrap();
    let b = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    let (sa, sb) = (get(&a).unwrap(), get(&b).unwrap());
    // A writes src/cart.rs first: it is A's now (new)
    let (v, claimed) = claim_gate(&sa, &write_call("src/cart.rs"), Verdict::Allow);
    assert_eq!(v, Verdict::Allow);
    assert_eq!(claimed.as_deref(), Some("src/cart.rs"));
    // again: still A's, not new
    let (_, again) = claim_gate(&sa, &write_call("./src/cart.rs"), Verdict::Allow);
    assert!(again.is_none());
    // B (in its worktree, absolute path there) is refused, naming A's issue and session
    let abs = format!("{}/src/cart.rs", sb.agent.ctx.root.display());
    match claim_gate(&sb, &write_call(&abs), Verdict::Allow) {
        (Verdict::Deny { reason }, None) => {
            assert!(reason.contains("src/cart.rs") && reason.contains("DX-1") && reason.contains(&a), "{reason}");
        }
        o => panic!("{o:?}"),
    }
    // reads and a denied verdict are not the claims' business
    let mut read = write_call("src/cart.rs");
    read.name = "read".into();
    assert_eq!(claim_gate(&sb, &read, Verdict::Allow), (Verdict::Allow, None));
    // a write that did not happen gives its claim back
    let (_, c) = claim_gate(&sb, &write_call("src/total.rs"), Verdict::Allow);
    assert_eq!(c.as_deref(), Some("src/total.rs"));
    release_claim(&sb, "src/total.rs");
    assert!(claim_gate(&sa, &write_call("src/total.rs"), Verdict::Allow).1.is_some());
    // A closes: its claims go; B may write the file now
    assert!(close(&a));
    let (v, c) = claim_gate(&sb, &write_call("src/cart.rs"), Verdict::Allow);
    assert_eq!((v, c.as_deref()), (Verdict::Allow, Some("src/cart.rs")));
    // a claim of a session that is gone (the app crashed) is abandoned: taken over
    let mut st = tutor_board::project::ProjectStore::open(&f.db()).unwrap();
    st.claim(
        &f.root(),
        "src/ghost.rs",
        &tutor_board::project::claims::Claimant {
            session: "cda-gone",
            issue: Some("DX-9"),
            pid: std::process::id(),
        },
        1,
        &|_| false,
    )
    .unwrap();
    assert!(claim_gate(&sb, &write_call("src/ghost.rs"), Verdict::Allow).1.is_some());
    close_keeping(&b, true);
}

#[test]
fn a_bash_write_to_a_claimed_file_is_told_to_the_human_the_model_and_the_audit_log() {
    let f = Fixture::new();
    let a = start(f.spec("DX-1", false), &key("sk"), None).unwrap();
    let b = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    let (sa, sb) = (get(&a).unwrap(), get(&b).unwrap());
    claim_gate(&sa, &write_call("src/cart.rs"), Verdict::Allow);
    let mut evs = vec![];
    bash_claims(
        &sb,
        "call-bash",
        &["src/cart.rs".to_string(), "src/new.rs".to_string()],
        &mut |e| evs.push(e),
    );
    match &evs[..] {
        [AgentEvent::Notice { text }] => assert!(text.contains("src/cart.rs (DX-1)"), "{text}"),
        e => panic!("{e:?}"),
    }
    assert!(sb.notes.lock().unwrap()[0].contains("src/cart.rs"));
    assert!(f.audit().contains(&("claim".to_string(), "held".to_string())));
    // the file it could take is B's now
    let held = claim_gate(&sa, &write_call("src/new.rs"), Verdict::Allow).0;
    assert!(matches!(held, Verdict::Deny { .. }));
    close(&a);
    close_keeping(&b, true);
}

#[test]
fn closing_removes_a_clean_worktree_keeps_a_dirty_one_and_both_are_audited() {
    let f = Fixture::new();
    let base = f.data.path().join("worktrees");
    // dirty: kept, with the files in the audit log
    let id = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    std::fs::write(f.wt.join("src/pay.rs"), "pub fn pay() {}\n").unwrap();
    assert!(close(&id));
    assert!(f.wt.is_dir());
    assert!(f.audit().contains(&("worktree".to_string(), "kept".to_string())));
    // committed (nothing uncommitted): removed; the branch stays
    tutor_eval::gitwork::codev::commit(f.repo.path(), &base, "DX-2", "DX-2: pay").unwrap();
    let id = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    // «start again» keeps it whatever it holds
    assert!(close_keeping(&id, true));
    assert!(f.wt.is_dir());
    let id = start(f.spec("DX-2", true), &key("sk"), None).unwrap();
    assert!(close(&id));
    assert!(!f.wt.exists());
    assert!(f.audit().contains(&("worktree".to_string(), "removed".to_string())));
    assert!(!g(f.repo.path(), &["rev-parse", "feature/dx-2-pay"]).is_empty());
    // a session that no longer has its worktree does not resume
    let resumed = StartSpec {
        resume: Some(id),
        ..f.spec("DX-2", false)
    };
    assert!(start(resumed, &key("sk"), None)
        .unwrap_err()
        .contains("já não existe"));
}
