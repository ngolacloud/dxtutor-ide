//! **Comandos de contentores** das verificações (Learn P3a): a gramática, curta de propósito, dos
//! `podman …`/`docker …` que um `checks.toml` pode pedir. PURO.
//!
//! Um curso de contentores não passa argumentos ao Podman: escreve um comando da lista abaixo, que
//! se lê para uma forma tipada ([`PodCommand`]), e o avaliador (`tutor_eval::tool_runner`) gera o
//! comando real com as flags do sandbox à frente (limites, `--cap-drop=ALL`, `--pull=never`,
//! `--network none`, etiquetas, nomes prefixados pela corrida). Uma opção que não esteja aqui é
//! recusada — `--privileged`, `--network host`, `-p`, `-v /:/host`, `--device`, `--security-opt`,
//! `--pid host`, `--userns`… nunca chegam ao Podman.
//!
//! | comando | o que faz |
//! |---|---|
//! | `build -t <imagem> [-f <ficheiro>] [--target <estágio>] [--build-arg K=V]… [--no-cache] [--format docker\|oci] <pasta>` | constrói o Containerfile/Dockerfile do aluno |
//! | `run [opções] <imagem> [args…]` | corre um contentor (opções abaixo) |
//! | `volume create <nome>` | um volume com nome, só desta corrida |
//! | `exec [-u <utilizador>] [-w <pasta>] [-e K=V]… <contentor> <comando…>` | um comando num contentor que corre |
//! | `healthcheck run <contentor>` | corre o HEALTHCHECK da imagem uma vez |
//! | `image inspect <imagem>` · `inspect <contentor>` | o JSON da imagem ou do contentor (para `save`) |
//! | `history <imagem>` · `logs <contentor>` · `stop [-t N] <contentor>` | |
//!
//! Opções de `run`: `-d`, `--rm`, `--name <n>`, `-e K=V`, `-v <volume>:/caminho[:ro]` (só volumes
//! criados antes no mesmo passo — nunca uma pasta do anfitrião), `--mount
//! type=image,source=<imagem>,target=/caminho`, `--network none|container:<contentor>`, `-u`,
//! `-w`, `--entrypoint`, `--read-only`, `--tmpfs /caminho` e `--cap-add` (só [`CAPABILITIES`]).
//!
//! `docker …` é a mesma gramática (o curso de Docker escreve os comandos como os escreveria com o
//! Docker), avaliada pelo mesmo Podman rootless; o `docker build` constrói sempre no formato Docker
//! (o do Docker), por isso não aceita `--format`.

use std::collections::BTreeSet;

use crate::project::safe_project_path;

/// O CLI com que o curso escreve o comando (o que corre é sempre o Podman do sandbox).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Flavour {
    Podman,
    Docker,
}

impl Flavour {
    pub fn binary(self) -> &'static str {
        match self {
            Flavour::Podman => "podman",
            Flavour::Docker => "docker",
        }
    }
}

/// O formato da imagem construída. O Podman constrói OCI por omissão — e o OCI não guarda o
/// `HEALTHCHECK` (o Podman avisa e ignora-o) —; o Docker constrói sempre no formato Docker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Oci,
    Docker,
}

/// As capacidades que um `run` pode devolver depois do `--cap-drop=ALL`: as que um serviço normal
/// às vezes precisa (portas abaixo de 1024, mudar de dono, de utilizador) — nunca `SYS_ADMIN`,
/// `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`…
pub const CAPABILITIES: [&str; 7] = [
    "CHOWN",
    "DAC_OVERRIDE",
    "FOWNER",
    "SETGID",
    "SETUID",
    "NET_BIND_SERVICE",
    "KILL",
];

/// A rede de um `run`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Network {
    /// `--network none` (o omisso no sandbox).
    None,
    /// `--network container:<nome>`: o espaço de rede de outro contentor do passo.
    Container(String),
}

