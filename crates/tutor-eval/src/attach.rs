//! Where to attach the debugger (A10, docs/v2/UI-AUDIT.md §3 «Debug de sistemas distribuídos»; DBG-01 attach).
//!
//! A target is the local machine, a container (`docker` / `podman`) or a Kubernetes pod (`kubectl`).
//! For each: the containers or pods there are, the processes inside one (read from `/proc` with `sh`,
//! which works in any image that has a shell), whether the image has a DAP adapter (`lldb-dap`), and
//! the command that runs the adapter there over stdio (`docker exec -i … lldb-dap`) — the DAP session
//! (`dapc::DapSession::attach`) speaks to it as if it were local. Without an adapter in the image, the
//! result says what to install; nothing is pretended.

use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    /// local | docker | podman | kubectl
    pub kind: String,
    /// the container or pod (empty: list them)
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub context: String,
    #[serde(default)]
    pub namespace: String,
    #[serde(default)]
    pub kubeconfig: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub command: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Targets {
    pub ok: bool,
    /// containers or pods, when no name was given
    pub places: Vec<String>,
    /// the processes inside the named container/pod (or on this machine, for `local`)
    pub processes: Vec<Proc>,
    /// the adapter found where the process runs (`lldb-dap`…), if any
    pub adapter: Option<String>,
    pub notes: String,
}

fn ok_name(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && s.len() < 254
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._:/@".contains(c))
}

/// The command prefix that runs something inside the target (`docker exec -i web`).
pub fn exec_prefix(t: &Target) -> Result<Vec<String>, String> {
    if !ok_name(&t.name) {
        return Err(format!("invalid container/pod name: {:?}", t.name));
    }
    Ok(match t.kind.as_str() {
        "docker" | "podman" => vec![t.kind.clone(), "exec".into(), "-i".into(), t.name.clone()],
        "kubectl" => {
            let mut v = vec!["kubectl".to_string()];
            if !t.kubeconfig.is_empty() {
                v.extend(["--kubeconfig".into(), t.kubeconfig.clone()]);
            }
            if !t.context.is_empty() {
                if !ok_name(&t.context) {
                    return Err("invalid context".into());
                }
                v.extend(["--context".into(), t.context.clone()]);
            }
            if !t.namespace.is_empty() {
                if !ok_name(&t.namespace) {
                    return Err("invalid namespace".into());
                }
                v.extend(["-n".into(), t.namespace.clone()]);
            }
            v.extend(["exec".into(), "-i".into(), t.name.clone(), "--".into()]);
            v
        }
        other => return Err(format!("unknown target kind: {other}")),
    })
}

/// The adapter command for a target (`lldb-dap` locally, or run inside the container/pod).
pub fn adapter_command(t: &Target, adapter: &str) -> Result<Vec<String>, String> {
    if t.kind == "local" {
        return Ok(vec![adapter.to_string()]);
    }
    let mut v = exec_prefix(t)?;
    v.push(adapter.to_string());
    Ok(v)
}

fn run(argv: &[String]) -> Result<String, String> {
    let (p, rest) = argv.split_first().ok_or("empty command")?;
    let o = Command::new(p)
        .args(rest)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("{p}: {e}"))?;
    if !o.status.success() {
        let e = String::from_utf8_lossy(&o.stderr).trim().to_string();
        return Err(if e.is_empty() {
            format!("{} failed", argv.join(" "))
        } else {
            e
        });
    }
    Ok(String::from_utf8_lossy(&o.stdout).to_string())
}

/// `pid\tcmdline` lines from `/proc` (what the script below prints).
pub fn parse_procs(text: &str, own_pid: Option<u32>) -> Vec<Proc> {
    let mut v: Vec<Proc> = text
        .lines()
        .filter_map(|l| {
            let (pid, cmd) = l.split_once('\t')?;
            let pid: u32 = pid.trim().parse().ok()?;
            let cmd = cmd.trim();
            (!cmd.is_empty() && Some(pid) != own_pid).then(|| Proc {
                pid,
                command: cmd.chars().take(200).collect(),
            })
        })
        .collect();
    v.sort_by_key(|p| p.pid);
    v
}

const PS: &str = r#"for p in /proc/[0-9]*; do c=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null); [ -n "$c" ] && printf '%s\t%s\n' "${p#/proc/}" "$c"; done; true"#;
const FIND_ADAPTER: &str = "command -v lldb-dap || command -v lldb-vscode || true";

