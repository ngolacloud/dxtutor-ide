//! The **practice cluster** of the Kubernetes courses (Learn P3b): kind on rootless Podman, in the
//! course's own storage, with its own kubeconfig — never the user's contexts (`~/.kube/config` is
//! never read: every `kind` and `kubectl` gets the sandbox's `KUBECONFIG` and `--kubeconfig`).
//!
//! # What is fixed here, and not by a course
//!
//! - the kind release ([`KIND_VERSION`], one asset per platform with its SHA-256, checked before
//!   the file is used — like the language-server releases of LSP P3);
//! - the node image ([`NODE_IMAGE`], pinned by the digest the kind release publishes for it).
//!
//! A course only lists the images its live steps use (`[build] dependencies`, each pinned by
//! digest, `tutor_core::image_reference`). The approved «Prepare course» downloads all of it once
//! ([`plan_steps`], run by `course_cache::prepare`) into `<course cache>/<course>/cluster/`.
//!
//! # The cluster
//!
//! One per course, `dxtutor-<course>` ([`cluster_name`]), created when a live step is graded (or
//! by «Start practice cluster»), on an INTERNAL Podman network ([`NETWORK`]): the node has no
//! route out, so nothing is downloaded while grading — the step images are loaded from the
//! prepared archive (`kind load image-archive`). It is deleted after [`IDLE_SECS`] without use, by
//! «Delete cluster», and by [`cleanup`] when a run left one behind (only clusters whose name starts
//! with [`CLUSTER_PREFIX`], in a dxtutor sandbox). [`probe`] says whether this machine can run it
//! (Podman, cgroup v2 with the controllers delegated, user namespaces, the user's D-Bus session).

pub mod podman;

use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::runner::run_guarded;

/// The kind release the app downloads.
pub const KIND_VERSION: &str = "v0.33.0";

/// A kind release asset for one platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KindAsset {
    /// `linux-x64`, `linux-arm64` (as `lspinstall::current_platform` names them)
    pub platform: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
}

/// The assets of [`KIND_VERSION`] (checksums from the release's `.sha256sum` files and GitHub's
/// asset digests, which agree).
pub const KIND_ASSETS: &[KindAsset] = &[
    KindAsset {
        platform: "linux-x64",
        url: "https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-amd64",
        sha256: "aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d",
    },
    KindAsset {
        platform: "linux-arm64",
        url: "https://github.com/kubernetes-sigs/kind/releases/download/v0.33.0/kind-linux-arm64",
        sha256: "20022bee6cfcd5086cb7234d218e3454e6090022f2a8f55d1fa7fcf42c3867a2",
    },
];

/// The node image: Kubernetes v1.36.4 (the courses are written against kubectl v1.36), pinned by
/// the digest the kind v0.33.0 release notes publish for it.
pub const NODE_IMAGE: &str = "docker.io/kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed";

/// The internal Podman network the cluster runs on (no route out).
pub const NETWORK: &str = "dxtutor-kind";
/// Every practice cluster's name starts with this.
pub const CLUSTER_PREFIX: &str = "dxtutor-";
/// A cluster unused for this long is deleted.
pub const IDLE_SECS: u64 = 20 * 60;
/// The label of the namespaces grading creates.
pub const GRADING_LABEL: &str = "dxtutor.io/grading";

/// How long `kind create cluster` may take (it waits for the control plane).
const CREATE_TIMEOUT: Duration = Duration::from_secs(300);
const DELETE_TIMEOUT: Duration = Duration::from_secs(120);
const LOAD_TIMEOUT: Duration = Duration::from_secs(300);
const QUICK_TIMEOUT: Duration = Duration::from_secs(60);

/// The kind asset of this machine.
pub fn kind_asset() -> Option<&'static KindAsset> {
    let platform = crate::lspinstall::current_platform();
    KIND_ASSETS.iter().find(|a| a.platform == platform)
}

/// The cluster of course `key`: `dxtutor-<key>` (kind names allow `a-z0-9.-`; long keys are cut
/// and keep a hash so two courses never share a cluster).
pub fn cluster_name(key: &str) -> String {
    let clean: String = key
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let clean = clean.trim_matches('-').to_string();
    if clean.len() <= 32 {
        format!("{CLUSTER_PREFIX}{clean}")
    } else {
        let h = hex(&Sha256::digest(key.as_bytes()));
        format!(
            "{CLUSTER_PREFIX}{}-{}",
            &clean[..24].trim_end_matches('-'),
            &h[..7]
        )
    }
}

/// The kubectl context kind writes for a cluster.
pub fn context_name(cluster: &str) -> String {
    format!("kind-{cluster}")
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// The folders and files of a course's practice cluster.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sandbox {
    /// `<course cache>/<course>/cluster`
    pub dir: PathBuf,
    /// The course cache key (the course id).
    pub key: String,
    /// `dxtutor-<key>`
    pub name: String,
    /// The downloaded and checked kind.
    pub kind_bin: PathBuf,
    /// The step images, saved from the sandbox storage by the preparation.
    pub images: PathBuf,
    /// The sandbox's Podman storage, configuration and home.
    pub storage: PathBuf,
    pub conf: PathBuf,
    pub home: PathBuf,
    /// The sandbox's runtime folder (short and on the user's tmpfs: Podman keeps sockets there).
    pub runtime: PathBuf,
    /// The cluster's kubeconfig (the only one kind and kubectl ever see).
    pub kubeconfig: PathBuf,
    /// Created/used times of the cluster ([`ClusterState`]).
    pub state: PathBuf,
    /// The lock that serialises cluster work across processes (app and `dxt`).
    pub lock: PathBuf,
}

