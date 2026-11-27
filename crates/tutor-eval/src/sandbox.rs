//! O **sandbox de contentores** (Learn P3a): um contexto Podman rootless SÓ do dxtutor, para
//! avaliar passos que constroem e correm imagens (os cursos de Docker e de Podman) e, depois, o
//! que precisar de contentores (o kind do Learn P3b reutiliza este módulo).
//!
//! # O que é isolado, e como
//!
//! Decisão do dono: o motor é o **Podman rootless** (nunca o daemon do Docker do utilizador — avaliar
//! por ele é equivalente a root —, nunca o armazenamento do Podman do utilizador em
//! `~/.local/share/containers/storage`, nunca o motor do delonix). Cada comando corre com:
//!
//! - **armazenamento próprio** em [`Sandbox::root`] (`<cache dos cursos>/.sandbox/podman`, ou
//!   `DXTUTOR_SANDBOX_ROOT`): `storage/` (imagens e camadas), `volumes/`, `networks/`, `config/`
//!   (o `containers.conf`, o `storage.conf`, o `registries.conf` e um `auth.json` vazio, escritos por
//!   [`Sandbox::ensure`]) e um `home/` que faz de `HOME`/`XDG_*`. O `runroot` e o `tmpdir` do libpod
//!   vivem em `$XDG_RUNTIME_DIR/dxtutor-sbx-<hash>` (o Podman recusa um `runroot` com mais de 50
//!   caracteres; é estado volátil, como o do Podman do utilizador);
//! - **ambiente limpo**: só as variáveis da caixa (`CONTAINERS_CONF`, `CONTAINERS_STORAGE_CONF`,
//!   `CONTAINERS_REGISTRIES_CONF`, `REGISTRY_AUTH_FILE`, `HOME`, `XDG_*`) e as flags globais
//!   (`--root`, `--runroot`, `--tmpdir`, `--volumepath`, `--network-config-dir`, `--events-backend
//!   file`); o comando de saída do conmon (`container cleanup`) recebe as mesmas flags. A
//!   configuração do utilizador (`~/.config/containers`) nunca é lida;
//! - **etiquetas** em tudo o que cria: [`LABEL_SANDBOX`]`=<propósito>` (a avaliação usa
//!   [`PURPOSE_GRADE`]) e [`LABEL_RUN`]`=<id da corrida>`; a limpeza é por etiqueta
//!   ([`Sandbox::cleanup`]) e só apanha o que tem a etiqueta pedida;
//! - **limites** (`--memory`, `--pids-limit`, `--cpus`; nas construções `--memory`, `--cpu-quota`
//!   e `--ulimit nproc`, que no rootless conta por espaço de utilizador), `--cap-drop=ALL`,
//!   `no-new-privileges` e `--pull=never`. Os limites aplicam-se pelo gestor de cgroups `systemd`
//!   da sessão do utilizador; [`Sandbox::verify_limits`] confirma-os num contentor de prova e, se não
//!   valem, a avaliação recusa (nunca corre sem eles).
//!
//! # O que NÃO se usa (medido no Podman 4.9.3)
//!
//! - **Redes definidas pelo utilizador** (`podman network create`): no rootless, TODAS as
//!   configurações de um utilizador partilham o mesmo `rootless-netns` (dois sandboxes distintos
//!   criaram a mesma bridge `podman1` em `10.89.0.0/24`), por isso uma rede do sandbox chocaria com as
//!   do Podman do utilizador; e o `aardvark-dns` de uma rede `--internal` ainda resolve nomes de fora.
//!   O sandbox só usa `--network none` e `--network container:<nome>` (o espaço de rede de outro
//!   contentor do sandbox, que também não tem rede).
//! - **Temporizadores de healthcheck**: o Podman cria uma unidade systemd que chama `podman
//!   healthcheck run` SEM as flags do sandbox (iria ao armazenamento do utilizador). Os contentores
//!   correm com `--health-interval=disable` e o avaliador corre `podman healthcheck run` ele próprio.
//! - **Portas publicadas** (`-p`): abririam portas na máquina do utilizador.
//!
//! As construções (`podman build`) põem os contentores dos `RUN` numa fatia systemd própria da
//! corrida (`--cgroup-parent dxtutor-sbx-<id>.slice:runc:build`): esses processos não pertencem ao
//! grupo do `podman` (o runc dá-lhes sessão própria), e um `RUN` que exceda o tempo limite só morre
//! pela fatia ([`Sandbox::stop_run_slice`]).
//!
//! Só Linux: no macOS e no Windows o Podman corre numa VM (`podman machine`) e a avaliação não está
//! disponível ([`unsupported_reason`]).

