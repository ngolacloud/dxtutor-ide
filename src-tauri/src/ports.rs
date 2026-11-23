//! Listening TCP ports of the user's processes — the data behind the Services view's
//! "Ports" list (VS Code's Ports panel detects the same thing to offer "Open in Browser").
//!
//! Linux reads `/proc/net/tcp{,6}` for sockets in LISTEN state and maps each socket inode
//! to its owning process through `/proc/<pid>/fd`; only the user's own processes are
//! readable, which is exactly the scope we want. macOS asks `lsof`, Windows `netstat`.
//! A port is `in_workspace` when its process runs with a cwd inside the open folder (a dev
//! server started from the project, in our terminal or elsewhere).

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    pub port: u16,
    /// Bound address as text ("127.0.0.1", "0.0.0.0", "::", …).
    pub address: String,
    pub pid: Option<u32>,
    pub process: Option<String>,
    pub command: Option<String>,
    pub cwd: Option<String>,
    pub in_workspace: bool,
}

/// One LISTEN socket from `/proc/net/tcp` or `/proc/net/tcp6`: (address, port, inode). Pure.
pub fn parse_proc_net_tcp(text: &str, v6: bool) -> Vec<(String, u16, u64)> {
    text.lines()
        .skip(1)
        .filter_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            if f.len() < 10 || f[3] != "0A" {
                return None;
            }
            let (addr, port) = f[1].split_once(':')?;
            let port = u16::from_str_radix(port, 16).ok()?;
            let inode = f[9].parse::<u64>().ok()?;
            Some((hex_addr(addr, v6)?, port, inode))
        })
        .collect()
}

/// Kernel hex address → text. IPv4 is one little-endian u32; IPv6 four of them.
fn hex_addr(h: &str, v6: bool) -> Option<String> {
    if !v6 {
        let n = u32::from_str_radix(h, 16).ok()?;
        return Some(std::net::Ipv4Addr::from(n.swap_bytes()).to_string());
    }
    if h.len() != 32 {
        return None;
    }
    let mut bytes = [0u8; 16];
    for i in 0..4 {
        let w = u32::from_str_radix(&h[i * 8..i * 8 + 8], 16)
            .ok()?
            .swap_bytes();
        bytes[i * 4..i * 4 + 4].copy_from_slice(&w.to_be_bytes());
    }
    let ip = std::net::Ipv6Addr::from(bytes);
    Some(
        ip.to_ipv4_mapped()
            .map(|v4| v4.to_string())
            .unwrap_or_else(|| ip.to_string()),
    )
}

fn mark(mut ports: Vec<PortInfo>, root: Option<&Path>) -> Vec<PortInfo> {
    for p in &mut ports {
        p.in_workspace = match (root, p.cwd.as_deref()) {
            (Some(r), Some(c)) => Path::new(c).starts_with(r),
            _ => false,
        };
    }
    // One row per (port, pid): a server bound on both 0.0.0.0 and :: shows once.
    ports.sort_by(|a, b| {
        (!a.in_workspace, a.port, a.address.len()).cmp(&(!b.in_workspace, b.port, b.address.len()))
    });
    ports.dedup_by(|a, b| a.port == b.port && a.pid == b.pid);
    ports
}