/// Um `run`, já lido.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunSpec {
    pub name: Option<String>,
    pub detach: bool,
    pub rm: bool,
    pub env: Vec<(String, String)>,
    /// `(volume, caminho, só leitura)`.
    pub volumes: Vec<(String, String, bool)>,
    /// `(imagem, caminho)`: `--mount type=image` (só leitura).
    pub image_mounts: Vec<(String, String)>,
    pub network: Network,
    pub user: Option<String>,
    pub workdir: Option<String>,
    pub entrypoint: Option<String>,
    pub read_only: bool,
    pub tmpfs: Vec<String>,
    pub cap_add: Vec<String>,
    pub image: String,
    pub args: Vec<String>,
}

/// A operação de um comando.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Op {
    Build {
        /// `app` ou `app:v1`.
        tag: String,
        file: Option<String>,
        dir: String,
        format: Option<Format>,
        target: Option<String>,
        build_args: Vec<(String, String)>,
        no_cache: bool,
    },
    Run(Box<RunSpec>),
    VolumeCreate {
        name: String,
    },
    Exec {
        name: String,
        user: Option<String>,
        workdir: Option<String>,
        env: Vec<(String, String)>,
        args: Vec<String>,
    },
    Healthcheck {
        name: String,
    },
    ImageInspect {
        image: String,
    },
    Inspect {
        name: String,
    },
    History {
        image: String,
    },
    Logs {
        name: String,
    },
    Stop {
        name: String,
        timeout: u32,
    },
}

/// Um comando de contentores da lista permitida.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PodCommand {
    pub flavour: Flavour,
    pub op: Op,
}

/// Os comandos permitidos, para as mensagens.
pub const ALLOWED: &str = "`build`, `run`, `volume create`, `exec`, `healthcheck run`, \
     `image inspect`, `inspect`, `history`, `logs` and `stop` (see the course guide for their options)";

/// Um nome de contentor ou de volume de um passo: minúsculas, dígitos e `-`, até 30.
pub fn name_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.starts_with(|c: char| c.is_ascii_lowercase())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// A tag de uma imagem construída no passo: `app` ou `app:v1`.
pub fn tag_ok(s: &str) -> bool {
    match s.split_once(':') {
        Some((n, t)) => {
            name_ok(n)
                && !t.is_empty()
                && t.len() <= 30
                && t.starts_with(|c: char| c.is_ascii_alphanumeric())
                && t.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        }
        None => name_ok(s),
    }
}

/// Um caminho absoluto dentro do contentor, sem `..` e que não seja a raiz.
pub fn container_path_ok(p: &str) -> bool {
    p.starts_with('/')
        && p.len() > 1
        && p.len() <= 200
        && !p.split('/').any(|c| c == ".." || c == ".")
        && p.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '-' | '.' | '@' | '+'))
}

fn env_ok(kv: &str) -> Option<(String, String)> {
    let (k, v) = kv.split_once('=')?;
    let key_ok = k.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && k.len() <= 64;
    (key_ok && !v.contains('\n') && v.len() <= 1000).then(|| (k.to_string(), v.to_string()))
}

fn user_ok(u: &str) -> bool {
    let part = |p: &str| {
        !p.is_empty()
            && p.len() <= 32
            && p.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
    };
    match u.split_once(':') {
        Some((a, b)) => part(a) && part(b),
        None => part(u),
    }
}

fn dir_arg_ok(p: &str) -> bool {
    p == "." || safe_project_path(p)
}

