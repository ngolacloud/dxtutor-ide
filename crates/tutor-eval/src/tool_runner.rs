//! O **avaliador de ferramentas** (Learn P2b): os passos dos cursos de Kubernetes e do Delonix.
//!
//! Um passo destes não tem testes numa linguagem: o seu ficheiro oculto
//! [`tutor_core::toolcheck::CHECKS_FILE`] declara verificações estruturais sobre os ficheiros
//! YAML do aluno e comandos de ferramentas reais. As regras (forma, lista de comandos
//! permitidos, avaliação) são do modelo ([`tutor_core::toolcheck`]); aqui só se lê YAML, se
//! escrevem os ficheiros numa pasta nova e se correm os comandos.
//!
//! # Offline, sempre
//!
//! Só correm os comandos de [`tutor_core::toolcheck::parse_command`], sem shell, com o ambiente
//! LIMPO e uma caixa própria: `HOME`, `XDG_*`, `DELONIX_ROOT` e um `KUBECONFIG` VAZIO numa pasta
//! temporária (os contextos reais do utilizador nunca são lidos), tempo limite de parede e grupo de
//! processos próprio. Antes de correr, duas guardas no Rust tapam o que a lista não chega:
//!
//! - `kubectl kustomize`: um kustomization não pode apontar para a rede (um recurso remoto faz o
//!   kustomize correr o `git`; um URL `http(s)://` é descarregado) nem usar o Helm; cada
//!   `resources`/`components`/… tem de ser um caminho que EXISTE dentro da pasta de trabalho.
//! - `delonix compose config`: cada `ports` tem de dizer a porta do anfitrião (sem ela o delonix
//!   abre um socket para escolher uma porta livre — `compose.rs` `free_host_port`) e o ficheiro não
//!   pode interpolar variáveis.
//!
//! Uma ferramenta em falta é um ERRO com o que instalar ([`tutor_core::toolcheck::Tool::install_hint`]),
//! nunca um «falhou» obscuro nem um «passou».
//!
//! A avaliação destes comandos corre no anfitrião (mesmo com o sandbox de contentores ligado): só
//! lêem ficheiros.
//!
//! # Contentores (Learn P3a)
//!
//! Os cursos de Docker e de Podman (linguagem `dockerfile`) juntam os comandos de contentores de
//! [`tutor_core::podcmd`]: correm no sandbox Podman rootless (`crate::sandbox`,
//! `crate::container_check`) contra as imagens que «Prepare course» puxou — nunca no daemon do
//! Docker nem no armazenamento do Podman do utilizador, e nunca puxam nada. Um curso que não foi
//! preparado recusa com `COURSE_NOT_PREPARED`; sem `podman`, diz o que instalar.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{bail, Context, Result};
use serde_json::Value;
use tutor_core::toolcheck::{self, Checks, Expect, Outcome, Tool, ToolCommand, CHECKS_FILE};
use tutor_core::Phase;

use crate::complexity::Sample;
use crate::lang::{Diagnostic, LanguageRunner, Severity};
use crate::runner::{run_guarded, Correctness, RunOutput};

/// Tempo limite de cada comando.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
/// Quanto da saída de um comando entra no relatório.
const OUTPUT_TAIL: usize = 3000;

/// O avaliador dos cursos cujos passos se avaliam por verificações (`yaml`, e `dockerfile` nos
/// cursos de contentores, cujos ficheiros principais são Containerfiles).
#[derive(Debug, Clone, Copy, Default)]
pub struct ToolRunner {
    /// Os ficheiros dos drills e os diagnósticos são de Containerfiles (não de YAML).
    pub containerfile: bool,
}

impl ToolRunner {
    /// O avaliador de um curso em `language`.
    pub fn for_language(language: &str) -> Self {
        ToolRunner {
            containerfile: toolcheck::containerfile_language(language),
        }
    }
}

impl LanguageRunner for ToolRunner {
    fn check_correctness(&self, phase: &Phase, _student_code: &str) -> Result<Correctness> {
        bail!(
            "step `{}`: a course graded by checks uses project steps (`project` with `{CHECKS_FILE}` in its hidden files)",
            phase.id
        )
    }

    fn probe_complexity(&self, _phase: &Phase, _student_code: &str) -> Result<Vec<Sample>> {
        bail!("tool steps have no complexity probe")
    }

    fn diagnostics(&self, student_code: &str) -> Result<Vec<Diagnostic>> {
        if self.containerfile {
            return Ok(match tutor_core::containerfile::parse(student_code) {
                Ok(_) => Vec::new(),
                Err(e) => vec![Diagnostic {
                    line: e.line,
                    col: 1,
                    severity: Severity::Error,
                    message: e.message,
                }],
            });
        }
        Ok(match yaml_documents(student_code) {
            Ok(_) => Vec::new(),
            Err(e) => vec![Diagnostic {
                line: e.line,
                col: e.col,
                severity: Severity::Error,
                message: e.message,
            }],
        })
    }

    fn check_project(&self, phase: &Phase, tree: &BTreeMap<String, String>) -> Result<Correctness> {
        grade(
            phase,
            tree,
            &find_tool,
            crate::course_cache::root().as_deref(),
            &open_kind_cluster,
        )
    }

    fn grades_support_files(&self) -> bool {
        true
    }
}

// ── YAML ─────────────────────────────────────────────────────────────────────────────────

/// Um erro de leitura de YAML com a posição (base 1; 0 = desconhecida).
#[derive(Debug, Clone)]
pub struct YamlError {
    pub line: u32,
    pub col: u32,
    pub message: String,
}

/// Um valor YAML como valor JSON (o modelo das verificações). As chaves que não são texto viram
/// texto; as etiquetas (`!tag`) ficam com o valor.
fn to_json(v: serde_norway::Value) -> Value {
    use serde_norway::Value as Y;
    match v {
        Y::Null => Value::Null,
        Y::Bool(b) => Value::Bool(b),
        Y::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::from(i)
            } else if let Some(u) = n.as_u64() {
                Value::from(u)
            } else {
                n.as_f64()
                    .and_then(serde_json::Number::from_f64)
                    .map(Value::Number)
                    .unwrap_or(Value::Null)
            }
        }
        Y::String(s) => Value::String(s),
        Y::Sequence(s) => Value::Array(s.into_iter().map(to_json).collect()),
        Y::Mapping(m) => Value::Object(
            m.into_iter()
                .map(|(k, v)| {
                    let key = match k {
                        Y::String(s) => s,
                        Y::Number(n) => n.to_string(),
                        Y::Bool(b) => b.to_string(),
                        Y::Null => "null".to_string(),
                        other => serde_norway::to_string(&other)
                            .unwrap_or_default()
                            .trim()
                            .to_string(),
                    };
                    (key, to_json(v))
                })
                .collect(),
        ),
        Y::Tagged(t) => to_json(t.value),
    }
}

/// Os documentos de um texto YAML (separados por `---`), sem os vazios (como o `kubectl`). As
/// chaves `<<` (merge) aplicam-se, como no delonix.
pub fn yaml_documents(text: &str) -> std::result::Result<Vec<Value>, YamlError> {
    use serde::Deserialize;
    let mut out = Vec::new();
    for de in serde_norway::Deserializer::from_str(text) {
        let mut v = serde_norway::Value::deserialize(de).map_err(|e| {
            let (line, col) = e
                .location()
                .map(|l| (l.line() as u32, l.column() as u32))
                .unwrap_or((0, 0));
            YamlError {
                line,
                col,
                message: e.to_string(),
            }
        })?;
        v.apply_merge().map_err(|e| YamlError {
            line: 0,
            col: 0,
            message: e.to_string(),
        })?;
        if !v.is_null() {
            out.push(to_json(v));
        }
    }
    Ok(out)
}

/// Lê um ficheiro YAML da pasta de trabalho para as verificações (o erro já diz o ficheiro).
fn load_docs(name: &str, text: &str) -> std::result::Result<Vec<Value>, String> {
    yaml_documents(text).map_err(|e| format!("`{name}` is not valid YAML: {}", e.message))
}