impl Sandbox {
    /// The sandbox of course `key` whose cache folder is `course_dir`.
    pub fn new(course_dir: &Path, key: &str) -> Sandbox {
        let dir = course_dir.join("cluster");
        let podman = dir.join("podman");
        Sandbox {
            key: key.to_string(),
            name: cluster_name(key),
            kind_bin: dir.join("bin").join("kind"),
            images: dir.join("images.tar"),
            storage: podman.join("storage"),
            conf: podman.join("conf"),
            home: podman.join("home"),
            runtime: runtime_dir(&dir),
            kubeconfig: dir.join("kubeconfig"),
            state: dir.join("cluster.json"),
            lock: dir.join("cluster.lock"),
            dir,
        }
    }

    /// What a complete preparation leaves (besides the course cache's marker).
    pub fn prepared(&self) -> bool {
        self.kind_bin.is_file() && self.images.is_file() && self.storage.is_dir()
    }

    pub fn context(&self) -> String {
        context_name(&self.name)
    }

    /// The node container kind creates.
    pub fn node(&self) -> String {
        format!("{}-control-plane", self.name)
    }
}

/// A short runtime folder for the sandbox whose folder is `dir`: under `/run/user/<uid>` (the
/// user's tmpfs, the same whoever starts it — the libpod database remembers the path), else the
/// temporary folder.
fn runtime_dir(dir: &Path) -> PathBuf {
    let uid = unsafe { libc::getuid() };
    let h = hex(&Sha256::digest(dir.display().to_string().as_bytes()));
    let name = format!("dxtutor-kind-{}", &h[..12]);
    let run = PathBuf::from(format!("/run/user/{uid}"));
    let owned = std::fs::metadata(&run).is_ok_and(|m| {
        use std::os::unix::fs::MetadataExt;
        m.is_dir() && m.uid() == uid
    });
    if owned {
        run.join(name)
    } else {
        std::env::temp_dir().join(format!("{name}-{uid}"))
    }
}

// ── Can this machine run it? ─────────────────────────────────────────────────────────────

/// What [`probe`] found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    /// The practice cluster can run here.
    pub ok: bool,
    /// `podman --version`, when Podman is installed.
    pub podman: Option<String>,
    /// Why not (one sentence), when it cannot.
    pub reason: Option<String>,
    /// What to install or change.
    pub fix: Option<String>,
}

/// What to install when Podman is missing.
pub const PODMAN_HINT: &str = "Install Podman 4.9 or newer, rootless (https://podman.io/docs/installation — on Ubuntu: `sudo apt install podman uidmap slirp4netns`), then open the course again. The offline steps of the course grade without it.";

/// The `podman` program: on the PATH, else the usual folders.
pub fn podman_program() -> Option<PathBuf> {
    crate::plugin::find_on_path("podman").or_else(|| {
        ["/usr/bin/podman", "/usr/local/bin/podman"]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
    })
}

fn user_name() -> Option<String> {
    std::env::var("USER")
        .ok()
        .filter(|u| !u.is_empty())
        .or_else(|| {
            let uid = unsafe { libc::getuid() };
            std::fs::read_to_string("/etc/passwd")
                .ok()?
                .lines()
                .find_map(|l| {
                    let f: Vec<&str> = l.split(':').collect();
                    (f.len() > 2 && f[2] == uid.to_string()).then(|| f[0].to_string())
                })
        })
}

/// The facts [`probe`] reads, so the rules are tested without the machine.
#[derive(Debug, Clone, Default)]
pub struct HostFacts {
    pub podman_version: Option<String>,
    pub cgroup2: bool,
    /// The controllers delegated to the user's systemd instance.
    pub delegated: Vec<String>,
    pub max_user_namespaces: Option<u64>,
    pub unprivileged_userns: Option<bool>,
    pub subuid: bool,
    pub session_bus: bool,
}

/// Reads [`HostFacts`] from this machine (files under `/proc`, `/sys`, `/etc`, and `podman
/// --version`; nothing is created).
pub fn host_facts() -> HostFacts {
    let uid = unsafe { libc::getuid() };
    let podman_version = podman_program().and_then(|p| {
        let out = Command::new(p).arg("--version").output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    });
    let delegated = std::fs::read_to_string(format!(
        "/sys/fs/cgroup/user.slice/user-{uid}.slice/user@{uid}.service/cgroup.controllers"
    ))
    .map(|s| s.split_whitespace().map(str::to_string).collect())
    .unwrap_or_default();
    let read_num = |p: &str| {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|s| s.trim().parse::<u64>().ok())
    };
    let subuid = user_name().is_some_and(|name| {
        std::fs::read_to_string("/etc/subuid").is_ok_and(|s| {
            s.lines().any(|l| {
                let first = l.split(':').next().unwrap_or("");
                first == name || first == uid.to_string()
            })
        })
    });
    HostFacts {
        podman_version,
        cgroup2: Path::new("/sys/fs/cgroup/cgroup.controllers").exists(),
        delegated,
        max_user_namespaces: read_num("/proc/sys/user/max_user_namespaces"),
        unprivileged_userns: read_num("/proc/sys/kernel/unprivileged_userns_clone").map(|n| n == 1),
        subuid,
        session_bus: podman::session_bus().is_some(),
    }
}

