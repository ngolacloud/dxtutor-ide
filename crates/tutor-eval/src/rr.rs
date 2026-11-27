//! Record and replay with rr (r23 F2b, UI-DBG-04/13).
//!
//! `rr record` keeps a run of the program; `rr replay -s 0` serves the recording as a gdb remote
//! target, and the debugger (gdb in DAP mode, `dapc::DapSession::replay`) drives it — forwards with
//! the DAP requests, backwards with gdb's `reverse-*` commands, the position with rr's own
//! commands (`when`, `when-ticks`, loaded from `rr gdbinit`). Nothing is simulated: without rr, or
//! on a CPU rr cannot count, `probe` says why and the UI hides time travel with that reason.
//!
//! What was measured (docs/v2/AUDIT-r23.md, F2b spike): on a hybrid Intel CPU (P and E cores) the
//! branch counter rr needs exists only on the P cores' PMU (`cpu_core`), so recording binds to one
//! of them (`--bind-to-cpu`); rr < 5.9 does not know Meteor Lake at all.

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use serde::Serialize;

/// The first CPU of the performance cores on a hybrid Intel CPU (`None`: not hybrid).
pub fn bind_cpu() -> Option<u32> {
    let s = std::fs::read_to_string("/sys/bus/event_source/devices/cpu_core/cpus").ok()?;
    first_cpu(&s)
}

/// `0-11,16` → 0.
pub fn first_cpu(list: &str) -> Option<u32> {
    list.trim()
        .split([',', '-'])
        .next()
        .and_then(|n| n.trim().parse().ok())
}

/// Can rr record here? (asked once per run of the app: a tiny recording of `true`)
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RrStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub works: bool,
    /// rr's own words when it cannot record (an unknown CPU, counters that do not count…)
    pub error: Option<String>,
}

fn on_path(tool: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(tool).is_file()))
        .unwrap_or(false)
}

/// The useful line of an rr failure (`[FATAL …] Intel CPU type 0xa06a0 unknown`, or the first
/// sentence after it).
pub fn rr_error(stderr: &str) -> String {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|l| {
            !l.is_empty()
                && !l.starts_with("rr(")
                && !l.contains("libc.so")
                && !l.starts_with("===")
        })
        .collect();
    let fatal = lines.iter().position(|l| l.contains("FATAL"));
    match fatal {
        Some(i) => {
            let head = lines[i].split(']').nth(1).unwrap_or("").trim();
            if head.is_empty() {
                lines.get(i + 1).copied().unwrap_or(lines[i]).to_string()
            } else {
                head.to_string()
            }
        }
        None => lines.last().copied().unwrap_or("rr failed").to_string(),
    }
}

fn record_args(trace: &Path, program: &str, args: &[String]) -> Vec<String> {
    let mut a = vec!["record".to_string()];
    if let Some(cpu) = bind_cpu() {
        a.push(format!("--bind-to-cpu={cpu}"));
    }
    a.push("-o".into());
    a.push(trace.display().to_string());
    a.push(program.to_string());
    a.extend(args.iter().cloned());
    a
}

pub fn probe() -> RrStatus {
    static CACHE: OnceLock<RrStatus> = OnceLock::new();
    CACHE.get_or_init(probe_now).clone()
}