use std::collections::BTreeSet;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use sha2::{Digest, Sha256};

use crate::runner::{run_guarded, Rlimits};

/// A etiqueta que marca tudo o que o sandbox cria; o valor é o propósito ([`PURPOSE_GRADE`]).
pub const LABEL_SANDBOX: &str = "io.dxtutor.sandbox";
/// A etiqueta com o id da corrida que criou o objecto ([`new_run_id`]).
pub const LABEL_RUN: &str = "io.dxtutor.run";
/// O propósito das corridas de avaliação: a limpeza de restos no arranque só apanha estes.
pub const PURPOSE_GRADE: &str = "grade";
/// Aponta a raiz do sandbox (senão `<cache dos cursos>/.sandbox/podman`).
pub const ROOT_ENV: &str = "DXTUTOR_SANDBOX_ROOT";
/// A versão mínima do Podman (`--health-interval=disable`, `rm --filter`, montagens de imagem).
pub const MIN_PODMAN: (u32, u32) = (4, 4);
/// O prefixo das fatias systemd das corridas (a hierarquia é `dxtutor.slice/dxtutor-sbx.slice/…`).
const SLICE_PREFIX: &str = "dxtutor-sbx-";

/// O que instalar quando o Podman falta (texto para o aluno e para o autor do curso).
pub fn install_hint() -> &'static str {
    "podman is not installed. Install Podman 4.4 or newer for your Linux distribution \
     (https://podman.io/docs/installation — e.g. `sudo apt install podman` or `sudo dnf install podman`), \
     rootless, and open the course again. Grading runs only in a private rootless Podman sandbox: it \
     never uses the Docker daemon nor your own Podman images and containers."
}

/// Porque o sandbox não está disponível nesta plataforma (`None` em Linux).
pub fn unsupported_reason() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        None
    } else {
        Some(
            "the container sandbox is Linux-only: it needs rootless Podman with a systemd user \
             session. On macOS and Windows Podman runs inside a VM (`podman machine`), which this \
             grader does not drive; the course text works, grading does not.",
        )
    }
}

/// A raiz do sandbox para a raiz da cache dos cursos `cache_root`: `DXTUTOR_SANDBOX_ROOT`, senão
/// `<cache_root>/.sandbox/podman` (um `.` à frente não pode ser o id de um curso).
pub fn root_for(cache_root: &Path) -> PathBuf {
    if let Some(dir) = std::env::var_os(ROOT_ENV).filter(|d| !d.is_empty()) {
        return PathBuf::from(dir);
    }
    cache_root.join(".sandbox").join("podman")
}

/// A raiz do sandbox da app e do `dxt` (ver [`root_for`]).
pub fn default_root() -> Option<PathBuf> {
    crate::course_cache::root().map(|r| root_for(&r))
}

/// Onde está o `podman`: `DXTUTOR_PODMAN_BIN`, o `PATH`, ou as pastas habituais (a app desktop pode
/// arrancar com um `PATH` curto).
pub fn find_podman() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os(crate::container::PODMAN_BIN_ENV).filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    crate::plugin::find_on_path("podman").or_else(|| {
        ["/usr/bin/podman", "/usr/local/bin/podman"]
            .iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
    })
}

/// Um id curto e único para uma corrida (12 hexadecimais, só `[0-9a-f]`: entra em nomes de
/// contentores e de fatias systemd, onde `-` aninha).
pub fn new_run_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut h = Sha256::new();
    h.update(std::process::id().to_le_bytes());
    h.update(COUNTER.fetch_add(1, Ordering::Relaxed).to_le_bytes());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    h.update(now.to_le_bytes());
    h.finalize()
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn uid() -> u32 {
    // SAFETY: getuid não falha nem tem efeitos.
    unsafe { libc::getuid() }
}

/// O resultado de um comando do sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exec {
    /// O código de saída (`None` quando morreu por um sinal ou pelo tempo limite).
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

impl Exec {
    pub fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out
    }
}

/// Um contexto Podman rootless com armazenamento, configuração e estado próprios. Ver o cabeçalho
/// do módulo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sandbox {
    root: PathBuf,
    /// `$XDG_RUNTIME_DIR` da sessão (o do ambiente, ou `/run/user/<uid>`).
    runtime_dir: PathBuf,
    /// `<runtime_dir>/dxtutor-sbx-<hash da raiz>`: `run/` (o runroot) e `tmp/` (o tmpdir do libpod).
    run_dir: PathBuf,
    bin: PathBuf,
}

