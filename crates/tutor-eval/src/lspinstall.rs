//! Installing language servers from the registry's recipes (LSP P3).
//!
//! The registry (`languages/registry.json`, [`crate::langreg`]) says, per server, how it may be
//! installed (`recipes`: npm, pip, pipx, go, cargo, dotnet, gem, rustup, brew, apt, a GitHub
//! release). This module turns them into the EXACT commands — the UI never sends one — like
//! `git_clone_plan` does for a clone:
//!
//! - [`plan`] (read-only): every recipe of the server as an [`InstallOption`] — the command line,
//!   where it lands, whether the package manager is on the login shell's PATH. Only recipes of the
//!   TRUSTED registry (bundled + the user's `lsp.json`) are offered, never a project file's.
//! - User-space managers install into dxtutor's own folder, `<app data>/lsp-servers/<server>/`
//!   (like mason): npm `--global --prefix`, a Python venv, pipx/go/gem/dotnet/cargo with their
//!   folder flags. `rustup` adds a toolchain component. The UI runs these in a terminal task.
//! - `brew` and `apt` are system managers (apt needs sudo): the command is shown for the human to
//!   run; dxtutor never runs it.
//! - `github`: dxtutor downloads the pinned asset itself ([`install_release`]), checks its SHA-256
//!   BEFORE unpacking anything, and refuses on a mismatch.
//! - [`managed_program`]: where `lsp.rs::resolve_server` looks first.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::langreg::{Asset, Recipe, Registry, Server};

/// The folder (inside the app's local data folder) that holds one folder per installed server.
pub const INSTALL_DIR: &str = "lsp-servers";

/// The note a release install leaves in its folder: where the program is.
pub const MANIFEST: &str = "dxtutor-install.json";

/// A release is at most this big (a download that goes on is cut and thrown away).
pub const MAX_DOWNLOAD: u64 = 1024 * 1024 * 1024;

/// How a recipe runs.
pub const MODE_TERMINAL: &str = "terminal";
pub const MODE_DOWNLOAD: &str = "download";
pub const MODE_MANUAL: &str = "manual";

/// One way to install a server, built from a recipe for this machine.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallOption {
    /// the option's id: the manager (one recipe per manager)
    pub id: String,
    pub manager: String,
    /// [`MODE_TERMINAL`] (dxtutor runs `command` in a terminal task), [`MODE_DOWNLOAD`] (dxtutor
    /// downloads and checks the asset itself) or [`MODE_MANUAL`] (the human runs `command`)
    pub mode: String,
    /// the manager is there (and, for a release, there is an asset for this platform)
    pub available: bool,
    /// why not: the program that was not found (`npm`, `python3`, `tar`…) or `platform`
    pub missing: Option<String>,
    /// the exact command line (POSIX shell quoting); for a release, what dxtutor will do
    pub command: String,
    /// the same command, one argv per step (empty for a release)
    pub steps: Vec<Vec<String>>,
    /// where the terminal task runs
    pub cwd: String,
    /// the environment the terminal task needs (the login shell's PATH, so the manager finds its
    /// runtime: npm's node, pip's python)
    pub env: BTreeMap<String, String>,
    /// where it lands: a folder, `toolchain` (rustup) or `system` (brew, apt)
    pub target: String,
    pub packages: Vec<String>,
    /// a release: the asset's URL and checksum
    pub url: Option<String>,
    pub sha256: Option<String>,
}

/// Every way to install a server on this machine.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPlan {
    pub server: String,
    pub label: String,
    pub name: String,
    /// `<app data>/lsp-servers/<server>`: where user-space installs land
    pub dir: String,
    /// this machine (`linux-x64`, …)
    pub platform: String,
    pub options: Vec<InstallOption>,
    /// the option the notice proposes: the first available that dxtutor can run, else the first
    /// available the human runs
    pub recommended: Option<String>,
    /// the registry's hand-install hint (`install`)
    pub manual: Option<String>,
    /// why no recipe is offered: `project` (the server, or how it starts, comes from the project's
    /// `.dxtutor/lsp.json`), `command` (your `lsp.json` runs another program than the recipes
    /// install)
    pub withheld: Option<String>,
}

/// What [`plan`] needs to know about the machine.
pub struct PlanCtx<'a> {
    /// `<app data>/lsp-servers`
    pub managed: &'a Path,
    /// [`current_platform`] (a test passes another)
    pub platform: &'a str,
    pub home: Option<&'a Path>,
    /// the login shell's PATH (`shellenv`): where the managers are looked for, and the PATH the
    /// terminal task gets
    pub path: &'a OsStr,
}

/// This machine as the release assets name it (`linux-x64`, `darwin-arm64`, …).
pub fn current_platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        o => o,
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        a => a,
    };
    format!("{os}-{arch}")
}

/// `program` on `path` (a file).
pub fn find_on(path: &OsStr, program: &str) -> Option<PathBuf> {
    std::env::split_paths(path)
        .filter(|d| !d.as_os_str().is_empty())
        .map(|d| d.join(program))
        .find(|p| p.is_file())
}

/// The program a manager runs, and where else it may live.
fn manager_program(manager: &str) -> Option<&'static str> {
    Some(match manager {
        "npm" => "npm",
        "pip" => "python3",
        "pipx" => "pipx",
        "go" => "go",
        "cargo" => "cargo",
        "dotnet" => "dotnet",
        "gem" => "gem",
        "rustup" => "rustup",
        "brew" => "brew",
        "apt" => "apt-get",
        _ => return None,
    })
}

fn find_manager(ctx: &PlanCtx, manager: &str) -> Option<PathBuf> {
    let program = manager_program(manager)?;
    find_on(ctx.path, program).or_else(|| {
        // the usual homes of rustup and a per-user .NET, when the login PATH lacks them
        let rel = match manager {
            "rustup" | "cargo" => format!(".cargo/bin/{program}"),
            "dotnet" => ".dotnet/dotnet".to_string(),
            _ => return None,
        };
        let p = ctx.home?.join(rel);
        p.is_file().then_some(p)
    })
}