/// Lê um comando de contentores (`argv[0]` é `podman` ou `docker`). Ver o cabeçalho do módulo.
pub fn parse(argv: &[String]) -> Result<PodCommand, String> {
    let shown = argv.join(" ");
    let refuse = |why: String| {
        Err(format!(
            "command `{shown}` is not allowed in a check: {why}"
        ))
    };
    let flavour = match argv.first().map(String::as_str) {
        Some("podman") => Flavour::Podman,
        Some("docker") => Flavour::Docker,
        _ => return refuse("container commands start with `podman` or `docker`".into()),
    };
    let rest: Vec<&str> = argv[1..].iter().map(String::as_str).collect();
    let op = match rest.as_slice() {
        ["build", tail @ ..] => parse_build(flavour, tail),
        ["run", tail @ ..] => parse_run(tail).map(|r| Op::Run(Box::new(r))),
        ["volume", "create", name] if name_ok(name) => Ok(Op::VolumeCreate {
            name: name.to_string(),
        }),
        ["exec", tail @ ..] => parse_exec(tail),
        ["healthcheck", "run", name] if name_ok(name) => Ok(Op::Healthcheck {
            name: name.to_string(),
        }),
        ["image", "inspect", image] => Ok(Op::ImageInspect {
            image: image.to_string(),
        }),
        ["inspect", name] | ["container", "inspect", name] if name_ok(name) => Ok(Op::Inspect {
            name: name.to_string(),
        }),
        ["history", image] => Ok(Op::History {
            image: image.to_string(),
        }),
        ["logs", name] if name_ok(name) => Ok(Op::Logs {
            name: name.to_string(),
        }),
        ["stop", name] if name_ok(name) => Ok(Op::Stop {
            name: name.to_string(),
            timeout: 2,
        }),
        ["stop", "-t", t, name] if name_ok(name) => match t.parse::<u32>() {
            Ok(n) if n <= 10 => Ok(Op::Stop {
                name: name.to_string(),
                timeout: n,
            }),
            _ => Err("`stop -t` takes 0 to 10 seconds".into()),
        },
        _ => Err(format!("only {ALLOWED} are allowed")),
    };
    match op {
        Ok(op) => Ok(PodCommand { flavour, op }),
        Err(why) => refuse(why),
    }
}

/// Lê `--opção valor` ou `--opção=valor`.
fn take<'a>(
    words: &[&'a str],
    i: &mut usize,
    short: &[&str],
    long: &str,
) -> Option<Result<&'a str, String>> {
    let w = words[*i];
    if let Some(v) = w.strip_prefix(&format!("{long}=")) {
        *i += 1;
        return Some(Ok(v));
    }
    if w == long || short.contains(&w) {
        return Some(match words.get(*i + 1) {
            Some(v) => {
                *i += 2;
                Ok(v)
            }
            None => Err(format!("`{w}` needs a value")),
        });
    }
    None
}

fn parse_build(flavour: Flavour, w: &[&str]) -> Result<Op, String> {
    let (mut tag, mut file, mut format, mut target) = (None, None, None, None);
    let (mut build_args, mut no_cache, mut dir) = (Vec::new(), false, None);
    let mut i = 0;
    while i < w.len() {
        if let Some(v) = take(w, &mut i, &["-t"], "--tag") {
            let v = v?;
            if !tag_ok(v) {
                return Err(format!(
                    "`{v}` is not an image name for this step (`app` or `app:v1`, lowercase)"
                ));
            }
            tag = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &["-f"], "--file") {
            let v = v?;
            if !safe_project_path(v) {
                return Err(format!("`-f {v}` must be a file of the step"));
            }
            file = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &[], "--format") {
            if flavour == Flavour::Docker {
                return Err(
                    "`docker build` has no `--format`: Docker always builds Docker-format images"
                        .into(),
                );
            }
            format = Some(match v? {
                "docker" => Format::Docker,
                "oci" => Format::Oci,
                other => return Err(format!("`--format {other}`: use docker or oci")),
            });
        } else if let Some(v) = take(w, &mut i, &[], "--target") {
            let v = v?;
            if !name_ok(&v.to_ascii_lowercase()) {
                return Err(format!("`--target {v}` is not a stage name"));
            }
            target = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &[], "--build-arg") {
            let v = v?;
            build_args
                .push(env_ok(v).ok_or_else(|| format!("`--build-arg {v}` must be KEY=value"))?);
        } else if w[i] == "--no-cache" {
            no_cache = true;
            i += 1;
        } else if w[i].starts_with('-') {
            return Err(format!("`build {}` is not an allowed option", w[i]));
        } else {
            if dir.is_some() {
                return Err("`build` takes one context folder".into());
            }
            if !dir_arg_ok(w[i]) {
                return Err(format!(
                    "the build context `{}` must be `.` or a folder of the step",
                    w[i]
                ));
            }
            dir = Some(w[i].to_string());
            i += 1;
        }
    }
    Ok(Op::Build {
        tag: tag.ok_or("`build` needs `-t <name>`")?,
        file,
        dir: dir.ok_or("`build` needs the context folder (`.`)")?,
        format,
        target,
        build_args,
        no_cache,
    })
}