/// A pasta de sessão do utilizador com o bus do systemd (o gestor de cgroups que aplica os limites).
fn session_runtime_dir() -> Result<PathBuf> {
    let candidates = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .into_iter()
        .chain(std::iter::once(PathBuf::from(format!(
            "/run/user/{}",
            uid()
        ))));
    for dir in candidates {
        let Ok(meta) = std::fs::metadata(&dir) else {
            continue;
        };
        if meta.is_dir() && meta.uid() == uid() && dir.join("bus").exists() {
            return Ok(dir);
        }
    }
    bail!(
        "no systemd user session was found (no XDG_RUNTIME_DIR with a `bus` socket, nor /run/user/{}/bus): \
         rootless Podman applies the sandbox's memory, process and CPU limits through it, and grading never \
         runs a container without them. Log in to a desktop or `loginctl enable-linger` this user.",
        uid()
    )
}

impl Sandbox {
    /// O sandbox em `root` com o `podman` encontrado por [`find_podman`]. Não escreve nada (ver
    /// [`Sandbox::ensure`]).
    pub fn at(root: &Path) -> Result<Sandbox> {
        let bin = find_podman().with_context(install_hint)?;
        Sandbox::with_bin(root, &bin)
    }

    /// [`Sandbox::at`] com o `podman` dado (os testes fixam-no).
    pub fn with_bin(root: &Path, bin: &Path) -> Result<Sandbox> {
        if let Some(why) = unsupported_reason() {
            bail!("{why}");
        }
        if uid() == 0 {
            bail!(
                "the container sandbox refuses to run as root: rootful Podman would make grading \
                 root-equivalent. Run dxtutor as your normal user (rootless Podman)."
            );
        }
        if !root.is_absolute() {
            bail!(
                "the sandbox root must be an absolute path: {}",
                root.display()
            );
        }
        let runtime_dir = session_runtime_dir()?;
        let hash: String = Sha256::digest(root.as_os_str().as_encoded_bytes())
            .iter()
            .take(4)
            .map(|b| format!("{b:02x}"))
            .collect();
        let run_dir = runtime_dir.join(format!("dxtutor-sbx-{hash}"));
        // O Podman recusa um runroot com mais de 50 caracteres.
        let runroot_len = run_dir.join("run").as_os_str().len();
        if runroot_len > 50 {
            bail!(
                "XDG_RUNTIME_DIR `{}` is too long for Podman's runroot (at most 50 characters)",
                runtime_dir.display()
            );
        }
        Ok(Sandbox {
            root: root.to_path_buf(),
            runtime_dir,
            run_dir,
            bin: bin.to_path_buf(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn bin(&self) -> &Path {
        &self.bin
    }

    /// O armazenamento de imagens e contentores (o `graphroot`).
    pub fn storage(&self) -> PathBuf {
        self.root.join("storage")
    }

    fn config_dir(&self) -> PathBuf {
        self.root.join("config")
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn runroot(&self) -> PathBuf {
        self.run_dir.join("run")
    }

    fn tmpdir(&self) -> PathBuf {
        self.run_dir.join("tmp")
    }

    /// Os ficheiros de configuração e o seu conteúdo.
    fn config_files(&self) -> Vec<(PathBuf, String)> {
        let q = |p: PathBuf| toml_string(&p.display().to_string());
        let c = self.config_dir();
        vec![
            (
                c.join("containers.conf"),
                format!(
                    "# Written by dxtutor: the private Podman sandbox of the Learning Track.\n\
                     [containers]\nlog_driver = \"k8s-file\"\nlog_size_max = 4194304\npids_limit = 128\n\n\
                     [engine]\nevents_logger = \"file\"\nevents_logfile_path = {}\ntmp_dir = {}\nvolume_path = {}\n\
                     cgroup_manager = \"systemd\"\n\n[network]\nnetwork_config_dir = {}\n",
                    q(self.root.join("events.log")),
                    q(self.tmpdir()),
                    q(self.root.join("volumes")),
                    q(self.root.join("networks")),
                ),
            ),
            (
                c.join("storage.conf"),
                format!(
                    "# Written by dxtutor: the private Podman sandbox of the Learning Track.\n\
                     [storage]\ndriver = \"overlay\"\ngraphroot = {}\nrunroot = {}\n",
                    q(self.storage()),
                    q(self.runroot()),
                ),
            ),
            (
                c.join("registries.conf"),
                "# Written by dxtutor: images are always named in full; nothing is searched.\n\
                 unqualified-search-registries = []\nshort-name-mode = \"enforcing\"\n"
                    .to_string(),
            ),
            (c.join("auth.json"), "{}\n".to_string()),
        ]
    }

    /// Cria as pastas e escreve a configuração (só quando muda). Idempotente.
    pub fn ensure(&self) -> Result<()> {
        for d in [
            self.root.clone(),
            self.storage(),
            self.root.join("volumes"),
            self.root.join("networks"),
            self.config_dir(),
            self.home(),
            self.root.join("tmp"),
        ] {
            std::fs::create_dir_all(&d).with_context(|| format!("create {}", d.display()))?;
        }
        let _ = std::fs::set_permissions(&self.root, std::fs::Permissions::from_mode(0o700));
        private_dir(&self.run_dir)?;
        for d in [self.runroot(), self.tmpdir()] {
            private_dir(&d)?;
        }
        for (path, content) in self.config_files() {
            if std::fs::read_to_string(&path).ok().as_deref() != Some(content.as_str()) {
                std::fs::write(&path, content)
                    .with_context(|| format!("write {}", path.display()))?;
            }
        }
        Ok(())
    }

    /// As flags globais de cada comando (as mesmas chegam ao `container cleanup` do conmon).
    pub fn global_args(&self) -> Vec<String> {
        let p = |x: PathBuf| x.display().to_string();
        vec![
            "--root".into(),
            p(self.storage()),
            "--runroot".into(),
            p(self.runroot()),
            "--tmpdir".into(),
            p(self.tmpdir()),
            "--volumepath".into(),
            p(self.root.join("volumes")),
            "--network-config-dir".into(),
            p(self.root.join("networks")),
            "--events-backend".into(),
            "file".into(),
            "--cgroup-manager".into(),
            "systemd".into(),
            "--storage-driver".into(),
            "overlay".into(),
            "--log-level".into(),
            "error".into(),
        ]
    }

    /// O ambiente completo de um comando (depois de `env_clear`).
    pub fn env(&self) -> Vec<(String, String)> {
        let p = |x: PathBuf| x.display().to_string();
        let mut path = String::new();
        if let Some(dir) = self.bin.parent() {
            path.push_str(&dir.display().to_string());
            path.push(':');
        }
        path.push_str("/usr/local/bin:/usr/bin:/bin");
        let c = self.config_dir();
        let h = self.home();
        vec![
            ("PATH".into(), path),
            ("HOME".into(), p(h.clone())),
            ("XDG_CONFIG_HOME".into(), p(h.join(".config"))),
            ("XDG_DATA_HOME".into(), p(h.join(".local/share"))),
            ("XDG_CACHE_HOME".into(), p(h.join(".cache"))),
            ("XDG_RUNTIME_DIR".into(), p(self.runtime_dir.clone())),
            (
                "DBUS_SESSION_BUS_ADDRESS".into(),
                format!("unix:path={}", self.runtime_dir.join("bus").display()),
            ),
            ("CONTAINERS_CONF".into(), p(c.join("containers.conf"))),
            ("CONTAINERS_STORAGE_CONF".into(), p(c.join("storage.conf"))),
            (
                "CONTAINERS_REGISTRIES_CONF".into(),
                p(c.join("registries.conf")),
            ),
            ("REGISTRY_AUTH_FILE".into(), p(c.join("auth.json"))),
            // As camadas grandes de um `pull` passam por aqui (o omisso é /var/tmp).
            ("TMPDIR".into(), p(self.root.join("tmp"))),
            ("LANG".into(), "C".into()),
        ]
    }

    /// Aplica o ambiente do sandbox a um comando (limpa o herdado).
    pub fn configure(&self, cmd: &mut Command) {
        cmd.env_clear();
        for (k, v) in self.env() {
            cmd.env(k, v);
        }
    }

    /// `podman <flags globais> <args>`, com o ambiente do sandbox.
    pub fn command(&self, args: &[String]) -> Command {
        let mut cmd = Command::new(&self.bin);
        cmd.args(self.global_args()).args(args);
        cmd.current_dir("/");
        self.configure(&mut cmd);
        cmd
    }

    /// Corre `podman <args>` com tempo limite (o grupo de processos morre ao excedê-lo) e a saída
    /// limitada (`RLIMIT_FSIZE` de 1 GiB herdado pelo conmon e pelos contentores).
    pub fn exec(&self, args: &[String], timeout: Duration) -> Result<Exec> {
        let out_dir = tempfile::Builder::new()
            .prefix("dxtutor-sbx-out-")
            .tempdir()
            .context("create the output folder")?;
        let cmd = self.command(args);
        const INF: u64 = u64::MAX;
        let limits = Rlimits {
            cpu_secs: INF,
            as_bytes: INF,
            fsize_bytes: 1 << 30,
            nproc: INF,
        };
        let out = run_guarded(cmd, out_dir.path(), "podman", timeout, Some(limits))
            .with_context(|| format!("run {}", self.bin.display()))?;
        Ok(Exec {
            code: out.status.and_then(|s| s.code()),
            stdout: out.stdout,
            stderr: out.stderr,
            timed_out: out.timed_out,
        })
    }

    /// [`Sandbox::exec`] que falha quando o comando falha (para a manutenção do sandbox).
    fn exec_ok(&self, args: &[&str], timeout: Duration) -> Result<String> {
        let argv: Vec<String> = args.iter().map(|s| s.to_string()).collect();
        let out = self.exec(&argv, timeout)?;
        if !out.ok() {
            bail!(
                "`podman {}` failed{}: {}",
                args.join(" "),
                if out.timed_out { " (timed out)" } else { "" },
                out.stderr.trim()
            );
        }
        Ok(out.stdout)
    }

    /// `podman --version` (sem tocar no armazenamento): `podman version 4.9.3`.
    pub fn version(&self) -> Result<String> {
        self.ensure()?;
        let out = self.exec(&["--version".to_string()], Duration::from_secs(15))?;
        if !out.ok() {
            bail!("`podman --version` failed: {}", out.stderr.trim());
        }
        let v = out.stdout.trim().to_string();
        if let Some((major, minor)) = parse_version(&v) {
            if (major, minor) < MIN_PODMAN {
                bail!(
                    "{v} is too old: the sandbox needs Podman {}.{} or newer ({})",
                    MIN_PODMAN.0,
                    MIN_PODMAN.1,
                    install_hint()
                );
            }
        }
        Ok(v)
    }

    /// Tranca o sandbox (exclusivo, entre processos: a app e o `dxt`). Uma corrida de avaliação
    /// limpa os restos e as imagens intermédias com ele na mão.
    pub fn lock(&self) -> Result<SandboxLock> {
        std::fs::create_dir_all(&self.root)
            .with_context(|| format!("create {}", self.root.display()))?;
        let path = self.root.join("sandbox.lock");
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .with_context(|| format!("open {}", path.display()))?;
        use std::os::fd::AsRawFd;
        // SAFETY: flock num descritor válido; bloqueia até ter a tranca.
        let rc = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
        if rc != 0 {
            bail!(
                "lock {}: {}",
                path.display(),
                std::io::Error::last_os_error()
            );
        }
        Ok(SandboxLock { _file: file })
    }

    /// Remove o que tem a etiqueta `label` (`chave=valor`): contentores (com `-t 0`, e os seus
    /// volumes anónimos, `-v`), volumes,
    /// redes e imagens; depois as imagens intermédias sem nome (`image prune`, só as pendentes) e os
    /// contentores de trabalho do buildah que um `build` interrompido deixou. Chamar com a tranca
    /// ([`Sandbox::lock`]) na mão: o `prune` e os contentores do buildah não têm etiqueta.
    pub fn cleanup(&self, label: &str) -> Cleaned {
        let t = Duration::from_secs(120);
        let filter = format!("label={label}");
        let mut c = Cleaned::default();
        let mut note = |what: &str, r: Result<String>| match r {
            Ok(out) => out
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|l| l.trim().to_string())
                .collect::<Vec<_>>(),
            Err(e) => {
                c.errors.push(format!("{what}: {e}"));
                Vec::new()
            }
        };
        let containers = note(
            "containers",
            self.exec_ok(&["rm", "-f", "-v", "-t", "0", "--filter", &filter], t),
        );
        let volumes = note(
            "volumes",
            self.exec_ok(&["volume", "prune", "-f", "--filter", &filter], t),
        );
        let networks = note(
            "networks",
            self.exec_ok(&["network", "prune", "-f", "--filter", &filter], t),
        );
        let ids = note(
            "images",
            self.exec_ok(&["images", "-q", "--no-trunc", "--filter", &filter], t),
        );
        let ids: BTreeSet<String> = ids.into_iter().collect();
        let mut removed_images = 0;
        if !ids.is_empty() {
            let mut args = vec!["rmi", "-f"];
            args.extend(ids.iter().map(String::as_str));
            removed_images = note("images", self.exec_ok(&args, t)).len();
        }
        // Os contentores de trabalho do buildah (um build morto a meio deixa-os): só podem ser das
        // construções da avaliação, a única coisa que constrói neste armazenamento.
        let external = note(
            "build containers",
            self.exec_ok(
                &["ps", "-a", "--external", "--format", "{{.ID}} {{.Command}}"],
                t,
            ),
        );
        for line in external {
            let mut parts = line.split_whitespace();
            if let (Some(id), Some("buildah")) = (parts.next(), parts.next()) {
                let _ = self.exec_ok(&["rm", "-f", id], t);
            }
        }
        let pruned = note(
            "dangling images",
            self.exec_ok(&["image", "prune", "-f"], t),
        );
        c.containers = containers.len();
        c.volumes = volumes.len();
        c.networks = networks.len();
        c.images = removed_images + pruned.len();
        c
    }

    /// Mata o que resta na fatia systemd da corrida `run` (os `RUN` de um `build` que excedeu o
    /// tempo) e pára-a. Melhor esforço.
    pub fn stop_run_slice(&self, run: &str) {
        if !run.chars().all(|c| c.is_ascii_hexdigit()) {
            return;
        }
        let unit = format!("{SLICE_PREFIX}{run}.slice");
        let path = PathBuf::from(format!(
            "/sys/fs/cgroup/user.slice/user-{0}.slice/user@{0}.service/dxtutor.slice/dxtutor-sbx.slice/{unit}",
            uid()
        ));
        if path.is_dir() {
            let _ = std::fs::write(path.join("cgroup.kill"), "1");
        }
        let mut cmd = Command::new("systemctl");
        cmd.args(["--user", "stop", &unit]);
        self.configure(&mut cmd);
        let _ = run_guarded(
            cmd,
            &std::env::temp_dir(),
            &format!("slice-{run}"),
            Duration::from_secs(20),
            None,
        );
    }

    /// O `--cgroup-parent` das construções da corrida `run` (ver o cabeçalho do módulo).
    pub fn build_cgroup_parent(run: &str) -> String {
        format!("{SLICE_PREFIX}{run}.slice:runc:build")
    }

    /// `true` se a imagem `reference` existe no armazenamento do sandbox.
    pub fn has_image(&self, reference: &str) -> Result<bool> {
        let out = self.exec(
            &["image".into(), "exists".into(), reference.into()],
            Duration::from_secs(30),
        )?;
        match out.code {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => bail!(
                "`podman image exists {reference}` failed: {}",
                out.stderr.trim()
            ),
        }
    }

    /// Confirma, num contentor de prova da imagem `image`, que os limites de memória e de processos
    /// valem (lidos dos cgroups dentro do contentor). Uma vez por raiz e por processo.
    pub fn verify_limits(&self, image: &str) -> Result<()> {
        static VERIFIED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
        if VERIFIED
            .lock()
            .map(|v| v.contains(&self.root))
            .unwrap_or(false)
        {
            return Ok(());
        }
        let run = new_run_id();
        let mut limits = crate::container::ContainerLimits::grading();
        limits.labels = vec![
            (LABEL_SANDBOX.into(), PURPOSE_GRADE.into()),
            (LABEL_RUN.into(), run.clone()),
        ];
        let mut args: Vec<String> = vec![
            "run".into(),
            "--rm".into(),
            "--network".into(),
            "none".into(),
        ];
        args.extend(limits.run_args());
        args.extend([
            image.to_string(),
            "cat".into(),
            "/sys/fs/cgroup/memory.max".into(),
            "/sys/fs/cgroup/pids.max".into(),
        ]);
        let out = self.exec(&args, Duration::from_secs(60))?;
        let _ = self.cleanup(&format!("{LABEL_RUN}={run}"));
        if !out.ok() {
            bail!(
                "the sandbox could not start a limited container: {}",
                out.stderr.trim()
            );
        }
        let lines: Vec<&str> = out.stdout.lines().map(str::trim).collect();
        let want_mem = (limits.memory_mb.unwrap_or(0) * 1024 * 1024).to_string();
        let want_pids = limits.pids.unwrap_or(0).to_string();
        if lines.first() != Some(&want_mem.as_str()) || lines.get(1) != Some(&want_pids.as_str()) {
            bail!(
                "rootless Podman did not apply the sandbox limits (memory.max {:?}, pids.max {:?}; \
                 expected {want_mem} and {want_pids}): the cgroup v2 memory and pids controllers must be \
                 delegated to your user session. Grading never runs a container without them.",
                lines.first(),
                lines.get(1)
            );
        }
        if let Ok(mut v) = VERIFIED.lock() {
            v.push(self.root.clone());
        }
        Ok(())
    }

    /// Apaga o sandbox inteiro (armazenamento e estado): os ficheiros das camadas pertencem aos
    /// subuids do utilizador, por isso apaga-se dentro do seu espaço de utilizador (`podman
    /// unshare`). Para os testes e para «esquecer» o sandbox; nunca apaga fora da raiz.
    pub fn destroy(&self) -> Result<()> {
        let mut last = String::new();
        for attempt in 0..5 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(400));
            }
            // As camadas e os volumes pertencem aos subuids: apagam-se dentro do espaço de
            // utilizador do Podman, onde o `storage/overlay` está montado sobre si próprio (cada
            // comando do Podman volta a montá-lo): desmonta-se e apaga-se no MESMO processo. Os
            // caminhos vão como argumentos do `sh`, nunca dentro do texto do script.
            let argv: Vec<String> = vec![
                "unshare".into(),
                "sh".into(),
                "-c".into(),
                r#"umount -R -l -- "$1" 2>/dev/null; shift; rm -rf -- "$@""#.into(),
                "sh".into(),
                self.storage().join("overlay").display().to_string(),
                self.storage().display().to_string(),
                self.root.join("volumes").display().to_string(),
            ];
            let out = run_guarded(
                self.command(&argv),
                &std::env::temp_dir(),
                "sbx-destroy",
                Duration::from_secs(120),
                None,
            )?;
            // O resto (a configuração, as trancas que o Podman volta a criar ao sair, o runroot)
            // é do utilizador.
            let mut errs = Vec::new();
            for dir in [&self.root, &self.run_dir] {
                if dir.exists() {
                    if let Err(e) = std::fs::remove_dir_all(dir) {
                        errs.push(format!("{}: {e}", dir.display()));
                    }
                }
            }
            if errs.is_empty() {
                return Ok(());
            }
            last = format!("{} {}", out.stderr.trim(), errs.join("; "));
        }
        bail!("could not remove {}: {}", self.root.display(), last.trim())
    }
}

/// A tranca do sandbox (solta-se ao cair).
pub struct SandboxLock {
    _file: std::fs::File,
}

/// O que uma limpeza removeu.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Cleaned {
    pub containers: usize,
    pub volumes: usize,
    pub networks: usize,
    pub images: usize,
    pub errors: Vec<String>,
}

