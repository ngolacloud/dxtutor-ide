//! Os comandos de contentores das verificações (Learn P3a), a correr no sandbox Podman rootless
//! (`crate::sandbox`). A gramática e as regras são do modelo (`tutor_core::podcmd`,
//! `tutor_core::containerfile`); aqui, cada comando lido vira o comando real, com as flags do
//! sandbox à frente:
//!
//! - **build**: `--pull=never --network=none --isolation=oci --force-rm --layers`, memória (1 GiB
//!   sem swap), CPU (dois), `--ulimit nproc=512` (no rootless conta por espaço de utilizador),
//!   `--cap-drop=ALL` com as seis capacidades que um `RUN adduser`/`chown` precisa
//!   ([`BUILD_CAPS`], dentro do espaço de utilizador rootless), `no-new-privileges`, a fatia systemd
//!   da corrida e as etiquetas; o Containerfile passa antes pela guarda
//!   ([`tutor_core::containerfile::guard`]);
//! - **run**: [`crate::container::ContainerLimits::grading`] (512 MiB, 128 processos, um CPU,
//!   `--cap-drop=ALL`, `no-new-privileges`, `--pull=never`), `--network none` (ou o espaço de rede
//!   de outro contentor da corrida), `--health-interval=disable` e as etiquetas;
//! - os nomes do passo (imagens, contentores, volumes) ganham o id da corrida
//!   (`localhost/dxtutor-<id>/app`, `dx-<id>-web`), e as saídas mostram-se sem ele.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use tutor_core::podcmd::{Flavour, Format, Network, Op, PodCommand};
use tutor_core::ImageRef;

use crate::container::ContainerLimits;
use crate::course_cache::NOT_PREPARED;
use crate::runner::RunOutput;
use crate::sandbox::{Run, Sandbox};

/// As capacidades dos contentores dos `RUN` de uma construção (dentro do espaço de utilizador
/// rootless: não valem nada fora dele).
pub const BUILD_CAPS: &str = "CHOWN,DAC_OVERRIDE,FOWNER,FSETID,SETGID,SETUID";
/// O tempo limite de cada comando que não é uma construção.
pub const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);

/// Uma sessão de comandos de contentores: a corrida no sandbox (tranca, etiquetas, limpeza ao
/// cair), a pasta de trabalho e as imagens preparadas.
pub(crate) struct PodSession<'a> {
    run: Run<'a>,
    work: PathBuf,
    images: Vec<ImageRef>,
    build_timeout: Duration,
    /// As imagens construídas nesta corrida (`app:latest`).
    built: BTreeSet<String>,
    counter: u32,
    pub(crate) version: String,
}

fn normal_tag(t: &str) -> String {
    if t.contains(':') {
        t.to_string()
    } else {
        format!("{t}:latest")
    }
}