fn parse_run(w: &[&str]) -> Result<RunSpec, String> {
    let mut r = RunSpec {
        name: None,
        detach: false,
        rm: false,
        env: Vec::new(),
        volumes: Vec::new(),
        image_mounts: Vec::new(),
        network: Network::None,
        user: None,
        workdir: None,
        entrypoint: None,
        read_only: false,
        tmpfs: Vec::new(),
        cap_add: Vec::new(),
        image: String::new(),
        args: Vec::new(),
    };
    let mut i = 0;
    while i < w.len() {
        let word = w[i];
        if !word.starts_with('-') {
            r.image = word.to_string();
            r.args = w[i + 1..].iter().map(|s| s.to_string()).collect();
            break;
        }
        if matches!(word, "-d" | "--detach") {
            r.detach = true;
            i += 1;
        } else if word == "--rm" {
            r.rm = true;
            i += 1;
        } else if word == "--read-only" {
            r.read_only = true;
            i += 1;
        } else if let Some(v) = take(w, &mut i, &[], "--name") {
            let v = v?;
            if !name_ok(v) {
                return Err(format!("`--name {v}`: lowercase letters, digits and `-`"));
            }
            r.name = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &["-e"], "--env") {
            let v = v?;
            r.env
                .push(env_ok(v).ok_or_else(|| format!("`-e {v}` must be KEY=value"))?);
        } else if let Some(v) = take(w, &mut i, &["-v"], "--volume") {
            let v = v?;
            let parts: Vec<&str> = v.split(':').collect();
            let (vol, path, ro) = match parts.as_slice() {
                [vol, path] => (*vol, *path, false),
                [vol, path, "ro"] => (*vol, *path, true),
                [vol, path, "rw"] => (*vol, *path, false),
                _ => {
                    return Err(format!(
                        "`-v {v}`: write `<volume>:/path` or `<volume>:/path:ro`"
                    ))
                }
            };
            if !name_ok(vol) {
                return Err(format!(
                    "`-v {v}`: only named volumes created in this step are mounted, never a folder of your machine"
                ));
            }
            if !container_path_ok(path) {
                return Err(format!(
                    "`-v {v}`: `{path}` must be an absolute path in the container"
                ));
            }
            r.volumes.push((vol.to_string(), path.to_string(), ro));
        } else if let Some(v) = take(w, &mut i, &[], "--mount") {
            let v = v?;
            let (mut kind, mut src, mut dst) = (None, None, None);
            for kv in v.split(',') {
                match kv.split_once('=') {
                    Some(("type", t)) => kind = Some(t),
                    Some(("source" | "src", s)) => src = Some(s),
                    Some(("target" | "dst" | "destination", d)) => dst = Some(d),
                    _ => return Err(format!("`--mount {v}`: only type, source and target")),
                }
            }
            match (kind, src, dst) {
                (Some("image"), Some(s), Some(d)) if container_path_ok(d) => {
                    r.image_mounts.push((s.to_string(), d.to_string()))
                }
                _ => {
                    return Err(format!(
                        "`--mount {v}`: only `type=image,source=<image>,target=/path` (read-only)"
                    ))
                }
            }
        } else if let Some(v) =
            take(w, &mut i, &[], "--network").or_else(|| take(w, &mut i, &[], "--net"))
        {
            let v = v?;
            r.network = match v {
                "none" => Network::None,
                other => match other.strip_prefix("container:") {
                    Some(n) if name_ok(n) => Network::Container(n.to_string()),
                    _ => {
                        return Err(format!(
                            "`--network {other}`: only `none` or `container:<name>` (the sandbox never joins your machine's network)"
                        ))
                    }
                },
            };
        } else if let Some(v) = take(w, &mut i, &["-u"], "--user") {
            let v = v?;
            if !user_ok(v) {
                return Err(format!("`--user {v}` is not a user[:group]"));
            }
            r.user = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &["-w"], "--workdir") {
            let v = v?;
            if !container_path_ok(v) {
                return Err(format!("`-w {v}` must be an absolute path"));
            }
            r.workdir = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &[], "--entrypoint") {
            let v = v?;
            if v.contains('\n') || v.len() > 200 {
                return Err("`--entrypoint` is one command".into());
            }
            r.entrypoint = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &[], "--tmpfs") {
            let v = v?;
            if !container_path_ok(v) {
                return Err(format!("`--tmpfs {v}` must be an absolute path"));
            }
            r.tmpfs.push(v.to_string());
        } else if let Some(v) = take(w, &mut i, &[], "--cap-add") {
            let v = v?.to_ascii_uppercase();
            let v = v.strip_prefix("CAP_").unwrap_or(&v).to_string();
            if !CAPABILITIES.contains(&v.as_str()) {
                return Err(format!(
                    "`--cap-add {v}` is not allowed (only {})",
                    CAPABILITIES.join(", ")
                ));
            }
            r.cap_add.push(v);
        } else {
            return Err(format!(
                "`run {word}` is not an allowed option (no host network, ports, host folders, devices or privileges in the sandbox)"
            ));
        }
    }
    if r.image.is_empty() {
        return Err("`run` needs an image".into());
    }
    if r.args.iter().map(String::len).sum::<usize>() > 8000 {
        return Err("the command is too long".into());
    }
    Ok(r)
}