#[cfg(target_os = "linux")]
fn listening() -> Vec<PortInfo> {
    let mut socks: HashMap<u64, (String, u16)> = HashMap::new();
    for (file, v6) in [("/proc/net/tcp", false), ("/proc/net/tcp6", true)] {
        if let Ok(t) = std::fs::read_to_string(file) {
            for (a, p, i) in parse_proc_net_tcp(&t, v6) {
                socks.insert(i, (a, p));
            }
        }
    }
    let mut out = Vec::new();
    let Ok(procs) = std::fs::read_dir("/proc") else {
        return out;
    };
    for e in procs.flatten() {
        let Ok(pid) = e.file_name().to_string_lossy().parse::<u32>() else {
            continue;
        };
        let Ok(fds) = std::fs::read_dir(e.path().join("fd")) else {
            continue;
        };
        for fd in fds.flatten() {
            let Ok(target) = std::fs::read_link(fd.path()) else {
                continue;
            };
            let t = target.to_string_lossy();
            let Some(inode) = t
                .strip_prefix("socket:[")
                .and_then(|s| s.strip_suffix(']'))
                .and_then(|s| s.parse::<u64>().ok())
            else {
                continue;
            };
            if let Some((address, port)) = socks.remove(&inode) {
                let read = |n: &str| std::fs::read_to_string(e.path().join(n)).ok();
                out.push(PortInfo {
                    port,
                    address,
                    pid: Some(pid),
                    process: read("comm").map(|s| s.trim().to_string()),
                    command: read("cmdline")
                        .map(|s| {
                            s.split('\0')
                                .filter(|x| !x.is_empty())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .filter(|s| !s.is_empty()),
                    cwd: std::fs::read_link(e.path().join("cwd"))
                        .ok()
                        .map(|p| p.to_string_lossy().into_owned()),
                    in_workspace: false,
                });
            }
        }
    }
    out
}

/// `lsof -F` output (records of `p<pid>`, `c<command>`, `n<addr:port>`). Pure.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn parse_lsof(text: &str) -> Vec<PortInfo> {
    let (mut pid, mut cmd) = (None::<u32>, None::<String>);
    let mut out = Vec::new();
    for l in text.lines() {
        let (tag, val) = l.split_at(l.len().min(1));
        match tag {
            "p" => pid = val.parse().ok(),
            "c" => cmd = Some(val.to_string()),
            "n" => {
                if let Some((addr, port)) = val.rsplit_once(':') {
                    if let Ok(port) = port.parse() {
                        let address = match addr.trim_matches(|c| c == '[' || c == ']') {
                            "*" => "0.0.0.0".to_string(),
                            a => a.to_string(),
                        };
                        out.push(PortInfo {
                            port,
                            address,
                            pid,
                            process: cmd.clone(),
                            command: None,
                            cwd: None,
                            in_workspace: false,
                        });
                    }
                }
            }
            _ => {}
        }
    }
    out
}

#[cfg(target_os = "macos")]
fn listening() -> Vec<PortInfo> {
    let run = |args: &[&str]| {
        std::process::Command::new("lsof")
            .args(args)
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    let mut ports =
        parse_lsof(&run(&["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]).unwrap_or_default());
    let mut cwds: HashMap<u32, Option<String>> = HashMap::new();
    for p in &mut ports {
        if let Some(pid) = p.pid {
            p.cwd = cwds
                .entry(pid)
                .or_insert_with(|| {
                    run(&["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"]).and_then(|s| {
                        s.lines()
                            .find_map(|l| l.strip_prefix('n').map(str::to_string))
                    })
                })
                .clone();
        }
    }
    ports
}

#[cfg(windows)]
fn listening() -> Vec<PortInfo> {
    let out = std::process::Command::new("netstat")
        .args(["-ano", "-p", "TCP"])
        .output();
    let text = out
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    text.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split_whitespace().collect();
            if f.len() < 5 || f[3] != "LISTENING" {
                return None;
            }
            let (addr, port) = f[1].rsplit_once(':')?;
            Some(PortInfo {
                port: port.parse().ok()?,
                address: addr.to_string(),
                pid: f[4].parse().ok(),
                process: None,
                command: None,
                cwd: None,
                in_workspace: false,
            })
        })
        .collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
fn listening() -> Vec<PortInfo> {
    Vec::new()
}

/// Every listening TCP port of the user's processes, the workspace's first.
pub fn list(root: Option<&Path>) -> Vec<PortInfo> {
    mark(listening(), root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proc_net_tcp_keeps_listen_sockets() {
        let v4 = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0000000000000000 100 0 0 10 0\n   1: 0100007F:A1B2 0100007F:1F90 01 00000000:00000000 00:00000000 00000000  1000        0 4343 1\n";
        assert_eq!(
            parse_proc_net_tcp(v4, false),
            vec![("127.0.0.1".to_string(), 8080, 4242)]
        );
        let v6 = "header\n   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 99 1\n   1: 0000000000000000FFFF00000100007F:0016 00000000000000000000000000000000:0000 0A 0 0 0 1000 0 98 1\n";
        assert_eq!(
            parse_proc_net_tcp(v6, true),
            vec![
                ("::".to_string(), 3000, 99),
                ("127.0.0.1".to_string(), 22, 98)
            ]
        );
    }

    #[test]
    fn lsof_records() {
        let t = "p123\ncnode\nn*:5173\nn[::1]:5173\np9\ncpostgres\nn127.0.0.1:5432\n";
        let p = parse_lsof(t);
        assert_eq!(p.len(), 3);
        assert_eq!(
            (p[0].port, p[0].address.as_str(), p[0].pid),
            (5173, "0.0.0.0", Some(123))
        );
        assert_eq!(p[1].address, "::1");
        assert_eq!(p[2].process.as_deref(), Some("postgres"));
    }

    #[test]
    fn workspace_ports_first_and_one_row_per_pid() {
        let mk = |port, addr: &str, pid, cwd: &str| PortInfo {
            port,
            address: addr.into(),
            pid: Some(pid),
            process: None,
            command: None,
            cwd: Some(cwd.into()),
            in_workspace: false,
        };
        let got = mark(
            vec![
                mk(22, "0.0.0.0", 1, "/"),
                mk(5173, "::", 7, "/w/ui"),
                mk(5173, "0.0.0.0", 7, "/w/ui"),
            ],
            Some(Path::new("/w")),
        );
        assert_eq!(got.len(), 2);
        assert!(got[0].in_workspace && got[0].port == 5173 && got[0].address == "::");
        assert!(!got[1].in_workspace);
    }
}
