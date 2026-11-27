//! H6a: `dxtutor-ide agent -p …` end to end — the real binary, the real harness, against a fake Ollama (a local HTTP
//! server that plays the model): a file is written (Auto allows it), a dangerous command is refused because nobody is
//! there to approve it, and the run ends with the model's answer, the outcome and the exit code. Everything the binary
//! writes goes to temporary folders (HOME, the IDE's config and data).

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::sync::{Arc, Mutex};

/// The IDE's binary: Cargo's path when it gives one, else next to this test's (`target/<profile>/`).
fn bin_path() -> std::path::PathBuf {
    if let Some(p) = option_env!("CARGO_BIN_EXE_dxtutor-ide") {
        return p.into();
    }
    let exe = std::env::current_exe().unwrap();
    let dir = exe.parent().unwrap().parent().unwrap();
    let b = dir.join("dxtutor-ide");
    assert!(
        b.exists(),
        "build the IDE first: cargo build -p dxtutor-ide ({})",
        b.display()
    );
    b
}

/// The model's turns, one per `/api/chat` request.
fn fake_ollama(turns: Vec<serde_json::Value>) -> (u16, Arc<Mutex<Vec<serde_json::Value>>>) {
    let srv = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = srv.local_addr().unwrap().port();
    let seen: Arc<Mutex<Vec<serde_json::Value>>> = Default::default();
    let seen2 = seen.clone();
    std::thread::spawn(move || {
        let mut turns = turns.into_iter();
        for conn in srv.incoming() {
            let Ok(mut conn) = conn else { break };
            let mut reader = BufReader::new(conn.try_clone().unwrap());
            let mut head = String::new();
            let mut len = 0usize;
            loop {
                let mut l = String::new();
                if reader.read_line(&mut l).unwrap_or(0) == 0 {
                    break;
                }
                if let Some(v) = l.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
                if l == "\r\n" {
                    break;
                }
                head.push_str(&l);
            }
            let mut body = vec![0u8; len];
            let _ = reader.read_exact(&mut body);
            if !head.starts_with("POST /api/chat") {
                let _ = conn.write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                );
                continue;
            }
            seen2
                .lock()
                .unwrap()
                .push(serde_json::from_slice(&body).unwrap_or_default());
            let msg = turns.next().unwrap_or_else(
                || serde_json::json!({"role": "assistant", "content": "(no more turns)"}),
            );
            let lines = format!(
                "{}\n{}\n",
                serde_json::json!({"model": "fake", "message": msg, "done": false}),
                serde_json::json!({"model": "fake", "message": {"role": "assistant", "content": ""}, "done": true, "done_reason": "stop", "prompt_eval_count": 100, "eval_count": 7})
            );
            let _ = conn.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{lines}",
                    lines.len()
                )
                .as_bytes(),
            );
        }
    });
    (port, seen)
}

#[test]
fn a_headless_run_writes_refuses_what_needs_a_human_and_answers() {
    let (port, seen) = fake_ollama(vec![
        serde_json::json!({"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "write", "arguments": {"path": "hello.txt", "content": "olá\n"}}},
            {"function": {"name": "bash", "arguments": {"command": "rm -rf ./build"}}}
        ]}),
        serde_json::json!({"role": "assistant", "content": "Escrevi hello.txt; não apaguei build (precisa de um humano)."}),
    ]);
    let home = tempfile::tempdir().unwrap();
    let proj = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(proj.path().join("build")).unwrap();
    let out = Command::new(bin_path())
        .args([
            "agent",
            "-p",
            "cria hello.txt e limpa a pasta build",
            "--provider",
            "ollama",
            "--model",
            "fake",
            "--output",
            "json",
        ])
        .current_dir(proj.path())
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", home.path())
        .env("DXTUTOR_CONFIG_DIR", home.path().join("cfg"))
        .env("DXTUTOR_DATA_DIR", home.path().join("data"))
        .env("OLLAMA_HOST", format!("http://127.0.0.1:{port}"))
        .env("DXTUTOR_KEYCHAIN_SERVICE", "dxtutor-headless-test")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stdout: {stdout}\nstderr: {stderr}"
    );
    let v: serde_json::Value =
        serde_json::from_str(&stdout).unwrap_or_else(|e| panic!("{e}: {stdout}"));
    assert_eq!(v["outcome"], "done");
    assert!(v["result"].as_str().unwrap().contains("Escrevi hello.txt"));
    assert_eq!(v["requests"], 2);
    assert!(!v["sessionId"].as_str().unwrap().is_empty());
    // the write ran (Auto allows it); the dangerous command did not (nobody could approve it)
    assert_eq!(
        std::fs::read_to_string(proj.path().join("hello.txt")).unwrap(),
        "olá\n"
    );
    assert!(proj.path().join("build").exists());
    let refused = v["refused"].as_array().unwrap();
    assert!(
        refused
            .iter()
            .any(|r| r.as_str().unwrap().starts_with("bash:")),
        "{refused:?}"
    );
    // the model was told why, in the tool result of the refused call
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 2);
    let second = seen[1]["messages"].to_string();
    assert!(second.contains("No human is available"), "{second}");
}

