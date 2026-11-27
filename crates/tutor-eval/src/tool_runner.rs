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
//! A avaliação corre sempre no anfitrião (mesmo com o sandbox de contentores ligado): os comandos
//! permitidos só lêem ficheiros.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Duration;

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

/// O avaliador dos cursos cujos passos se avaliam por verificações (`yaml`).
#[derive(Debug, Clone, Copy, Default)]
pub struct ToolRunner;

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
        grade(phase, tree)
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

// ── Ferramentas ──────────────────────────────────────────────────────────────────────────

/// Onde está o executável de `tool`: no `PATH` de quem avalia, senão nas pastas habituais (a app
/// desktop pode arrancar com um `PATH` curto).
pub fn find_tool(tool: Tool) -> Option<PathBuf> {
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
fn grade(phase: &Phase, tree: &BTreeMap<String, String>) -> Result<Correctness> {
    let project = phase
        .project
        .as_ref()
        .with_context(|| format!("step `{}` is not a project step", phase.id))?;
    let errs = toolcheck::check_step(project);
    if !errs.is_empty() {
        bail!("invalid checks in step `{}`: {}", phase.id, errs.join("; "));
    }
    let checks = Checks::parse(&project.tests[CHECKS_FILE]).map_err(anyhow::Error::msg)?;

    // Uma ferramenta em falta: dizer o que instalar ANTES de correr o que quer que seja.
    let mut bins: BTreeMap<Tool, PathBuf> = BTreeMap::new();
    for tool in checks.tools() {
        match find_tool(tool) {
            Some(b) => {
                bins.insert(tool, b);
            }
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
    let sandbox = ToolSandbox::create(&base.join("sandbox"))?;
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

    for run in &checks.runs {
        let cmd = toolcheck::parse_command(&run.cmd).map_err(anyhow::Error::msg)?;
        let shown = cmd.display();
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
        let bin = &bins[&cmd.tool()];
        let out = sandbox.run(bin, &cmd.args(), &work)?;
        let both = format!("{}\n{}", out.stdout, out.stderr);
        let status_ok = match run.expect {
            Expect::Success => out.ok,
            Expect::Failure => !out.ok,
        };
        let missing: Vec<&String> = run
            .output_contains
            .iter()
            .filter(|s| !both.contains(s.as_str()))
            .collect();
        let ok = status_ok && missing.is_empty();
        let mut detail = String::new();
        if !ok {
            let why = if !status_ok {
                match run.expect {
                    Expect::Success => "it failed".to_string(),
                    Expect::Failure => "it succeeded, but it should refuse this input".to_string(),
                }
            } else {
                format!(
                    "the output lacks {}",
                    missing
                        .iter()
                        .map(|s| format!("`{s}`"))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };
            detail = format!("{} ({why})\n{}", run.message, indent(&tail(&both)));
        }
        outcomes.push(Outcome {
            ok,
            label: shown.clone(),
            detail,
        });
        if let Some(s) = &run.save {
            let v = if out.ok {
                load_docs(s, &out.stdout)
            } else {
                Err(format!("`{shown}` failed, so `{s}` has no content"))
            };
            saved.insert(s.clone(), v);
        }
    }

    // Os documentos de cada ficheiro que as verificações lêem (o aluno, os ocultos, os guardados).
    let mut docs: BTreeMap<String, std::result::Result<Vec<Value>, String>> = saved;
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
    outcomes.extend(checks.evaluate(&docs));

    let failed = outcomes.iter().filter(|o| !o.ok).count();
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
        let r = ToolRunner;
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
        let e = ToolRunner
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
            let r = ToolRunner.check_project(&p, &good).unwrap();
            assert!(r.passed, "{}", r.raw);
            let typo: BTreeMap<String, String> =
                [("pod.yaml".to_string(), manifest.replace("image:", "imgae:"))].into();
            let r = ToolRunner.check_project(&p, &typo).unwrap();
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
            let r = ToolRunner
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
}
