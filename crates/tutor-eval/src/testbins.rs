//! «Debug this test» (r23 F2): the test binaries of a Cargo project and the tests in each.
//!
//! `cargo test --no-run --message-format=json` builds the test binaries and names them (the
//! `compiler-artifact` lines whose profile is a test and that have an executable); each binary
//! lists its own tests with `--list --format terse`. The debugger then launches one binary with
//! `--exact <name> --nocapture` (`test_args`), in the package's folder — where `cargo test`
//! runs it. Nothing here guesses: a build that fails says why with the compiler's own words.

use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;
use serde_json::Value;

/// One test binary of the project and the tests in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestBinary {
    /// the crate's target name (`store`, or `api` for `tests/api.rs`)
    pub target: String,
    /// `lib`, `bin`, `test`, `bench`, `example`…
    pub kind: String,
    pub executable: String,
    /// the package's folder (where `cargo test` runs the binary)
    pub cwd: String,
    pub tests: Vec<String>,
}

/// The test binaries named by cargo's JSON messages: (target, kind, executable, package folder).
pub fn parse_artifacts(stdout: &str) -> Vec<(String, String, String, String)> {
    let mut out: Vec<(String, String, String, String)> = vec![];
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v["reason"] != "compiler-artifact" || v["profile"]["test"] != true {
            continue;
        }
        let Some(exe) = v["executable"].as_str() else {
            continue;
        };
        let target = v["target"]["name"].as_str().unwrap_or("").to_string();
        let kind = v["target"]["kind"][0].as_str().unwrap_or("").to_string();
        let cwd = v["manifest_path"]
            .as_str()
            .and_then(|m| Path::new(m).parent())
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        if !out.iter().any(|o| o.2 == exe) {
            out.push((target, kind, exe.to_string(), cwd));
        }
    }
    out
}

/// The compiler's errors in cargo's JSON messages (what to show when the build fails).
pub fn build_errors(stdout: &str) -> String {
    stdout
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .filter(|v| v["reason"] == "compiler-message" && v["message"]["level"] == "error")
        .filter_map(|v| v["message"]["rendered"].as_str().map(String::from))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The tests a binary lists (`name: test` lines of `--list --format terse`).
pub fn parse_list(out: &str) -> Vec<String> {
    out.lines()
        .filter_map(|l| l.strip_suffix(": test"))
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .collect()
}

/// The arguments that run exactly one test, with its output shown (a panic's message reaches
/// the debugger's console instead of the harness's capture).
pub fn test_args(name: &str) -> Vec<String> {
    vec!["--exact".into(), name.into(), "--nocapture".into()]
}

/// Builds the project's test binaries and lists their tests. `mk` makes the commands (the app
/// passes one with the login shell's environment, so `cargo` from rustup is found).
pub fn test_targets(root: &Path, mk: &dyn Fn(&str) -> Command) -> Result<Vec<TestBinary>, String> {
    if !root.join("Cargo.toml").is_file() {
        return Err("not a Cargo project: «Debug Test» needs a Cargo.toml in the folder".into());
    }
    let out = mk("cargo")
        .args(["test", "--no-run", "--message-format=json"])
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("could not run cargo: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    if !out.status.success() {
        let errs = build_errors(&stdout);
        let tail = String::from_utf8_lossy(&out.stderr);
        let why = if errs.trim().is_empty() {
            tail.lines()
                .rev()
                .take(20)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            errs
        };
        return Err(format!("cargo test --no-run failed:\n{why}"));
    }
    let mut bins = vec![];
    for (target, kind, exe, cwd) in parse_artifacts(&stdout) {
        let list = mk(&exe)
            .args(["--list", "--format", "terse"])
            .current_dir(if cwd.is_empty() {
                root
            } else {
                Path::new(&cwd)
            })
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("could not list the tests of {exe}: {e}"))?;
        let tests = parse_list(&String::from_utf8_lossy(&list.stdout));
        if !tests.is_empty() {
            bins.push(TestBinary {
                target,
                kind,
                executable: exe,
                cwd,
                tests,
            });
        }
    }
    Ok(bins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_cargo_messages_and_the_list() {
        let msgs = r#"{"reason":"compiler-artifact","target":{"name":"store","kind":["lib"]},"profile":{"test":false},"executable":null,"manifest_path":"/w/crates/store/Cargo.toml"}
{"reason":"compiler-artifact","target":{"name":"store","kind":["lib"]},"profile":{"test":true},"executable":"/w/target/debug/deps/store-1a2b","manifest_path":"/w/crates/store/Cargo.toml"}
{"reason":"compiler-artifact","target":{"name":"api","kind":["test"]},"profile":{"test":true},"executable":"/w/target/debug/deps/api-9f","manifest_path":"/w/crates/store/Cargo.toml"}
{"reason":"build-finished","success":true}
not json"#;
        let a = parse_artifacts(msgs);
        assert_eq!(a.len(), 2);
        assert_eq!(
            a[0],
            (
                "store".into(),
                "lib".into(),
                "/w/target/debug/deps/store-1a2b".into(),
                "/w/crates/store".into()
            )
        );
        assert_eq!(a[1].1, "test");
        assert_eq!(
            parse_list("lru::tests::evicts_least_recently_used: test\nlru::tests::get_missing_returns_none: test\nbench_x: bench\n"),
            vec!["lru::tests::evicts_least_recently_used", "lru::tests::get_missing_returns_none"]
        );
        assert_eq!(test_args("a::b"), vec!["--exact", "a::b", "--nocapture"]);
        let err = r#"{"reason":"compiler-message","message":{"level":"error","rendered":"error[E0425]: cannot find value `x`"}}
{"reason":"compiler-message","message":{"level":"warning","rendered":"warning: unused"}}"#;
        assert_eq!(build_errors(err), "error[E0425]: cannot find value `x`");
    }

    /// A real Cargo project: builds its test binary and lists the tests in it; a folder without a
    /// Cargo.toml and a build that fails say so.
    #[test]
    fn real_cargo_project() {
        if Command::new("cargo").arg("--version").output().is_err() {
            eprintln!("skipped: no cargo");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        std::fs::create_dir_all(p.join("src")).unwrap();
        std::fs::write(
            p.join("Cargo.toml"),
            "[package]\nname = \"lru\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n",
        )
        .unwrap();
        std::fs::write(p.join("src/lib.rs"), "pub fn two() -> i32 { 2 }\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() { assert_eq!(super::two(), 2); }\n    #[test]\n    fn fails() { assert_eq!(super::two(), 3); }\n}\n").unwrap();
        let mk = |prog: &str| Command::new(prog);
        let bins = test_targets(p, &mk).unwrap();
        assert_eq!(bins.len(), 1, "{bins:?}");
        assert_eq!(bins[0].kind, "lib");
        assert_eq!(bins[0].tests, vec!["tests::adds", "tests::fails"]);
        assert_eq!(bins[0].cwd, p.display().to_string());
        assert!(test_targets(&p.join("src"), &mk)
            .unwrap_err()
            .contains("Cargo.toml"));
        std::fs::write(p.join("src/lib.rs"), "pub fn two() -> i32 { x }\n").unwrap();
        let e = test_targets(p, &mk).unwrap_err();
        assert!(
            e.contains("E0425") || e.contains("cannot find value"),
            "{e}"
        );
    }
}