fn probe_now() -> RrStatus {
    if !on_path("rr") {
        return RrStatus {
            installed: false,
            version: None,
            works: false,
            error: None,
        };
    }
    let version = Command::new("rr")
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let dir = std::env::temp_dir().join(format!("dxtutor-rr-probe-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let out = Command::new("rr")
        .args(record_args(&dir, "true", &[]))
        .stdin(Stdio::null())
        .output();
    let _ = std::fs::remove_dir_all(&dir);
    match out {
        Ok(o) if o.status.success() => RrStatus {
            installed: true,
            version,
            works: true,
            error: None,
        },
        Ok(o) => RrStatus {
            installed: true,
            version,
            works: false,
            error: Some(rr_error(&String::from_utf8_lossy(&o.stderr))),
        },
        Err(e) => RrStatus {
            installed: true,
            version,
            works: false,
            error: Some(e.to_string()),
        },
    }
}

/// A recorded run.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    /// the trace folder (what `replay` takes)
    pub trace: String,
    pub program: String,
    pub exit_code: Option<i32>,
    /// what the program printed (its tail)
    pub output: String,
}

/// Where the app keeps its recordings: `<temp>/dxtutor-rr/<id>`, the newest `keep` only.
pub fn traces_dir() -> PathBuf {
    std::env::temp_dir().join("dxtutor-rr")
}

fn prune(dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut all: Vec<(std::time::SystemTime, PathBuf)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    all.sort();
    let n = all.len();
    for (_, p) in all.into_iter().take(n.saturating_sub(keep)) {
        let _ = std::fs::remove_dir_all(p);
    }
}

/// Records `program args` in `cwd` into a new trace under `traces_dir()` (named `id`).
pub fn record(
    id: &str,
    program: &str,
    args: &[String],
    cwd: Option<&Path>,
) -> Result<Recording, String> {
    let st = probe();
    if !st.installed {
        return Err("rr is not installed".into());
    }
    if !st.works {
        return Err(format!(
            "rr cannot record here: {}",
            st.error.unwrap_or_default()
        ));
    }
    let base = traces_dir();
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    prune(&base, 5);
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trace = base.join(safe);
    let _ = std::fs::remove_dir_all(&trace);
    let mut cmd = Command::new("rr");
    cmd.args(record_args(&trace, program, args))
        .stdin(Stdio::null());
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    let o = cmd
        .output()
        .map_err(|e| format!("could not start rr: {e}"))?;
    let mut text = String::from_utf8_lossy(&o.stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&o.stderr));
    if !trace.join("version").is_file() && !trace.join("data").exists() {
        return Err(format!(
            "rr did not record: {}",
            rr_error(&String::from_utf8_lossy(&o.stderr))
        ));
    }
    let tail: String = text
        .lines()
        .rev()
        .take(80)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    Ok(Recording {
        trace: trace.display().to_string(),
        program: program.to_string(),
        exit_code: o.status.code(),
        output: tail,
    })
}

/// `rr replay -s 0 <trace>`: the recording served as a gdb remote target on a local port.
pub struct ReplayServer {
    pub child: Child,
    pub port: u16,
}

/// Each line the replayed program prints (rr writes it on its own stdout/stderr as it replays).
pub type OnLine = std::sync::Arc<dyn Fn(&str) + Send + Sync>;

impl ReplayServer {
    pub fn start(trace: &str, on_line: Option<OnLine>) -> Result<ReplayServer, String> {
        let mut child = Command::new("rr")
            .args(["replay", "-s", "0", trace])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("could not start rr replay: {e}"))?;
        let out = child.stdout.take().ok_or("rr replay has no stdout")?;
        let err = child.stderr.take().ok_or("rr replay has no stderr")?;
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let ready = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        for r in [
            Box::new(out) as Box<dyn std::io::Read + Send>,
            Box::new(err),
        ] {
            let (tx, ready, on) = (tx.clone(), ready.clone(), on_line.clone());
            // keep reading to the end: the replayed program's output comes out here (to the
            // console), and a closed pipe kills rr with SIGPIPE at the program's first print
            std::thread::spawn(move || {
                for l in BufReader::new(r).lines().map_while(Result::ok) {
                    if ready.load(std::sync::atomic::Ordering::SeqCst) {
                        if let Some(f) = &on {
                            f(&format!("{l}\n"));
                        }
                    } else {
                        let _ = tx.send(l);
                    }
                }
            });
        }
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut seen = String::new();
        while Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(l) => {
                    if let Some(p) = parse_port(&l) {
                        ready.store(true, std::sync::atomic::Ordering::SeqCst);
                        return Ok(ReplayServer { child, port: p });
                    }
                    seen.push_str(&l);
                    seen.push('\n');
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(_)) = child.try_wait() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = child.kill();
        Err(format!("rr replay did not start: {}", rr_error(&seen)))
    }
}