/// The rule: can a kind cluster run on rootless Podman with these facts?
pub fn support_from(f: &HostFacts) -> Support {
    let no = |reason: &str, fix: &str| Support {
        ok: false,
        podman: f.podman_version.clone(),
        reason: Some(reason.to_string()),
        fix: Some(fix.to_string()),
    };
    if f.podman_version.is_none() {
        return no("Podman is not installed.", PODMAN_HINT);
    }
    if !f.cgroup2 {
        return no(
            "This machine uses cgroup v1; kind on rootless Podman needs cgroup v2.",
            "Boot with the unified cgroup hierarchy (systemd.unified_cgroup_hierarchy=1), as every current distribution does by default.",
        );
    }
    let missing: Vec<&str> = ["cpu", "memory", "pids"]
        .into_iter()
        .filter(|c| !f.delegated.iter().any(|d| d == c))
        .collect();
    if !missing.is_empty() {
        return no(
            &format!(
                "The cgroup controllers {} are not delegated to your user, so a rootless container cannot run a cluster node.",
                missing.join(", ")
            ),
            "Delegate them to user sessions: a drop-in `/etc/systemd/system/user@.service.d/delegate.conf` with `[Service]` `Delegate=cpu cpuset io memory pids`, then log in again (https://kind.sigs.k8s.io/docs/user/rootless/).",
        );
    }
    if f.max_user_namespaces == Some(0) || f.unprivileged_userns == Some(false) {
        return no(
            "User namespaces are disabled, so rootless containers cannot run.",
            "Enable them (`user.max_user_namespaces` above 0, `kernel.unprivileged_userns_clone=1`).",
        );
    }
    if !f.subuid {
        return no(
            "Your user has no subordinate ids in /etc/subuid, which rootless Podman needs.",
            "Add a range, e.g. `sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 $USER`.",
        );
    }
    if !f.session_bus {
        return no(
            "There is no D-Bus session for your user; rootless Podman needs it to delegate cgroups to the cluster node.",
            "Run the app (or `dxt`) inside your desktop or `systemd --user` session.",
        );
    }
    Support {
        ok: true,
        podman: f.podman_version.clone(),
        reason: None,
        fix: None,
    }
}

/// Whether this machine can run the practice cluster.
pub fn probe() -> Support {
    support_from(&host_facts())
}

// ── Preparation (run by `course_cache::prepare`) ─────────────────────────────────────────

/// A file the preparation downloads itself, checked by its SHA-256 before it is kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Download {
    pub url: String,
    pub sha256: String,
    pub dest: PathBuf,
}

/// One command of the preparation: `podman …` in the sandbox, or a [`Download`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub args: Vec<String>,
    pub download: Option<Download>,
    pub network: bool,
}

/// The lines that make the preparation's fingerprint: what is pinned here (kind, node image) and
/// the course's images. Changing a pin makes a prepared course stale.
pub fn pins() -> Vec<String> {
    let mut out = vec![format!("kind {KIND_VERSION}"), format!("node {NODE_IMAGE}")];
    if let Some(a) = kind_asset() {
        out.push(format!("kind-asset {} {}", a.url, a.sha256));
    }
    out
}

/// The preparation of a cluster course: download kind (checked), pull the node image and the
/// step images by digest into the sandbox storage, name them as the manifests do, and save the
/// step images into the archive the cluster loads. `images` are the course's dependency lines.
pub fn plan_steps(sb: &Sandbox, images: &[String]) -> Result<Vec<Step>> {
    let asset = kind_asset().with_context(|| {
        format!(
            "kind {KIND_VERSION} has no release for this machine ({}); the practice cluster runs on linux-x64 and linux-arm64",
            crate::lspinstall::current_platform()
        )
    })?;
    let node = tutor_core::image_reference(NODE_IMAGE).map_err(anyhow::Error::msg)?;
    let mut refs = Vec::new();
    for line in images {
        refs.push(tutor_core::image_reference(line).map_err(anyhow::Error::msg)?);
    }
    let s = |x: &str| x.to_string();
    let mut steps = vec![
        Step {
            args: vec![],
            download: Some(Download {
                url: asset.url.to_string(),
                sha256: asset.sha256.to_string(),
                dest: sb.kind_bin.clone(),
            }),
            network: true,
        },
        Step {
            args: vec![s("pull"), s("--quiet"), node.pinned()],
            download: None,
            network: true,
        },
        Step {
            args: vec![s("tag"), node.pinned(), node.named()],
            download: None,
            network: false,
        },
    ];
    for r in &refs {
        steps.push(Step {
            args: vec![s("pull"), s("--quiet"), r.pinned()],
            download: None,
            network: true,
        });
        steps.push(Step {
            args: vec![s("tag"), r.pinned(), r.named()],
            download: None,
            network: false,
        });
    }
    if !refs.is_empty() {
        let mut save = vec![
            s("save"),
            s("--quiet"),
            s("--multi-image-archive"),
            s("--output"),
            sb.images.display().to_string(),
        ];
        save.extend(refs.iter().map(|r| r.named()));
        steps.push(Step {
            args: save,
            download: None,
            network: false,
        });
    }
    Ok(steps)
}

/// The header of the approval text: what is downloaded, where it goes, and what grading then does.
pub fn plan_header(sb: &Sandbox, images: &[String]) -> String {
    let mut h =
        String::from("# Practice cluster of the course: kind on rootless Podman. Downloads:\n");
    if let Some(a) = kind_asset() {
        h.push_str(&format!(
            "#   kind {KIND_VERSION} ({}) sha256 {}\n",
            a.platform, a.sha256
        ));
    }
    h.push_str(&format!("#   node image {NODE_IMAGE}\n"));
    for i in images {
        h.push_str(&format!("#   {i}\n"));
    }
    h.push_str(&format!(
        "# Podman uses this course's own storage ({}) and runtime folder ({}),\n# never your containers, images or ~/.kube/config.\n",
        sb.storage.display(),
        sb.runtime.display()
    ));
    h.push_str(&format!(
        "# Live steps then create the cluster {} there when graded, on an internal network\n# (it downloads nothing), and delete it after {} min without use.\n",
        sb.name,
        IDLE_SECS / 60
    ));
    h
}

struct Hashing<W: Write> {
    inner: W,
    hash: Sha256,
    len: u64,
}