impl<'a> PodSession<'a> {
    /// Tranca o sandbox, limpa os restos, confirma as imagens preparadas (pelo digest) e os limites.
    pub(crate) fn start(
        sandbox: &'a Sandbox,
        work: &Path,
        images: Vec<ImageRef>,
        key: &str,
        build_timeout: Duration,
    ) -> Result<PodSession<'a>> {
        let version = sandbox.version()?;
        let run = Run::start(sandbox)?;
        for img in &images {
            let out = sandbox.exec(
                &[
                    "image".into(),
                    "inspect".into(),
                    "--format".into(),
                    "{{.Digest}} {{range .RepoDigests}}{{.}} {{end}}".into(),
                    img.name(),
                ],
                COMMAND_TIMEOUT,
            )?;
            let found = out.ok()
                && out
                    .stdout
                    .split_whitespace()
                    .any(|d| d.ends_with(&img.digest));
            if !found {
                bail!(
                    "{NOT_PREPARED}: course `{key}`: the image `{}` is not in the container sandbox (or is not the pinned one). \
                     Grading never pulls images: use «Prepare course» again (or `dxt plugin prepare <course folder>`).",
                    img.name()
                );
            }
        }
        if let Some(first) = images.first() {
            sandbox.verify_limits(&first.name())?;
        }
        Ok(PodSession {
            run,
            work: work.to_path_buf(),
            images,
            build_timeout,
            built: BTreeSet::new(),
            counter: 0,
            version,
        })
    }

    fn container(&self, name: &str) -> String {
        format!("dx-{}-{name}", self.run.id)
    }

    fn image_of_tag(&self, tag: &str) -> String {
        format!("localhost/dxtutor-{}/{}", self.run.id, normal_tag(tag))
    }

    /// A imagem real de uma referência do curso: uma construída nesta corrida, ou uma preparada
    /// (pelo nome completo).
    fn image(&self, reference: &str) -> std::result::Result<String, String> {
        if tutor_core::podcmd::tag_ok(reference) && self.built.contains(&normal_tag(reference)) {
            return Ok(self.image_of_tag(reference));
        }
        if let Some(i) = self.images.iter().find(|i| i.matches(reference)) {
            return Ok(i.name());
        }
        Err(format!(
            "`{reference}` was not built in this step and is not one of the prepared images"
        ))
    }

    fn label_args(&self) -> Vec<String> {
        self.run
            .labels()
            .into_iter()
            .flat_map(|(k, v)| ["--label".to_string(), format!("{k}={v}")])
            .collect()
    }

    /// As saídas sem o id da corrida.
    pub(crate) fn tidy(&self, s: &str) -> String {
        // O aviso do runc rootless quando um `RUN` pede capacidades ambientes (inofensivo, e repetido
        // em cada passo da construção) não interessa ao aluno.
        let kept: Vec<&str> = s
            .lines()
            .filter(|l| !l.contains("can't raise ambient capability"))
            .collect();
        let mut out = kept.join("\n");
        if s.ends_with('\n') && !out.is_empty() {
            out.push('\n');
        }
        out.replace(&format!("localhost/dxtutor-{}/", self.run.id), "")
            .replace(&format!("dx-{}-", self.run.id), "")
    }

    /// Corre um comando. `Ok(Err(porquê))` = não correu (a guarda recusou); `Err` = o sandbox
    /// falhou.
    pub(crate) fn exec(
        &mut self,
        cmd: &PodCommand,
    ) -> Result<std::result::Result<RunOutput, String>> {
        let (args, timeout, after_build) = match self.translate(cmd)? {
            Ok(t) => t,
            Err(why) => return Ok(Err(why)),
        };
        let out = self.run.sandbox.exec(&args, timeout)?;
        if out.timed_out {
            // Um `RUN` de uma construção não pertence ao grupo do podman: a fatia mata-o.
            self.run.sandbox.stop_run_slice(&self.run.id);
        }
        if let Some(tag) = after_build {
            if out.ok() {
                self.built.insert(normal_tag(&tag));
            }
        }
        let mut stderr = self.tidy(&out.stderr);
        if out.timed_out {
            stderr.push_str(&format!(
                "\n[dxtutor] exceeded the {} s time limit and was stopped",
                timeout.as_secs()
            ));
        }
        Ok(Ok(RunOutput {
            ok: out.ok(),
            stdout: self.tidy(&out.stdout),
            stderr,
        }))
    }

    /// O comando real (args do podman, tempo limite, a tag a registar se for uma construção).
    #[allow(clippy::type_complexity)]
    fn translate(
        &mut self,
        cmd: &PodCommand,
    ) -> Result<std::result::Result<(Vec<String>, Duration, Option<String>), String>> {
        let s = |x: &str| x.to_string();
        Ok(Ok(match &cmd.op {
            Op::Build {
                tag,
                file,
                dir,
                format,
                target,
                build_args,
                no_cache,
            } => {
                let ctx = if dir == "." {
                    self.work.clone()
                } else {
                    self.work.join(dir)
                };
                let file_path = match file {
                    Some(f) => self.work.join(f),
                    None => match ["Containerfile", "Dockerfile"]
                        .iter()
                        .map(|n| ctx.join(n))
                        .find(|p| p.is_file())
                    {
                        Some(p) => p,
                        None => {
                            return Ok(Err(format!(
                                "there is no Containerfile or Dockerfile in `{dir}`"
                            )))
                        }
                    },
                };
                let text = std::fs::read_to_string(&file_path)
                    .with_context(|| format!("read {}", file_path.display()))?;
                let rel = file_path
                    .strip_prefix(&self.work)
                    .unwrap_or(&file_path)
                    .display()
                    .to_string();
                let instrs = match tutor_core::containerfile::parse(&text) {
                    Ok(i) => i,
                    Err(e) => return Ok(Err(format!("`{rel}` {e}"))),
                };
                if let Err(why) = tutor_core::containerfile::guard(&instrs, &self.images) {
                    return Ok(Err(format!("`{rel}` {why}")));
                }
                let fmt = match (cmd.flavour, format) {
                    (Flavour::Docker, _) | (_, Some(Format::Docker)) => "docker",
                    _ => "oci",
                };
                let mut a = vec![
                    s("build"),
                    s("--pull=never"),
                    s("--network=none"),
                    s("--isolation=oci"),
                    s("--force-rm"),
                    s("--layers=true"),
                    format!("--format={fmt}"),
                    s("--memory=1024m"),
                    s("--memory-swap=1024m"),
                    s("--cpu-period=100000"),
                    s("--cpu-quota=200000"),
                    s("--ulimit=nproc=512:512"),
                    s("--cap-drop=ALL"),
                    format!("--cap-add={BUILD_CAPS}"),
                    s("--security-opt=no-new-privileges"),
                    format!(
                        "--cgroup-parent={}",
                        Sandbox::build_cgroup_parent(&self.run.id)
                    ),
                ];
                a.extend(self.label_args());
                a.extend([s("-t"), self.image_of_tag(tag)]);
                a.extend([s("-f"), file_path.display().to_string()]);
                if let Some(t) = target {
                    a.extend([s("--target"), t.clone()]);
                }
                for (k, v) in build_args {
                    a.extend([s("--build-arg"), format!("{k}={v}")]);
                }
                if *no_cache {
                    a.push(s("--no-cache"));
                }
                a.push(ctx.display().to_string());
                (a, self.build_timeout, Some(tag.clone()))
            }
            Op::Run(r) => {
                self.counter += 1;
                let name = match &r.name {
                    Some(n) => self.container(n),
                    None => self.container(&format!("run{}", self.counter)),
                };
                let image = match self.image(&r.image) {
                    Ok(i) => i,
                    Err(why) => return Ok(Err(why)),
                };
                let mut limits = ContainerLimits::grading();
                limits.cap_add = r.cap_add.clone();
                limits.read_only = r.read_only;
                limits.labels = self.run.labels();
                let mut a = vec![s("run"), s("--name"), name];
                a.extend(limits.run_args());
                a.push(s("--health-interval=disable"));
                a.push(match &r.network {
                    Network::None => s("--network=none"),
                    Network::Container(c) => format!("--network=container:{}", self.container(c)),
                });
                if r.detach {
                    a.push(s("-d"));
                }
                if r.rm {
                    a.push(s("--rm"));
                }
                for (k, v) in &r.env {
                    a.extend([s("-e"), format!("{k}={v}")]);
                }
                for (vol, path, ro) in &r.volumes {
                    a.extend([
                        s("-v"),
                        format!(
                            "{}:{path}{}",
                            self.container(vol),
                            if *ro { ":ro" } else { "" }
                        ),
                    ]);
                }
                for (img, path) in &r.image_mounts {
                    let i = match self.image(img) {
                        Ok(i) => i,
                        Err(why) => return Ok(Err(why)),
                    };
                    a.push(format!("--mount=type=image,source={i},target={path}"));
                }
                for t in &r.tmpfs {
                    a.extend([s("--tmpfs"), format!("{t}:rw,size=64m")]);
                }
                if let Some(u) = &r.user {
                    a.extend([s("--user"), u.clone()]);
                }
                if let Some(w) = &r.workdir {
                    a.extend([s("--workdir"), w.clone()]);
                }
                if let Some(e) = &r.entrypoint {
                    a.push(format!("--entrypoint={e}"));
                }
                a.push(image);
                a.extend(r.args.iter().cloned());
                (a, COMMAND_TIMEOUT, None)
            }
            Op::VolumeCreate { name } => {
                let mut a = vec![s("volume"), s("create")];
                a.extend(self.label_args());
                a.push(self.container(name));
                (a, COMMAND_TIMEOUT, None)
            }
            Op::Exec {
                name,
                user,
                workdir,
                env,
                args,
            } => {
                let mut a = vec![s("exec")];
                if let Some(u) = user {
                    a.extend([s("--user"), u.clone()]);
                }
                if let Some(w) = workdir {
                    a.extend([s("--workdir"), w.clone()]);
                }
                for (k, v) in env {
                    a.extend([s("-e"), format!("{k}={v}")]);
                }
                a.push(self.container(name));
                a.extend(args.iter().cloned());
                (a, COMMAND_TIMEOUT, None)
            }
            Op::Healthcheck { name } => (
                vec![s("healthcheck"), s("run"), self.container(name)],
                COMMAND_TIMEOUT,
                None,
            ),
            Op::ImageInspect { image } => match self.image(image) {
                Ok(i) => (vec![s("image"), s("inspect"), i], COMMAND_TIMEOUT, None),
                Err(why) => return Ok(Err(why)),
            },
            Op::Inspect { name } => (
                vec![s("container"), s("inspect"), self.container(name)],
                COMMAND_TIMEOUT,
                None,
            ),
            Op::History { image } => match self.image(image) {
                Ok(i) => (vec![s("history"), i], COMMAND_TIMEOUT, None),
                Err(why) => return Ok(Err(why)),
            },
            Op::Logs { name } => (vec![s("logs"), self.container(name)], COMMAND_TIMEOUT, None),
            Op::Stop { name, timeout } => (
                vec![
                    s("stop"),
                    s("-t"),
                    timeout.to_string(),
                    self.container(name),
                ],
                COMMAND_TIMEOUT,
                None,
            ),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_normalised() {
        assert_eq!(normal_tag("app"), "app:latest");
        assert_eq!(normal_tag("app:v1"), "app:v1");
    }
}