#[test]
fn usage_errors_exit_2() {
    let home = tempfile::tempdir().unwrap();
    let out = Command::new(bin_path())
        .args(["agent", "--mode", "yolo", "-p", "x"])
        .env("HOME", home.path())
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&out.stderr).contains("--mode"));
}

/// H6b: `agent review` reads the branch's changes, cannot change anything (a write the model tries is refused by the
/// plan mode), and `--post` comments the answer on the PR through `gh` (a fake one here, that keeps what it got).
#[cfg(unix)]
#[test]
fn a_review_reads_only_and_is_posted_on_the_pr() {
    use std::os::unix::fs::PermissionsExt;
    let (port, seen) = fake_ollama(vec![
        serde_json::json!({"role": "assistant", "content": "", "tool_calls": [
            {"function": {"name": "write", "arguments": {"path": "a.rs", "content": "fn a() {}\n"}}}
        ]}),
        serde_json::json!({"role": "assistant", "content": "## Summary\nMakes a call unsafe.\n## Findings\n- **high** `a.rs:1` — unsafe_thing is not defined — it does not compile — define it\n## Verdict\nrequest changes"}),
    ]);
    let home = tempfile::tempdir().unwrap();
    let proj = tempfile::tempdir().unwrap();
    let p = proj.path();
    let g = |a: &[&str]| {
        let o = Command::new("git")
            .arg("-C")
            .arg(p)
            .args(a)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@e")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@e")
            .output()
            .unwrap();
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    };
    g(&["init", "-q", "--initial-branch=main"]);
    std::fs::write(p.join("a.rs"), "fn a() {}\n").unwrap();
    g(&["add", "-A"]);
    g(&["commit", "-q", "-m", "base"]);
    g(&["checkout", "-q", "-b", "feat"]);
    std::fs::write(p.join("a.rs"), "fn a() { unsafe_thing() }\n").unwrap();
    g(&["commit", "-qam", "make a unsafe"]);
    // a fake gh that keeps its arguments and the comment
    let bin = home.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let got = home.path().join("gh-got.txt");
    std::fs::write(
        bin.join("gh"),
        format!(
            "#!/bin/sh\necho \"$@\" > '{0}'\ncat >> '{0}'\n",
            got.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(bin.join("gh"), std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let out = Command::new(bin_path())
        .args([
            "agent",
            "review",
            "--base",
            "main",
            "--post",
            "42",
            "--provider",
            "ollama",
            "--model",
            "fake",
        ])
        .current_dir(p)
        .env_clear()
        .env("PATH", path)
        .env("HOME", home.path())
        .env("DXTUTOR_CONFIG_DIR", home.path().join("cfg"))
        .env("DXTUTOR_DATA_DIR", home.path().join("data"))
        .env("OLLAMA_HOST", format!("http://127.0.0.1:{port}"))
        .env("DXTUTOR_KEYCHAIN_SERVICE", "dxtutor-headless-test")
        .output()
        .unwrap();
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert_eq!(
        out.status.code(),
        Some(0),
        "stdout: {stdout}\nstderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(stdout.contains("## Verdict") && stdout.contains("Co-Dev review"));
    // nothing changed: the write the model tried was refused by the plan mode
    assert_eq!(
        std::fs::read_to_string(p.join("a.rs")).unwrap(),
        "fn a() { unsafe_thing() }\n"
    );
    // the request held the branch's diff
    let seen = seen.lock().unwrap();
    assert!(seen[0]["messages"]
        .to_string()
        .contains("+fn a() { unsafe_thing() }"));
    // posted on PR 42
    let posted = std::fs::read_to_string(&got).unwrap();
    assert!(
        posted.starts_with("pr comment 42 --body-file -"),
        "{posted}"
    );
    assert!(posted.contains("request changes") && posted.contains("Co-Dev review"));
}