/// The containers/pods there are (no name) or the processes in one and its adapter.
pub fn targets(t: &Target) -> Targets {
    match t.kind.as_str() {
        "local" => {
            // the user's own processes on this machine
            let me = std::process::id();
            let uid = std::fs::read_to_string("/proc/self/status")
                .ok()
                .and_then(|s| {
                    s.lines().find_map(|l| {
                        l.strip_prefix("Uid:")
                            .map(|r| r.split_whitespace().next().unwrap_or("").to_string())
                    })
                });
            let mut procs = vec![];
            for e in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
                let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else {
                    continue;
                };
                let st = std::fs::read_to_string(e.path().join("status")).unwrap_or_default();
                let owner = st.lines().find_map(|l| {
                    l.strip_prefix("Uid:")
                        .map(|r| r.split_whitespace().next().unwrap_or("").to_string())
                });
                if owner != uid || pid == me {
                    continue;
                }
                let cmd = std::fs::read(e.path().join("cmdline"))
                    .map(|b| {
                        String::from_utf8_lossy(&b)
                            .replace('\0', " ")
                            .trim()
                            .to_string()
                    })
                    .unwrap_or_default();
                if !cmd.is_empty() {
                    procs.push(Proc {
                        pid,
                        command: cmd.chars().take(200).collect(),
                    });
                }
            }
            procs.sort_by_key(|p| p.pid);
            let adapter = crate::dapc::find_adapter().map(|p| p.display().to_string());
            let scope =
                std::fs::read_to_string("/proc/sys/kernel/yama/ptrace_scope").unwrap_or_default();
            let notes = if scope.trim() == "1" {
                "ptrace_scope is 1: a process can be attached to only if it allows it (prctl PR_SET_PTRACER) or runs as a child of the debugger; otherwise `sudo sysctl kernel.yama.ptrace_scope=0`.".to_string()
            } else {
                String::new()
            };
            Targets {
                ok: true,
                processes: procs,
                notes: if adapter.is_none() {
                    "No DAP adapter on PATH: install lldb-dap (LLVM).".into()
                } else {
                    notes
                },
                adapter,
                ..Default::default()
            }
        }
        "docker" | "podman" | "kubectl" if t.name.is_empty() => {
            let listed = match t.kind.as_str() {
                "kubectl" => {
                    let mut v = vec!["kubectl".to_string()];
                    if !t.kubeconfig.is_empty() {
                        v.extend(["--kubeconfig".into(), t.kubeconfig.clone()]);
                    }
                    if ok_name(&t.context) {
                        v.extend(["--context".into(), t.context.clone()]);
                    }
                    if ok_name(&t.namespace) {
                        v.extend(["-n".into(), t.namespace.clone()]);
                    }
                    v.extend([
                        "--request-timeout=10s".into(),
                        "get".into(),
                        "pods".into(),
                        "-o".into(),
                        "json".into(),
                    ]);
                    run(&v).map(|s| {
                        serde_json::from_str::<Value>(&s)
                            .ok()
                            .and_then(|j| j["items"].as_array().cloned())
                            .unwrap_or_default()
                            .iter()
                            .filter(|p| p["status"]["phase"] == "Running")
                            .filter_map(|p| p["metadata"]["name"].as_str().map(String::from))
                            .collect::<Vec<_>>()
                    })
                }
                tool => run(&[
                    tool.to_string(),
                    "ps".into(),
                    "--format".into(),
                    "{{.Names}}".into(),
                ])
                .map(|s| {
                    s.lines()
                        .map(|l| l.trim().to_string())
                        .filter(|l| !l.is_empty())
                        .collect()
                }),
            };
            match listed {
                Ok(places) => Targets {
                    ok: true,
                    notes: if places.is_empty() {
                        "Nothing running there.".into()
                    } else {
                        String::new()
                    },
                    places,
                    ..Default::default()
                },
                Err(e) => Targets {
                    notes: e,
                    ..Default::default()
                },
            }
        }
        "docker" | "podman" | "kubectl" => {
            let pre = match exec_prefix(t) {
                Ok(p) => p,
                Err(e) => {
                    return Targets {
                        notes: e,
                        ..Default::default()
                    }
                }
            };
            let sh = |script: &str| {
                let mut v = pre.clone();
                v.extend(["sh".into(), "-c".into(), script.into()]);
                run(&v)
            };
            match sh(PS) {
                Ok(out) => {
                    let adapter = sh(FIND_ADAPTER)
                        .ok()
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                    let processes = parse_procs(&out, None)
                        .into_iter()
                        .filter(|p| !p.command.starts_with("sh -c for p in /proc"))
                        .collect();
                    Targets {
                        ok: true,
                        processes,
                        notes: if adapter.is_none() {
                            "This image has no DAP adapter: add lldb-dap to it (e.g. `apt-get install lldb` on Debian/Ubuntu, `apk add lldb` on Alpine), or debug a local build.".into()
                        } else {
                            String::new()
                        },
                        adapter,
                        ..Default::default()
                    }
                }
                Err(e) => Targets {
                    notes: e,
                    ..Default::default()
                },
            }
        }
        other => Targets {
            notes: format!("unknown target kind: {other}"),
            ..Default::default()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn builds_exec_prefixes_and_refuses_odd_names() {
        let t = |kind: &str, name: &str| Target {
            kind: kind.into(),
            name: name.into(),
            context: "kind-dev".into(),
            namespace: "shop".into(),
            kubeconfig: String::new(),
        };
        assert_eq!(
            adapter_command(&t("docker", "web"), "lldb-dap").unwrap(),
            vec!["docker", "exec", "-i", "web", "lldb-dap"]
        );
        assert_eq!(
            adapter_command(&t("kubectl", "web-7c9f"), "lldb-dap")
                .unwrap()
                .join(" "),
            "kubectl --context kind-dev -n shop exec -i web-7c9f -- lldb-dap"
        );
        assert_eq!(
            adapter_command(&t("local", ""), "lldb-dap").unwrap(),
            vec!["lldb-dap"]
        );
        assert!(exec_prefix(&t("docker", "--privileged")).is_err());
        assert!(exec_prefix(&t("docker", "a b")).is_err());
        assert_eq!(
            parse_procs("1\tpostgres -D /data\n27\t\nx\ty\n9\tsleep 60\n", None)
                .iter()
                .map(|p| p.pid)
                .collect::<Vec<_>>(),
            vec![1, 9]
        );
    }

    /// A real attach with lldb-dap to a running process that allows it (ptrace_scope 1): breakpoint
    /// in its loop, stop there, read a local, then detach — the process keeps running.
    #[test]
    fn real_local_attach() {
        if crate::dapc::find_adapter().is_none()
            || Command::new("cc").arg("--version").output().is_err()
        {
            eprintln!("skipped: no lldb-dap or cc");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("w.c");
        std::fs::write(&src, "#include <sys/prctl.h>\n#include <unistd.h>\n#include <stdio.h>\nvolatile int ticks = 0;\nvoid tick(int n) {\n  ticks += n;\n}\nint main(void) {\n  prctl(PR_SET_PTRACER, PR_SET_PTRACER_ANY, 0, 0, 0);\n  for (;;) { tick(1); usleep(20000); }\n  return 0;\n}\n").unwrap();
        let bin = d.path().join("w");
        assert!(Command::new("cc")
            .args(["-g", "-O0", "-o"])
            .arg(&bin)
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let mut child = Command::new(&bin).spawn().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(200));
        let out: Arc<Mutex<String>> = Arc::default();
        let adapter = crate::dapc::find_adapter().unwrap().display().to_string();
        let s = crate::dapc::DapSession::attach(
            &[adapter],
            child.id(),
            Some(d.path().to_str().unwrap()),
            Some({
                let o = out.clone();
                Arc::new(move |_c: &str, t: &str| o.lock().unwrap().push_str(t))
            }),
            None,
        )
        .expect("attach");
        s.set_breakpoints(
            src.to_str().unwrap(),
            &[crate::dapc::BreakpointSpec {
                line: 6,
                ..Default::default()
            }],
        )
        .unwrap();
        let st = s.run().unwrap();
        assert!(st.stopped, "{st:?}");
        assert_eq!((st.func.as_str(), st.line), ("tick", 6));
        let locals = s.locals(0).unwrap();
        assert!(
            locals.iter().any(|v| v.name == "n" && v.value == "1"),
            "{locals:?}"
        );
        s.set_breakpoints(src.to_str().unwrap(), &[]).unwrap();
        s.stop();
        std::thread::sleep(std::time::Duration::from_millis(300));
        assert!(
            child.try_wait().unwrap().is_none(),
            "the process must keep running after detaching"
        );
        let _ = child.kill();
        let _ = child.wait();
        // a pid that does not exist: the adapter says so
        let adapter = crate::dapc::find_adapter().unwrap().display().to_string();
        assert!(crate::dapc::DapSession::attach(&[adapter], 4_000_000, None, None, None).is_err());
    }

    /// A throwaway container from a local image: its processes are listed and the missing adapter
    /// is said — never the user's own containers.
    #[test]
    fn real_container_processes_and_missing_adapter() {
        let image = "postgres:16-alpine";
        let has_image = Command::new("docker")
            .args(["image", "inspect", image])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !has_image {
            eprintln!("skipped: no docker or no {image}");
            return;
        }
        let name = format!("dxt-attach-test-{}", std::process::id());
        assert!(Command::new("docker")
            .args([
                "run",
                "-d",
                "--rm",
                "--name",
                &name,
                "--entrypoint",
                "sleep",
                image,
                "60"
            ])
            .stdout(Stdio::null())
            .status()
            .unwrap()
            .success());
        let t = Target {
            kind: "docker".into(),
            name: name.clone(),
            context: String::new(),
            namespace: String::new(),
            kubeconfig: String::new(),
        };
        let r = targets(&t);
        let _ = Command::new("docker")
            .args(["rm", "-f", &name])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        assert!(r.ok, "{}", r.notes);
        assert!(
            r.processes
                .iter()
                .any(|p| p.pid == 1 && p.command.starts_with("sleep 60")),
            "{:?}",
            r.processes
        );
        assert!(r.adapter.is_none());
        assert!(r.notes.contains("apk add lldb"));
        let listed = targets(&Target {
            kind: "docker".into(),
            name: String::new(),
            context: String::new(),
            namespace: String::new(),
            kubeconfig: String::new(),
        });
        assert!(listed.ok);
    }
}