impl Cleaned {
    pub fn is_empty(&self) -> bool {
        self.containers + self.volumes + self.networks + self.images == 0
    }
}

/// `podman version 4.9.3` → `(4, 9)`.
pub fn parse_version(text: &str) -> Option<(u32, u32)> {
    let v = text.split_whitespace().last()?;
    let mut parts = v.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((major, minor))
}

/// Uma cadeia TOML básica (com aspas e escapes).
fn toml_string(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c if c.is_control() => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Cria `dir` só para o utilizador (0700) ou confirma que a que existe é dele e não é uma ligação.
fn private_dir(dir: &Path) -> Result<()> {
    match std::fs::symlink_metadata(dir) {
        Ok(meta) => {
            if !meta.is_dir() || meta.uid() != uid() {
                bail!(
                    "{} exists and is not a folder owned by this user",
                    dir.display()
                );
            }
            if meta.mode() & 0o077 != 0 {
                std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))
                    .with_context(|| format!("chmod {}", dir.display()))?;
            }
            Ok(())
        }
        Err(_) => std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)
            .with_context(|| format!("create {}", dir.display())),
    }
}

/// Uma corrida de avaliação no sandbox: a tranca, o id, e a limpeza garantida ao cair (mesmo num
/// erro ou num pânico): os contentores, volumes e imagens com a etiqueta da corrida, as imagens
/// intermédias e a fatia systemd das construções.
pub struct Run<'a> {
    pub sandbox: &'a Sandbox,
    pub id: String,
    _lock: SandboxLock,
    started: Instant,
}