impl<W: Write> Write for Hashing<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.len + buf.len() as u64 > crate::lspinstall::MAX_DOWNLOAD {
            return Err(std::io::Error::other("the download is too big"));
        }
        let n = self.inner.write(buf)?;
        self.len += n as u64;
        self.hash.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

/// Downloads `d.url` with `fetch`, checks its SHA-256 and only then puts it at `d.dest`
/// (executable). On a mismatch nothing is kept and what was there stays.
pub fn download_checked(d: &Download, fetch: crate::lspinstall::Fetch) -> Result<(), String> {
    let parent = d.dest.parent().ok_or("no folder for the download")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = parent.join(".download.partial");
    let got = {
        let f = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut w = Hashing {
            inner: std::io::BufWriter::new(f),
            hash: Sha256::new(),
            len: 0,
        };
        let r = fetch(&d.url, &mut w).and_then(|_| w.flush().map_err(|e| e.to_string()));
        if let Err(e) = r {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        hex(&w.hash.finalize())
    };
    if got != d.sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "checksum mismatch for {}: expected sha256 {}, got {} — nothing was kept",
            d.url, d.sha256, got
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &d.dest).map_err(|e| e.to_string())
}

/// A sandbox command (`podman` or `kind`) with the sandbox's environment and nothing else.
pub fn command(sb: &Sandbox, program: &Path, args: &[String], online: bool) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args).env_clear().current_dir(&sb.dir);
    let podman_dir = podman_program().and_then(|p| p.parent().map(Path::to_path_buf));
    for (k, v) in podman::env(sb, podman_dir.as_deref(), online) {
        cmd.env(k, v);
    }
    cmd
}

// ── The cluster ──────────────────────────────────────────────────────────────────────────

/// When the cluster was created and last used (s since the epoch), and how long creating took.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterState {
    pub created_at: u64,
    pub last_used: u64,
    pub create_secs: f64,
    pub load_secs: f64,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn read_state(sb: &Sandbox) -> Option<ClusterState> {
    std::fs::read_to_string(&sb.state)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn write_state(sb: &Sandbox, st: &ClusterState) {
    let tmp = sb.state.with_extension("json.tmp");
    if std::fs::write(&tmp, serde_json::to_vec_pretty(st).unwrap_or_default()).is_ok() {
        let _ = std::fs::rename(&tmp, &sb.state);
    }
}

/// Marks the cluster as used now (the idle clock restarts).
pub fn touch(sb: &Sandbox) {
    if let Some(mut st) = read_state(sb) {
        st.last_used = now();
        write_state(sb, &st);
    }
}

/// A cross-process lock on the sandbox (released when dropped).
pub struct Lock {
    _file: std::fs::File,
}

/// Takes the sandbox's lock (waits for another process — the app or `dxt` — to finish).
pub fn lock(sb: &Sandbox) -> Result<Lock> {
    std::fs::create_dir_all(&sb.dir)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&sb.lock)
        .context("open the cluster lock")?;
    use std::os::unix::io::AsRawFd;
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        bail!("cannot lock {}", sb.lock.display());
    }
    Ok(Lock { _file: file })
}

/// The output of a sandbox command.
#[derive(Debug, Clone)]
pub struct Ran {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Runs a sandbox command with a wall-clock limit.
pub fn run(mut cmd: Command, timeout: Duration) -> Result<Ran> {
    let tmp = tempfile::Builder::new()
        .prefix("dxtutor-kind-")
        .tempdir()
        .context("a folder for the command output")?;
    cmd.stdin(std::process::Stdio::null());
    let out = run_guarded(cmd, tmp.path(), "kind", timeout, None)?;
    Ok(Ran {
        ok: !out.timed_out && out.status.map(|s| s.success()).unwrap_or(false),
        stdout: out.stdout,
        stderr: out.stderr,
        timed_out: out.timed_out,
    })
}

fn podman_cmd(sb: &Sandbox, args: &[&str]) -> Result<Command> {
    let p = podman_program().context(PODMAN_HINT)?;
    let args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    Ok(command(sb, &p, &args, false))
}

fn kind_cmd(sb: &Sandbox, args: &[String]) -> Command {
    command(sb, &sb.kind_bin, args, false)
}

/// The kind clusters in the sandbox (`kind get clusters`).
pub fn clusters(sb: &Sandbox) -> Result<Vec<String>> {
    if !sb.kind_bin.is_file() || !sb.storage.is_dir() {
        return Ok(Vec::new());
    }
    podman::ensure_runtime(sb)?;
    let r = run(
        kind_cmd(sb, &["get".into(), "clusters".into()]),
        QUICK_TIMEOUT,
    )?;
    if !r.ok {
        bail!("kind get clusters failed: {}", r.stderr.trim());
    }
    Ok(r.stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect())
}

fn node_running(sb: &Sandbox) -> bool {
    podman_cmd(
        sb,
        &["inspect", "--format", "{{.State.Running}}", &sb.node()],
    )
    .ok()
    .and_then(|c| run(c, QUICK_TIMEOUT).ok())
    .is_some_and(|r| r.ok && r.stdout.trim() == "true")
}

/// The memory the node container uses now (bytes): its cgroup's `memory.current` minus the page
/// cache it could drop (`inactive_file`), the "working set" `kubectl top` and `docker stats` show.
pub fn memory_bytes(sb: &Sandbox) -> Option<u64> {
    let r = run(
        podman_cmd(
            sb,
            &["inspect", "--format", "{{.State.CgroupPath}}", &sb.node()],
        )
        .ok()?,
        QUICK_TIMEOUT,
    )
    .ok()?;
    let cg = r.stdout.trim();
    if !r.ok || cg.is_empty() {
        return None;
    }
    let dir = format!("/sys/fs/cgroup/{}", cg.trim_start_matches('/'));
    let current: u64 = std::fs::read_to_string(format!("{dir}/memory.current"))
        .ok()?
        .trim()
        .parse()
        .ok()?;
    let inactive: u64 = std::fs::read_to_string(format!("{dir}/memory.stat"))
        .ok()
        .and_then(|st| {
            st.lines()
                .find_map(|l| l.strip_prefix("inactive_file "))
                .and_then(|v| v.trim().parse().ok())
        })
        .unwrap_or(0);
    Some(current.saturating_sub(inactive))
}

/// What the Learning Track shows about a course's cluster.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterStatus {
    pub name: String,
    /// The course was prepared (kind, node image and step images are there).
    pub prepared: bool,
    /// The cluster exists in the sandbox.
    pub exists: bool,
    /// Its node container runs.
    pub running: bool,
    pub created_at: Option<u64>,
    pub last_used: Option<u64>,
    pub create_secs: Option<f64>,
    /// Bytes the node uses now.
    pub memory_bytes: Option<u64>,
    /// When it is deleted if nobody uses it (s since the epoch).
    pub idle_deadline: Option<u64>,
}

