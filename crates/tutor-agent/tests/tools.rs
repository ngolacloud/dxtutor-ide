//! Ferramentas reais (F2) em pastas temporárias — sem rede.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tutor_agent::tools::{coding_tools, ToolsetOptions};
use tutor_agent::{Tool, ToolCtx, ToolOutput};

struct Ws {
    dir: tempfile::TempDir,
    tools: Vec<Arc<dyn Tool>>,
    ctx: ToolCtx,
}

fn ws() -> Ws {
    let dir = tempfile::tempdir().unwrap();
    let ctx = ToolCtx {
        root: dir.path().to_path_buf(),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let opts = ToolsetOptions {
        test_cmd: Some("exit 3".into()),
        lint_cmd: Some("echo lint-ok".into()),
        ..Default::default()
    };
    Ws {
        dir,
        tools: coding_tools(&opts),
        ctx,
    }
}

impl Ws {
    fn path(&self) -> &Path {
        self.dir.path()
    }
    fn put(&self, rel: &str, content: &str) {
        let p = self.path().join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }
    fn get(&self, rel: &str) -> String {
        fs::read_to_string(self.path().join(rel)).unwrap()
    }
    fn call(&self, name: &str, input: Value) -> ToolOutput {
        let t = self
            .tools
            .iter()
            .find(|t| t.name() == name)
            .unwrap_or_else(|| panic!("sem ferramenta {name}"));
        tutor_agent::schema::validate(&t.input_schema(), &input)
            .expect("input do teste devia ser válido");
        t.run(&input, &self.ctx)
    }
}

// ───── read ─────

#[test]
fn read_numbers_lines_and_pages_large_files() {
    let w = ws();
    w.put("a.txt", "um\ndois\ntrês\nquatro\n");
    let r = w.call("read", json!({"path": "a.txt"}));
    assert!(!r.is_error);
    assert!(r.content.contains("     1\tum\n") && r.content.contains("     4\tquatro\n"));

    let r = w.call("read", json!({"path": "a.txt", "offset": 2, "limit": 2}));
    assert!(r.content.contains("     2\tdois") && r.content.contains("     3\ttrês"));
    assert!(!r.content.contains("quatro\n") || r.content.contains("offset=4"));
    assert!(r.content.contains("usa offset=4"));

    assert!(
        w.call("read", json!({"path": "a.txt", "offset": 99}))
            .is_error
    );
    assert!(w.call("read", json!({"path": "nao.txt"})).is_error);
    w.put("sub/x", "");
    assert!(w
        .call("read", json!({"path": "sub"}))
        .content
        .contains("pasta"));
    fs::write(w.path().join("bin"), [0u8, 1, 2, 3]).unwrap();
    assert!(w
        .call("read", json!({"path": "bin"}))
        .content
        .contains("binário"));
}

// ───── edit / write ─────

#[test]
fn edit_requires_a_prior_read_and_a_unique_match() {
    let w = ws();
    w.put("src/lib.rs", "fn a() {}\nfn b() {}\nfn a2() {}\n");
    let r = w.call(
        "edit",
        json!({"path": "src/lib.rs", "old_string": "fn b() {}", "new_string": "fn b() { 1 }"}),
    );
    assert!(
        r.is_error && r.content.contains("antes de o alterar"),
        "{}",
        r.content
    );

    w.call("read", json!({"path": "src/lib.rs"}));
    let r = w.call(
        "edit",
        json!({"path": "src/lib.rs", "old_string": "fn a", "new_string": "fn z"}),
    );
    assert!(r.is_error && r.content.contains("2 vezes"), "{}", r.content);
    let r = w.call(
        "edit",
        json!({"path": "src/lib.rs", "old_string": "nada disto", "new_string": "x"}),
    );
    assert!(r.is_error && r.content.contains("não encontrado"));
    assert!(
        w.call(
            "edit",
            json!({"path": "src/lib.rs", "old_string": "x", "new_string": "x"})
        )
        .is_error
    );

    let r = w.call(
        "edit",
        json!({"path": "src/lib.rs", "old_string": "fn b() {}", "new_string": "fn b() { 1 }"}),
    );
    assert!(!r.is_error, "{}", r.content);
    assert!(r.content.contains("linha 2"));
    // o próprio edit actualiza o estado: pode voltar a editar sem reler
    let r = w.call("edit", json!({"path": "src/lib.rs", "old_string": "fn a", "new_string": "fn z", "replace_all": true}));
    assert!(!r.is_error && r.content.contains("2 substituição"));
    assert_eq!(w.get("src/lib.rs"), "fn z() {}\nfn b() { 1 }\nfn z2() {}\n");
}

#[test]
fn edit_and_write_refuse_a_file_changed_since_the_read() {
    let w = ws();
    w.put("a.rs", "let x = 1;\n");
    w.call("read", json!({"path": "a.rs"}));
    w.put("a.rs", "let x = 2; // editado pelo humano\n");
    let r = w.call(
        "edit",
        json!({"path": "a.rs", "old_string": "let x", "new_string": "let y"}),
    );
    assert!(
        r.is_error && r.content.contains("mudou desde a última leitura"),
        "{}",
        r.content
    );
    let r = w.call("write", json!({"path": "a.rs", "content": "tudo novo"}));
    assert!(r.is_error && r.content.contains("mudou"));
    assert_eq!(
        w.get("a.rs"),
        "let x = 2; // editado pelo humano\n",
        "nada foi escrito"
    );
}

#[test]
fn write_creates_new_files_and_needs_a_read_to_overwrite() {
    let w = ws();
    let r = w.call(
        "write",
        json!({"path": "novo/dir/a.md", "content": "# Olá\n```rust\nfn main() {}\n```\n"}),
    );
    assert!(!r.is_error && r.content.contains("criado"));
    // conteúdo com fences de código passa intacto (o protocolo antigo truncava-o)
    assert!(w.get("novo/dir/a.md").ends_with("```\n"));

    w.put("b.txt", "velho");
    assert!(w
        .call("write", json!({"path": "b.txt", "content": "novo"}))
        .content
        .contains("antes de o alterar"));
    w.call("read", json!({"path": "b.txt"}));
    assert!(w
        .call("write", json!({"path": "b.txt", "content": "novo"}))
        .content
        .contains("sobrescrito"));
    assert_eq!(w.get("b.txt"), "novo");
}

#[test]
fn paths_outside_the_root_are_refused_everywhere() {
    let w = ws();
    for (tool, input) in [
        ("read", json!({"path": "../x"})),
        ("read", json!({"path": "/etc/hostname"})),
        ("write", json!({"path": "../fora.txt", "content": "x"})),
        (
            "edit",
            json!({"path": "../../a", "old_string": "a", "new_string": "b"}),
        ),
        ("glob", json!({"pattern": "*", "path": ".."})),
        ("grep", json!({"pattern": "x", "path": "/"})),
        ("git_diff", json!({"path": "../x"})),
    ] {
        let r = w.call(tool, input);
        assert!(r.is_error, "{tool} devia recusar: {}", r.content);
    }
}

#[cfg(unix)]
#[test]
fn symlinks_cannot_carry_writes_out_of_the_root() {
    let w = ws();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("segredo"), "x").unwrap();
    std::os::unix::fs::symlink(outside.path(), w.path().join("docs")).unwrap();
    let r = w.call(
        "write",
        json!({"path": "docs/authorized_keys", "content": "ssh-rsa AAA"}),
    );
    assert!(r.is_error, "{}", r.content);
    assert!(!outside.path().join("authorized_keys").exists());
    assert!(w.call("read", json!({"path": "docs/segredo"})).is_error);
}