impl<'a> Run<'a> {
    /// Tranca o sandbox, remove os restos de corridas de avaliação anteriores (só os de
    /// [`PURPOSE_GRADE`]) e começa uma corrida nova.
    pub fn start(sandbox: &'a Sandbox) -> Result<Run<'a>> {
        sandbox.ensure()?;
        let lock = sandbox.lock()?;
        let leftovers = sandbox.cleanup(&format!("{LABEL_SANDBOX}={PURPOSE_GRADE}"));
        if !leftovers.errors.is_empty() {
            bail!(
                "the sandbox could not remove the leftovers of an earlier run: {}",
                leftovers.errors.join("; ")
            );
        }
        Ok(Run {
            sandbox,
            id: new_run_id(),
            _lock: lock,
            started: Instant::now(),
        })
    }

    /// As etiquetas de tudo o que esta corrida cria.
    pub fn labels(&self) -> Vec<(String, String)> {
        vec![
            (LABEL_SANDBOX.into(), PURPOSE_GRADE.into()),
            (LABEL_RUN.into(), self.id.clone()),
        ]
    }

    pub fn elapsed(&self) -> Duration {
        self.started.elapsed()
    }
}

impl Drop for Run<'_> {
    fn drop(&mut self) {
        self.sandbox.stop_run_slice(&self.id);
        let _ = self.sandbox.cleanup(&format!("{LABEL_RUN}={}", self.id));
    }
}