/// The status of the course's cluster (reads only; no cluster is created).
pub fn status(sb: &Sandbox) -> Result<ClusterStatus> {
    let prepared = sb.prepared();
    let exists = prepared && clusters(sb)?.contains(&sb.name);
    let running = exists && node_running(sb);
    let st = read_state(sb).filter(|_| exists);
    Ok(ClusterStatus {
        name: sb.name.clone(),
        prepared,
        exists,
        running,
        created_at: st.as_ref().map(|s| s.created_at),
        last_used: st.as_ref().map(|s| s.last_used),
        create_secs: st.as_ref().map(|s| s.create_secs),
        memory_bytes: if running { memory_bytes(sb) } else { None },
        idle_deadline: st.as_ref().map(|s| s.last_used + IDLE_SECS),
    })
}

/// What [`ensure`] did.
#[derive(Debug, Clone, PartialEq)]
pub struct Ensured {
    /// The cluster was created now (else it was reused).
    pub created: bool,
    pub create_secs: f64,
    pub load_secs: f64,
}

/// The kubectl of the practice cluster: the host's `kubectl`, with the sandbox's kubeconfig and
/// context and nothing of the user's (`HOME` is the sandbox's, so `~/.kube` is never read).
pub fn kubectl(sb: &Sandbox, kubectl: &Path, namespace: Option<&str>, args: &[String]) -> Command {
    let mut cmd = Command::new(kubectl);
    cmd.env_clear()
        .current_dir(&sb.dir)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("HOME", &sb.home)
        .env("KUBECONFIG", &sb.kubeconfig)
        .env("KUBECACHEDIR", sb.home.join(".kube-cache"))
        .env("LANG", "C")
        .env("NO_COLOR", "1")
        .arg("--kubeconfig")
        .arg(&sb.kubeconfig)
        .arg("--context")
        .arg(sb.context());
    if let Some(ns) = namespace {
        cmd.arg("--namespace").arg(ns);
    }
    cmd.args(args);
    cmd
}

fn api_ready(sb: &Sandbox, kubectl_bin: &Path) -> bool {
    sb.kubeconfig.is_file()
        && run(
            kubectl(
                sb,
                kubectl_bin,
                None,
                &["get".into(), "--raw".into(), "/readyz".into()],
            ),
            Duration::from_secs(20),
        )
        .is_ok_and(|r| r.ok)
}

fn ensure_network(sb: &Sandbox) -> Result<()> {
    let exists = run(
        podman_cmd(sb, &["network", "exists", NETWORK])?,
        QUICK_TIMEOUT,
    )?;
    if exists.ok {
        return Ok(());
    }
    let r = run(
        podman_cmd(
            sb,
            &[
                "network",
                "create",
                "--internal",
                "--label",
                podman::LABEL,
                NETWORK,
            ],
        )?,
        QUICK_TIMEOUT,
    )?;
    if !r.ok {
        bail!("podman network create failed: {}", r.stderr.trim());
    }
    Ok(())
}

/// The cluster of the sandbox, running and ready: reused when it answers, else (re)created and
/// given the step images. The caller holds [`lock`]. `kubectl_bin` checks the API server.
pub fn ensure(sb: &Sandbox, kubectl_bin: &Path) -> Result<Ensured> {
    if !sb.prepared() {
        bail!(
            "{}",
            crate::course_cache::not_prepared_message(&sb.key, false)
        );
    }
    let support = probe();
    if !support.ok {
        bail!(
            "{LIVE_UNAVAILABLE}: {} {}",
            support.reason.unwrap_or_default(),
            support.fix.unwrap_or_default()
        );
    }
    podman::init(sb)?;
    let existing = clusters(sb)?;
    if existing.contains(&sb.name) {
        if node_running(sb) && api_ready(sb, kubectl_bin) {
            touch(sb);
            return Ok(Ensured {
                created: false,
                create_secs: 0.0,
                load_secs: 0.0,
            });
        }
        // Stopped or broken (a reboot, a crash): start over.
        delete_cluster(sb)?;
        podman::init(sb)?;
    }
    ensure_network(sb)?;
    let _ = std::fs::remove_file(&sb.kubeconfig);
    let t0 = Instant::now();
    let r = run(
        kind_cmd(
            sb,
            &[
                "create".into(),
                "cluster".into(),
                "--name".into(),
                sb.name.clone(),
                "--image".into(),
                NODE_IMAGE.into(),
                "--kubeconfig".into(),
                sb.kubeconfig.display().to_string(),
                "--wait".into(),
                "180s".into(),
            ],
        ),
        CREATE_TIMEOUT,
    )?;
    let create_secs = t0.elapsed().as_secs_f64();
    if !r.ok {
        let why = format!(
            "kind create cluster failed{}: {}",
            if r.timed_out { " (timed out)" } else { "" },
            tail(&format!("{}\n{}", r.stdout, r.stderr), 1500)
        );
        let _ = delete_cluster(sb);
        bail!("{why}");
    }
    let t1 = Instant::now();
    if sb.images.is_file() {
        let r = run(
            kind_cmd(
                sb,
                &[
                    "load".into(),
                    "image-archive".into(),
                    sb.images.display().to_string(),
                    "--name".into(),
                    sb.name.clone(),
                ],
            ),
            LOAD_TIMEOUT,
        )?;
        if !r.ok {
            let why = format!(
                "kind load image-archive failed: {}",
                tail(&format!("{}\n{}", r.stdout, r.stderr), 1500)
            );
            let _ = delete_cluster(sb);
            bail!("{why}");
        }
    }
    let load_secs = t1.elapsed().as_secs_f64();
    let t = now();
    write_state(
        sb,
        &ClusterState {
            created_at: t,
            last_used: t,
            create_secs,
            load_secs,
        },
    );
    Ok(Ensured {
        created: true,
        create_secs,
        load_secs,
    })
}