/// A forma curta de um documento para a saída de um drill.
fn describe_doc(d: &Value) -> String {
    let kind = d.get("kind").and_then(Value::as_str);
    let name = d
        .get("metadata")
        .and_then(|m| m.get("name"))
        .and_then(Value::as_str);
    let api = d.get("apiVersion").and_then(Value::as_str);
    match (kind, name) {
        (Some(k), Some(n)) => format!(
            "{k}/{n}{}",
            api.map(|a| format!(" ({a})")).unwrap_or_default()
        ),
        (Some(k), None) => format!("{k} (no metadata.name)"),
        _ => match d.as_object() {
            Some(m) => format!(
                "a mapping with {}",
                m.keys()
                    .map(|k| format!("`{k}`"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            None => format!("a {} value", if d.is_array() { "list" } else { "scalar" }),
        },
    }
}

/// O caminho dos drills de um curso `yaml`: «correr» o ficheiro é lê-lo como YAML e dizer que
/// documentos tem. Sem ferramentas e sem rede.
pub fn run_yaml_program(code: &str) -> RunOutput {
    match yaml_documents(code) {
        Ok(docs) if docs.is_empty() => RunOutput {
            ok: false,
            stdout: String::new(),
            stderr: "no YAML document in the file".into(),
        },
        Ok(docs) => RunOutput {
            ok: true,
            stdout: format!(
                "valid YAML: {} document(s)\n{}\n",
                docs.len(),
                docs.iter()
                    .map(|d| format!("  - {}", describe_doc(d)))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
            stderr: String::new(),
        },
        Err(e) => RunOutput {
            ok: false,
            stdout: String::new(),
            stderr: format!("not valid YAML: {}", e.message),
        },
    }
}

/// O caminho dos drills de um curso de contentores: «correr» o Containerfile é lê-lo e dizer que
/// instruções e estágios tem. Sem construir nada, sem Podman e sem rede.
pub fn run_containerfile_program(code: &str) -> RunOutput {
    match tutor_core::containerfile::parse(code) {
        Ok(instrs) => RunOutput {
            ok: true,
            stdout: tutor_core::containerfile::describe(&instrs),
            stderr: String::new(),
        },
        Err(e) => RunOutput {
            ok: false,
            stdout: String::new(),
            stderr: format!("not a valid Containerfile: {e}"),
        },
    }
}

// ── Ferramentas ──────────────────────────────────────────────────────────────────────────

/// Onde está o executável de `tool`: no `PATH` de quem avalia, senão nas pastas habituais (a app
/// desktop pode arrancar com um `PATH` curto).
pub fn find_tool(tool: Tool) -> Option<PathBuf> {
    if tool == Tool::Podman {
        return crate::sandbox::find_podman();
    }
    let bin = tool.binary();
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/usr/bin"));
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join(".local/bin"));
    }
    dirs.into_iter()
        .filter(|d| d.is_absolute())
        .map(|d| d.join(bin))
        .find(|f| f.is_file())
}

/// A caixa de um comando: pastas temporárias para `HOME`, `XDG_*`, `DELONIX_ROOT` e um
/// `KUBECONFIG` vazio. Fica fora da pasta de trabalho.
struct ToolSandbox {
    root: PathBuf,
}

impl ToolSandbox {
    fn create(root: &Path) -> Result<Self> {
        for d in ["home", "config", "cache", "data", "delonix", "out"] {
            std::fs::create_dir_all(root.join(d)).context("create the tool sandbox")?;
        }
        std::fs::write(root.join("kubeconfig"), "").context("create the empty kubeconfig")?;
        Ok(ToolSandbox {
            root: root.to_path_buf(),
        })
    }

    /// O comando com o ambiente limpo e só as variáveis da caixa.
    fn command(&self, bin: &Path, args: &[String], cwd: &Path) -> Command {
        let mut cmd = Command::new(bin);
        cmd.args(args).current_dir(cwd).env_clear();
        let mut path = String::new();
        if let Some(parent) = bin.parent() {
            path.push_str(&parent.display().to_string());
            path.push(':');
        }
        path.push_str("/usr/local/bin:/usr/bin:/bin");
        let r = &self.root;
        cmd.env("PATH", path)
            .env("HOME", r.join("home"))
            .env("XDG_CONFIG_HOME", r.join("config"))
            .env("XDG_CACHE_HOME", r.join("cache"))
            .env("XDG_DATA_HOME", r.join("data"))
            .env("KUBECONFIG", r.join("kubeconfig"))
            .env("DELONIX_ROOT", r.join("delonix"))
            .env("LANG", "C")
            .env("NO_COLOR", "1")
            .env("TERM", "dumb");
        cmd
    }

    fn run(&self, bin: &Path, args: &[String], cwd: &Path) -> Result<RunOutput> {
        let cmd = self.command(bin, args, cwd);
        let out = run_guarded(cmd, &self.root.join("out"), "tool", COMMAND_TIMEOUT, None)
            .with_context(|| format!("run {}", bin.display()))?;
        if out.timed_out {
            return Ok(RunOutput {
                ok: false,
                stdout: out.stdout,
                stderr: format!("exceeded the {} s time limit", COMMAND_TIMEOUT.as_secs()),
            });
        }
        Ok(RunOutput {
            ok: out.status.map(|s| s.success()).unwrap_or(false),
            stdout: out.stdout,
            stderr: out.stderr,
        })
    }
}

/// A versão de cada ferramenta (a saída de `version_args`, numa linha) ou o que instalar.
pub fn tool_versions(tools: &BTreeSet<Tool>) -> Vec<(Tool, std::result::Result<String, String>)> {
    tools.iter().map(|&t| (t, tool_version(t))).collect()
}

fn tool_version(tool: Tool) -> std::result::Result<String, String> {
    let bin = find_tool(tool).ok_or_else(|| tool.install_hint().to_string())?;
    let tmp = tempfile::Builder::new()
        .prefix("dxtutor-toolver-")
        .tempdir()
        .map_err(|e| e.to_string())?;
    let sb = ToolSandbox::create(tmp.path()).map_err(|e| e.to_string())?;
    let args: Vec<String> = tool.version_args().iter().map(|s| s.to_string()).collect();
    let out = sb
        .run(&bin, &args, &tmp.path().join("home"))
        .map_err(|e| e.to_string())?;
    if !out.ok {
        return Err(format!(
            "`{} {}` failed: {}",
            tool.binary(),
            args.join(" "),
            out.stderr.trim()
        ));
    }
    // kubectl: «Client Version: v1.36.6» + «Kustomize Version: v5.8.1»; delonix: «delonix 0.2.0»
    // na primeira linha (as seguintes são o slogan e o commit).
    let lines: Vec<&str> = out
        .stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect();
    Ok(match tool {
        Tool::Kubectl => lines
            .iter()
            .filter(|l| l.contains("Version:"))
            .copied()
            .collect::<Vec<_>>()
            .join(", "),
        Tool::Delonix => lines
            .iter()
            .take(1)
            .copied()
            .chain(lines.iter().filter(|l| l.starts_with("commit:")).copied())
            .collect::<Vec<_>>()
            .join(" · "),
        // «podman version 4.9.3»: o que os cursos de contentores correm (o rootless, no sandbox).
        Tool::Podman => format!(
            "{}, rootless sandbox",
            lines.first().copied().unwrap_or_default()
        ),
    })
}

// ── Guardas ──────────────────────────────────────────────────────────────────────────────

/// `p` relativo a `base` dentro de `root`, sem sair dele (lexicamente; não segue ligações — a
/// pasta de trabalho só tem ficheiros normais escritos pelo avaliador).
fn inside(root: &Path, base: &Path, p: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for comp in Path::new(p).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    out.starts_with(root).then_some(out)
}

fn looks_remote(s: &str) -> bool {
    let l = s.trim().to_ascii_lowercase();
    l.contains("://")
        || l.starts_with("git@")
        || l.starts_with("git::")
        || l.starts_with("github.com/")
        || l.starts_with("gitlab.com/")
        || l.starts_with("bitbucket.org/")
        || l.contains("?ref=")
        || l.contains("?version=")
}

fn all_strings<'a>(v: &'a Value, out: &mut Vec<&'a str>) {
    match v {
        Value::String(s) => out.push(s),
        Value::Array(a) => a.iter().for_each(|x| all_strings(x, out)),
        Value::Object(m) => m.values().for_each(|x| all_strings(x, out)),
        _ => {}
    }
}

const KUSTOMIZATION_FILES: [&str; 3] = ["kustomization.yaml", "kustomization.yml", "Kustomization"];
/// Campos de um kustomization cujas entradas de texto são caminhos para outros ficheiros ou
/// pastas (que o kustomize carregaria, até da rede).
const KUSTOMIZE_PATH_LISTS: [&str; 8] = [
    "resources",
    "bases",
    "components",
    "crds",
    "generators",
    "transformers",
    "validators",
    "configurations",
];
const KUSTOMIZE_FORBIDDEN: [&str; 3] = ["helmCharts", "helmGlobals", "helmChartInflationGenerator"];

/// A guarda do `kubectl kustomize`: nenhum kustomization da pasta de trabalho aponta para a rede
/// ou usa o Helm, e as listas de caminhos só nomeiam o que existe dentro da pasta.
fn kustomize_guard(work: &Path) -> std::result::Result<(), String> {
    let mut stack = vec![work.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in rd.flatten() {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                stack.push(p);
                continue;
            }
            let name = e.file_name().to_string_lossy().into_owned();
            if !KUSTOMIZATION_FILES.contains(&name.as_str()) {
                continue;
            }
            let rel = p.strip_prefix(work).unwrap_or(&p).display().to_string();
            let text = std::fs::read_to_string(&p).map_err(|e| format!("`{rel}`: {e}"))?;
            let docs = load_docs(&rel, &text)?;
            for d in &docs {
                let Some(m) = d.as_object() else { continue };
                if let Some(k) = KUSTOMIZE_FORBIDDEN.iter().find(|k| m.contains_key(**k)) {
                    return Err(format!(
                        "`{rel}` uses `{k}`: Helm charts are not built offline in this course"
                    ));
                }
                let mut strings = Vec::new();
                all_strings(d, &mut strings);
                if let Some(s) = strings.iter().find(|s| looks_remote(s)) {
                    return Err(format!(
                        "`{rel}` refers to `{s}`, which is remote: the course builds kustomizations offline, from local files only"
                    ));
                }
                for field in KUSTOMIZE_PATH_LISTS {
                    let Some(list) = m.get(field).and_then(Value::as_array) else {
                        continue;
                    };
                    for entry in list.iter().filter_map(Value::as_str) {
                        let base = p.parent().unwrap_or(work);
                        let ok = inside(work, base, entry).is_some_and(|t| t.exists());
                        if !ok {
                            return Err(format!(
                                "`{rel}`: `{field}` entry `{entry}` is not a file or folder of this step (only local paths inside the step are built)"
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// A guarda do `delonix compose config`: cada porta publicada diz a porta do anfitrião e o
/// ficheiro não interpola variáveis.
fn compose_guard(work: &Path, file: &str) -> std::result::Result<(), String> {
    let text = std::fs::read_to_string(work.join(file)).map_err(|e| format!("`{file}`: {e}"))?;
    if text.replace("$$", "").contains('$') {
        return Err(format!(
            "`{file}` uses `$` variable interpolation, which this course does not grade (the result would depend on the environment)"
        ));
    }
    let docs = load_docs(file, &text)?;
    let refuse = |svc: &str, port: &Value| {
        Err(format!(
            "service `{svc}`: the port {port} does not say the host port; write it as \"HOST:CONTAINER\" (e.g. \"8080:80\") — without one, compose picks a random free port on this machine"
        ))
    };
    for d in &docs {
        let Some(services) = d.get("services").and_then(Value::as_object) else {
            continue;
        };
        for (svc, s) in services {
            // delonix 0.2.0 (commit edba10a1c) panics in `topo_sort` on a `depends_on` that names
            // no service; say it in words instead of showing the learner a panic.
            let deps: Vec<&str> = match s.get("depends_on") {
                Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
                Some(Value::Object(m)) => m.keys().map(String::as_str).collect(),
                _ => Vec::new(),
            };
            if let Some(d) = deps.iter().find(|d| !services.contains_key(**d)) {
                return Err(format!(
                    "service `{svc}` depends on `{d}`, which is not a service of `{file}`"
                ));
            }
            let Some(ports) = s.get("ports").and_then(Value::as_array) else {
                continue;
            };
            for port in ports {
                let explicit = match port {
                    Value::String(p) => p.contains(':'),
                    Value::Object(m) => m.get("published").is_some_and(|p| !p.is_null()),
                    _ => false,
                };
                if !explicit {
                    return refuse(svc, port);
                }
            }
        }
    }
    Ok(())
}

fn guard(cmd: &ToolCommand, work: &Path) -> std::result::Result<(), String> {
    match cmd {
        ToolCommand::KubectlKustomize { .. } => kustomize_guard(work),
        ToolCommand::DelonixComposeConfig { file, .. } => compose_guard(work, file),
        ToolCommand::DelonixManifestRender { .. } => Ok(()),
        // Os comandos de contentores têm a sua guarda (`container_check`); o `append` não corre nada.
        ToolCommand::Pod { .. } | ToolCommand::Append { .. } => Ok(()),
    }
}

// ── A avaliação ──────────────────────────────────────────────────────────────────────────

fn tail(s: &str) -> String {
    let s = s.trim();
    let n = s.chars().count();
    if n <= OUTPUT_TAIL {
        s.to_string()
    } else {
        let cut: String = s.chars().skip(n - OUTPUT_TAIL).collect();
        format!("…{cut}")
    }
}

fn indent(s: &str) -> String {
    s.lines()
        .map(|l| format!("    {l}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Avalia um passo de projecto: escreve a árvore do aluno, os ocultos (menos o [`CHECKS_FILE`]) e
/// os ficheiros de apoio numa pasta nova, corre os comandos e as verificações, e diz tudo.
/// `find` localiza cada ferramenta ([`find_tool`]; os testes injectam outra).
fn grade(
    phase: &Phase,
    tree: &BTreeMap<String, String>,
    find: &dyn Fn(Tool) -> Option<PathBuf>,
    cache_root: Option<&Path>,
    open_cluster: OpenCluster,
) -> Result<Correctness> {
    let project = phase
        .project
        .as_ref()
        .with_context(|| format!("step `{}` is not a project step", phase.id))?;
    let images = phase
        .build
        .cache
        .as_ref()
        .filter(|c| c.kind() == Some(tutor_core::CacheKind::Images))
        .map(|c| {
            c.dependencies
                .iter()
                .filter_map(|d| tutor_core::image_reference(d).ok())
                .collect::<Vec<_>>()
        });
    let errs = toolcheck::check_step_with(project, images.as_deref());
    if !errs.is_empty() {
        bail!("invalid checks in step `{}`: {}", phase.id, errs.join("; "));
    }
    let checks = Checks::parse(&project.tests[CHECKS_FILE]).map_err(anyhow::Error::msg)?;

    // Uma ferramenta em falta: dizer o que instalar ANTES de correr o que quer que seja.
    let mut bins: BTreeMap<Tool, PathBuf> = BTreeMap::new();
    for tool in checks.tools() {
        match find(tool) {
            Some(b) => {
                bins.insert(tool, b);
            }
            None if tool == Tool::Kubectl && checks.needs_cluster() => bail!(
                "kubectl is not installed. Install kubectl v1.36 (https://kubernetes.io/docs/tasks/tools/) and open the course again: the live steps talk to the course's practice cluster with it (its own kubeconfig, never yours)."
            ),
            None => bail!("{}", tool.install_hint()),
        }
    }

    let tmp = tempfile::Builder::new()
        .prefix("dxtutor-tool-")
        .tempdir()
        .context("create the grading folder")?;
    let base = tmp
        .path()
        .canonicalize()
        .context("resolve the grading folder")?;
    let work = base.join("work");
    std::fs::create_dir_all(&work).context("create the work folder")?;
    let tool_sandbox = ToolSandbox::create(&base.join("sandbox"))?;
    let mut written: BTreeMap<String, String> = BTreeMap::new();
    for (rel, content) in tree
        .iter()
        .chain(
            project
                .tests
                .iter()
                .filter(|(k, _)| k.as_str() != CHECKS_FILE),
        )
        .chain(phase.support.iter())
    {
        write_new(&work, rel, content)?;
        written.insert(rel.clone(), content.clone());
    }

    let mut report: Vec<String> = Vec::new();
    let mut outcomes: Vec<Outcome> = Vec::new();
    let mut saved: BTreeMap<String, std::result::Result<Vec<Value>, String>> = BTreeMap::new();
    let mut raw_saved: BTreeMap<String, String> = BTreeMap::new();

    // O sandbox de contentores, se algum comando o usa: o curso tem de estar preparado (as imagens
    // no sandbox), e a sessão limpa tudo o que criar ao cair.
    let sandbox = match bins.get(&Tool::Podman) {
        None => None,
        Some(bin) => {
            let env = crate::course_cache::images_env_in(cache_root, &phase.build)?
                .with_context(|| {
                    format!(
                        "step `{}` runs container commands, but its course declares no base images: list them in [build] dependencies (with prepare = true)",
                        phase.id
                    )
                })?;
            Some((
                crate::sandbox::Sandbox::with_bin(&env.layout.images_sandbox, bin)?,
                env,
            ))
        }
    };
    let mut session = match &sandbox {
        None => None,
        Some((sb, env)) => Some(crate::container_check::PodSession::start(
            sb,
            &work,
            env.images.clone(),
            &env.key,
            env.timeout,
        )?),
    };
    if let Some(s) = &session {
        report.push(format!(
            "Graded in the private rootless Podman sandbox ({}); nothing is pulled and everything it creates is removed afterwards.\n",
            s.version
        ));
    }

    for run in &checks.runs {
        let cmd = toolcheck::parse_command(&run.cmd).map_err(anyhow::Error::msg)?;
        let shown = cmd.display();
        if let ToolCommand::Append { file, text } = &cmd {
            use std::io::Write;
            let path = work.join(file);
            let res = std::fs::OpenOptions::new()
                .append(true)
                .open(&path)
                .and_then(|mut f| f.write_all(text.as_bytes()));
            outcomes.push(Outcome {
                ok: res.is_ok(),
                label: format!("the grader changed `{file}` (appended a line)"),
                detail: match res {
                    Ok(()) => String::new(),
                    Err(e) => format!("{} (`{file}`: {e})", run.message),
                },
            });
            continue;
        }
        if let Err(why) = guard(&cmd, &work) {
            outcomes.push(Outcome {
                ok: false,
                label: shown.clone(),
                detail: format!("{} (not run: {why})", run.message),
            });
            if let Some(s) = &run.save {
                saved.insert(s.clone(), Err(format!("`{shown}` did not run")));
            }
            continue;
        }
        let mut attempt = 0;
        let (out, verdict) = loop {
            let out = match (&cmd, session.as_mut()) {
                (ToolCommand::Pod { cmd: pod, .. }, Some(s)) => match s.exec(pod)? {
                    Ok(o) => o,
                    Err(why) => {
                        break (
                            RunOutput {
                                ok: false,
                                stdout: String::new(),
                                stderr: String::new(),
                            },
                            Err(format!("not run: {why}")),
                        )
                    }
                },
                (ToolCommand::Pod { .. }, None) => bail!("no container sandbox for `{shown}`"),
                _ => {
                    let tool = cmd.tool().context("a command without a tool")?;
                    tool_sandbox.run(&bins[&tool], &cmd.args(), &work)?
                }
            };
            let verdict = judge(run, &out);
            attempt += 1;
            if verdict.is_ok() || attempt > run.retries {
                break (out, verdict);
            }
            std::thread::sleep(Duration::from_secs(1));
        };
        let both = format!("{}\n{}", out.stdout, out.stderr);
        let ok = verdict.is_ok();
        let mut detail = String::new();
        if let Err(why) = verdict {
            detail = if both.trim().is_empty() {
                format!("{} ({why})", run.message)
            } else {
                format!("{} ({why})\n{}", run.message, indent(&tail(&both)))
            };
        }
        outcomes.push(Outcome {
            ok,
            label: shown.clone(),
            detail,
        });
        if let Some(s) = &run.save {
            let v = if out.ok {
                raw_saved.insert(s.clone(), out.stdout.clone());
                load_docs(s, &out.stdout)
            } else {
                Err(format!("`{shown}` failed, so `{s}` has no content"))
            };
            saved.insert(s.clone(), v);
        }
    }

    // Os documentos de cada ficheiro que as verificações lêem (o aluno, os ocultos, os guardados).
    let mut docs: BTreeMap<String, std::result::Result<Vec<Value>, String>> = saved.clone();
    let wanted: BTreeSet<&str> = checks
        .checks
        .iter()
        .flat_map(|c| {
            std::iter::once(c.file.as_str()).chain(
                [&c.same_as, &c.among, &c.selects]
                    .into_iter()
                    .flatten()
                    .filter_map(|r| r.file.as_deref()),
            )
        })
        .collect();
    for f in wanted {
        if docs.contains_key(f) {
            continue;
        }
        if let Some(text) = written.get(f) {
            docs.insert(f.to_string(), load_docs(f, text));
        }
    }
    // As verificações que não precisam do cluster primeiro; as que lêem uma saída ao vivo depois.
    let (post, pre): (Vec<&toolcheck::Check>, Vec<&toolcheck::Check>) =
        checks.checks.iter().partition(|c| checks.is_post_live(c));
    outcomes.extend(pre.iter().map(|c| toolcheck::evaluate_check(c, &docs)));
    let mut header: Vec<String> = Vec::new();
    if checks.needs_cluster() {
        if outcomes.iter().any(|o| !o.ok) {
            outcomes.push(Outcome {
                ok: false,
                label: "live checks in the practice cluster".into(),
                detail: "not run: fix the checks above first — they need no cluster".into(),
            });
        } else {
            // Os ficheiros guardados pelos `[[run]]` também se podem aplicar.
            for (name, out) in &raw_saved {
                if !written.contains_key(name) {
                    write_new(&work, name, out)?;
                    written.insert(name.clone(), out.clone());
                }
            }
            let kubectl = bins
                .get(&Tool::Kubectl)
                .cloned()
                .context("kubectl was not found")?;
            let cluster = open_cluster(phase, &kubectl)?;
            header.push(cluster.describe());
            let live = live::run(cluster.as_ref(), phase, &checks, &work, &written)?;
            header.push(format!(
                "namespace {} (deleted after grading)",
                live.namespace
            ));
            outcomes.extend(live.outcomes);
            docs.extend(live.saved);
            outcomes.extend(post.iter().map(|c| toolcheck::evaluate_check(c, &docs)));
        }
    }

    let failed = outcomes.iter().filter(|o| !o.ok).count();
    report.extend(header.iter().map(|h| format!("· {h}")));
    if !header.is_empty() {
        report.push(String::new());
    }
    for o in &outcomes {
        if o.ok {
            report.push(format!("✓ {}", o.label));
        } else {
            report.push(format!(
                "✗ {}\n  {}",
                o.label,
                o.detail.replace('\n', "\n  ")
            ));
        }
    }
    let total = outcomes.len();
    let passed = failed == 0;
    report.push(String::new());
    report.push(if passed {
        format!("{total} of {total} checks passed")
    } else {
        format!("{failed} of {total} checks failed")
    });
    Ok(Correctness {
        passed,
        summary: if passed {
            "verificações passaram".to_string()
        } else {
            format!("{failed} de {total} verificações falharam")
        },
        raw: report.join("\n"),
    })
}

/// O veredicto de um comando: o código de saída esperado e as regras da saída.
fn judge(run: &toolcheck::Run, out: &RunOutput) -> std::result::Result<(), String> {
    let both = format!("{}\n{}", out.stdout, out.stderr);
    match (run.expect, out.ok) {
        (Expect::Success, false) => return Err("it failed".into()),
        (Expect::Failure, true) => {
            return Err("it succeeded, but it should refuse this input".into())
        }
        _ => {}
    }
    let missing: Vec<String> = run
        .output_contains
        .iter()
        .filter(|s| !both.contains(s.as_str()))
        .map(|s| format!("`{s}`"))
        .collect();
    if !missing.is_empty() {
        return Err(format!("the output lacks {}", missing.join(", ")));
    }
    for re in &run.output_matches {
        let rx = regex::Regex::new(re).map_err(|e| format!("bad regex: {e}"))?;
        if !rx.is_match(&both) {
            return Err(format!("the output does not match `{re}`"));
        }
    }
    if let Some(s) = run.output_lacks.iter().find(|s| both.contains(s.as_str())) {
        return Err(format!("the output contains `{s}`"));
    }
    Ok(())
}

// ── Ao vivo (Learn P3b) ──────────────────────────────────────────────────────────────────

/// The practice cluster a live step runs against (the real one is [`KindCluster`]; the tests use
/// a scripted one).
pub(crate) trait LiveCluster {
    /// One line for the report (the cluster, whether it was created now, the versions).
    fn describe(&self) -> String;
    /// The prepared images: the only ones a manifest may use.
    fn images(&self) -> Vec<tutor_core::ImageRef>;
    /// Runs `kubectl <args>` against the practice cluster, in `namespace` when given, from `cwd`.
    fn kubectl(
        &self,
        namespace: Option<&str>,
        args: &[String],
        cwd: &Path,
        timeout: Duration,
    ) -> Result<RunOutput>;
}

/// Opens the practice cluster of a phase (creating it when needed).
pub(crate) type OpenCluster<'a> = &'a dyn Fn(&Phase, &Path) -> Result<Box<dyn LiveCluster>>;

/// The course's kind cluster, locked for this grading (another process waits).
struct KindCluster {
    sb: crate::kindbox::Sandbox,
    kubectl: PathBuf,
    images: Vec<tutor_core::ImageRef>,
    ensured: crate::kindbox::Ensured,
    _lock: crate::kindbox::Lock,
}

impl LiveCluster for KindCluster {
    fn describe(&self) -> String {
        let how = if self.ensured.created {
            format!(
                "created now in {:.0} s (images loaded in {:.0} s)",
                self.ensured.create_secs, self.ensured.load_secs
            )
        } else {
            "reused".to_string()
        };
        format!(
            "practice cluster {} (kind {} on rootless Podman, Kubernetes {}): {how}",
            self.sb.name,
            crate::kindbox::KIND_VERSION,
            node_version()
        )
    }

    fn images(&self) -> Vec<tutor_core::ImageRef> {
        self.images.clone()
    }

    fn kubectl(
        &self,
        namespace: Option<&str>,
        args: &[String],
        cwd: &Path,
        timeout: Duration,
    ) -> Result<RunOutput> {
        let mut cmd = crate::kindbox::kubectl(&self.sb, &self.kubectl, namespace, args);
        cmd.current_dir(cwd);
        let r = crate::kindbox::run(cmd, timeout)?;
        Ok(RunOutput {
            ok: r.ok,
            stdout: r.stdout,
            stderr: if r.timed_out {
                format!(
                    "{}\nexceeded the {} s time limit",
                    r.stderr,
                    timeout.as_secs()
                )
            } else {
                r.stderr
            },
        })
    }
}

impl Drop for KindCluster {
    fn drop(&mut self) {
        crate::kindbox::touch(&self.sb);
    }
}

/// `v1.36.4` from the pinned node image.
fn node_version() -> String {
    tutor_core::image_reference(crate::kindbox::NODE_IMAGE)
        .map(|r| r.tag)
        .unwrap_or_default()
}

/// The images a phase's course prepared.
fn prepared_images(phase: &Phase) -> Vec<tutor_core::ImageRef> {
    phase
        .build
        .cache
        .iter()
        .flat_map(|c| &c.dependencies)
        .filter_map(|d| tutor_core::image_reference(d).ok())
        .collect()
}

/// The real [`OpenCluster`]: the course's prepared sandbox (or `COURSE_NOT_PREPARED`), locked,
/// with its cluster running (or `LIVE_UNAVAILABLE` when this machine cannot run it).
fn open_kind_cluster(phase: &Phase, kubectl: &Path) -> Result<Box<dyn LiveCluster>> {
    let Some(sb) = crate::course_cache::cluster_sandbox(&phase.build)? else {
        bail!(
            "step `{}` has live checks, but its course prepares no practice cluster (add `[build] prepare = true` with the images it uses)",
            phase.id
        );
    };
    let lock = crate::kindbox::lock(&sb)?;
    let ensured = crate::kindbox::ensure(&sb, kubectl)?;
    Ok(Box::new(KindCluster {
        images: prepared_images(phase),
        sb,
        kubectl: kubectl.to_path_buf(),
        ensured,
        _lock: lock,
    }))
}

mod live {
    use super::*;
    use tutor_core::livecheck::{self, LiveCommand};

    /// What the live part of a grading gave.
    pub(super) struct LiveResult {
        pub namespace: String,
        pub outcomes: Vec<Outcome>,
        pub saved: BTreeMap<String, std::result::Result<Vec<Value>, String>>,
    }

    const QUICK: Duration = Duration::from_secs(60);
    const POLL: Duration = Duration::from_secs(2);

    fn s(x: &str) -> String {
        x.to_string()
    }

    /// Creates the grading namespace, runs the `[[live]]` entries in order (stopping at the first
    /// that fails: the rest would only fail for the same reason) and deletes the namespace.
    pub(super) fn run(
        cluster: &dyn LiveCluster,
        phase: &Phase,
        checks: &Checks,
        work: &Path,
        written: &BTreeMap<String, String>,
    ) -> Result<LiveResult> {
        let ns = crate::kindbox::namespace_for(&phase.id);
        // Namespaces an interrupted grading left behind go first (this cluster is locked for us).
        let _ = cluster.kubectl(
            None,
            &[
                s("delete"),
                s("namespace"),
                s("-l"),
                s(crate::kindbox::GRADING_LABEL),
                s("--wait=false"),
                s("--ignore-not-found"),
            ],
            work,
            QUICK,
        );
        let made = cluster.kubectl(
            None,
            &[s("create"), s("namespace"), ns.clone()],
            work,
            QUICK,
        )?;
        if !made.ok {
            bail!(
                "could not create the grading namespace {ns}: {}",
                made.stderr.trim()
            );
        }
        let result = run_in(cluster, &ns, checks, work, written);
        let _ = cluster.kubectl(
            None,
            &[s("delete"), s("namespace"), ns.clone(), s("--wait=false")],
            work,
            QUICK,
        );
        let (outcomes, saved) = result?;
        Ok(LiveResult {
            namespace: ns,
            outcomes,
            saved,
        })
    }

    type Docs = BTreeMap<String, std::result::Result<Vec<Value>, String>>;

    fn run_in(
        cluster: &dyn LiveCluster,
        ns: &str,
        checks: &Checks,
        work: &Path,
        written: &BTreeMap<String, String>,
    ) -> Result<(Vec<Outcome>, Docs)> {
        let _ = cluster.kubectl(
            None,
            &[
                s("label"),
                s("namespace"),
                ns.to_string(),
                format!("{}=true", crate::kindbox::GRADING_LABEL),
            ],
            work,
            QUICK,
        );
        // A new namespace gets its `default` service account a moment later; a Pod applied
        // before it exists is refused.
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let r = cluster.kubectl(
                Some(ns),
                &[
                    s("get"),
                    s("serviceaccount"),
                    s("default"),
                    s("-o"),
                    s("name"),
                ],
                work,
                QUICK,
            )?;
            if r.ok || Instant::now() >= deadline {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let images = cluster.images();
        let mut outcomes = Vec::new();
        let mut saved: Docs = BTreeMap::new();
        let mut stopped = false;
        for entry in &checks.live {
            let cmd = livecheck::parse_live_command(&entry.cmd).map_err(anyhow::Error::msg)?;
            let shown = cmd.display();
            if stopped {
                outcomes.push(Outcome {
                    ok: false,
                    label: shown,
                    detail: "not run: an earlier live check failed".into(),
                });
                continue;
            }
            if let LiveCommand::Apply { file } = &cmd {
                let problems = match written.get(file) {
                    None => vec![format!("`{file}` is not a file of the step")],
                    Some(text) => match load_docs(file, text) {
                        Err(e) => vec![e],
                        Ok(docs) => livecheck::manifest_problems(file, &docs, &images),
                    },
                };
                if !problems.is_empty() {
                    outcomes.push(Outcome {
                        ok: false,
                        label: shown,
                        detail: format!("{} (not applied: {})", entry.message, problems.join("; ")),
                    });
                    stopped = true;
                    continue;
                }
            }
            let (out, until_detail) = match &entry.until {
                Some(until) => poll_until(cluster, ns, &cmd, until, entry.timeout_secs, work)?,
                None => {
                    let timeout = cmd
                        .wait_secs()
                        .map(|w| Duration::from_secs(w + 30))
                        .unwrap_or(QUICK);
                    (cluster.kubectl(Some(ns), &cmd.args(), work, timeout)?, None)
                }
            };
            let both = format!("{}\n{}", out.stdout, out.stderr);
            let status_ok = match entry.expect {
                Expect::Success => out.ok,
                Expect::Failure => !out.ok,
            };
            let missing: Vec<&String> = entry
                .output_contains
                .iter()
                .filter(|t| !both.contains(t.as_str()))
                .collect();
            let ok = status_ok && missing.is_empty() && until_detail.is_none();
            let mut detail = String::new();
            if !ok {
                let why = if let Some(d) = &until_detail {
                    d.clone()
                } else if !status_ok {
                    match entry.expect {
                        Expect::Success => "it failed".to_string(),
                        Expect::Failure => {
                            "it succeeded, but the cluster should refuse this".to_string()
                        }
                    }
                } else {
                    format!(
                        "the output lacks {}",
                        missing
                            .iter()
                            .map(|t| format!("`{t}`"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                };
                detail = format!("{} ({why})\n{}", entry.message, indent(&tail(&both)));
                stopped = true;
            }
            outcomes.push(Outcome {
                ok,
                label: shown.clone(),
                detail,
            });
            if let Some(name) = &entry.save {
                let v = if out.ok {
                    load_docs(name, &out.stdout)
                } else {
                    Err(format!("`{shown}` failed, so `{name}` has no content"))
                };
                saved.insert(name.clone(), v);
            }
        }
        Ok((outcomes, saved))
    }

    /// Repeats a `get … -o json` until `until` holds or the time runs out. The last output is
    /// returned; the detail says why it never held (`None` when it did).
    fn poll_until(
        cluster: &dyn LiveCluster,
        ns: &str,
        cmd: &LiveCommand,
        until: &toolcheck::Check,
        timeout_secs: Option<u64>,
        work: &Path,
    ) -> Result<(RunOutput, Option<String>)> {
        let limit = Duration::from_secs(timeout_secs.unwrap_or(livecheck::DEFAULT_WAIT_SECS));
        let deadline = Instant::now() + limit;
        let mut probe = until.clone();
        probe.file = String::new();
        if probe.message.trim().is_empty() {
            probe.message = "the condition did not hold".into();
        }
        loop {
            let out = cluster.kubectl(Some(ns), &cmd.args(), work, QUICK)?;
            let why = if out.ok {
                let mut docs: Docs = BTreeMap::new();
                docs.insert(String::new(), load_docs("output", &out.stdout));
                let o = toolcheck::evaluate_check(&probe, &docs);
                if o.ok {
                    return Ok((out, None));
                }
                o.detail
            } else {
                out.stderr.trim().to_string()
            };
            if Instant::now() >= deadline {
                let path = if until.path.is_empty() {
                    "the object".to_string()
                } else {
                    format!("`{}`", until.path)
                };
                return Ok((
                    out,
                    Some(format!(
                        "after {} s, {path} still did not match: {why}",
                        limit.as_secs()
                    )),
                ));
            }
            std::thread::sleep(POLL);
        }
    }
}

/// Cria `rel` (um caminho seguro) dentro de `root`, sem substituir nada.
fn write_new(root: &Path, rel: &str, content: &str) -> Result<()> {
    use std::io::Write;
    if !tutor_core::safe_project_path(rel) {
        bail!("unsafe path `{rel}`");
    }
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).with_context(|| format!("create folder for {rel}"))?;
    }
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .with_context(|| format!("write {rel} (already exists or not a file path)"))?;
    f.write_all(content.as_bytes())
        .with_context(|| format!("write {rel}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_core::{Gabarito, Level, ProjectFiles};

    fn phase(starter: &[(&str, &str)], checks: &str) -> Phase {
        let map = |p: &[(&str, &str)]| {
            p.iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect::<BTreeMap<_, _>>()
        };
        let main = starter[0].0.to_string();
        Phase {
            id: "t".into(),
            title: "t".into(),
            level: Level::Basico,
            language: "yaml".into(),
            instructions: String::new(),
            entry: String::new(),
            starter: String::new(),
            tests: String::new(),
            gabarito: Gabarito {
                solution: String::new(),
                time: String::new(),
                space: String::new(),
                justification: String::new(),
            },
            probe: None,
            hints: Vec::new(),
            dependencies: Vec::new(),
            project: Some(ProjectFiles {
                main: main.clone(),
                starter: map(starter),
                readonly: Vec::new(),
                tests: map(&[(CHECKS_FILE, checks)]),
                solution: map(&[(&main, "x: 1\n")]),
                explanation: String::new(),
            }),
            build: Default::default(),
            support: Default::default(),
        }
    }

    #[test]
    fn yaml_documents_skip_empty_docs_apply_merges_and_report_positions() {
        let d =
            yaml_documents("---\na: &x {k: 1}\nb:\n  <<: *x\n  j: 2\n---\n---\nc: 3\n").unwrap();
        assert_eq!(d.len(), 2);
        assert_eq!(d[0]["b"]["k"], 1);
        assert_eq!(d[1]["c"], 3);
        let e = yaml_documents("a: 1\nb: [1, 2\n").unwrap_err();
        assert!(e.line >= 2, "{e:?}");
        assert!(
            yaml_documents("a: 1\na: 2\n").is_err(),
            "duplicate keys are an error"
        );
        // `no` is text in YAML 1.2 (the delonix and serde dialect), integer keys become text.
        let d = yaml_documents("restartPolicy: no\n80: http\n").unwrap();
        assert_eq!(d[0]["restartPolicy"], "no");
        assert_eq!(d[0]["80"], "http");
    }

    #[test]
    fn drills_read_the_yaml_and_say_what_is_in_it() {
        let ok = run_yaml_program(
            "apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\n---\nservices: {}\n",
        );
        assert!(ok.ok);
        assert!(
            ok.stdout.contains("Pod/web (v1)") && ok.stdout.contains("`services`"),
            "{}",
            ok.stdout
        );
        assert!(!run_yaml_program("a: [").ok);
        assert!(!run_yaml_program("# only a comment\n").ok);
    }

    #[test]
    fn structural_checks_grade_a_project_without_any_tool() {
        let checks = "[[check]]\nfile = \"pod.yaml\"\npath = \"spec.containers[0].image\"\nequals = \"nginx:1.27\"\nmessage = \"Use nginx:1.27.\"\n";
        let p = phase(
            &[("pod.yaml", "spec:\n  containers:\n  - image: nginx\n")],
            checks,
        );
        let r = ToolRunner::default();
        let bad = r
            .check_project(&p, &p.project.as_ref().unwrap().starter)
            .unwrap();
        assert!(!bad.passed);
        assert!(
            bad.raw.contains("✗ pod.yaml › spec.containers[0].image")
                && bad.raw.contains("Use nginx:1.27."),
            "{}",
            bad.raw
        );
        let good: BTreeMap<String, String> = [(
            "pod.yaml".to_string(),
            "spec:\n  containers:\n  - image: nginx:1.27\n".to_string(),
        )]
        .into();
        let ok = r.check_project(&p, &good).unwrap();
        assert!(ok.passed, "{}", ok.raw);
        assert!(ok.raw.contains("1 of 1 checks passed"));
        let broken: BTreeMap<String, String> =
            [("pod.yaml".to_string(), "spec: [".to_string())].into();
        let b = r.check_project(&p, &broken).unwrap();
        assert!(!b.passed && b.raw.contains("not valid YAML"), "{}", b.raw);
        assert!(
            r.check_correctness(&p, "x").is_err(),
            "single-file steps are refused"
        );
    }

    #[test]
    fn invalid_checks_are_an_error_not_a_verdict() {
        let p = phase(
            &[("a.yaml", "a: 1\n")],
            "[[run]]\ncmd = [\"kubectl\", \"apply\", \"-f\", \"a.yaml\"]\nmessage = \"m\"\n",
        );
        let e = ToolRunner::default()
            .check_project(&p, &BTreeMap::new())
            .unwrap_err()
            .to_string();
        assert!(e.contains("is not allowed"), "{e}");
    }

    #[test]
    fn the_kustomize_guard_refuses_remote_and_missing_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path();
        std::fs::create_dir_all(w.join("base")).unwrap();
        std::fs::write(w.join("base/deploy.yaml"), "kind: Deployment\n").unwrap();
        std::fs::write(
            w.join("base/kustomization.yaml"),
            "resources:\n- deploy.yaml\n",
        )
        .unwrap();
        std::fs::create_dir_all(w.join("prod")).unwrap();
        let k = w.join("prod/kustomization.yaml");
        std::fs::write(
            &k,
            "resources:\n- ../base\nimages:\n- name: nginx\n  newName: ghcr.io/acme/nginx\n",
        )
        .unwrap();
        assert_eq!(kustomize_guard(w), Ok(()));
        for (bad, frag) in [
            (
                "resources:\n- https://github.com/acme/app//k8s?ref=v1\n",
                "remote",
            ),
            ("resources:\n- github.com/acme/app/k8s\n", "remote"),
            ("resources:\n- ../../outside\n", "not a file or folder"),
            ("resources:\n- missing.yaml\n", "not a file or folder"),
            ("patches:\n- path: http://example.com/p.yaml\n", "remote"),
            ("helmCharts:\n- name: x\n", "Helm"),
            ("resources: [\n", "not valid YAML"),
        ] {
            std::fs::write(&k, bad).unwrap();
            let e = kustomize_guard(w).unwrap_err();
            assert!(e.contains(frag), "{bad}: {e}");
        }
    }

    #[test]
    fn the_compose_guard_wants_host_ports_and_no_interpolation() {
        let tmp = tempfile::tempdir().unwrap();
        let w = tmp.path();
        let f = |s: &str| {
            std::fs::write(w.join("compose.yaml"), s).unwrap();
            compose_guard(w, "compose.yaml")
        };
        assert_eq!(f("services:\n  web:\n    image: nginx\n    ports: [\"8080:80\", \"127.0.0.1:8443:443\"]\n"), Ok(()));
        assert_eq!(f("services:\n  web:\n    image: nginx\n    ports:\n    - target: 80\n      published: 8080\n"), Ok(()));
        assert_eq!(
            f("services:\n  web:\n    command: [\"sh\", \"-c\", \"echo $$HOME\"]\n"),
            Ok(())
        );
        for (bad, frag) in [
            ("services:\n  web:\n    ports: [\"80\"]\n", "host port"),
            ("services:\n  web:\n    ports: [80]\n", "host port"),
            (
                "services:\n  web:\n    ports:\n    - target: 80\n",
                "host port",
            ),
            (
                "x: &p\n  ports: [\"80\"]\nservices:\n  web:\n    <<: *p\n",
                "host port",
            ),
            (
                "services:\n  web:\n    ports: [\"${PORT:-80}\"]\n",
                "interpolation",
            ),
            (
                "services:\n  web:\n    image: x\n    depends_on: [api]\n",
                "depends on `api`",
            ),
            (
                "services:\n  web:\n    image: x\n    depends_on:\n      db:\n        condition: service_started\n",
                "depends on `db`",
            ),
        ] {
            let e = f(bad).unwrap_err();
            assert!(e.contains(frag), "{bad}: {e}");
        }
    }

    #[test]
    fn a_missing_tool_is_an_error_that_says_what_to_install() {
        let checks = "[[run]]\ncmd = [\"kubectl\", \"kustomize\", \".\"]\nmessage = \"m\"\n";
        let p = phase(&[("kustomization.yaml", "resources: []\n")], checks);
        let e = grade(
            &p,
            &p.project.as_ref().unwrap().starter,
            &|_| None,
            None,
            &no_cluster,
        )
        .unwrap_err()
        .to_string();
        assert!(
            e.contains("kubectl is not installed")
                && e.contains("https://kubernetes.io/docs/tasks/tools/"),
            "{e}"
        );
    }

    #[test]
    fn a_missing_tool_says_what_to_install() {
        assert!(Tool::Kubectl
            .install_hint()
            .contains("https://kubernetes.io/docs/tasks/tools/"));
        assert!(Tool::Delonix.install_hint().contains("0.2.0"));
    }

    /// Com as ferramentas instaladas (como nesta máquina de desenvolvimento): os comandos reais
    /// correm na caixa, sem tocar no HOME de quem avalia.
    #[test]
    fn real_tools_run_offline_in_the_sandbox_when_installed() {
        let manifest = "apiVersion: compute.delonix.io/v1beta1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers:\n  - name: web\n    image: nginx:1.27\n";
        if find_tool(Tool::Delonix).is_some() {
            let checks = "[[run]]\ncmd = [\"delonix\", \"manifest\", \"render\", \"-f\", \"pod.yaml\"]\nsave = \"rendered.yaml\"\nmessage = \"The manifest must load.\"\n\n[[check]]\nfile = \"rendered.yaml\"\npath = \"spec.restartPolicy\"\nexists = true\nmessage = \"render fills the defaults\"\n";
            let p = phase(&[("pod.yaml", manifest)], checks);
            let good: BTreeMap<String, String> =
                [("pod.yaml".to_string(), manifest.to_string())].into();
            let r = ToolRunner::default().check_project(&p, &good).unwrap();
            assert!(r.passed, "{}", r.raw);
            let typo: BTreeMap<String, String> =
                [("pod.yaml".to_string(), manifest.replace("image:", "imgae:"))].into();
            let r = ToolRunner::default().check_project(&p, &typo).unwrap();
            assert!(
                !r.passed && r.raw.contains("The manifest must load."),
                "{}",
                r.raw
            );
        }
        if find_tool(Tool::Kubectl).is_some() {
            let checks = "[[run]]\ncmd = [\"kubectl\", \"kustomize\", \".\"]\nsave = \"out.yaml\"\nmessage = \"It must build.\"\n\n[[check]]\nfile = \"out.yaml\"\npath = \"metadata.namespace\"\nequals = \"shop\"\nmessage = \"namespace\"\n";
            let p = phase(
                &[
                    ("kustomization.yaml", "namespace: shop\nresources:\n- pod.yaml\n"),
                    ("pod.yaml", "apiVersion: v1\nkind: Pod\nmetadata:\n  name: web\nspec:\n  containers:\n  - name: web\n    image: nginx:1.27\n"),
                ],
                checks,
            );
            let r = ToolRunner::default()
                .check_project(&p, &p.project.as_ref().unwrap().starter)
                .unwrap();
            assert!(r.passed, "{}", r.raw);
        }
        for (t, v) in tool_versions(&[Tool::Kubectl, Tool::Delonix].into()) {
            if let Ok(v) = v {
                assert!(!v.is_empty(), "{t:?}");
            }
        }
    }

    fn no_cluster(_: &Phase, _: &Path) -> Result<Box<dyn LiveCluster>> {
        panic!("the practice cluster must not be opened here")
    }

    type Reply = Box<dyn Fn(&[String], usize) -> RunOutput>;

    /// A scripted practice cluster: records every kubectl call (namespace, args) and answers with
    /// `reply(args, how many times these args were seen before)`.
    struct Scripted {
        calls: Calls,
        reply: Reply,
    }

    impl LiveCluster for Scripted {
        fn describe(&self) -> String {
            "practice cluster dxtutor-test: reused".into()
        }
        fn images(&self) -> Vec<tutor_core::ImageRef> {
            vec![tutor_core::image_reference(
                "docker.io/library/nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10",
            )
            .unwrap()]
        }
        fn kubectl(
            &self,
            namespace: Option<&str>,
            args: &[String],
            _cwd: &Path,
            _timeout: Duration,
        ) -> Result<RunOutput> {
            let mut calls = self.calls.lock().unwrap();
            let seen = calls.iter().filter(|(_, a)| a == args).count();
            calls.push((namespace.map(str::to_string), args.to_vec()));
            Ok((self.reply)(args, seen))
        }
    }

    fn ok(stdout: &str) -> RunOutput {
        RunOutput {
            ok: true,
            stdout: stdout.into(),
            stderr: String::new(),
        }
    }

    const LIVE_CHECKS: &str = r#"
[[check]]
file = "web.yaml"
path = "kind"
equals = "Deployment"
message = "A Deployment."

[[live]]
cmd = ["kubectl", "apply", "-f", "web.yaml"]
message = "The API server must accept it."

[[live]]
cmd = ["kubectl", "rollout", "status", "deployment/web", "--timeout=90s"]
message = "It must roll out."

[[live]]
cmd = ["kubectl", "get", "deploy", "web", "-o", "json"]
until = { path = "status.readyReplicas", equals = 2 }
timeout_secs = 20
save = "live.json"
message = "Two replicas must be ready."

[[check]]
file = "live.json"
path = "spec.replicas"
equals = 2
message = "Two replicas."
"#;

    const WEB: &str = "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas: 2\n  template:\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.27.5-alpine\n";

    type Calls = std::sync::Arc<std::sync::Mutex<Vec<(Option<String>, Vec<String>)>>>;

    fn grade_live(files: &[(&str, &str)], checks: &str, reply: Reply) -> (Correctness, Calls) {
        let p = phase(files, checks);
        let calls: Calls = Default::default();
        let shared = calls.clone();
        let cell = std::sync::Mutex::new(Some(reply));
        let open = move |_: &Phase, _: &Path| -> Result<Box<dyn LiveCluster>> {
            let reply = cell.lock().unwrap().take().expect("opened once");
            Ok(Box::new(Scripted {
                calls: shared.clone(),
                reply,
            }))
        };
        let tree: BTreeMap<String, String> = files
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let r = grade(
            &p,
            &tree,
            &|_| Some(PathBuf::from("/usr/bin/true")),
            None,
            &open,
        )
        .unwrap();
        (r, calls)
    }

    #[test]
    fn a_live_step_runs_in_a_fresh_namespace_waits_and_checks_the_saved_output() {
        let (r, calls) = grade_live(
            &[("web.yaml", WEB)],
            LIVE_CHECKS,
            Box::new(|args, seen| {
                if args.first().map(String::as_str) == Some("get") && args[1] == "deployments" {
                    // ready on the second look
                    let ready = if seen == 0 { 1 } else { 2 };
                    return ok(&format!(
                        "{{\"spec\": {{\"replicas\": 2}}, \"status\": {{\"readyReplicas\": {ready}}}}}"
                    ));
                }
                ok("done")
            }),
        );
        assert!(r.passed, "{}", r.raw);
        assert!(
            r.raw.contains("· practice cluster dxtutor-test: reused"),
            "{}",
            r.raw
        );
        assert!(r
            .raw
            .contains("✓ kubectl rollout status deployments/web --timeout=90s"));
        assert!(r.raw.contains("✓ live.json › spec.replicas"), "{}", r.raw);
        let calls = calls.lock().unwrap();
        let words: Vec<String> = calls
            .iter()
            .map(|(ns, a)| format!("{}|{}", ns.as_deref().unwrap_or("-"), a.join(" ")))
            .collect();
        let ns = calls
            .iter()
            .find_map(|(_, a)| (a[0] == "create").then(|| a[2].clone()))
            .expect("a namespace was created");
        assert!(ns.starts_with("dxt-t-"), "{ns}");
        assert_eq!(
            words[0],
            "-|delete namespace -l dxtutor.io/grading --wait=false --ignore-not-found"
        );
        assert_eq!(words[1], format!("-|create namespace {ns}"));
        assert_eq!(
            words[2],
            format!("-|label namespace {ns} dxtutor.io/grading=true")
        );
        assert_eq!(words[3], format!("{ns}|get serviceaccount default -o name"));
        assert_eq!(words[4], format!("{ns}|apply -f web.yaml"));
        assert_eq!(
            words[5],
            format!("{ns}|rollout status deployments/web --timeout=90s")
        );
        assert_eq!(words[6], format!("{ns}|get deployments web -o json"));
        assert_eq!(words[7], words[6], "polled again until ready");
        assert_eq!(
            words.last().unwrap(),
            &format!("-|delete namespace {ns} --wait=false")
        );
        // Every command of the step ran in the grading namespace; only the grader's own
        // namespace housekeeping ran outside it.
        for (n, a) in calls.iter() {
            assert!(
                n.as_deref() == Some(ns.as_str())
                    || ["create", "delete", "label"].contains(&a[0].as_str()),
                "{a:?}"
            );
        }
    }

    #[test]
    fn a_manifest_that_would_leave_the_sandbox_is_not_applied() {
        let bad = WEB.replace("nginx:1.27.5-alpine", "nginx:latest");
        let (r, calls) = grade_live(&[("web.yaml", &bad)], LIVE_CHECKS, Box::new(|_, _| ok("")));
        assert!(!r.passed);
        assert!(
            r.raw.contains("not applied") && r.raw.contains("no version tag"),
            "{}",
            r.raw
        );
        assert!(
            r.raw.contains("not run: an earlier live check failed"),
            "{}",
            r.raw
        );
        let calls = calls.lock().unwrap();
        assert!(
            !calls.iter().any(|(_, a)| a[0] == "apply"),
            "nothing applied"
        );
        assert_eq!(
            calls.last().unwrap().1[0],
            "delete",
            "the namespace is still deleted"
        );
    }

    #[test]
    fn a_failed_check_without_cluster_keeps_the_cluster_closed() {
        let p = phase(&[("web.yaml", "kind: Pod\n")], LIVE_CHECKS);
        let r = grade(
            &p,
            &p.project.as_ref().unwrap().starter,
            &|_| Some(PathBuf::from("/usr/bin/true")),
            None,
            &no_cluster,
        )
        .unwrap();
        assert!(!r.passed);
        assert!(
            r.raw.contains("✗ live checks in the practice cluster"),
            "{}",
            r.raw
        );
        assert!(r.raw.contains("fix the checks above first"), "{}", r.raw);
    }

    #[test]
    fn a_live_command_can_be_expected_to_fail_and_a_wait_can_time_out() {
        let checks = r#"
[[live]]
cmd = ["kubectl", "apply", "-f", "web.yaml"]
message = "apply"

[[live]]
cmd = ["kubectl", "rollout", "status", "deploy/web", "--timeout=20s"]
expect = "failure"
output_contains = ["exceeded its progress deadline"]
message = "The bad rollout must hit its deadline."
"#;
        let reply = |stuck: bool| -> Reply {
            Box::new(move |args, _| {
                if args[0] == "rollout" {
                    RunOutput {
                        ok: !stuck,
                        stdout: String::new(),
                        stderr: if stuck {
                            "error: deployment \"web\" exceeded its progress deadline".into()
                        } else {
                            String::new()
                        },
                    }
                } else {
                    ok("")
                }
            })
        };
        let (r, _) = grade_live(&[("web.yaml", WEB)], checks, reply(true));
        assert!(r.passed, "{}", r.raw);
        let (r, _) = grade_live(&[("web.yaml", WEB)], checks, reply(false));
        assert!(
            !r.passed && r.raw.contains("the cluster should refuse this"),
            "{}",
            r.raw
        );

        let never = r#"
[[live]]
cmd = ["kubectl", "apply", "-f", "web.yaml"]
message = "apply"

[[live]]
cmd = ["kubectl", "get", "pods", "-l", "app=web", "-o", "json"]
until = { path = "items", len = 3 }
timeout_secs = 1
message = "Three Pods."
"#;
        let (r, _) = grade_live(
            &[("web.yaml", WEB)],
            never,
            Box::new(|_, _| ok("{\"items\": []}")),
        );
        assert!(
            !r.passed && r.raw.contains("after 1 s, `items` still did not match"),
            "{}",
            r.raw
        );
    }
}
