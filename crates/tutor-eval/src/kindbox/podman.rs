//! A **rootless Podman of the course's own** (Learn P3b): its storage, runtime folder,
//! configuration and registries, never the user's (`~/.local/share/containers`, `~/.config/
//! containers`, their containers and images).
//!
//! Kept small and on its own on purpose: Learn P3a builds the reusable container sandbox of the
//! Docker/Podman courses, and this file is what gets swapped for it when both land.
//!
//! How the isolation works (measured with Podman 4.9.3, rootless, cgroup v2):
//!
//! - `CONTAINERS_STORAGE_CONF` with `rootless_storage_path` (a rootless Podman ignores
//!   `graphroot`) puts images, containers, the libpod database and the network definitions under
//!   the course's folder;
//! - the RUN root of a rootless Podman is `$XDG_RUNTIME_DIR/containers` whatever `storage.conf`
//!   says, and the libpod database remembers it: so every Podman of the sandbox runs with its own
//!   `XDG_RUNTIME_DIR` ([`Sandbox::runtime`]), from the very first call. That also gives it its own
//!   pause process (`<runtime>/libpod/tmp/pause.pid`), which [`stop_pause`] ends;
//! - `CONTAINERS_CONF` and `CONTAINERS_REGISTRIES_CONF` replace the user's files; `HOME` and the
//!   `XDG_*` folders point inside the sandbox;
//! - the systemd cgroup manager still needs the user's D-Bus session (cgroup delegation for the
//!   kind node): `DBUS_SESSION_BUS_ADDRESS` is passed on, or found at `/run/user/<uid>/bus`.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::Sandbox;

/// The label every object the sandbox creates by itself carries (the kind network).
pub const LABEL: &str = "io.dxtutor.sandbox=kind";

/// The user's D-Bus session bus: the variable, or the usual socket.
pub fn session_bus() -> Option<String> {
    if let Some(v) = std::env::var_os("DBUS_SESSION_BUS_ADDRESS").filter(|v| !v.is_empty()) {
        return Some(v.to_string_lossy().into_owned());
    }
    let sock = PathBuf::from(format!("/run/user/{}/bus", unsafe { libc::getuid() }));
    sock.exists()
        .then(|| format!("unix:path={}", sock.display()))
}

fn toml_str(p: &Path) -> String {
    format!(
        "\"{}\"",
        p.display()
            .to_string()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    )
}

/// Creates the sandbox's folders and writes its Podman configuration (idempotent).
pub fn init(sb: &Sandbox) -> Result<()> {
    for d in [&sb.storage, &sb.home, &sb.conf, &sb.dir.join("bin")] {
        std::fs::create_dir_all(d).with_context(|| format!("create {}", d.display()))?;
    }
    ensure_runtime(sb)?;
    let storage = format!(
        "# dxtutor practice cluster: this course's own rootless Podman storage\n[storage]\ndriver = \"overlay\"\ngraphroot = {s}\nrootless_storage_path = {s}\nrunroot = {r}\n",
        s = toml_str(&sb.storage),
        r = toml_str(&sb.runtime.join("containers")),
    );
    let containers = format!(
        "# dxtutor practice cluster: never the user's containers.conf\n[engine]\ntmp_dir = {t}\nvolume_path = {v}\n[network]\nnetwork_config_dir = {n}\n",
        t = toml_str(&sb.runtime.join("libpod").join("tmp")),
        v = toml_str(&sb.storage.join("volumes")),
        n = toml_str(&sb.storage.join("networks")),
    );
    // Online (preparation only): fully qualified names, nothing else.
    let online = "unqualified-search-registries = []\nshort-name-mode = \"enforcing\"\n";
    // Offline (everything else): the registries the cluster could use are blocked, so a missing
    // image fails at once instead of being downloaded.
    let mut offline = String::from(online);
    for r in [
        "docker.io",
        "registry.k8s.io",
        "registry-1.docker.io",
        "quay.io",
        "ghcr.io",
        "gcr.io",
        "mcr.microsoft.com",
        "public.ecr.aws",
    ] {
        offline.push_str(&format!(
            "\n[[registry]]\nprefix = \"{r}\"\nlocation = \"{r}\"\nblocked = true\n"
        ));
    }
    std::fs::write(sb.conf.join("storage.conf"), storage)?;
    std::fs::write(sb.conf.join("containers.conf"), containers)?;
    std::fs::write(sb.conf.join("registries-online.conf"), online)?;
    std::fs::write(sb.conf.join("registries-offline.conf"), offline)?;
    Ok(())
}

