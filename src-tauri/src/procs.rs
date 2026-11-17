//! Running programs: `exec` captures output (no shell, arguments passed as-is),
//! `spawn_shell` streams a shell command line by line to the UI and can be stopped.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Serialize, PartialEq)]
pub struct ExecOut {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    #[serde(rename = "timedOut")]
    pub timed_out: bool,
}

/// Runs `program args…` in `cwd`, feeding `stdin`, and waits at most `timeout`.
pub fn exec(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    env: &HashMap<String, String>,
    stdin: Option<&str>,
    timeout: Duration,
) -> Result<ExecOut, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .envs(env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    cmd.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let mut child = cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    if let (Some(input), Some(mut si)) = (stdin, child.stdin.take()) {
        let input = input.to_string();
        thread::spawn(move || {
            let _ = si.write_all(input.as_bytes());
        });
    }
    let out = read_all(child.stdout.take());
    let err = read_all(child.stderr.take());
    let start = Instant::now();
    let (code, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(st)) => break (st.code().unwrap_or(-1), false),
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break (-1, true);
            }
            Ok(None) => thread::sleep(Duration::from_millis(15)),
            Err(e) => return Err(e.to_string()),
        }
    };
    Ok(ExecOut {
        code,
        stdout: out.join().unwrap_or_default(),
        stderr: err.join().unwrap_or_default(),
        timed_out,
    })
}

fn read_all<R: Read + Send + 'static>(r: Option<R>) -> thread::JoinHandle<String> {
    thread::spawn(move || {
        let mut s = Vec::new();
        if let Some(mut r) = r {
            let _ = r.read_to_end(&mut s);
        }
        String::from_utf8_lossy(&s).to_string()
    })
}

/// The platform shell used for terminal commands.
pub fn shell_command(line: &str) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.args(["/C", line]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", line]);
        c
    }
}

#[derive(Default, Clone)]
pub struct Procs(pub Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>);

#[derive(Serialize, Clone)]
pub struct Line {
    pub id: String,
    pub line: String,
    pub err: bool,
}

#[derive(Serialize, Clone)]
pub struct Exit {
    pub id: String,
    pub code: i32,
}

/// Starts `line` in a shell. `on_line` gets each output line, `on_exit` the exit code.
pub fn spawn_shell<F, G>(
    procs: &Procs,
    id: String,
    line: &str,
    cwd: Option<&str>,
    env: &HashMap<String, String>,
    on_line: F,
    on_exit: G,
) -> Result<(), String>
where
    F: Fn(Line) + Send + Sync + 'static,
    G: FnOnce(Exit) + Send + 'static,
{
    let mut cmd = shell_command(line);
    cmd.envs(env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    // Own process group, so Stop also ends the children (docker compose, cargo…).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let on_line = Arc::new(on_line);
    let mut readers = Vec::new();
    for (pipe, err) in [
        (
            child
                .stdout
                .take()
                .map(|p| Box::new(p) as Box<dyn Read + Send>),
            false,
        ),
        (
            child
                .stderr
                .take()
                .map(|p| Box::new(p) as Box<dyn Read + Send>),
            true,
        ),
    ] {
        if let Some(p) = pipe {
            let cb = on_line.clone();
            let id = id.clone();
            readers.push(thread::spawn(move || {
                for l in BufReader::new(p).lines() {
                    match l {
                        Ok(line) => cb(Line {
                            id: id.clone(),
                            line,
                            err,
                        }),
                        Err(_) => break,
                    }
                }
            }));
        }
    }
    let child = Arc::new(Mutex::new(child));
    procs.0.lock().unwrap().insert(id.clone(), child.clone());
    let map = procs.0.clone();
    thread::spawn(move || {
        let code = loop {
            let r = child.lock().unwrap().try_wait();
            match r {
                Ok(Some(st)) => break st.code().unwrap_or(-1),
                Ok(None) => thread::sleep(Duration::from_millis(30)),
                Err(_) => break -1,
            }
        };
        for r in readers {
            let _ = r.join();
        }
        map.lock().unwrap().remove(&id);
        on_exit(Exit { id, code });
    });
    Ok(())
}

pub fn kill(procs: &Procs, id: &str) -> bool {
    let child = match procs.0.lock().unwrap().get(id) {
        Some(c) => c.clone(),
        None => return false,
    };
    let mut c = child.lock().unwrap();
    #[cfg(unix)]
    {
        let pgid = format!("-{}", c.id());
        if Command::new("kill")
            .args(["-TERM", "--", &pgid])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    c.kill().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn exec_captures_output_and_exit_code() {
        let o = exec(
            "sh",
            &["-c".into(), "echo out; echo err >&2; exit 3".into()],
            None,
            &HashMap::new(),
            None,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(o.code, 3);
        assert_eq!(o.stdout.trim(), "out");
        assert_eq!(o.stderr.trim(), "err");
        assert!(!o.timed_out);
    }

    #[test]
    fn exec_passes_arguments_without_a_shell() {
        let o = exec(
            "printf",
            &["%s".into(), "a b; rm -rf /".into()],
            None,
            &HashMap::new(),
            None,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(o.stdout, "a b; rm -rf /");
    }

    #[test]
    fn exec_feeds_stdin_and_times_out() {
        let o = exec(
            "cat",
            &[],
            None,
            &HashMap::new(),
            Some("hello"),
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(o.stdout, "hello");
        let t = exec(
            "sleep",
            &["5".into()],
            None,
            &HashMap::new(),
            None,
            Duration::from_millis(200),
        )
        .unwrap();
        assert!(t.timed_out);
    }

    #[test]
    fn spawn_streams_lines_and_reports_exit() {
        let procs = Procs::default();
        let (tx, rx) = mpsc::channel();
        let tx2 = tx.clone();
        let mut env = HashMap::new();
        env.insert("DX_TEST".into(), "42".into());
        spawn_shell(
            &procs,
            "t1".into(),
            "echo one; echo $DX_TEST",
            None,
            &env,
            move |l| tx.send(l.line).unwrap(),
            move |e| tx2.send(format!("exit {}", e.code)).unwrap(),
        )
        .unwrap();
        let got: Vec<String> = (0..3)
            .map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        assert_eq!(got, vec!["one", "42", "exit 0"]);
    }

    #[test]
    fn spawned_process_can_be_killed() {
        let procs = Procs::default();
        let (tx, rx) = mpsc::channel();
        spawn_shell(
            &procs,
            "t2".into(),
            "sleep 30",
            None,
            &HashMap::new(),
            |_| {},
            move |e| tx.send(e.code).unwrap(),
        )
        .unwrap();
        thread::sleep(Duration::from_millis(100));
        assert!(kill(&procs, "t2"));
        assert_ne!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    }
}