/// The prefix of the error when the practice cluster cannot run on this machine (the offline
/// steps still grade; `dxt plugin test` skips the live ones with this message).
pub const LIVE_UNAVAILABLE: &str = "LIVE_UNAVAILABLE";

fn tail(s: &str, n: usize) -> String {
    let s = s.trim();
    let count = s.chars().count();
    if count <= n {
        s.to_string()
    } else {
        format!("…{}", s.chars().skip(count - n).collect::<String>())
    }
}

/// What [`delete_cluster`] did.
#[derive(Debug, Clone, PartialEq)]
pub struct Deleted {
    pub existed: bool,
    pub secs: f64,
}

/// Deletes the course's cluster (if it exists), its kubeconfig and network, and stops the
/// sandbox's pause process: nothing of the sandbox keeps running. The images stay prepared. The
/// caller holds [`lock`].
pub fn delete_cluster(sb: &Sandbox) -> Result<Deleted> {
    let t0 = Instant::now();
    if !sb.kind_bin.is_file() || !sb.storage.is_dir() {
        let _ = std::fs::remove_file(&sb.kubeconfig);
        return Ok(Deleted {
            existed: false,
            secs: 0.0,
        });
    }
    podman::init(sb)?;
    let existed = clusters(sb)?.contains(&sb.name);
    if existed {
        let r = run(
            kind_cmd(
                sb,
                &[
                    "delete".into(),
                    "cluster".into(),
                    "--name".into(),
                    sb.name.clone(),
                    "--kubeconfig".into(),
                    sb.kubeconfig.display().to_string(),
                ],
            ),
            DELETE_TIMEOUT,
        )?;
        if !r.ok {
            bail!(
                "kind delete cluster failed: {}",
                tail(&format!("{}\n{}", r.stdout, r.stderr), 1500)
            );
        }
    }
    if existed && sb.name == cluster_name(&sb.key) {
        let _ = std::fs::remove_file(&sb.state);
    }
    // When no cluster is left in the sandbox: its kubeconfig, network and pause process go too.
    if clusters(sb).map(|c| c.is_empty()).unwrap_or(false) {
        let _ = std::fs::remove_file(&sb.kubeconfig);
        let _ = std::fs::remove_file(&sb.state);
        if let Ok(r) = run(podman_cmd(sb, &["ps", "--all", "--quiet"])?, QUICK_TIMEOUT) {
            if r.ok && r.stdout.trim().is_empty() {
                let _ = run(
                    podman_cmd(sb, &["network", "rm", "--force", NETWORK])?,
                    QUICK_TIMEOUT,
                );
            }
        }
        podman::stop_pause(sb);
        let _ = std::fs::remove_dir_all(&sb.runtime);
    }
    Ok(Deleted {
        existed,
        secs: t0.elapsed().as_secs_f64(),
    })
}

/// The cluster sandboxes under the course cache root (one per prepared cluster course).
pub fn sandboxes(root: &Path) -> Vec<Sandbox> {
    let Ok(rd) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut out: Vec<Sandbox> = rd
        .flatten()
        .filter(|e| e.path().join("cluster").join("podman").is_dir())
        .filter_map(|e| {
            let key = e.file_name().to_string_lossy().into_owned();
            crate::course_cache::key_ok(&key).then(|| Sandbox::new(&e.path(), &key))
        })
        .collect();
    out.sort_by(|a, b| a.key.cmp(&b.key));
    out
}

/// A practice cluster that should not be there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Leftover {
    pub course: String,
    pub cluster: String,
}

/// Whether Podman may have something of the sandbox alive: a cluster was created and not deleted
/// (its state file), or Podman ran since (its runtime folder). Otherwise nothing is asked — the
/// reaper must not start Podman every minute.
fn maybe_active(sb: &Sandbox) -> bool {
    sb.state.exists() || sb.runtime.exists()
}

/// The stale clusters of one sandbox: names with [`CLUSTER_PREFIX`] that are not the course's own
/// (a renamed course), or the course's own unused for `max_idle` (or with no record of use).
fn stale_in(sb: &Sandbox, names: &[String], max_idle: Duration) -> Vec<String> {
    let t = now();
    names
        .iter()
        .filter(|n| n.starts_with(CLUSTER_PREFIX))
        .filter(|n| {
            **n != sb.name || read_state(sb).is_none_or(|s| s.last_used + max_idle.as_secs() <= t)
        })
        .cloned()
        .collect()
}