/// The runtime folder (0700) with the folder of the pause process.
pub fn ensure_runtime(sb: &Sandbox) -> Result<()> {
    std::fs::create_dir_all(sb.runtime.join("libpod").join("tmp"))
        .with_context(|| format!("create {}", sb.runtime.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&sb.runtime, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// The environment of every `podman` and `kind` of the sandbox (the command starts from an EMPTY
/// environment). `online` only for the preparation's pulls.
pub fn env(sb: &Sandbox, podman_dir: Option<&Path>, online: bool) -> BTreeMap<String, OsString> {
    let mut path = String::new();
    if let Some(d) = podman_dir {
        path.push_str(&d.display().to_string());
        path.push(':');
    }
    path.push_str("/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin");
    let reg = if online {
        "registries-online.conf"
    } else {
        "registries-offline.conf"
    };
    let mut e: BTreeMap<String, OsString> = BTreeMap::new();
    let mut set = |k: &str, v: OsString| {
        e.insert(k.to_string(), v);
    };
    set("PATH", path.into());
    set("HOME", sb.home.clone().into());
    set("XDG_RUNTIME_DIR", sb.runtime.clone().into());
    set("XDG_CONFIG_HOME", sb.home.join(".config").into());
    set("XDG_DATA_HOME", sb.home.join(".local/share").into());
    set("XDG_CACHE_HOME", sb.home.join(".cache").into());
    set(
        "CONTAINERS_STORAGE_CONF",
        sb.conf.join("storage.conf").into(),
    );
    set("CONTAINERS_CONF", sb.conf.join("containers.conf").into());
    set("CONTAINERS_REGISTRIES_CONF", sb.conf.join(reg).into());
    set("KIND_EXPERIMENTAL_PROVIDER", "podman".into());
    set("KIND_EXPERIMENTAL_PODMAN_NETWORK", super::NETWORK.into());
    set("KUBECONFIG", sb.kubeconfig.clone().into());
    set("LANG", "C.UTF-8".into());
    set("NO_COLOR", "1".into());
    if let Some(bus) = session_bus() {
        set("DBUS_SESSION_BUS_ADDRESS", bus.into());
    }
    if let Ok(tmp) = std::env::var("TMPDIR") {
        set("TMPDIR", tmp.into());
    }
    e
}

/// A `catatonit` of this user whose `XDG_RUNTIME_DIR` is the sandbox's runtime folder.
fn pause_by_environment(sb: &Sandbox) -> Option<i32> {
    let want = format!("XDG_RUNTIME_DIR={}", sb.runtime.display());
    std::fs::read_dir("/proc").ok()?.flatten().find_map(|e| {
        let pid: i32 = e.file_name().to_str()?.parse().ok()?;
        let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).ok()?;
        if comm.trim() != "catatonit" {
            return None;
        }
        let env = std::fs::read(format!("/proc/{pid}/environ")).ok()?;
        env.split(|b| *b == 0)
            .any(|kv| kv == want.as_bytes())
            .then_some(pid)
    })
}

/// Ends the sandbox's pause process (the one that keeps its user namespace), if it runs: after the
/// cluster is deleted nothing of the sandbox stays running. Only a `catatonit` of this user whose
/// pid file is in the sandbox's runtime folder is signalled.
pub fn stop_pause(sb: &Sandbox) -> bool {
    let pid_file = sb.runtime.join("libpod").join("tmp").join("pause.pid");
    let from_file = std::fs::read_to_string(&pid_file)
        .ok()
        .and_then(|s| s.trim().parse::<i32>().ok())
        .filter(|p| *p > 1);
    // Without the pid file (its folder was removed under a running Podman), find the sandbox's
    // pause process by the runtime folder in its environment.
    let Some(pid) = from_file.or_else(|| pause_by_environment(sb)) else {
        return false;
    };
    let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).unwrap_or_default();
    let is_pause = String::from_utf8_lossy(&cmdline)
        .split('\0')
        .next()
        .is_some_and(|a| a.ends_with("catatonit") || a.contains("podman pause"));
    let mine = std::fs::metadata(format!("/proc/{pid}")).is_ok_and(|m| {
        use std::os::unix::fs::MetadataExt;
        m.uid() == unsafe { libc::getuid() }
    });
    if !(is_pause && mine) {
        let _ = std::fs::remove_file(&pid_file);
        return false;
    }
    unsafe {
        libc::kill(pid, libc::SIGTERM);
    }
    for _ in 0..50 {
        if !Path::new(&format!("/proc/{pid}")).exists() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if Path::new(&format!("/proc/{pid}")).exists() {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    let _ = std::fs::remove_file(&pid_file);
    true
}