fn parse_exec(w: &[&str]) -> Result<Op, String> {
    let (mut user, mut workdir, mut env) = (None, None, Vec::new());
    let mut i = 0;
    while i < w.len() && w[i].starts_with('-') {
        if let Some(v) = take(w, &mut i, &["-u"], "--user") {
            let v = v?;
            if !user_ok(v) {
                return Err(format!("`--user {v}` is not a user[:group]"));
            }
            user = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &["-w"], "--workdir") {
            let v = v?;
            if !container_path_ok(v) {
                return Err(format!("`-w {v}` must be an absolute path"));
            }
            workdir = Some(v.to_string());
        } else if let Some(v) = take(w, &mut i, &["-e"], "--env") {
            let v = v?;
            env.push(env_ok(v).ok_or_else(|| format!("`-e {v}` must be KEY=value"))?);
        } else {
            return Err(format!(
                "`exec {}` is not an allowed option (no -it, no --privileged)",
                w[i]
            ));
        }
    }
    match w.get(i) {
        Some(n) if name_ok(n) && w.len() > i + 1 => Ok(Op::Exec {
            name: n.to_string(),
            user,
            workdir,
            env,
            args: w[i + 1..].iter().map(|s| s.to_string()).collect(),
        }),
        _ => Err("`exec` needs a container of the step and a command".into()),
    }
}