/// The [`Leftover`]s under the course cache `root` (reads only).
pub fn leftovers(root: &Path, max_idle: Duration) -> Vec<Leftover> {
    let mut out = Vec::new();
    for sb in sandboxes(root).into_iter().filter(maybe_active) {
        let Ok(names) = clusters(&sb) else { continue };
        for cluster in stale_in(&sb, &names, max_idle) {
            out.push(Leftover {
                course: sb.key.clone(),
                cluster,
            });
        }
    }
    out
}

/// Deletes the stale clusters under `root` (see [`leftovers`]) and returns them. Each sandbox is
/// locked while it is cleaned, so a grading in progress is never cut. A sandbox left without
/// clusters also loses its Podman pause process and runtime folder: nothing keeps running.
pub fn cleanup(root: &Path, max_idle: Duration) -> Vec<Leftover> {
    let mut done = Vec::new();
    for sb in sandboxes(root).into_iter().filter(maybe_active) {
        let Ok(_guard) = lock(&sb) else { continue };
        let Ok(names) = clusters(&sb) else { continue };
        for cluster in stale_in(&sb, &names, max_idle) {
            let mut target = sb.clone();
            target.name = cluster.clone();
            if delete_cluster(&target).is_ok() {
                done.push(Leftover {
                    course: sb.key.clone(),
                    cluster,
                });
            }
        }
        if clusters(&sb).is_ok_and(|c| c.is_empty()) {
            let _ = std::fs::remove_file(&sb.state);
            podman::stop_pause(&sb);
            let _ = std::fs::remove_dir_all(&sb.runtime);
        }
    }
    done
}

/// The texts the approval dialog shows for «Start practice cluster» and «Delete cluster»: the
/// exact commands (the Podman environment is the sandbox's, described by the preparation).
pub fn start_command_text(sb: &Sandbox) -> String {
    format!(
        "podman network create --internal --label {} {NETWORK}\nkind create cluster --name {} --image {NODE_IMAGE} --kubeconfig {} --wait 180s\nkind load image-archive {} --name {}",
        podman::LABEL,
        sb.name,
        sb.kubeconfig.display(),
        sb.images.display(),
        sb.name
    )
}

pub fn delete_command_text(sb: &Sandbox) -> String {
    format!(
        "kind delete cluster --name {} --kubeconfig {}\npodman network rm --force {NETWORK}",
        sb.name,
        sb.kubeconfig.display()
    )
}

/// A grading namespace name: `dxt-<step>-<random>` (DNS label, ≤ 63).
pub fn namespace_for(step: &str) -> String {
    let slug: String = step
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug: String = slug.trim_matches('-').chars().take(40).collect();
    let mut seed = [0u8; 8];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let h = Sha256::digest(format!("{nanos}-{}-{step}", std::process::id()).as_bytes());
    seed.copy_from_slice(&h[..8]);
    format!("dxt-{}-{}", slug.trim_end_matches('-'), &hex(&seed)[..6])
}