// ───── glob / grep ─────

#[test]
fn glob_respects_gitignore_and_subpaths() {
    let w = ws();
    w.put(".gitignore", "target/\n*.log\n");
    w.put("src/a.rs", "");
    w.put("src/deep/b.rs", "");
    w.put("target/debug/c.rs", "");
    w.put("x.log", "");
    w.put("README.md", "");
    let r = w.call("glob", json!({"pattern": "**/*.rs"}));
    assert_eq!(r.content, "src/a.rs\nsrc/deep/b.rs");
    assert_eq!(
        w.call("glob", json!({"pattern": "*.rs", "path": "src/deep"}))
            .content,
        "src/deep/b.rs"
    );
    assert!(w
        .call("glob", json!({"pattern": "*.py"}))
        .content
        .contains("nenhum"));
}

#[test]
fn grep_modes_filters_and_errors() {
    let w = ws();
    w.put("a.rs", "fn main() {\n    todo!()\n}\n");
    w.put("b.ts", "// TODO: algo\nconst x = 1;\n");
    w.put("c.rs", "nada\n");
    assert_eq!(
        w.call("grep", json!({"pattern": "(?i)todo"})).content,
        "a.rs\nb.ts"
    );
    let r = w.call(
        "grep",
        json!({"pattern": "todo", "mode": "content", "ignore_case": true}),
    );
    assert!(
        r.content.contains("a.rs:2:     todo!()") && r.content.contains("b.ts:1: // TODO: algo")
    );
    assert_eq!(
        w.call("grep", json!({"pattern": "todo", "glob": "*.rs"}))
            .content,
        "a.rs"
    );
    assert_eq!(
        w.call("grep", json!({"pattern": "\\n|\\}", "mode": "count"}))
            .content,
        "a.rs: 1"
    );
    assert!(w
        .call("grep", json!({"pattern": "zzz"}))
        .content
        .contains("sem resultados"));
    assert!(w.call("grep", json!({"pattern": "("})).is_error);
}

