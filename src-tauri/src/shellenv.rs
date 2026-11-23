//! The user's login-shell environment, resolved once (VS Code's "resolving shell
//! environment").
//!
//! A desktop app started from the launcher inherits a bare environment: no nvm `node`, no
//! rustup `cargo`, no `~/go/bin`. The terminal does not care (the shell loads the rc files
//! itself), but the Problems checkers run programs directly, so they need the PATH and
//! variables the user's own shell would have. We ask the shell once (`$SHELL -ilc env -0`,
//! bounded by a timeout) and cache the answer for the whole run; if that fails we fall back
//! to the app's own environment.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

static ENV: OnceLock<HashMap<String, String>> = OnceLock::new();

/// Parse the output of `env -0` (NUL-separated `KEY=value` records). Pure.
pub fn parse_env0(raw: &[u8]) -> HashMap<String, String> {
    raw.split(|b| *b == 0)
        .filter_map(|rec| {
            let s = String::from_utf8_lossy(rec);
            let (k, v) = s.split_once('=')?;
            (!k.is_empty() && !k.contains('\n')).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

#[cfg(unix)]
fn resolve() -> Option<HashMap<String, String>> {
    let shell = crate::pty::default_shell();
    let mut child = Command::new(&shell)
        .args(["-ilc", "command env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("DXTUTOR_RESOLVING_ENVIRONMENT", "1")
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = Vec::new();
    child.stdout.take()?.read_to_end(&mut out).ok()?;
    let env = parse_env0(&out);
    env.contains_key("PATH").then_some(env)
}

#[cfg(not(unix))]
fn resolve() -> Option<HashMap<String, String>> {
    None
}

/// The resolved environment (login shell's, else this process's).
pub fn get() -> &'static HashMap<String, String> {
    ENV.get_or_init(|| {
        let mut env = resolve().unwrap_or_else(|| std::env::vars().collect());
        env.remove("DXTUTOR_RESOLVING_ENVIRONMENT");
        env
    })
}

/// A `Command` for `program` with the resolved environment, the program itself looked up on
/// the resolved PATH (so `cargo` is rustup's even when the app's PATH lacks it).
pub fn command(program: &str) -> Command {
    let env = get();
    let resolved = env
        .get("PATH")
        .and_then(|path| {
            std::env::split_paths(path)
                .map(|d| d.join(program))
                .find(|c| c.is_file())
        })
        .unwrap_or_else(|| program.into());
    let mut c = Command::new(resolved);
    c.env_clear().envs(env.iter());
    c
}

/// Whether `program` exists on the resolved PATH.
pub fn has(program: &str) -> bool {
    get()
        .get("PATH")
        .is_some_and(|path| std::env::split_paths(path).any(|d| d.join(program).is_file()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_env0_keeps_values_with_equals_and_newlines() {
        let raw = b"PATH=/a:/b\0X=1=2\0MULTI=l1\nl2\0\0=bad\0";
        let env = parse_env0(raw);
        assert_eq!(env["PATH"], "/a:/b");
        assert_eq!(env["X"], "1=2");
        assert_eq!(env["MULTI"], "l1\nl2");
        assert_eq!(env.len(), 3);
    }
}