/// Ajudas dos testes que exercitam o sandbox real SEM rede: uma imagem construída `FROM scratch`
/// com o `busybox` estático do anfitrião (`/bin/busybox` no Ubuntu/Debian).
#[doc(hidden)]
pub mod testing {
    use super::*;

    /// `Some(sandbox)` numa raiz temporária quando esta máquina pode correr o sandbox real (Linux,
    /// `podman`, sessão systemd, um `busybox` estático); `None` (o teste salta) senão.
    pub fn sandbox_or_skip(root: &Path) -> Option<Sandbox> {
        let busybox = Path::new("/bin/busybox");
        if !busybox.is_file() || find_podman().is_none() {
            eprintln!("skip: no podman or no static busybox on this machine");
            return None;
        }
        match Sandbox::at(root) {
            Ok(sb) => Some(sb),
            Err(e) => {
                eprintln!("skip: {e}");
                None
            }
        }
    }

    /// Constrói `tag` (`localhost/fixture/busybox:1`) no sandbox, offline, e devolve o digest.
    pub fn busybox_image(sb: &Sandbox, tag: &str) -> Result<String> {
        sb.ensure()?;
        let ctx = tempfile::tempdir()?;
        std::fs::copy("/bin/busybox", ctx.path().join("busybox"))?;
        std::fs::write(
            ctx.path().join("Containerfile"),
            "FROM scratch\nCOPY busybox /bin/busybox\nRUN [\"/bin/busybox\", \"--install\", \"-s\", \"/bin\"]\n",
        )?;
        let out = sb.exec(
            &[
                "build".into(),
                "--pull=never".into(),
                "--network=none".into(),
                "-t".into(),
                tag.into(),
                ctx.path().display().to_string(),
            ],
            Duration::from_secs(120),
        )?;
        if !out.ok() {
            bail!("build the busybox fixture: {}", out.stderr);
        }
        let d = sb.exec(
            &[
                "image".into(),
                "inspect".into(),
                "--format".into(),
                "{{.Digest}}".into(),
                tag.into(),
            ],
            Duration::from_secs(30),
        )?;
        Ok(d.stdout.trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_parse_and_old_ones_are_spotted() {
        assert_eq!(parse_version("podman version 4.9.3"), Some((4, 9)));
        assert_eq!(parse_version("podman version 5.2.0-dev"), Some((5, 2)));
        assert_eq!(parse_version("nonsense"), None);
        assert!(parse_version("podman version 4.3.1").unwrap() < MIN_PODMAN);
    }

    #[test]
    fn run_ids_are_short_unique_hex() {
        let a = new_run_id();
        let b = new_run_id();
        assert_ne!(a, b);
        assert_eq!(a.len(), 12);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(
            Sandbox::build_cgroup_parent(&a),
            format!("dxtutor-sbx-{a}.slice:runc:build")
        );
    }

    #[test]
    fn the_root_lives_beside_the_course_caches_unless_overridden() {
        if std::env::var_os(ROOT_ENV).is_none() {
            assert_eq!(
                root_for(Path::new("/data/course-cache")),
                PathBuf::from("/data/course-cache/.sandbox/podman")
            );
        }
    }

    #[test]
    fn toml_strings_are_escaped() {
        assert_eq!(toml_string(r#"/a "b"\c"#), r#""/a \"b\"\\c""#);
    }

    /// Com uma sessão systemd (como nesta máquina): a configuração escrita aponta tudo para a raiz
    /// do sandbox e nunca para o HOME do utilizador.
    #[test]
    fn the_configuration_points_only_inside_the_sandbox() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("sbx");
        let Ok(sb) = Sandbox::with_bin(&root, Path::new("/usr/bin/podman")) else {
            return; // sem sessão systemd (CI): nada a verificar aqui
        };
        let files = sb.config_files();
        let all: String = files.iter().map(|(_, c)| c.as_str()).collect();
        let home = std::env::var("HOME").unwrap_or_default();
        assert!(!home.is_empty() && !all.contains(&format!("{home}/.local/share/containers")));
        assert!(all.contains(&sb.storage().display().to_string()));
        let env = sb.env();
        let get = |k: &str| env.iter().find(|(x, _)| x == k).map(|(_, v)| v.clone());
        assert_eq!(get("HOME"), Some(root.join("home").display().to_string()));
        assert!(get("CONTAINERS_CONF")
            .unwrap()
            .starts_with(&root.display().to_string()));
        let g = sb.global_args();
        let pos = g.iter().position(|a| a == "--runroot").unwrap();
        assert!(g[pos + 1].len() <= 50, "{}", g[pos + 1]);
        assert!(g
            .windows(2)
            .any(|w| w[0] == "--root" && w[1] == sb.storage().display().to_string()));
    }
}