fn mode_of(manager: &str) -> &'static str {
    match manager {
        "brew" | "apt" => MODE_MANUAL,
        "github" => MODE_DOWNLOAD,
        _ => MODE_TERMINAL,
    }
}

/// `s` quoted for a POSIX shell only when it needs it (`'…'`, a `'` inside as `'\''`).
pub fn sh_quote(s: &str) -> String {
    let plain = !s.is_empty()
        && s.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '/' | '.' | '_' | '-' | '@' | ':' | '=' | '+' | ',' | '%')
        });
    if plain {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Steps as one shell line: each argv quoted, the steps joined with `&&`.
pub fn command_line(steps: &[Vec<String>]) -> String {
    steps
        .iter()
        .map(|argv| {
            argv.iter()
                .map(|a| sh_quote(a))
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join(" && ")
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// The argv of each step of a user-space or system recipe (`prog` = the manager found, or its
/// bare name for a system manager the human runs).
fn steps_of(r: &Recipe, dir: &Path, prog: &str, env: &str) -> Vec<Vec<String>> {
    let pk = r.packages.clone();
    let with_version = |mut v: Vec<String>| {
        if let Some(ver) = &r.version {
            v.push("--version".into());
            v.push(ver.clone());
        }
        v
    };
    let argv = |head: &[&str], tail: Vec<String>| -> Vec<String> {
        head.iter().map(|x| x.to_string()).chain(tail).collect()
    };
    match r.manager.as_str() {
        "npm" => vec![argv(
            &[prog, "install", "--global", "--prefix", &s(dir)],
            pk,
        )],
        "pip" => {
            let venv = dir.join("venv");
            let py = venv.join("bin").join("python");
            vec![
                argv(&[prog, "-m", "venv", &s(&venv)], vec![]),
                argv(&[&s(&py), "-m", "pip", "install"], pk),
            ]
        }
        "pipx" => vec![argv(
            &[
                env,
                &format!("PIPX_HOME={}", s(&dir.join("pipx"))),
                &format!("PIPX_BIN_DIR={}", s(&dir.join("bin"))),
                &format!("PIPX_MAN_DIR={}", s(&dir.join("man"))),
                prog,
                "install",
            ],
            pk,
        )],
        "go" => vec![argv(
            &[
                env,
                &format!("GOBIN={}", s(&dir.join("bin"))),
                prog,
                "install",
            ],
            pk,
        )],
        "cargo" => vec![with_version(argv(
            &[prog, "install", "--locked", "--root", &s(dir)],
            pk,
        ))],
        "dotnet" => vec![with_version(argv(
            &[prog, "tool", "install", "--tool-path", &s(&dir.join("bin"))],
            pk,
        ))],
        "gem" => vec![with_version(argv(
            &[
                prog,
                "install",
                "--no-document",
                "--install-dir",
                &s(&dir.join("gems")),
                "--bindir",
                &s(&dir.join("bin")),
            ],
            pk,
        ))],
        "rustup" => vec![argv(&[prog, "component", "add"], pk)],
        "brew" => vec![argv(&["brew", "install"], pk)],
        "apt" => vec![argv(&["sudo", "apt-get", "install"], pk)],
        _ => Vec::new(),
    }
}

/// One recipe as an option for this machine.
fn option_of(r: &Recipe, dir: &Path, ctx: &PlanCtx) -> InstallOption {
    let mode = mode_of(&r.manager);
    let cwd = ctx.home.map(s).unwrap_or_else(|| s(ctx.managed));
    let mut env = BTreeMap::new();
    let mut opt = InstallOption {
        id: r.manager.clone(),
        manager: r.manager.clone(),
        mode: mode.to_string(),
        available: false,
        missing: None,
        command: String::new(),
        steps: Vec::new(),
        cwd,
        env: BTreeMap::new(),
        target: s(dir),
        packages: r.packages.clone(),
        url: None,
        sha256: None,
    };
    match mode {
        MODE_DOWNLOAD => {
            match r.asset_for(ctx.platform) {
                None => opt.missing = Some("platform".into()),
                Some(a) => {
                    opt.url = Some(a.url.clone());
                    opt.sha256 = Some(a.sha256.clone());
                    opt.command = format!(
                        "download {}\ncheck    sha256 {}\nunpack   into {}",
                        a.url,
                        a.sha256,
                        s(dir)
                    );
                    if a.archive == "tar.gz" && find_on(ctx.path, "tar").is_none() {
                        opt.missing = Some("tar".into());
                    }
                }
            }
            opt.available = opt.missing.is_none();
        }
        MODE_MANUAL => {
            let found = find_manager(ctx, &r.manager);
            opt.available = found.is_some();
            opt.missing = found
                .is_none()
                .then(|| manager_program(&r.manager).unwrap_or_default().to_string());
            opt.target = "system".into();
            opt.steps = steps_of(r, dir, "", "env");
            opt.command = command_line(&opt.steps);
        }
        _ => {
            let found = find_manager(ctx, &r.manager);
            let program = manager_program(&r.manager).unwrap_or_default();
            let envp = find_on(ctx.path, "env")
                .map(|p| s(&p))
                .unwrap_or_else(|| "/usr/bin/env".into());
            let prog = found
                .as_deref()
                .map(s)
                .unwrap_or_else(|| program.to_string());
            opt.available = found.is_some();
            opt.missing = found.is_none().then(|| program.to_string());
            if !cfg!(unix) {
                // the commands are POSIX shell lines (`env`, `venv/bin`); the terminal task on Windows
                // is `cmd /C` — not offered there yet
                opt.available = false;
                opt.missing = Some("platform".into());
            }
            opt.steps = steps_of(r, dir, &prog, &envp);
            opt.command = command_line(&opt.steps);
            if r.manager == "rustup" {
                opt.target = "toolchain".into();
            }
            env.insert("PATH".into(), ctx.path.to_string_lossy().into_owned());
            opt.env = env;
        }
    }
    opt
}

/// Every way to install `effective` (the server the editor uses for the file) on this machine,
/// from the TRUSTED registry: `bundled` + the user's file = `trusted`. A server the project file
/// adds, or whose program it changes, gets no option (`withheld: project`); a server whose program
/// the user's file changed without giving it recipes neither (`withheld: command` — the bundled
/// recipes would install another program).
pub fn plan(
    bundled: &Registry,
    trusted: &Registry,
    effective: &Server,
    ctx: &PlanCtx,
) -> InstallPlan {
    let dir = ctx.managed.join(&effective.id);
    let mut out = InstallPlan {
        server: effective.id.clone(),
        label: effective.label.clone(),
        name: effective.name.clone(),
        dir: s(&dir),
        platform: ctx.platform.to_string(),
        options: Vec::new(),
        recommended: None,
        manual: effective.install.clone(),
        withheld: None,
    };
    let Some(t) = trusted.server(&effective.id) else {
        out.withheld = Some("project".into());
        return out;
    };
    if t.command != effective.command || t.resolver() != effective.resolver() {
        out.withheld = Some("project".into());
        out.manual = t.install.clone();
        return out;
    }
    out.manual = t.install.clone();
    if let Some(b) = bundled.server(&t.id) {
        if b.command != t.command && b.recipes == t.recipes {
            out.withheld = Some("command".into());
            if b.install == t.install {
                out.manual = None; // the bundled hint names the other program too
            }
            return out;
        }
    }
    out.options = t.recipes.iter().map(|r| option_of(r, &dir, ctx)).collect();
    out.recommended = out
        .options
        .iter()
        .find(|o| o.available && o.mode != MODE_MANUAL)
        .or_else(|| out.options.iter().find(|o| o.available))
        .map(|o| o.id.clone());
    out
}

// ── Where an installed server is ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    bin: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    sha256: String,
}

/// A relative folder with no `..` (the manifest is ours, but read it as untrusted anyway).
fn inner(rel: &str) -> bool {
    rel == "."
        || (!rel.is_empty()
            && !Path::new(rel).is_absolute()
            && rel
                .split(['/', '\\'])
                .all(|seg| !seg.is_empty() && seg != "." && seg != ".."))
}

/// `command` of server `id` installed in dxtutor's own folder: where a release put it (its
/// manifest), else `bin/` (npm, pipx, go, cargo, dotnet, gem), else `venv/bin/` (pip).
pub fn managed_program(managed: &Path, id: &str, command: &str) -> Option<PathBuf> {
    if id.is_empty() || !inner(id) || command.is_empty() || command.contains(['/', '\\']) {
        return None;
    }
    let dir = managed.join(id);
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(m) = std::fs::read_to_string(dir.join(MANIFEST))
        .ok()
        .and_then(|t| serde_json::from_str::<Manifest>(&t).ok())
        .filter(|m| inner(&m.bin))
    {
        dirs.push(dir.join(&m.bin));
    }
    dirs.push(dir.join("bin"));
    dirs.push(dir.join("venv").join("bin"));
    dirs.into_iter()
        .map(|d| d.join(command))
        .find(|p| p.is_file())
}

/// The environment a server installed in dxtutor's folder needs to start: gems need `GEM_PATH`
/// (the binstub looks for its gem there); a .NET tool needs `DOTNET_ROOT` when the runtime is not
/// in a standard place (`dotnet` found on the login PATH, followed to its real folder) — unless
/// the app's environment sets it already.
pub fn launch_env(
    managed: &Path,
    program: &Path,
    path: &OsStr,
    dotnet_root_set: bool,
) -> Vec<(String, String)> {
    let Ok(rel) = program.strip_prefix(managed) else {
        return Vec::new();
    };
    let Some(id) = rel.components().next() else {
        return Vec::new();
    };
    let dir = managed.join(id);
    let mut env = Vec::new();
    let gems = dir.join("gems");
    if gems.is_dir() {
        env.push(("GEM_PATH".into(), s(&gems)));
        env.push(("GEM_HOME".into(), s(&gems)));
    }
    if !dotnet_root_set && dir.join("bin").join(".store").is_dir() {
        if let Some(root) = find_on(path, "dotnet")
            .and_then(|d| std::fs::canonicalize(d).ok())
            .and_then(|d| d.parent().map(Path::to_path_buf))
        {
            env.push(("DOTNET_ROOT".into(), s(&root)));
        }
    }
    env
}

// ── Release downloads ───────────────────────────────────────────────────────────────────────────

/// Writes through to a file while hashing, and refuses to grow past [`MAX_DOWNLOAD`].
struct Hashing<W: Write> {
    inner: W,
    hash: Sha256,
    len: u64,
}

impl<W: Write> Write for Hashing<W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if self.len + buf.len() as u64 > MAX_DOWNLOAD {
            return Err(std::io::Error::other(format!(
                "the download is bigger than {} MiB",
                MAX_DOWNLOAD / 1024 / 1024
            )));
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

/// Fetches `url` into `w` (redirects followed — GitHub sends release assets to its CDN).
pub type Fetch<'a> = &'a dyn Fn(&str, &mut dyn Write) -> Result<(), String>;

/// [`Fetch`] over HTTP(S), with time limits.
pub fn http_fetch(url: &str, w: &mut dyn Write) -> Result<(), String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120))
        .redirects(8)
        .build();
    let resp = agent
        .get(url)
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let mut r = resp.into_reader().take(MAX_DOWNLOAD + 1);
    std::io::copy(&mut r, w).map_err(|e| format!("download failed: {e}"))?;
    Ok(())
}

/// The hex SHA-256 of a file.
pub fn sha256_file(p: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(p).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    std::io::copy(&mut f, &mut h).map_err(|e| e.to_string())?;
    Ok(hex(&h.finalize()))
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[cfg(unix)]
fn set_mode(p: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(p, std::fs::Permissions::from_mode(mode));
}
#[cfg(not(unix))]
fn set_mode(_p: &Path, _mode: u32) {}

/// Unpacks a zip into `out`; an entry whose path leaves `out` is refused (zip-slip).
fn unzip(file: &Path, out: &Path) -> Result<(), String> {
    let f = std::fs::File::open(file).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| format!("not a zip file: {e}"))?;
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|e| e.to_string())?;
        let rel = e
            .enclosed_name()
            .ok_or_else(|| format!("the archive has an unsafe path: {}", e.name()))?;
        let dest = out.join(rel);
        if e.is_dir() {
            std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = dest.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut e, &mut w).map_err(|e| e.to_string())?;
        if let Some(mode) = e.unix_mode() {
            set_mode(&dest, mode & 0o777);
        }
    }
    Ok(())
}