/// The environment, for the report: kind version, node image, Podman.
pub fn versions(sb: &Sandbox) -> BTreeMap<&'static str, String> {
    let mut v = BTreeMap::new();
    v.insert("kind", KIND_VERSION.to_string());
    v.insert("node", NODE_IMAGE.to_string());
    if sb.kind_bin.is_file() {
        if let Ok(r) = run(kind_cmd(sb, &["version".into()]), QUICK_TIMEOUT) {
            if r.ok {
                v.insert("kind", r.stdout.trim().to_string());
            }
        }
    }
    if let Some(p) = probe().podman {
        v.insert("podman", p);
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> HostFacts {
        HostFacts {
            podman_version: Some("podman version 4.9.3".into()),
            cgroup2: true,
            delegated: vec!["cpu".into(), "memory".into(), "pids".into()],
            max_user_namespaces: Some(100),
            unprivileged_userns: Some(true),
            subuid: true,
            session_bus: true,
        }
    }

    #[test]
    fn the_sandbox_cannot_run_without_podman_cgroup2_delegation_userns_or_dbus() {
        assert!(support_from(&facts()).ok);
        let cases: Vec<(Box<dyn Fn(&mut HostFacts)>, &str)> = vec![
            (
                Box::new(|f| f.podman_version = None),
                "Podman is not installed",
            ),
            (Box::new(|f| f.cgroup2 = false), "cgroup v1"),
            (
                Box::new(|f| f.delegated = vec!["cpu".into()]),
                "memory, pids are not delegated",
            ),
            (
                Box::new(|f| f.max_user_namespaces = Some(0)),
                "User namespaces are disabled",
            ),
            (
                Box::new(|f| f.unprivileged_userns = Some(false)),
                "User namespaces are disabled",
            ),
            (Box::new(|f| f.subuid = false), "subordinate ids"),
            (Box::new(|f| f.session_bus = false), "D-Bus session"),
        ];
        for (change, want) in cases {
            let mut f = facts();
            change(&mut f);
            let s = support_from(&f);
            assert!(!s.ok);
            let reason = s.reason.unwrap();
            assert!(reason.contains(want), "{reason}");
            assert!(s.fix.is_some_and(|x| !x.is_empty()));
        }
        assert!(support_from(&HostFacts {
            podman_version: None,
            ..facts()
        })
        .fix
        .unwrap()
        .contains("podman.io"));
    }

    #[test]
    fn names_are_kind_names_with_the_prefix() {
        assert_eq!(
            cluster_name("kubernetes-basics"),
            "dxtutor-kubernetes-basics"
        );
        assert_eq!(cluster_name("a_b.c"), "dxtutor-a-b-c");
        let long = cluster_name("a-very-long-course-identifier-that-goes-on-and-on");
        assert!(
            long.starts_with("dxtutor-a-very-long-course-id") && long.len() <= 40,
            "{long}"
        );
        assert_ne!(
            long,
            cluster_name("a-very-long-course-identifier-that-goes-on-and-on-2")
        );
        assert_eq!(context_name("dxtutor-k"), "kind-dxtutor-k");
        let ns = namespace_for("k8s-p12-Rollout_Web");
        assert!(
            ns.starts_with("dxt-k8s-p12-rollout-web-") && ns.len() <= 63,
            "{ns}"
        );
        assert_ne!(ns, namespace_for("k8s-p12-Rollout_Web"));
    }

    #[test]
    fn the_sandbox_lives_in_the_course_cache_and_a_short_runtime_folder() {
        let sb = Sandbox::new(
            Path::new("/data/course-cache/kubernetes-basics"),
            "kubernetes-basics",
        );
        assert_eq!(
            sb.dir,
            Path::new("/data/course-cache/kubernetes-basics/cluster")
        );
        assert!(sb.storage.starts_with(&sb.dir) && sb.kubeconfig.starts_with(&sb.dir));
        assert!(!sb
            .kubeconfig
            .starts_with(dirs::home_dir().unwrap_or_default().join(".kube")));
        assert!(
            sb.runtime.display().to_string().len() < 60,
            "{}",
            sb.runtime.display()
        );
        assert_eq!(sb.node(), "dxtutor-kubernetes-basics-control-plane");
        assert_eq!(sb.context(), "kind-dxtutor-kubernetes-basics");
        assert!(!sb.prepared());
    }

    #[test]
    fn the_plan_downloads_kind_checked_and_pulls_every_image_by_digest() {
        let sb = Sandbox::new(Path::new("/c/k"), "k");
        let img = "docker.io/library/nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10".to_string();
        let Ok(steps) = plan_steps(&sb, std::slice::from_ref(&img)) else {
            assert!(
                kind_asset().is_none(),
                "only fails on a platform without a release"
            );
            return;
        };
        let d = steps[0].download.as_ref().expect("first, kind");
        assert!(d.url.contains(KIND_VERSION) && d.sha256.len() == 64 && d.dest == sb.kind_bin);
        let words: Vec<String> = steps.iter().skip(1).map(|s| s.args.join(" ")).collect();
        assert_eq!(
            words,
            [
                "pull --quiet docker.io/kindest/node@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed",
                "tag docker.io/kindest/node@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed docker.io/kindest/node:v1.36.4",
                "pull --quiet docker.io/library/nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10",
                "tag docker.io/library/nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 docker.io/library/nginx:1.27.5-alpine",
                "save --quiet --multi-image-archive --output /c/k/cluster/images.tar docker.io/library/nginx:1.27.5-alpine",
            ]
        );
        let network: Vec<bool> = steps.iter().map(|s| s.network).collect();
        assert_eq!(network, [true, true, false, true, false, false]);
        assert!(plan_steps(&sb, &["nginx:1".into()]).is_err());
        let h = plan_header(&sb, &[img]);
        assert!(
            h.contains("never your containers")
                && h.contains(NODE_IMAGE)
                && h.contains("internal network")
        );
    }

    #[test]
    fn a_download_is_kept_only_when_its_checksum_matches() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("bin/kind");
        let body = b"#!/bin/sh\necho kind\n".to_vec();
        let sum = hex(&Sha256::digest(&body));
        let fetch = |_: &str, w: &mut dyn Write| w.write_all(&body).map_err(|e| e.to_string());
        let bad = Download {
            url: "https://example.org/kind".into(),
            sha256: "0".repeat(64),
            dest: dest.clone(),
        };
        let e = download_checked(&bad, &fetch).unwrap_err();
        assert!(e.contains("checksum mismatch") && !dest.exists(), "{e}");
        let good = Download { sha256: sum, ..bad };
        download_checked(&good, &fetch).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&dest).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert!(!tmp.path().join("bin/.download.partial").exists());
    }

    #[test]
    fn the_podman_environment_is_the_sandboxs_own() {
        let sb = Sandbox::new(Path::new("/c/k"), "k");
        let e = podman::env(&sb, Some(Path::new("/opt/podman/bin")), false);
        let get = |k: &str| {
            e.get(k)
                .map(|v| v.to_string_lossy().into_owned())
                .unwrap_or_default()
        };
        assert_eq!(get("HOME"), "/c/k/cluster/podman/home");
        assert_eq!(
            get("CONTAINERS_STORAGE_CONF"),
            "/c/k/cluster/podman/conf/storage.conf"
        );
        assert!(get("CONTAINERS_REGISTRIES_CONF").ends_with("registries-offline.conf"));
        assert_eq!(get("KUBECONFIG"), "/c/k/cluster/kubeconfig");
        assert_eq!(get("KIND_EXPERIMENTAL_PROVIDER"), "podman");
        assert_eq!(get("KIND_EXPERIMENTAL_PODMAN_NETWORK"), NETWORK);
        assert_eq!(get("XDG_RUNTIME_DIR"), sb.runtime.display().to_string());
        assert!(get("PATH").starts_with("/opt/podman/bin:"));
        let online = podman::env(&sb, None, true);
        assert!(online["CONTAINERS_REGISTRIES_CONF"]
            .to_string_lossy()
            .ends_with("registries-online.conf"));

        let tmp = tempfile::tempdir().unwrap();
        let sb = Sandbox::new(tmp.path(), "k");
        podman::init(&sb).unwrap();
        let storage = std::fs::read_to_string(sb.conf.join("storage.conf")).unwrap();
        assert!(
            storage.contains("rootless_storage_path")
                && storage.contains(&sb.storage.display().to_string())
        );
        let offline = std::fs::read_to_string(sb.conf.join("registries-offline.conf")).unwrap();
        assert!(offline.contains("prefix = \"docker.io\"") && offline.contains("blocked = true"));
        let _ = std::fs::remove_dir_all(&sb.runtime);
    }
}