impl Drop for ReplayServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The port in rr's `target extended-remote 127.0.0.1:NNNN` line.
pub fn parse_port(line: &str) -> Option<u16> {
    let i = line.find("target extended-remote")? + "target extended-remote".len();
    let addr = line[i..]
        .trim_start()
        .split(|c: char| c == '\'' || c.is_whitespace())
        .next()?;
    addr.rsplit(':').next()?.parse().ok()
}

/// rr's gdb commands (`when`, `when-ticks`…) written once to a file gdb loads with `-x`.
pub fn gdbinit_file() -> Result<PathBuf, String> {
    let p = traces_dir().join("rr.gdbinit");
    std::fs::create_dir_all(traces_dir()).map_err(|e| e.to_string())?;
    let o = Command::new("rr")
        .arg("gdbinit")
        .output()
        .map_err(|e| format!("rr gdbinit: {e}"))?;
    if !o.status.success() {
        return Err("rr gdbinit failed".into());
    }
    std::fs::write(&p, &o.stdout).map_err(|e| e.to_string())?;
    Ok(p)
}

/// The number in `Completed event: 395` / `Current tick: 1072`.
pub fn parse_number(s: &str) -> Option<u64> {
    s.rsplit(':').next()?.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_rr_lines() {
        assert_eq!(first_cpu("0-11\n"), Some(0));
        assert_eq!(first_cpu("4,6-7"), Some(4));
        assert_eq!(first_cpu(""), None);
        assert_eq!(parse_port("Launch gdb with\n  gdb '-l' '10000' '-ex' 'target extended-remote 127.0.0.1:18769' /x"), Some(18769));
        assert_eq!(parse_port("'gdb' '-ex' 'target extended-remote 127.0.0.1:44100' '/tmp/dxtutor-rr/x/mmap_copy_5_t'"), Some(44100));
        assert_eq!(parse_port("nothing"), None);
        assert_eq!(parse_number("Completed event: 395\n"), Some(395));
        assert_eq!(parse_number("Current tick: 1072"), Some(1072));
        assert_eq!(rr_error("[FATAL ./src/PerfCounters_x86.h:125:compute_cpu_microarch()] Intel CPU type 0xa06a0 unknown\n=== Start rr backtrace:\nrr(main+0x1)[0x1]\n"), "Intel CPU type 0xa06a0 unknown");
        assert_eq!(rr_error("[FATAL src/PerfCounters.cc:488:check_working_counters()] \nGot 0 branch events, expected at least 500.\n"), "Got 0 branch events, expected at least 500.");
    }

    /// A real recording of a small C program, served for replay (skipped without rr, or when rr
    /// cannot record on this machine — the probe says why).
    #[test]
    fn records_and_serves_a_run() {
        let st = probe();
        if !st.works || Command::new("cc").arg("--version").output().is_err() {
            eprintln!("skipped: rr cannot record here ({st:?})");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("t.c"),
            "#include <stdio.h>\nint main(void){ printf(\"hi\\n\"); return 3; }\n",
        )
        .unwrap();
        let bin = d.path().join("t");
        assert!(Command::new("cc")
            .args(["-g", "-O0", "-o"])
            .arg(&bin)
            .arg(d.path().join("t.c"))
            .status()
            .unwrap()
            .success());
        let r = record("test-records", bin.to_str().unwrap(), &[], Some(d.path())).unwrap();
        assert_eq!(r.exit_code, Some(3));
        assert!(r.output.contains("hi"), "{r:?}");
        let srv = ReplayServer::start(&r.trace, None).unwrap();
        assert!(srv.port > 0);
        assert!(gdbinit_file().unwrap().is_file());
    }
}