#[test]
fn grep_content_shows_150_lines_and_counts_the_rest() {
    let w = ws();
    let many: String = (0..100).map(|i| format!("hit {i}\n")).collect();
    for f in ["a.txt", "b.txt", "c.txt"] {
        w.put(f, &many);
    }
    let r = w.call("grep", json!({"pattern": "hit", "mode": "content"}));
    let shown = r.content.lines().filter(|l| l.contains(": hit ")).count();
    assert_eq!(shown, 150);
    // the note gives the total so the model can decide to narrow it down
    assert!(
        r.content.contains("150 de 300 linhas") && r.content.contains("300 linhas em 3 ficheiros"),
        "{}",
        r.content.lines().last().unwrap()
    );
    assert!(r.content.contains("mode=\"count\""));
    // under the cap: no note
    let r = w.call("grep", json!({"pattern": "hit 7$", "mode": "content"}));
    assert!(!r.content.contains("mostradas"), "{}", r.content);
}

// ───── bash / run_tests / lint ─────

#[test]
fn bash_reports_exit_code_and_output() {
    let w = ws();
    let r = w.call(
        "bash",
        json!({"command": "echo olá; echo erro >&2; exit 4"}),
    );
    assert!(r.is_error);
    assert!(r.content.starts_with("exit 4"));
    assert!(r.content.contains("--- stdout\nolá") && r.content.contains("--- stderr\nerro"));
    let r = w.call("bash", json!({"command": "pwd"}));
    assert!(!r.is_error);
    assert_eq!(
        fs::canonicalize(r.content.lines().nth(2).unwrap()).unwrap(),
        fs::canonicalize(w.path()).unwrap()
    );
}

#[cfg(unix)]
#[test]
fn bash_timeout_kills_the_whole_process_group() {
    let w = ws();
    let t0 = Instant::now();
    let r = w.call(
        "bash",
        json!({"command": "sleep 30 & echo $! > neto.pid; sleep 30", "timeout_secs": 1}),
    );
    assert!(
        t0.elapsed() < Duration::from_secs(8),
        "devia acabar perto de 1 s"
    );
    assert!(r.is_error && r.content.contains("tempo limite"));
    let pid: i32 = w.get("neto.pid").trim().parse().unwrap();
    std::thread::sleep(Duration::from_millis(200));
    let alive = unsafe { libc_kill0(pid) };
    assert!(!alive, "o neto em background devia ter morrido com o grupo");
}

#[cfg(unix)]
unsafe fn libc_kill0(pid: i32) -> bool {
    // kill(pid, 0) == 0 ⇒ o processo existe
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, 0) == 0
}

#[cfg(unix)]
#[test]
fn background_grandchildren_do_not_hang_the_tool() {
    let w = ws();
    let t0 = Instant::now();
    let r = w.call("bash", json!({"command": "sleep 30 & echo pronto"}));
    assert!(
        t0.elapsed() < Duration::from_secs(5),
        "não pode ficar à espera do neto: {:?}",
        t0.elapsed()
    );
    assert!(!r.is_error && r.content.contains("pronto"), "{}", r.content);
}

#[test]
fn bash_is_cancelled_by_the_session_flag() {
    let w = ws();
    let flag = w.ctx.cancel.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        flag.store(true, Ordering::Relaxed);
    });
    let t0 = Instant::now();
    let r = w.call("bash", json!({"command": "sleep 30"}));
    assert!(t0.elapsed() < Duration::from_secs(5));
    assert!(r.is_error && r.content.contains("cancelado"));
}

#[test]
fn verify_tools_run_the_detected_commands() {
    let w = ws();
    let r = w.call("run_tests", json!({}));
    assert!(
        r.is_error && r.content.starts_with("$ exit 3\nexit 3"),
        "{}",
        r.content
    );
    let r = w.call("lint", json!({}));
    assert!(!r.is_error && r.content.contains("lint-ok"));
}

// ───── git ─────

#[test]
fn git_status_and_diff_are_read_only_views() {
    let w = ws();
    let g = |args: &[&str]| {
        assert!(
            std::process::Command::new("git")
                .args(args)
                .current_dir(w.path())
                .output()
                .unwrap()
                .status
                .success(),
            "{args:?}"
        );
    };
    g(&["init", "-q", "-b", "main"]);
    w.put("a.txt", "um\n");
    g(&["add", "."]);
    g(&[
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-qm",
        "init",
    ]);
    w.put("a.txt", "um\ndois\n");
    w.put("novo.txt", "x\n");

    let s = w.call("git_status", json!({}));
    assert!(!s.is_error);
    assert!(
        s.content.contains("## main")
            && s.content.contains(" M a.txt")
            && s.content.contains("?? novo.txt"),
        "{}",
        s.content
    );
    let d = w.call("git_diff", json!({"path": "a.txt"}));
    assert!(d.content.contains("+dois"), "{}", d.content);
    assert_eq!(
        w.call("git_diff", json!({"staged": true})).content,
        "(sem alterações)"
    );
}