/// Download `asset` (the release of server `id`, whose program is `command`), check its SHA-256,
/// unpack it into `<managed>/<id>` (replacing what was there) and return the program. Nothing is
/// unpacked, and nothing replaced, unless the checksum matches; on any error the folder stays as it
/// was. `tar` = the system `tar`, for a `tar.gz`.
pub fn install_release(
    managed: &Path,
    id: &str,
    command: &str,
    asset: &Asset,
    fetch: Fetch,
    tar: Option<&Path>,
) -> Result<PathBuf, String> {
    if !inner(id) || command.is_empty() || command.contains(['/', '\\']) {
        return Err(format!("not a server id/command: {id} {command}"));
    }
    std::fs::create_dir_all(managed)
        .map_err(|e| format!("cannot create {}: {e}", managed.display()))?;
    let staging = managed.join(format!(".{id}.partial"));
    let _ = std::fs::remove_dir_all(&staging);
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| -> Result<PathBuf, String> {
        let file = staging.join("download");
        let got = {
            let f = std::fs::File::create(&file).map_err(|e| e.to_string())?;
            let mut w = Hashing {
                inner: std::io::BufWriter::new(f),
                hash: Sha256::new(),
                len: 0,
            };
            fetch(&asset.url, &mut w)?;
            w.flush().map_err(|e| e.to_string())?;
            hex(&w.hash.finalize())
        };
        if got != asset.sha256 {
            return Err(format!(
                "checksum mismatch for {}: expected sha256 {}, got {} — nothing was installed",
                asset.url, asset.sha256, got
            ));
        }
        let out = staging.join("out");
        std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
        let bin_rel = match asset.archive.as_str() {
            "zip" | "tar.gz" => asset.bin.clone().unwrap_or_else(|| ".".into()),
            _ => "bin".to_string(),
        };
        if !inner(&bin_rel) {
            return Err(format!(
                "bin `{bin_rel}` is not a folder inside the archive"
            ));
        }
        match asset.archive.as_str() {
            "zip" => unzip(&file, &out)?,
            "tar.gz" => {
                let tar = tar.ok_or("tar was not found on your PATH")?;
                let st = std::process::Command::new(tar)
                    .arg("-xzf")
                    .arg(&file)
                    .arg("-C")
                    .arg(&out)
                    .status()
                    .map_err(|e| format!("tar: {e}"))?;
                if !st.success() {
                    return Err(format!("tar could not unpack the archive ({st})"));
                }
            }
            "gz" | "none" => {
                let bin = out.join("bin");
                std::fs::create_dir_all(&bin).map_err(|e| e.to_string())?;
                let mut w = std::fs::File::create(bin.join(command)).map_err(|e| e.to_string())?;
                let f = std::fs::File::open(&file).map_err(|e| e.to_string())?;
                if asset.archive == "gz" {
                    std::io::copy(&mut flate2::read::GzDecoder::new(f), &mut w)
                        .map_err(|e| format!("not a gzip file: {e}"))?;
                } else {
                    std::io::copy(&mut std::io::BufReader::new(f), &mut w)
                        .map_err(|e| e.to_string())?;
                }
            }
            other => return Err(format!("unknown archive `{other}`")),
        }
        let program = out.join(&bin_rel).join(command);
        if !program.is_file() {
            return Err(format!(
                "the release has no {command} in {bin_rel}/ — nothing was installed"
            ));
        }
        set_mode(&program, 0o755);
        let manifest = Manifest {
            bin: bin_rel.clone(),
            url: asset.url.clone(),
            sha256: asset.sha256.clone(),
        };
        std::fs::write(
            out.join(MANIFEST),
            serde_json::to_string_pretty(&manifest).unwrap_or_default(),
        )
        .map_err(|e| e.to_string())?;
        let dest = managed.join(id);
        if dest.exists() {
            std::fs::remove_dir_all(&dest)
                .map_err(|e| format!("cannot replace {}: {e}", dest.display()))?;
        }
        std::fs::rename(&out, &dest).map_err(|e| e.to_string())?;
        Ok(dest.join(&bin_rel).join(command))
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::langreg::{parse, registry, validate};
    use std::ffi::OsString;

    /// A fake package manager: a script that records its arguments (one per line) and exits 0.
    fn fake(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(
            &p,
            "#!/bin/sh\nfor a in \"$@\"; do echo \"$a\"; done > \"$0.args\"\n",
        )
        .unwrap();
        set_mode(&p, 0o755);
        p
    }

    fn reg(servers: &str) -> Registry {
        let r = parse(&format!(
            r#"{{"version":1,"languages":[{{"id":"x","name":"X","extensions":["x"],"lspLanguageId":"x","server":"s"}}],"servers":[{servers}]}}"#
        ))
        .unwrap();
        assert!(validate(&r).is_empty(), "{:?}", validate(&r));
        r
    }

    fn ctx<'a>(managed: &'a Path, home: &'a Path, path: &'a OsStr) -> PlanCtx<'a> {
        PlanCtx {
            managed,
            platform: "linux-x64",
            home: Some(home),
            path,
        }
    }

    #[test]
    #[cfg(unix)]
    fn each_manager_gets_its_exact_command_into_dxtutors_folder() {
        let t = tempfile::tempdir().unwrap();
        let bin = t.path().join("fakebin");
        std::fs::create_dir_all(&bin).unwrap();
        for m in [
            "npm", "python3", "pipx", "go", "cargo", "dotnet", "gem", "rustup", "env", "brew",
            "apt-get",
        ] {
            fake(&bin, m);
        }
        let managed = t.path().join("data/lsp-servers");
        let path = OsString::from(&bin);
        let r = reg(
            r#"{"id":"s","name":"S","label":"s-ls","command":"s-ls","install":"get it","recipes":[
            {"manager":"npm","packages":["s-ls","typescript@5"]},
            {"manager":"pip","packages":["s-ls==1.2"]},
            {"manager":"pipx","packages":["s-ls"]},
            {"manager":"go","packages":["example.com/s-ls@latest"]},
            {"manager":"cargo","packages":["s-ls"],"version":"0.3.1"},
            {"manager":"dotnet","packages":["s-ls"]},
            {"manager":"gem","packages":["s-ls"],"version":"2.0"},
            {"manager":"rustup","packages":["s-ls"]},
            {"manager":"brew","packages":["s-ls"]},
            {"manager":"apt","packages":["s-ls"]}]}"#,
        );
        let p = plan(
            &r,
            &r,
            r.server("s").unwrap(),
            &ctx(&managed, t.path(), &path),
        );
        let d = managed.join("s").display().to_string();
        let b = bin.display().to_string();
        let by = |id: &str| p.options.iter().find(|o| o.id == id).unwrap();
        assert_eq!(
            by("npm").command,
            format!("{b}/npm install --global --prefix {d} s-ls typescript@5")
        );
        assert_eq!(
            by("pip").command,
            format!("{b}/python3 -m venv {d}/venv && {d}/venv/bin/python -m pip install s-ls==1.2")
        );
        assert_eq!(
            by("pipx").command,
            format!("{b}/env PIPX_HOME={d}/pipx PIPX_BIN_DIR={d}/bin PIPX_MAN_DIR={d}/man {b}/pipx install s-ls")
        );
        assert_eq!(
            by("go").command,
            format!("{b}/env GOBIN={d}/bin {b}/go install example.com/s-ls@latest")
        );
        assert_eq!(
            by("cargo").command,
            format!("{b}/cargo install --locked --root {d} s-ls --version 0.3.1")
        );
        assert_eq!(
            by("dotnet").command,
            format!("{b}/dotnet tool install --tool-path {d}/bin s-ls")
        );
        assert_eq!(
            by("gem").command,
            format!("{b}/gem install --no-document --install-dir {d}/gems --bindir {d}/bin s-ls --version 2.0")
        );
        assert_eq!(
            by("rustup").command,
            format!("{b}/rustup component add s-ls")
        );
        assert_eq!(by("rustup").target, "toolchain");
        // system managers: shown for the human, with sudo for apt — never run by dxtutor
        assert_eq!(by("brew").command, "brew install s-ls");
        assert_eq!(by("apt").command, "sudo apt-get install s-ls");
        for id in ["brew", "apt"] {
            assert_eq!(by(id).mode, MODE_MANUAL);
            assert_eq!(by(id).target, "system");
            assert!(by(id).env.is_empty());
        }
        for o in p.options.iter().filter(|o| o.mode == MODE_TERMINAL) {
            assert!(o.available, "{}", o.id);
            assert_eq!(
                o.env.get("PATH").map(String::as_str),
                Some(b.as_str()),
                "{}",
                o.id
            );
            assert_eq!(command_line(&o.steps), o.command);
        }
        assert_eq!(p.recommended.as_deref(), Some("npm"));
        assert_eq!(p.manual.as_deref(), Some("get it"));
        assert_eq!(p.dir, d);

        // the commands RUN as planned: each fake manager got exactly these arguments
        for o in p
            .options
            .iter()
            .filter(|o| o.mode == MODE_TERMINAL && o.id != "pip")
        {
            let st = std::process::Command::new("/bin/sh")
                .args(["-c", &o.command])
                .env("PATH", &path)
                .status()
                .unwrap();
            assert!(st.success(), "{}", o.command);
            // each fake records the arguments it got: `env` (go, pipx) got the variables and the
            // manager's own command line — exactly the planned step
            let args = std::fs::read_to_string(format!("{}.args", o.steps[0][0])).unwrap();
            assert_eq!(
                args.lines().collect::<Vec<_>>(),
                o.steps[0][1..]
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                "{}",
                o.id
            );
        }
    }

    #[test]
    #[cfg(unix)]
    fn a_folder_with_spaces_or_quotes_stays_one_argument() {
        let t = tempfile::tempdir().unwrap();
        let bin = t.path().join("b");
        std::fs::create_dir_all(&bin).unwrap();
        fake(&bin, "npm");
        let managed = t.path().join("Application Support/it's/lsp-servers");
        let path = OsString::from(&bin);
        let r = reg(
            r#"{"id":"s","name":"S","label":"s","command":"s","recipes":[{"manager":"npm","packages":["s"]}]}"#,
        );
        let p = plan(
            &r,
            &r,
            r.server("s").unwrap(),
            &ctx(&managed, t.path(), &path),
        );
        let o = &p.options[0];
        let st = std::process::Command::new("/bin/sh")
            .args(["-c", &o.command])
            .status()
            .unwrap();
        assert!(st.success());
        let args = std::fs::read_to_string(bin.join("npm.args")).unwrap();
        assert_eq!(
            args.lines().collect::<Vec<_>>(),
            vec![
                "install",
                "--global",
                "--prefix",
                &managed.join("s").display().to_string(),
                "s"
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn only_present_managers_and_this_platforms_assets_are_offered() {
        let t = tempfile::tempdir().unwrap();
        let bin = t.path().join("b");
        std::fs::create_dir_all(&bin).unwrap();
        fake(&bin, "apt-get");
        let managed = t.path().join("m");
        let path = OsString::from(&bin);
        let sha = "a".repeat(64);
        let r = reg(&format!(
            r#"{{"id":"s","name":"S","label":"s","command":"s","recipes":[
            {{"manager":"npm","packages":["s"]}},
            {{"manager":"github","assets":[{{"platform":"darwin-arm64","url":"https://github.com/o/r/releases/download/v1/s.gz","sha256":"{sha}","archive":"gz"}}]}},
            {{"manager":"apt","packages":["s"]}}]}}"#
        ));
        let p = plan(
            &r,
            &r,
            r.server("s").unwrap(),
            &ctx(&managed, t.path(), &path),
        );
        let by = |id: &str| p.options.iter().find(|o| o.id == id).unwrap();
        assert!(!by("npm").available);
        assert_eq!(by("npm").missing.as_deref(), Some("npm"));
        assert!(!by("github").available);
        assert_eq!(by("github").missing.as_deref(), Some("platform"));
        assert!(by("apt").available);
        // nothing dxtutor can run: the notice proposes the command for the human
        assert_eq!(p.recommended.as_deref(), Some("apt"));
        // on a mac with that asset, the release wins over apt
        let mac = PlanCtx {
            platform: "darwin-arm64",
            ..ctx(&managed, t.path(), &path)
        };
        let p = plan(&r, &r, r.server("s").unwrap(), &mac);
        assert_eq!(p.recommended.as_deref(), Some("github"));
        let g = p.options.iter().find(|o| o.id == "github").unwrap();
        assert_eq!(g.mode, MODE_DOWNLOAD);
        assert!(
            g.command.contains(&sha)
                && g.command
                    .contains("https://github.com/o/r/releases/download/v1/s.gz")
        );
        assert_eq!(g.sha256.as_deref(), Some(sha.as_str()));
        // no manager at all, nothing to propose
        let none = OsString::new();
        let p = plan(
            &r,
            &r,
            r.server("s").unwrap(),
            &ctx(&managed, t.path(), &none),
        );
        assert_eq!(p.recommended, None);
    }

    #[test]
    fn a_project_server_or_a_changed_program_gets_no_recipe() {
        let t = tempfile::tempdir().unwrap();
        let bin = t.path().join("b");
        std::fs::create_dir_all(&bin).unwrap();
        fake(&bin, "npm");
        let path = OsString::from(&bin);
        let managed = t.path().join("m");
        let c = ctx(&managed, t.path(), &path);
        let bundled = reg(
            r#"{"id":"s","name":"S","label":"s","command":"s","install":"npm i -g s","recipes":[{"manager":"npm","packages":["s"]}]}"#,
        );
        // the project changed the program (its recipes, whatever they say, are never offered)
        let mut proj = bundled.server("s").unwrap().clone();
        proj.command = "evil".into();
        proj.recipes[0].packages = vec!["evil".into()];
        let p = plan(&bundled, &bundled, &proj, &c);
        assert_eq!(p.withheld.as_deref(), Some("project"));
        assert!(p.options.is_empty());
        // a project-only server
        let mut other = proj.clone();
        other.id = "zzz".into();
        assert_eq!(
            plan(&bundled, &bundled, &other, &c).withheld.as_deref(),
            Some("project")
        );
        // the project changed only the recipes: the trusted ones are offered
        let mut only = bundled.server("s").unwrap().clone();
        only.recipes[0].packages = vec!["evil".into()];
        let p = plan(&bundled, &bundled, &only, &c);
        assert_eq!(p.options[0].packages, vec!["s"]);
        // the user's file changed the program but kept the bundled recipes: they would install the
        // bundled program, so none is offered (nor the bundled hint)
        let mut user = bundled.clone();
        user.servers[0].command = "basedpyright-langserver".into();
        let p = plan(&bundled, &user, user.server("s").unwrap(), &c);
        assert_eq!(p.withheld.as_deref(), Some("command"));
        assert_eq!(p.manual, None);
        // ... unless it gave recipes of its own
        user.servers[0].recipes = vec![parse_recipe(
            r#"{"manager":"npm","packages":["basedpyright"]}"#,
        )];
        let p = plan(&bundled, &user, user.server("s").unwrap(), &c);
        assert_eq!(p.withheld, None);
        assert_eq!(p.options[0].packages, vec!["basedpyright"]);
    }

    fn parse_recipe(j: &str) -> Recipe {
        serde_json::from_str(j).unwrap()
    }

    #[test]
    fn the_bundled_recipes_plan_on_this_machine_without_running_anything() {
        let t = tempfile::tempdir().unwrap();
        let none = OsString::new();
        let r = registry();
        for s in &r.servers {
            let p = plan(r, r, s, &ctx(t.path(), t.path(), &none));
            assert_eq!(p.withheld, None, "{}", s.id);
            assert_eq!(p.options.len(), s.recipes.len());
        }
        let ts = plan(
            r,
            r,
            r.server("typescript").unwrap(),
            &ctx(t.path(), t.path(), &none),
        );
        assert_eq!(
            ts.options[0].packages,
            vec!["typescript-language-server", "typescript@5"]
        );
        // rust-analyzer and clangd come as pinned releases on linux-x64
        for id in ["rust", "cpp", "kotlin", "sql"] {
            let p = plan(r, r, r.server(id).unwrap(), &ctx(t.path(), t.path(), &none));
            let g = p.options.iter().find(|o| o.id == "github").unwrap();
            assert!(g.available, "{id}");
            assert_eq!(
                p.recommended.as_deref(),
                Some("github"),
                "{id}: no manager on PATH"
            );
        }
    }

    // ── releases ──

    /// A one-shot HTTP server on 127.0.0.1 that answers every request with `body` (a fake GitHub).
    fn serve(body: Vec<u8>) -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap();
        std::thread::spawn(move || {
            for s in l.incoming().flatten() {
                let mut s = s;
                let mut buf = [0u8; 4096];
                let _ = s.read(&mut buf);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = s.write_all(head.as_bytes());
                let _ = s.write_all(&body);
            }
        });
        format!("http://{addr}/o/r/releases/download/v1/asset")
    }

    fn sha(b: &[u8]) -> String {
        hex(&Sha256::digest(b))
    }

    fn zip_of(files: &[(&str, &[u8], u32)]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            for (name, data, mode) in files {
                let o = zip::write::SimpleFileOptions::default().unix_permissions(*mode);
                z.start_file(*name, o).unwrap();
                z.write_all(data).unwrap();
            }
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    fn asset(url: &str, sum: &str, archive: &str, bin: Option<&str>) -> Asset {
        Asset {
            platform: "linux-x64".into(),
            url: url.into(),
            sha256: sum.into(),
            archive: archive.into(),
            bin: bin.map(String::from),
        }
    }

    #[test]
    fn a_release_from_a_fake_server_is_checked_unpacked_and_found() {
        let t = tempfile::tempdir().unwrap();
        let managed = t.path().join("lsp-servers");
        let body = zip_of(&[
            ("tool_1.0/bin/s-ls", b"#!/bin/sh\necho hi\n", 0o755),
            ("tool_1.0/lib/x", b"x", 0o644),
        ]);
        let url = serve(body.clone());
        let a = asset(&url, &sha(&body), "zip", Some("tool_1.0/bin"));
        let prog = install_release(&managed, "s", "s-ls", &a, &http_fetch, None).unwrap();
        assert_eq!(prog, managed.join("s/tool_1.0/bin/s-ls"));
        assert!(prog.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&prog).unwrap().permissions().mode() & 0o111,
                0o111
            );
        }
        // the resolver finds it through the manifest
        assert_eq!(managed_program(&managed, "s", "s-ls"), Some(prog.clone()));
        assert_eq!(managed_program(&managed, "other", "s-ls"), None);
        assert!(!managed.join(".s.partial").exists(), "no staging left");
        // a second install replaces the first
        let body2 = zip_of(&[("bin/s-ls", b"v2", 0o755)]);
        let url2 = serve(body2.clone());
        let p2 = install_release(
            &managed,
            "s",
            "s-ls",
            &asset(&url2, &sha(&body2), "zip", Some("bin")),
            &http_fetch,
            None,
        )
        .unwrap();
        assert_eq!(std::fs::read(&p2).unwrap(), b"v2");
        assert!(!managed.join("s/tool_1.0").exists());
    }

    #[test]
    fn a_checksum_mismatch_installs_nothing_and_keeps_what_was_there() {
        let t = tempfile::tempdir().unwrap();
        let managed = t.path().join("lsp-servers");
        let good = zip_of(&[("bin/s-ls", b"good", 0o755)]);
        let url = serve(good.clone());
        install_release(
            &managed,
            "s",
            "s-ls",
            &asset(&url, &sha(&good), "zip", Some("bin")),
            &http_fetch,
            None,
        )
        .unwrap();
        // the server sends something else than the pinned file
        let evil = zip_of(&[("bin/s-ls", b"evil", 0o755)]);
        let url = serve(evil);
        let err = install_release(
            &managed,
            "s",
            "s-ls",
            &asset(&url, &sha(&good), "zip", Some("bin")),
            &http_fetch,
            None,
        )
        .unwrap_err();
        assert!(
            err.contains("checksum mismatch") && err.contains("nothing was installed"),
            "{err}"
        );
        assert_eq!(std::fs::read(managed.join("s/bin/s-ls")).unwrap(), b"good");
        assert!(!managed.join(".s.partial").exists());
        // with nothing installed before, nothing is there after
        let err = install_release(
            &managed,
            "t",
            "t-ls",
            &asset(&url, &"0".repeat(64), "zip", Some("bin")),
            &http_fetch,
            None,
        )
        .unwrap_err();
        assert!(err.contains("checksum mismatch"));
        assert!(!managed.join("t").exists());
    }

    #[test]
    fn gz_none_and_tar_gz_releases_and_bad_archives() {
        use flate2::write::GzEncoder;
        let t = tempfile::tempdir().unwrap();
        let managed = t.path().join("lsp-servers");
        // a gzip-compressed program (rust-analyzer's way)
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(b"\x7fELF fake").unwrap();
        let gz = gz.finish().unwrap();
        let file_fetch = |data: Vec<u8>| {
            move |_u: &str, w: &mut dyn Write| w.write_all(&data).map_err(|e| e.to_string())
        };
        let f = file_fetch(gz.clone());
        let p = install_release(
            &managed,
            "rust",
            "rust-analyzer",
            &asset("u", &sha(&gz), "gz", None),
            &f,
            None,
        )
        .unwrap();
        assert_eq!(p, managed.join("rust/bin/rust-analyzer"));
        assert_eq!(std::fs::read(&p).unwrap(), b"\x7fELF fake");
        assert_eq!(managed_program(&managed, "rust", "rust-analyzer"), Some(p));
        // the program itself
        let f = file_fetch(b"raw".to_vec());
        let p = install_release(
            &managed,
            "raw",
            "r",
            &asset("u", &sha(b"raw"), "none", None),
            &f,
            None,
        )
        .unwrap();
        assert_eq!(std::fs::read(p).unwrap(), b"raw");
        // a tar.gz through the system tar
        if let Some(tar) = find_on(&std::env::var_os("PATH").unwrap_or_default(), "tar") {
            let src = t.path().join("src/jdt/bin");
            std::fs::create_dir_all(&src).unwrap();
            std::fs::write(src.join("jdtls"), "#!/bin/sh\n").unwrap();
            let tgz = t.path().join("a.tgz");
            assert!(std::process::Command::new(&tar)
                .arg("-czf")
                .arg(&tgz)
                .arg("-C")
                .arg(t.path().join("src"))
                .arg("jdt")
                .status()
                .unwrap()
                .success());
            let data = std::fs::read(&tgz).unwrap();
            let f = file_fetch(data.clone());
            let p = install_release(
                &managed,
                "java",
                "jdtls",
                &asset("u", &sha(&data), "tar.gz", Some("jdt/bin")),
                &f,
                Some(&tar),
            )
            .unwrap();
            assert_eq!(p, managed.join("java/jdt/bin/jdtls"));
            assert_eq!(managed_program(&managed, "java", "jdtls"), Some(p));
            assert!(install_release(
                &managed,
                "java2",
                "jdtls",
                &asset("u", &sha(&data), "tar.gz", Some("jdt/bin")),
                &f,
                None
            )
            .unwrap_err()
            .contains("tar was not found"));
        }
        // the archive lacks the program; a zip that climbs out of its folder
        let z = zip_of(&[("other/x", b"x", 0o644)]);
        let f = file_fetch(z.clone());
        let e = install_release(
            &managed,
            "k",
            "kls",
            &asset("u", &sha(&z), "zip", Some("bin")),
            &f,
            None,
        )
        .unwrap_err();
        assert!(e.contains("no kls in bin/"), "{e}");
        assert!(!managed.join("k").exists());
        let slip = zip_of(&[("../../escape", b"x", 0o644)]);
        let f = file_fetch(slip.clone());
        let e = install_release(
            &managed,
            "k",
            "kls",
            &asset("u", &sha(&slip), "zip", Some(".")),
            &f,
            None,
        )
        .unwrap_err();
        assert!(e.contains("unsafe path"), "{e}");
        assert!(!t.path().join("escape").exists());
        // a refused download (404 → error), nothing left
        let f = |_u: &str, _w: &mut dyn Write| Err::<(), String>("download failed: 404".into());
        assert!(install_release(
            &managed,
            "n",
            "n",
            &asset("u", &sha(b""), "none", None),
            &f,
            None
        )
        .is_err());
        assert!(!managed.join("n").exists());
    }

    #[test]
    fn managed_programs_are_looked_for_in_bin_then_the_venv_and_get_their_environment() {
        let t = tempfile::tempdir().unwrap();
        let m = t.path();
        assert_eq!(managed_program(m, "py", "pylsp"), None);
        std::fs::create_dir_all(m.join("py/venv/bin")).unwrap();
        std::fs::write(m.join("py/venv/bin/pylsp"), "").unwrap();
        assert_eq!(
            managed_program(m, "py", "pylsp"),
            Some(m.join("py/venv/bin/pylsp"))
        );
        std::fs::create_dir_all(m.join("py/bin")).unwrap();
        std::fs::write(m.join("py/bin/pylsp"), "").unwrap();
        assert_eq!(
            managed_program(m, "py", "pylsp"),
            Some(m.join("py/bin/pylsp"))
        );
        // never outside its folder
        assert_eq!(managed_program(m, "../py", "pylsp"), None);
        assert_eq!(managed_program(m, "py", "../bin/pylsp"), None);
        std::fs::write(m.join("py").join(MANIFEST), r#"{"bin":"../../etc"}"#).unwrap();
        assert_eq!(
            managed_program(m, "py", "pylsp"),
            Some(m.join("py/bin/pylsp"))
        );
        // a gem's binstub needs GEM_PATH; a .NET tool DOTNET_ROOT (the real folder of `dotnet`)
        std::fs::create_dir_all(m.join("rb/gems")).unwrap();
        let env = launch_env(m, &m.join("rb/bin/solargraph"), OsStr::new(""), false);
        assert!(env.contains(&("GEM_PATH".into(), m.join("rb/gems").display().to_string())));
        let dn = t.path().join("dotnet-sdk");
        std::fs::create_dir_all(&dn).unwrap();
        fake(&dn, "dotnet");
        std::fs::create_dir_all(m.join("cs/bin/.store")).unwrap();
        let env = launch_env(m, &m.join("cs/bin/csharp-ls"), dn.as_os_str(), false);
        let root = std::fs::canonicalize(&dn).unwrap().display().to_string();
        assert_eq!(env, vec![("DOTNET_ROOT".into(), root)]);
        assert!(launch_env(m, &m.join("cs/bin/csharp-ls"), dn.as_os_str(), true).is_empty());
        assert!(launch_env(m, Path::new("/usr/bin/clangd"), dn.as_os_str(), false).is_empty());
    }

    /// End to end against the real GitHub: the bundled rust-analyzer release for this machine, into a
    /// temporary folder, then run. Network: `cargo test -p tutor-eval lspinstall -- --ignored`.
    #[test]
    #[ignore]
    fn real_bundled_release_downloads_checks_and_runs() {
        let r = registry();
        let s = r.server("rust").unwrap();
        let recipe = s.recipes.iter().find(|x| x.manager == "github").unwrap();
        let Some(asset) = recipe.asset_for(&current_platform()) else {
            return; // no asset for this machine
        };
        let t = tempfile::tempdir().unwrap();
        let prog =
            install_release(t.path(), "rust", "rust-analyzer", asset, &http_fetch, None).unwrap();
        assert_eq!(
            managed_program(t.path(), "rust", "rust-analyzer"),
            Some(prog.clone())
        );
        let out = std::process::Command::new(&prog)
            .arg("--version")
            .output()
            .unwrap();
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).starts_with("rust-analyzer"));
    }

    /// End to end with the real npm (from the PATH of the test run): the bundled pyright recipe planned
    /// into a temporary folder, its exact command run, and the server found there.
    #[test]
    #[ignore]
    #[cfg(unix)]
    fn real_npm_recipe_installs_into_dxtutors_folder_only() {
        let path = std::env::var_os("PATH").unwrap_or_default();
        if find_on(&path, "npm").is_none() {
            return;
        }
        let t = tempfile::tempdir().unwrap();
        let managed = t.path().join("lsp-servers");
        let r = registry();
        let p = plan(
            r,
            r,
            r.server("python").unwrap(),
            &PlanCtx {
                managed: &managed,
                platform: &current_platform(),
                home: Some(t.path()),
                path: &path,
            },
        );
        let o = p.options.iter().find(|o| o.id == "npm").unwrap();
        let st = std::process::Command::new("/bin/sh")
            .args(["-c", &o.command])
            .env("PATH", &o.env["PATH"])
            .env("HOME", t.path())
            .env("npm_config_cache", t.path().join("npm-cache"))
            .current_dir(t.path())
            .status()
            .unwrap();
        assert!(st.success(), "{}", o.command);
        let prog =
            managed_program(&managed, "python", "pyright-langserver").expect("in dxtutor's folder");
        assert!(prog.starts_with(&managed));
    }

    #[test]
    #[cfg(unix)]
    fn quoting_survives_the_shell() {
        for s in [
            "plain",
            "with space",
            "it's",
            "a\"b",
            "$HOME",
            "`x`",
            "",
            "semi;colon",
            "*",
        ] {
            let out = std::process::Command::new("/bin/sh")
                .args(["-c", &format!("printf %s {}", sh_quote(s))])
                .output()
                .unwrap();
            assert_eq!(String::from_utf8_lossy(&out.stdout), s, "{s}");
        }
    }

    #[test]
    fn the_platform_name_is_one_the_registry_knows() {
        let p = current_platform();
        if cfg!(any(target_os = "linux", target_os = "macos"))
            && cfg!(any(target_arch = "x86_64", target_arch = "aarch64"))
        {
            assert!(crate::langreg::PLATFORMS.contains(&p.as_str()), "{p}");
        }
    }
}