/// Erros de um passo (vazio = válido): os nomes que os comandos usam existem antes de serem
/// usados — imagens construídas (ou preparadas: `prepared` diz se uma referência é uma imagem
/// preparada do curso; `None` quando não se sabe e não se verifica), contentores com `--name` e
/// volumes criados — e não se repetem. `files` são os ficheiros do passo.
pub fn check_sequence(
    cmds: &[(usize, &PodCommand)],
    files: &BTreeSet<String>,
    prepared: Option<&dyn Fn(&str) -> bool>,
) -> Vec<String> {
    let mut errs = Vec::new();
    let mut images: BTreeSet<String> = BTreeSet::new();
    let mut containers: BTreeSet<String> = BTreeSet::new();
    let mut volumes: BTreeSet<String> = BTreeSet::new();
    let normal_tag = |t: &str| {
        if t.contains(':') {
            t.to_string()
        } else {
            format!("{t}:latest")
        }
    };
    let image_known = |img: &str, images: &BTreeSet<String>| -> bool {
        (tag_ok(img) && images.contains(&normal_tag(img)))
            || match prepared {
                Some(p) => p(img),
                // Sem a lista: uma imagem preparada escreve-se sempre com tag ou digest.
                None => img.contains(':') || img.contains('@'),
            }
    };
    let need_container =
        |at: &str, name: &str, containers: &BTreeSet<String>, errs: &mut Vec<String>| {
            if !containers.contains(name) {
                errs.push(format!(
                    "{at}: container `{name}` is not started (with `--name`) by an earlier command"
                ));
            }
        };
    for (n, c) in cmds {
        let at = format!("run #{n}");
        match &c.op {
            Op::Build { tag, file, dir, .. } => {
                let prefix = if dir == "." {
                    String::new()
                } else {
                    format!("{}/", dir.trim_end_matches('/'))
                };
                if dir != "." && !files.iter().any(|f| f.starts_with(&prefix)) {
                    errs.push(format!(
                        "{at}: the build context `{dir}` has no file of the step"
                    ));
                }
                match file {
                    Some(f) if !files.contains(f) => {
                        errs.push(format!("{at}: `{f}` is not a file of the step"))
                    }
                    None if !["Containerfile", "Dockerfile"]
                        .iter()
                        .any(|d| files.contains(&format!("{prefix}{d}"))) =>
                    {
                        errs.push(format!(
                            "{at}: the context `{dir}` has no Containerfile or Dockerfile (or say which with `-f`)"
                        ))
                    }
                    _ => {}
                }
                images.insert(normal_tag(tag));
            }
            Op::Run(r) => {
                if !image_known(&r.image, &images) {
                    errs.push(format!(
                        "{at}: image `{}` is neither built by an earlier command nor one of the course's prepared images",
                        r.image
                    ));
                }
                for (img, _) in &r.image_mounts {
                    if !image_known(img, &images) {
                        errs.push(format!(
                            "{at}: the mounted image `{img}` is neither built earlier nor prepared"
                        ));
                    }
                }
                for (v, _, _) in &r.volumes {
                    if !volumes.contains(v) {
                        errs.push(format!(
                            "{at}: volume `{v}` is not created by an earlier `volume create`"
                        ));
                    }
                }
                if let Network::Container(name) = &r.network {
                    need_container(&at, name, &containers, &mut errs);
                }
                if let Some(name) = &r.name {
                    if !containers.insert(name.clone()) {
                        errs.push(format!("{at}: container `{name}` is started twice"));
                    }
                }
            }
            Op::VolumeCreate { name } => {
                if !volumes.insert(name.clone()) {
                    errs.push(format!("{at}: volume `{name}` is created twice"));
                }
            }
            Op::Exec { name, .. }
            | Op::Healthcheck { name }
            | Op::Inspect { name }
            | Op::Logs { name }
            | Op::Stop { name, .. } => need_container(&at, name, &containers, &mut errs),
            Op::ImageInspect { image } | Op::History { image } => {
                if !image_known(image, &images) {
                    errs.push(format!(
                        "{at}: image `{image}` is neither built by an earlier command nor prepared"
                    ));
                }
            }
        }
    }
    errs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(s: &str) -> Vec<String> {
        s.split(' ').map(str::to_string).collect()
    }

    #[test]
    fn the_allowed_commands_parse() {
        let b = parse(&argv("podman build -t app:v1 -f Containerfile --target build --build-arg V=1 --no-cache --format docker .")).unwrap();
        assert_eq!(
            b.op,
            Op::Build {
                tag: "app:v1".into(),
                file: Some("Containerfile".into()),
                dir: ".".into(),
                format: Some(Format::Docker),
                target: Some("build".into()),
                build_args: vec![("V".into(), "1".into())],
                no_cache: true,
            }
        );
        let r = parse(&argv("docker run -d --name web -e PORT=8080 -v data:/data:ro --mount type=image,source=app,target=/img --network container:db -u 10001:10001 -w /app --read-only --tmpfs /tmp --cap-add net_bind_service app python app.py --x")).unwrap();
        assert_eq!(r.flavour, Flavour::Docker);
        let Op::Run(r) = r.op else { panic!() };
        assert_eq!(r.name.as_deref(), Some("web"));
        assert_eq!(r.volumes, vec![("data".into(), "/data".into(), true)]);
        assert_eq!(r.image_mounts, vec![("app".into(), "/img".into())]);
        assert_eq!(r.network, Network::Container("db".into()));
        assert_eq!(r.cap_add, vec!["NET_BIND_SERVICE".to_string()]);
        assert_eq!(r.image, "app");
        assert_eq!(r.args, argv("python app.py --x"));
        assert!(r.detach && r.read_only);
        for ok in [
            "podman volume create data",
            "podman exec -u app web id -u",
            "podman healthcheck run web",
            "podman image inspect app",
            "podman inspect web",
            "podman history app",
            "podman logs web",
            "podman stop -t 0 web",
        ] {
            assert!(parse(&argv(ok)).is_ok(), "{ok}");
        }
    }

    #[test]
    fn what_could_escape_the_sandbox_is_refused() {
        for bad in [
            "podman run --privileged app",
            "podman run --network host app",
            "podman run --net=host app",
            "podman run -p 8080:80 app",
            "podman run -v /:/host app",
            "podman run -v /etc:/etc app",
            "podman run -v ./src:/src app",
            "podman run --mount type=bind,source=/,target=/host app",
            "podman run --device /dev/kvm app",
            "podman run --security-opt seccomp=unconfined app",
            "podman run --pid host app",
            "podman run --userns host app",
            "podman run --cap-add SYS_ADMIN app",
            "podman run --cap-add ALL app",
            "podman run --pull always app",
            "podman run -v data:/ app",
            "podman run -v data:/a/../etc app",
            "podman exec -it web sh",
            "podman exec --privileged web sh",
            "podman build -t app /etc",
            "podman build -t app ../x",
            "podman build -t App .",
            "podman build -t app --network host .",
            "podman build -t app --pull always .",
            "docker build -t app --format oci .",
            "podman network create net",
            "podman pull alpine",
            "podman push app",
            "podman system reset",
            "podman cp web:/etc/passwd .",
            "kubectl kustomize .",
        ] {
            assert!(parse(&argv(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn names_must_exist_before_they_are_used() {
        let cmds: Vec<PodCommand> = [
            "podman build -t app .",
            "podman volume create data",
            "podman run -d --name web -v data:/data app",
            "podman run --network container:web alpine:3.24.4 wget -q -O- http://127.0.0.1:8000/",
            "podman exec web id",
            "podman image inspect app",
        ]
        .iter()
        .map(|c| parse(&argv(c)).unwrap())
        .collect();
        let files: BTreeSet<String> = ["Containerfile".to_string(), "app.py".to_string()].into();
        let numbered: Vec<(usize, &PodCommand)> =
            cmds.iter().enumerate().map(|(i, c)| (i + 1, c)).collect();
        let prepared = |r: &str| r == "alpine:3.24.4";
        assert_eq!(
            check_sequence(&numbered, &files, Some(&prepared)),
            Vec::<String>::new()
        );
        let bad: Vec<PodCommand> = [
            "podman run --name web app",
            "podman run -v data:/data alpine:3.24.4 true",
            "podman exec db id",
            "podman run --name web alpine:3.20 true",
            "podman build -t app -f Dockerfile .",
            "podman build -t api srv",
        ]
        .iter()
        .map(|c| parse(&argv(c)).unwrap())
        .collect();
        let numbered: Vec<(usize, &PodCommand)> =
            bad.iter().enumerate().map(|(i, c)| (i + 1, c)).collect();
        let errs = check_sequence(&numbered, &files, Some(&prepared)).join("\n");
        for frag in [
            "run #1: image `app`",
            "run #2: volume `data`",
            "run #3: container `db`",
            "run #4: image `alpine:3.20`",
            "started twice",
            "run #5: `Dockerfile` is not a file",
            "run #6: the build context `srv` has no file",
        ] {
            assert!(errs.contains(frag), "{frag} in\n{errs}");
        }
    }
}
