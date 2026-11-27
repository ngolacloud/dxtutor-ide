//! **Verificações declarativas** dos cursos de FERRAMENTAS (Learn P2b: Kubernetes, Delonix).
//!
//! Um passo de projecto de um curso avaliado por verificações (linguagem `yaml`, ver
//! [`graded_by_checks`]) não traz testes numa linguagem: traz, nos ficheiros ocultos
//! (`project.tests`), um ficheiro [`CHECKS_FILE`] que diz o que tem de ser verdade nos ficheiros
//! do aluno. Duas espécies de verificação, ambas OFFLINE:
//!
//! - **estruturais** (`[[check]]`): um caminho num documento YAML e uma afirmação sobre o valor
//!   (existe, é igual, um de, corresponde a uma expressão regular, contém, só tem estas chaves,
//!   tamanho, tipo, igual a outro caminho, está entre os valores de outro caminho, um selector
//!   que escolhe as etiquetas de outro documento, número de documentos);
//! - **comandos** (`[[run]]`): uma ferramenta real a correr sobre os ficheiros, mas SÓ os
//!   comandos da lista de [`parse_command`] (sem rede, sem cluster; o motor de contentores só pelo
//!   sandbox Podman rootless dos cursos de Docker e de Podman — [`crate::podcmd`]). A saída pode ser
//!   guardada (`save`) e verificada como um ficheiro.
//!
//! ```toml
//! [[run]]
//! cmd = ["kubectl", "kustomize", "overlays/prod"]
//! save = "rendered.yaml"
//! message = "The prod overlay must build."
//!
//! [[check]]
//! file = "rendered.yaml"
//! doc = { kind = "Deployment", name = "prod-web" }
//! path = "spec.template.spec.containers[name=web].image"
//! equals = "nginx:1.27.3"
//! message = "The overlay must pin the image to nginx:1.27.3."
//! ```
//!
//! # Caminhos
//!
//! `a.b[0].c`, `containers[*].image` (todos), `containers[name=web]` (o elemento cujo `name` é
//! `web`), `labels["app.kubernetes.io/name"]` (uma chave com pontos ou barras). O caminho vazio é
//! o documento inteiro. Um caminho com `[*]` ou `[campo=valor]` pode dar vários valores: a
//! afirmação vale para TODOS e é falsa se não houver nenhum (salvo `exists = false`).
//!
//! As regras (forma, lista de comandos permitidos, avaliação estrutural) vivem aqui, no modelo,
//! para a validação dos plugins e o avaliador aplicarem exactamente as mesmas. Ler YAML e correr
//! os comandos é do `tutor-eval` (o modelo não faz I/O): a avaliação recebe os documentos já
//! convertidos para [`serde_json::Value`].

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use serde_json::Value;

use crate::project::safe_project_path;

/// O ficheiro oculto (em `project.tests`) com as verificações de um passo.
pub const CHECKS_FILE: &str = "checks.toml";

/// Máximo de verificações e de comandos de um passo.
const MAX_CHECKS: usize = 200;
const MAX_RUNS: usize = 24;

/// `true` se os passos de um curso nesta linguagem se avaliam por verificações declarativas
/// (o avaliador de ferramentas do `tutor-eval`), e não por testes numa linguagem.
pub fn graded_by_checks(language: &str) -> bool {
    matches!(
        language.trim().to_ascii_lowercase().as_str(),
        "yaml" | "yml" | "dockerfile" | "containerfile" | "odoo-module"
    )
}

/// `true` se os passos de um curso nesta linguagem (`odoo-module`) são módulos Odoo (Learn P3c): avaliados pela
/// tabela `[odoo]` do [`CHECKS_FILE`] ([`crate::odootest`]), no sandbox de contentores.
pub fn odoo_language(language: &str) -> bool {
    language.trim().eq_ignore_ascii_case("odoo-module")
}

/// `true` se os ficheiros dos drills de um curso nesta linguagem são Containerfiles (os cursos de
/// Docker e de Podman): «correr» um drill é lê-lo com [`crate::containerfile`].
pub fn containerfile_language(language: &str) -> bool {
    matches!(
        language.trim().to_ascii_lowercase().as_str(),
        "dockerfile" | "containerfile"
    )
}

/// As verificações de um passo (o conteúdo de [`CHECKS_FILE`]).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checks {
    /// Comandos a correr, pela ordem, antes das verificações estruturais.
    #[serde(default, rename = "run")]
    pub runs: Vec<Run>,
    /// Verificações estruturais, pela ordem.
    #[serde(default, rename = "check")]
    pub checks: Vec<Check>,
    /// Verificações AO VIVO no cluster de prática (Learn P3b, [`crate::livecheck`]), pela ordem.
    #[serde(default)]
    pub live: Vec<crate::livecheck::Live>,
    /// A instalação e os testes de módulos Odoo (Learn P3c, [`crate::odootest`]): corre no sandbox
    /// de contentores, depois dos `[[run]]` e antes das verificações estruturais.
    #[serde(default)]
    pub odoo: Option<crate::odootest::OdooTest>,
}

/// O que se espera do código de saída de um comando.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Expect {
    /// Sai com 0 (o omisso).
    #[default]
    Success,
    /// Sai com um código diferente de 0 (um passo que ensina o que a ferramenta recusa).
    Failure,
}

/// Um comando de uma ferramenta, da lista de [`parse_command`].
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Run {
    /// O comando, palavra a palavra (`["kubectl", "kustomize", "."]`). Nunca passa por uma shell.
    pub cmd: Vec<String>,
    /// Guarda a saída (stdout) como um ficheiro virtual com este nome, para as verificações.
    #[serde(default)]
    pub save: Option<String>,
    /// O código de saída esperado.
    #[serde(default)]
    pub expect: Expect,
    /// Textos que a saída (stdout + stderr) tem de conter.
    #[serde(default)]
    pub output_contains: Vec<String>,
    /// Expressões regulares que a saída tem de satisfazer (`(?m)`/`(?s)` à escolha do autor).
    #[serde(default)]
    pub output_matches: Vec<String>,
    /// Textos que a saída NÃO pode conter.
    #[serde(default)]
    pub output_lacks: Vec<String>,
    /// Quantas vezes repetir (um segundo entre tentativas) até o comando fazer o esperado: um
    /// serviço que demora a arrancar, um healthcheck. 0 = uma só vez.
    #[serde(default)]
    pub retries: u32,
    /// O que dizer ao aluno quando o comando não faz o esperado.
    #[serde(default)]
    pub message: String,
}

/// Escolhe UM documento de um ficheiro com vários (`---`): pelo `kind`, pelo `metadata.name` e
/// pelo `metadata.namespace`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocSelector {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub namespace: Option<String>,
}

/// Um caminho noutro sítio (o mesmo ficheiro se `file` faltar), para as afirmações que
/// comparam dois valores.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ref {
    #[serde(default)]
    pub file: Option<String>,
    #[serde(default)]
    pub doc: Option<DocSelector>,
    #[serde(default)]
    pub path: String,
}

/// O tipo de um valor YAML, para `is`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ValueType {
    String,
    Integer,
    Number,
    Boolean,
    Mapping,
    Sequence,
}

impl ValueType {
    fn name(self) -> &'static str {
        match self {
            ValueType::String => "a string",
            ValueType::Integer => "an integer",
            ValueType::Number => "a number",
            ValueType::Boolean => "a boolean",
            ValueType::Mapping => "a mapping",
            ValueType::Sequence => "a list",
        }
    }

    fn holds(self, v: &Value) -> bool {
        match self {
            ValueType::String => v.is_string(),
            ValueType::Integer => v.is_i64() || v.is_u64(),
            ValueType::Number => v.is_number(),
            ValueType::Boolean => v.is_boolean(),
            ValueType::Mapping => v.is_object(),
            ValueType::Sequence => v.is_array(),
        }
    }
}

/// Uma verificação estrutural: um valor (ficheiro, documento, caminho) e UMA afirmação.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Check {
    /// O ficheiro (do aluno, oculto, ou guardado por um `[[run]]`/`[[live]]`). Vazio no `until`
    /// de um `[[live]]` (o documento é a saída do comando).
    #[serde(default)]
    pub file: String,
    /// O documento (obrigatório quando o ficheiro tem mais de um, salvo em `doc_count`).
    #[serde(default)]
    pub doc: Option<DocSelector>,
    /// O caminho no documento (vazio = o documento inteiro).
    #[serde(default)]
    pub path: String,
    /// O que dizer ao aluno quando a verificação falha.
    #[serde(default)]
    pub message: String,

    // ── a afirmação (exactamente uma) ──
    #[serde(default)]
    pub exists: Option<bool>,
    #[serde(default)]
    pub equals: Option<toml::Value>,
    #[serde(default)]
    pub one_of: Option<Vec<toml::Value>>,
    #[serde(default)]
    pub matches: Option<String>,
    #[serde(default)]
    pub contains: Option<toml::Value>,
    #[serde(default)]
    pub only_keys: Option<Vec<String>>,
    #[serde(default)]
    pub len: Option<usize>,
    #[serde(default)]
    pub min_len: Option<usize>,
    #[serde(default)]
    pub is: Option<ValueType>,
    #[serde(default)]
    pub same_as: Option<Ref>,
    /// Cada valor está entre os valores de outro caminho — em TODOS os documentos que o `doc` da
    /// referência escolhe (todos, sem `doc`).
    #[serde(default)]
    pub among: Option<Ref>,
    #[serde(default)]
    pub selects: Option<Ref>,
    #[serde(default)]
    pub doc_count: Option<usize>,
    /// O valor é um número menor ou igual (o tamanho de uma imagem, um número de camadas).
    #[serde(default)]
    pub at_most: Option<f64>,
    /// O valor é um número maior ou igual.
    #[serde(default)]
    pub at_least: Option<f64>,
}

impl Check {
    /// Os nomes das afirmações presentes (uma verificação válida tem exactamente uma).
    fn assertions(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        let mut add = |present: bool, name: &'static str| {
            if present {
                out.push(name);
            }
        };
        add(self.exists.is_some(), "exists");
        add(self.equals.is_some(), "equals");
        add(self.one_of.is_some(), "one_of");
        add(self.matches.is_some(), "matches");
        add(self.contains.is_some(), "contains");
        add(self.only_keys.is_some(), "only_keys");
        add(self.len.is_some(), "len");
        add(self.min_len.is_some(), "min_len");
        add(self.is.is_some(), "is");
        add(self.same_as.is_some(), "same_as");
        add(self.among.is_some(), "among");
        add(self.selects.is_some(), "selects");
        add(self.doc_count.is_some(), "doc_count");
        add(self.at_most.is_some(), "at_most");
        add(self.at_least.is_some(), "at_least");
        out
    }
}

// ── Caminhos ─────────────────────────────────────────────────────────────────────────────

/// Um segmento de um caminho (ver o cabeçalho do módulo).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Seg {
    /// Uma chave de um mapa.
    Key(String),
    /// Um índice de uma lista.
    Index(usize),
    /// Todos os elementos de uma lista (ou valores de um mapa).
    All,
    /// Os elementos de uma lista cujo campo `key` vale `value`.
    Where { key: String, value: String },
}

fn bare_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '$')
}

/// Lê um caminho (`a.b[0]`, `c[*]`, `d[name=web]`, `e["x.y/z"]`). O caminho vazio é a raiz.
pub fn parse_path(path: &str) -> Result<Vec<Seg>, String> {
    let chars: Vec<char> = path.chars().collect();
    let mut segs = Vec::new();
    let mut i = 0;
    let bad = |why: &str| format!("path `{path}`: {why}");
    // Depois de um segmento: fim, `.`, ou `[`.
    let mut need_sep = false;
    while i < chars.len() {
        let c = chars[i];
        if c == '.' {
            if !need_sep {
                return Err(bad("unexpected `.`"));
            }
            i += 1;
            need_sep = false;
            if i >= chars.len() || chars[i] == '.' || chars[i] == '[' {
                return Err(bad("a `.` must be followed by a key"));
            }
            continue;
        }
        if c == '[' {
            let close = chars[i..]
                .iter()
                .position(|&x| x == ']')
                .map(|p| p + i)
                .ok_or_else(|| bad("`[` without `]`"))?;
            let inner: String = chars[i + 1..close].iter().collect();
            segs.push(parse_bracket(&inner).map_err(|e| bad(&e))?);
            i = close + 1;
            need_sep = true;
            continue;
        }
        if need_sep {
            return Err(bad(&format!("expected `.` or `[` before `{c}`")));
        }
        let start = i;
        while i < chars.len() && bare_char(chars[i]) {
            i += 1;
        }
        if i == start {
            return Err(bad(&format!(
                "unexpected `{c}` (quote keys with other characters: `[\"a.b/c\"]`)"
            )));
        }
        segs.push(Seg::Key(chars[start..i].iter().collect()));
        need_sep = true;
    }
    Ok(segs)
}

fn unquote(s: &str) -> Option<String> {
    let s = s.trim();
    if s.len() >= 2 && s.starts_with('"') && s.ends_with('"') {
        let inner = &s[1..s.len() - 1];
        if inner.contains('"') {
            return None;
        }
        Some(inner.to_string())
    } else {
        None
    }
}

fn parse_bracket(inner: &str) -> Result<Seg, String> {
    let t = inner.trim();
    if t.is_empty() {
        return Err("empty `[]`".into());
    }
    if t == "*" {
        return Ok(Seg::All);
    }
    if t.starts_with('"') {
        return unquote(t)
            .filter(|k| !k.is_empty())
            .map(Seg::Key)
            .ok_or_else(|| format!("bad quoted key `[{t}]`"));
    }
    if let Some((k, v)) = t.split_once('=') {
        let key = k.trim();
        if key.is_empty() || !key.chars().all(bare_char) {
            return Err(format!("bad field name in `[{t}]`"));
        }
        let v = v.trim();
        let value = if v.starts_with('"') {
            unquote(v).ok_or_else(|| format!("bad quoted value in `[{t}]`"))?
        } else {
            v.to_string()
        };
        if value.is_empty() {
            return Err(format!("empty value in `[{t}]`"));
        }
        return Ok(Seg::Where {
            key: key.to_string(),
            value,
        });
    }
    t.parse::<usize>()
        .map(Seg::Index)
        .map_err(|_| format!("`[{t}]` is not an index, `*`, `field=value` or a quoted key"))
}

/// O texto de um escalar para comparar com o `valor` de um `[campo=valor]`.
fn scalar_text(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Os valores em `segs` a partir de `root` (vários com `[*]`/`[campo=valor]`; nenhum quando o
/// caminho não existe).
pub fn resolve<'a>(root: &'a Value, segs: &[Seg]) -> Vec<&'a Value> {
    let mut cur: Vec<&Value> = vec![root];
    for seg in segs {
        let mut next = Vec::new();
        for v in cur {
            match seg {
                Seg::Key(k) => {
                    if let Some(x) = v.as_object().and_then(|m| m.get(k)) {
                        next.push(x);
                    }
                }
                Seg::Index(n) => {
                    if let Some(x) = v.as_array().and_then(|a| a.get(*n)) {
                        next.push(x);
                    }
                }
                Seg::All => match v {
                    Value::Array(a) => next.extend(a.iter()),
                    Value::Object(m) => next.extend(m.values()),
                    _ => {}
                },
                Seg::Where { key, value } => {
                    if let Some(a) = v.as_array() {
                        next.extend(a.iter().filter(|e| {
                            e.as_object()
                                .and_then(|m| m.get(key))
                                .and_then(scalar_text)
                                .is_some_and(|t| &t == value)
                        }));
                    }
                }
            }
        }
        cur = next;
    }
    cur
}

// ── A lista de comandos permitidos ───────────────────────────────────────────────────────

/// Uma ferramenta que as verificações podem correr.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Tool {
    Kubectl,
    Delonix,
    /// O Podman rootless do sandbox de contentores (os cursos de Docker e de Podman; os comandos
    /// `docker …` também correm nele).
    Podman,
}

impl Tool {
    /// O nome do executável.
    pub fn binary(self) -> &'static str {
        match self {
            Tool::Kubectl => "kubectl",
            Tool::Delonix => "delonix",
            Tool::Podman => "podman",
        }
    }

    /// Os argumentos que mostram a versão (sem rede: medido com `strace`, sem `socket`).
    pub fn version_args(self) -> &'static [&'static str] {
        match self {
            Tool::Kubectl => &["version", "--client"],
            Tool::Delonix => &["--version"],
            Tool::Podman => &["--version"],
        }
    }

    /// O que instalar quando a ferramenta falta (texto para o aluno e para o autor do curso).
    pub fn install_hint(self) -> &'static str {
        match self {
            Tool::Kubectl => {
                "kubectl is not installed. Install kubectl (https://kubernetes.io/docs/tasks/tools/) \
                 and open the course again. Grading only runs `kubectl kustomize`, offline: it never \
                 talks to a cluster and needs no kubeconfig."
            }
            Tool::Delonix => {
                "delonix is not installed. Install the Delonix Engine 0.2.1 \
                 (https://ngolacloud.github.io/delonix/ — the installer is \
                 https://github.com/ngolacloud/delonix/releases/latest/download/install.sh) and open \
                 the course again. Grading only runs `delonix manifest render` and `delonix compose \
                 config`, which read the files and never touch the engine."
            }
            Tool::Podman => {
                "podman is not installed. Install Podman 4.4 or newer for your Linux distribution \
                 (https://podman.io/docs/installation — e.g. `sudo apt install podman` or `sudo dnf \
                 install podman`), rootless, and open the course again. Grading runs only in a private \
                 rootless Podman sandbox: it never uses the Docker daemon nor your own Podman images \
                 and containers. Linux only: on macOS and Windows Podman runs in a VM, which this \
                 grader does not drive."
            }
        }
    }
}

/// Um comando permitido, já reconhecido (os argumentos são caminhos relativos seguros).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToolCommand {
    /// `kubectl kustomize <dir>`: constrói um kustomization localmente (sem cluster).
    KubectlKustomize { dir: String },
    /// `delonix manifest render -f <file>`: lê o manifesto e mostra-o com os valores omissos
    /// (sem ler nem escrever o estado do motor).
    DelonixManifestRender { file: String },
    /// `delonix compose config -f <file> -p <project>`: valida e resolve um compose (sem criar
    /// nada).
    DelonixComposeConfig { file: String, project: String },
    /// Um comando de contentores ([`crate::podcmd`]) que corre no sandbox Podman; `argv` é como o
    /// curso o escreveu (para o relatório).
    Pod {
        cmd: crate::podcmd::PodCommand,
        argv: Vec<String>,
    },
    /// `append <file> <text>`: junta texto a um ficheiro da pasta de trabalho, entre dois comandos
    /// (uma mudança no código para ver a cache de construção a funcionar). Não corre nada.
    Append { file: String, text: String },
}

/// Os comandos permitidos, para as mensagens.
pub const ALLOWED_COMMANDS: &str =
    "`kubectl kustomize <dir>`, `delonix manifest render -f <file>`, \
     `delonix compose config -f <file> -p <project>`, the container commands of the Docker and \
     Podman courses (`podman …`/`docker …`, run in the rootless sandbox) and `append <file> <text>`";

impl ToolCommand {
    /// A ferramenta que o comando corre (`None` para o `append`, que não corre nada).
    pub fn tool(&self) -> Option<Tool> {
        match self {
            ToolCommand::KubectlKustomize { .. } => Some(Tool::Kubectl),
            ToolCommand::DelonixManifestRender { .. }
            | ToolCommand::DelonixComposeConfig { .. } => Some(Tool::Delonix),
            ToolCommand::Pod { .. } => Some(Tool::Podman),
            ToolCommand::Append { .. } => None,
        }
    }

    /// Os argumentos (sem o executável), na forma canónica.
    pub fn args(&self) -> Vec<String> {
        let s = |x: &str| x.to_string();
        match self {
            ToolCommand::KubectlKustomize { dir } => vec![s("kustomize"), dir.clone()],
            ToolCommand::DelonixManifestRender { file } => {
                vec![s("manifest"), s("render"), s("-f"), file.clone()]
            }
            ToolCommand::DelonixComposeConfig { file, project } => vec![
                s("compose"),
                s("config"),
                s("-f"),
                file.clone(),
                s("-p"),
                project.clone(),
            ],
            ToolCommand::Pod { argv, .. } => argv[1..].to_vec(),
            ToolCommand::Append { file, text } => vec![file.clone(), text.clone()],
        }
    }

    /// O comando como se escreve (para o relatório).
    pub fn display(&self) -> String {
        match self {
            ToolCommand::Pod { argv, .. } => argv.join(" "),
            ToolCommand::Append { file, .. } => format!("append to {file}"),
            _ => {
                let mut parts = vec![self.tool().map(Tool::binary).unwrap_or("").to_string()];
                parts.extend(self.args());
                parts.join(" ")
            }
        }
    }
}

fn rel_path_arg(p: &str) -> bool {
    p == "." || safe_project_path(p)
}

fn project_name_ok(p: &str) -> bool {
    let mut cs = p.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && p.len() <= 63
        && cs.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Reconhece um comando da lista permitida, ou diz porque é recusado. A lista é curta de
/// propósito: só comandos que lêem os ficheiros e não vão à rede nem a um cluster nem ao motor de
/// contentores (provado no código-fonte e medido com `strace`; ver `docs/plugins/README.md`).
/// Recusados por isso, entre outros: `kubectl apply|create --dry-run=client -f` (pedem a
/// descoberta da API ao servidor: medido, ligam a `localhost:8080` sem kubeconfig), `kubectl
/// exec`, e `delonix manifest validate` (lê os stores do motor e varre os cgroups do anfitrião).
pub fn parse_command(argv: &[String]) -> Result<ToolCommand, String> {
    let words: Vec<&str> = argv.iter().map(String::as_str).collect();
    let refuse = || {
        format!(
            "command `{}` is not allowed in a check: only {ALLOWED_COMMANDS} run (offline, never against a cluster or the container engine)",
            words.join(" ")
        )
    };
    if matches!(words.first(), Some(&"podman") | Some(&"docker")) {
        return crate::podcmd::parse(argv).map(|cmd| ToolCommand::Pod {
            cmd,
            argv: argv.to_vec(),
        });
    }
    match words.as_slice() {
        ["append", file, text] if safe_project_path(file) && !text.is_empty() => {
            Ok(ToolCommand::Append {
                file: file.to_string(),
                text: text.to_string(),
            })
        }
        ["kubectl", "kustomize", dir] if rel_path_arg(dir) => Ok(ToolCommand::KubectlKustomize {
            dir: dir.to_string(),
        }),
        ["delonix", "manifest", "render", "-f", file] if safe_project_path(file) => {
            Ok(ToolCommand::DelonixManifestRender {
                file: file.to_string(),
            })
        }
        ["delonix", "compose", "config", "-f", file, "-p", project]
            if safe_project_path(file) && project_name_ok(project) =>
        {
            Ok(ToolCommand::DelonixComposeConfig {
                file: file.to_string(),
                project: project.to_string(),
            })
        }
        _ => Err(refuse()),
    }
}

// ── Forma ────────────────────────────────────────────────────────────────────────────────

fn plain_value(v: &toml::Value) -> bool {
    match v {
        toml::Value::Datetime(_) => false,
        toml::Value::Array(a) => a.iter().all(plain_value),
        toml::Value::Table(t) => t.values().all(plain_value),
        _ => true,
    }
}

/// Um valor TOML como valor JSON (o modelo dos documentos YAML).
fn json_of(v: &toml::Value) -> Value {
    match v {
        toml::Value::String(s) => Value::String(s.clone()),
        toml::Value::Integer(i) => Value::from(*i),
        toml::Value::Float(f) => serde_json::Number::from_f64(*f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        toml::Value::Boolean(b) => Value::Bool(*b),
        toml::Value::Datetime(d) => Value::String(d.to_string()),
        toml::Value::Array(a) => Value::Array(a.iter().map(json_of).collect()),
        toml::Value::Table(t) => {
            Value::Object(t.iter().map(|(k, v)| (k.clone(), json_of(v))).collect())
        }
    }
}

impl Checks {
    /// Lê o conteúdo de [`CHECKS_FILE`].
    pub fn parse(raw: &str) -> Result<Checks, String> {
        toml::from_str(raw).map_err(|e| format!("{CHECKS_FILE}: {e}"))
    }

    /// As ferramentas que os comandos destas verificações usam (as verificações ao vivo correm o
    /// `kubectl`).
    pub fn tools(&self) -> BTreeSet<Tool> {
        let mut out: BTreeSet<Tool> = self
            .runs
            .iter()
            .filter_map(|r| parse_command(&r.cmd).ok())
            .filter_map(|c| c.tool())
            .collect();
        if self.needs_cluster() {
            out.insert(Tool::Kubectl);
        }
        if self.odoo.is_some() {
            out.insert(Tool::Podman);
        }
        out
    }

    /// `true` quando o passo se verifica (também) ao vivo, no cluster de prática.
    pub fn needs_cluster(&self) -> bool {
        !self.live.is_empty()
    }

    /// Os ficheiros que as entradas `[[live]]` guardam.
    pub fn live_saves(&self) -> BTreeSet<String> {
        self.live.iter().filter_map(|l| l.save.clone()).collect()
    }

    /// `true` se a verificação lê uma saída de um `[[live]]` (corre depois das verificações ao
    /// vivo; as outras correm antes, sem cluster).
    pub fn is_post_live(&self, c: &Check) -> bool {
        let saves = self.live_saves();
        std::iter::once(c.file.as_str())
            .chain(
                [&c.same_as, &c.among, &c.selects]
                    .into_iter()
                    .flatten()
                    .map(|r| r.file.as_deref().unwrap_or(c.file.as_str())),
            )
            .any(|f| saves.contains(f))
    }

    /// `true` se algum comando corre no sandbox de contentores.
    pub fn uses_sandbox(&self) -> bool {
        self.tools().contains(&Tool::Podman)
    }

    /// Erros de forma (vazio = válidas). `files` são os ficheiros que existem na pasta de
    /// trabalho (os do aluno e os ocultos); os guardados pelos `[[run]]` juntam-se aqui.
    pub fn check(&self, files: &BTreeSet<String>) -> Vec<String> {
        self.check_with(files, None)
    }

    /// [`Checks::check`] sabendo que imagens o curso preparou (`prepared` diz se uma referência é
    /// uma delas; `None` = não verificar): os comandos de contentores só correm imagens construídas
    /// no passo ou preparadas.
    pub fn check_with(
        &self,
        files: &BTreeSet<String>,
        prepared: Option<&dyn Fn(&str) -> bool>,
    ) -> Vec<String> {
        self.check_with_images(files, prepared, None)
    }

    /// [`Checks::check_with`] com a lista das imagens preparadas (a tabela `[odoo]` escolhe a do
    /// Odoo da sua série e a do PostgreSQL).
    pub fn check_with_images(
        &self,
        files: &BTreeSet<String>,
        prepared: Option<&dyn Fn(&str) -> bool>,
        images: Option<&[crate::build::ImageRef]>,
    ) -> Vec<String> {
        let mut errs = Vec::new();
        let mut pods: Vec<(usize, crate::podcmd::PodCommand)> = Vec::new();
        if self.runs.is_empty()
            && self.checks.is_empty()
            && self.live.is_empty()
            && self.odoo.is_none()
        {
            errs.push(format!(
                "{CHECKS_FILE}: no [[check]], [[run]], [[live]] or [odoo]: nothing would be verified"
            ));
        }
        if let Some(o) = &self.odoo {
            errs.extend(
                o.check(files, images)
                    .into_iter()
                    .map(|e| format!("{CHECKS_FILE}: {e}")),
            );
        }
        if self.checks.len() > MAX_CHECKS {
            errs.push(format!("{CHECKS_FILE}: more than {MAX_CHECKS} checks"));
        }
        if self.runs.len() > MAX_RUNS {
            errs.push(format!("{CHECKS_FILE}: more than {MAX_RUNS} runs"));
        }
        let mut known = files.clone();
        let live_errs = {
            let mut k = known.clone();
            for r in &self.runs {
                if let Some(save) = &r.save {
                    k.insert(save.clone());
                }
            }
            let errs = crate::livecheck::check_live(&self.live, &mut k);
            for save in self.live_saves() {
                known.insert(save);
            }
            errs
        };
        errs.extend(live_errs);
        for (n, r) in self.runs.iter().enumerate() {
            let at = format!("{CHECKS_FILE}: run #{}", n + 1);
            match parse_command(&r.cmd) {
                Err(e) => errs.push(format!("{at}: {e}")),
                Ok(cmd) => {
                    let target = match &cmd {
                        ToolCommand::KubectlKustomize { .. } => None,
                        ToolCommand::DelonixManifestRender { file }
                        | ToolCommand::DelonixComposeConfig { file, .. }
                        | ToolCommand::Append { file, .. } => Some(file),
                        ToolCommand::Pod { cmd, .. } => {
                            if let crate::podcmd::Op::Run(spec) = &cmd.op {
                                if spec.name.is_some() && r.retries > 0 {
                                    errs.push(format!(
                                        "{at}: a `run --name` cannot be retried (the name would be taken); retry an `exec` or an unnamed run instead"
                                    ));
                                }
                            }
                            pods.push((n + 1, cmd.clone()));
                            None
                        }
                    };
                    if let Some(f) = target {
                        if !known.contains(f) {
                            errs.push(format!("{at}: `{f}` is not a file of the step"));
                        }
                    }
                }
            }
            if r.output_contains
                .iter()
                .chain(&r.output_lacks)
                .any(|s| s.is_empty())
            {
                errs.push(format!(
                    "{at}: an empty `output_contains`/`output_lacks` entry"
                ));
            }
            for re in &r.output_matches {
                if let Err(e) = regex::Regex::new(re) {
                    errs.push(format!(
                        "{at}: `output_matches` `{re}` is not a valid regex: {e}"
                    ));
                }
            }
            if r.retries > 30 {
                errs.push(format!("{at}: `retries` is at most 30"));
            }
            if r.message.trim().is_empty() {
                errs.push(format!(
                    "{at}: `message` is empty (tell the learner what the command checks)"
                ));
            }
            if let Some(save) = &r.save {
                if !safe_project_path(save) {
                    errs.push(format!("{at}: save `{save}` is not a safe relative path"));
                } else if !known.insert(save.clone()) {
                    errs.push(format!(
                        "{at}: save `{save}` is already a file of the step (or saved twice)"
                    ));
                }
                if r.expect == Expect::Failure {
                    errs.push(format!(
                        "{at}: a command expected to fail has no output to `save`"
                    ));
                }
            }
        }
        let seq: Vec<(usize, &crate::podcmd::PodCommand)> =
            pods.iter().map(|(n, c)| (*n, c)).collect();
        for e in crate::podcmd::check_sequence(&seq, files, prepared) {
            errs.push(format!("{CHECKS_FILE}: {e}"));
        }
        for (n, c) in self.checks.iter().enumerate() {
            let at = format!("{CHECKS_FILE}: check #{} ({})", n + 1, c.file);
            if !known.contains(&c.file) {
                errs.push(format!(
                    "{at}: `{}` is not a file of the step nor a saved output",
                    c.file
                ));
            }
            if c.message.trim().is_empty() {
                errs.push(format!(
                    "{at}: `message` is empty (tell the learner what is wrong)"
                ));
            }
            errs.extend(
                check_assertion_form(c)
                    .into_iter()
                    .map(|e| format!("{at}: {e}")),
            );
            for r in [&c.same_as, &c.among, &c.selects].into_iter().flatten() {
                let f = r.file.as_deref().unwrap_or(&c.file);
                if !known.contains(f) {
                    errs.push(format!(
                        "{at}: the reference file `{f}` is not a file of the step nor a saved output"
                    ));
                }
                if let Err(e) = parse_path(&r.path) {
                    errs.push(format!("{at}: reference {e}"));
                }
            }
        }
        errs
    }

    /// Avalia as verificações estruturais sobre `docs` (nome do ficheiro → documentos, ou o erro
    /// de leitura). Um resultado por verificação, pela ordem.
    pub fn evaluate(&self, docs: &BTreeMap<String, Result<Vec<Value>, String>>) -> Vec<Outcome> {
        self.checks.iter().map(|c| evaluate_one(c, docs)).collect()
    }
}

/// Erros de forma da AFIRMAÇÃO de uma verificação (o caminho, exactamente uma afirmação, a
/// expressão regular, listas vazias, datas), sem o ficheiro nem a mensagem: o `until` de um
/// `[[live]]` tem a mesma forma.
pub fn check_assertion_form(c: &Check) -> Vec<String> {
    let mut errs = Vec::new();
    if let Err(e) = parse_path(&c.path) {
        errs.push(e);
    }
    let a = c.assertions();
    if a.len() != 1 {
        errs.push(format!(
            "needs exactly one assertion, has {}{}",
            a.len(),
            if a.is_empty() {
                String::new()
            } else {
                format!(" ({})", a.join(", "))
            }
        ));
    }
    if c.doc_count.is_some() && !c.path.is_empty() {
        errs.push("`doc_count` counts documents: leave `path` empty".into());
    }
    if let Some(re) = &c.matches {
        if let Err(e) = regex::Regex::new(re) {
            errs.push(format!("`matches` is not a valid regex: {e}"));
        }
    }
    if c.only_keys.as_ref().is_some_and(|k| k.is_empty()) {
        errs.push("`only_keys` is empty".into());
    }
    if c.one_of.as_ref().is_some_and(|l| l.is_empty()) {
        errs.push("`one_of` is empty".into());
    }
    let values = c
        .equals
        .iter()
        .chain(c.contains.iter())
        .chain(c.one_of.iter().flatten());
    for v in values {
        if !plain_value(v) {
            errs.push("dates are not YAML values here; quote them as strings".into());
        }
    }
    errs
}

/// Avalia UMA verificação estrutural sobre `docs` (a do `until` de um `[[live]]`, ou as
/// verificações antes e depois das ao vivo).
pub fn evaluate_check(c: &Check, docs: &BTreeMap<String, Result<Vec<Value>, String>>) -> Outcome {
    evaluate_one(c, docs)
}

// ── Avaliação ────────────────────────────────────────────────────────────────────────────

/// O resultado de uma verificação (ou de um comando, no avaliador).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outcome {
    pub ok: bool,
    /// O que foi verificado (`deployment.yaml › Deployment/web › spec.replicas`).
    pub label: String,
    /// Num falhanço: a mensagem do curso e o que se encontrou.
    pub detail: String,
}

fn doc_label(d: &Value) -> String {
    let kind = d.get("kind").and_then(Value::as_str).unwrap_or("?");
    let name = d
        .get("metadata")
        .and_then(|m| m.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("?");
    format!("{kind}/{name}")
}

fn selector_text(s: &DocSelector) -> String {
    let mut parts = Vec::new();
    if let Some(k) = &s.kind {
        parts.push(format!("kind {k}"));
    }
    if let Some(n) = &s.name {
        parts.push(format!("name {n}"));
    }
    if let Some(ns) = &s.namespace {
        parts.push(format!("namespace {ns}"));
    }
    if parts.is_empty() {
        "any document".into()
    } else {
        parts.join(", ")
    }
}

fn doc_matches(d: &Value, s: &DocSelector) -> bool {
    let meta = d.get("metadata");
    let field = |v: Option<&Value>| v.and_then(Value::as_str).map(str::to_string);
    let ok = |want: &Option<String>, got: Option<String>| match want {
        None => true,
        Some(w) => got.as_deref() == Some(w.as_str()),
    };
    ok(&s.kind, field(d.get("kind")))
        && ok(&s.name, field(meta.and_then(|m| m.get("name"))))
        && ok(&s.namespace, field(meta.and_then(|m| m.get("namespace"))))
}

/// O único documento de `file` que `sel` escolhe, ou porque não há um.
fn pick_doc<'a>(
    docs: &'a BTreeMap<String, Result<Vec<Value>, String>>,
    file: &str,
    sel: Option<&DocSelector>,
) -> Result<&'a Value, String> {
    let all = match docs.get(file) {
        None => return Err(format!("`{file}` is not available")),
        Some(Err(e)) => return Err(e.clone()),
        Some(Ok(d)) => d,
    };
    match sel {
        None => match all.as_slice() {
            [one] => Ok(one),
            [] => Err(format!("`{file}` has no YAML document")),
            more => Err(format!(
                "`{file}` has {} documents; expected exactly one",
                more.len()
            )),
        },
        Some(s) => {
            let found: Vec<&Value> = all.iter().filter(|d| doc_matches(d, s)).collect();
            match found.as_slice() {
                [one] => Ok(*one),
                [] => Err(format!("no document with {} in `{file}`", selector_text(s))),
                more => Err(format!(
                    "{} documents with {} in `{file}`; expected exactly one",
                    more.len(),
                    selector_text(s)
                )),
            }
        }
    }
}

/// Compara dois valores YAML: os números pelo valor (`3` = `3.0`), o resto exactamente.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_f64(), y.as_f64()) {
            (Some(p), Some(q)) => p == q,
            _ => x == y,
        },
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}

/// Um valor curto para as mensagens (`"nginx"`, `3`, `{…}`).
fn show(v: &Value) -> String {
    let s = v.to_string();
    if s.chars().count() > 80 {
        let cut: String = s.chars().take(77).collect();
        format!("{cut}…")
    } else {
        s
    }
}

fn resolve_ref<'a>(
    docs: &'a BTreeMap<String, Result<Vec<Value>, String>>,
    default_file: &str,
    r: &Ref,
) -> Result<Vec<&'a Value>, String> {
    let file = r.file.as_deref().unwrap_or(default_file);
    let doc = pick_doc(docs, file, r.doc.as_ref())?;
    let segs = parse_path(&r.path)?;
    Ok(resolve(doc, &segs))
}

/// Os valores de `r` em TODOS os documentos que o seu `doc` escolhe (todos, sem `doc`): o
/// conjunto de valores permitidos de um `among` (os nomes dos Services de um ficheiro com vários).
fn resolve_pool<'a>(
    docs: &'a BTreeMap<String, Result<Vec<Value>, String>>,
    default_file: &str,
    r: &Ref,
) -> Result<Vec<&'a Value>, String> {
    let file = r.file.as_deref().unwrap_or(default_file);
    let all = match docs.get(file) {
        None => return Err(format!("`{file}` is not available")),
        Some(Err(e)) => return Err(e.clone()),
        Some(Ok(d)) => d,
    };
    let segs = parse_path(&r.path)?;
    Ok(all
        .iter()
        .filter(|d| r.doc.as_ref().is_none_or(|s| doc_matches(d, s)))
        .flat_map(|d| resolve(d, &segs))
        .collect())
}

fn evaluate_one(c: &Check, docs: &BTreeMap<String, Result<Vec<Value>, String>>) -> Outcome {
    let mut label = c.file.clone();
    if let Some(s) = &c.doc {
        label.push_str(" › ");
        label.push_str(&match (&s.kind, &s.name) {
            (Some(k), Some(n)) => format!("{k}/{n}"),
            (Some(k), None) => k.clone(),
            (None, Some(n)) => n.clone(),
            (None, None) => selector_text(s),
        });
    }
    if !c.path.is_empty() {
        label.push_str(" › ");
        label.push_str(&c.path);
    }
    let fail = |found: String| Outcome {
        ok: false,
        label: label.clone(),
        detail: if found.is_empty() {
            c.message.clone()
        } else {
            format!("{} ({found})", c.message)
        },
    };
    let pass = || Outcome {
        ok: true,
        label: label.clone(),
        detail: String::new(),
    };

    if let Some(n) = c.doc_count {
        let all = match docs.get(&c.file) {
            None => return fail(format!("`{}` is not available", c.file)),
            Some(Err(e)) => return fail(e.clone()),
            Some(Ok(d)) => d,
        };
        let count = match &c.doc {
            None => all.len(),
            Some(s) => all.iter().filter(|d| doc_matches(d, s)).count(),
        };
        return if count == n {
            pass()
        } else {
            let names: Vec<String> = all.iter().map(doc_label).collect();
            fail(format!("found {count}: {}", names.join(", ")))
        };
    }

    let doc = match pick_doc(docs, &c.file, c.doc.as_ref()) {
        Ok(d) => d,
        Err(e) => return fail(e),
    };
    let segs = match parse_path(&c.path) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    let found = resolve(doc, &segs);
    let present: Vec<&Value> = found.iter().copied().filter(|v| !v.is_null()).collect();

    if let Some(want) = c.exists {
        return match (want, present.is_empty()) {
            (true, false) if present.len() == found.len() => pass(),
            (true, _) => fail("missing".into()),
            (false, true) => pass(),
            (false, false) => fail(format!("found {}", show(present[0]))),
        };
    }
    if present.is_empty() || present.len() != found.len() {
        return fail("missing".into());
    }
    // Cada valor tem de satisfazer a afirmação; o primeiro que não satisfaz explica o falhanço.
    let check_all = |test: &dyn Fn(&Value) -> Result<(), String>| -> Outcome {
        for v in &present {
            if let Err(why) = test(v) {
                return fail(why);
            }
        }
        pass()
    };
    if let Some(e) = &c.equals {
        let want = json_of(e);
        return check_all(&|v| {
            if same(v, &want) {
                Ok(())
            } else {
                Err(format!("found {}, expected {}", show(v), show(&want)))
            }
        });
    }
    if let Some(list) = &c.one_of {
        let wants: Vec<Value> = list.iter().map(json_of).collect();
        return check_all(&|v| {
            if wants.iter().any(|w| same(v, w)) {
                Ok(())
            } else {
                Err(format!("found {}", show(v)))
            }
        });
    }
    if let Some(re) = &c.matches {
        let rx = match regex::Regex::new(re) {
            Ok(r) => r,
            Err(e) => return fail(format!("bad regex: {e}")),
        };
        return check_all(&|v| match v.as_str() {
            Some(s) if rx.is_match(s) => Ok(()),
            Some(_) => Err(format!("found {}", show(v))),
            None => Err(format!("found {}, which is not a string", show(v))),
        });
    }
    if let Some(e) = &c.contains {
        let want = json_of(e);
        return check_all(&|v| {
            let ok = match (v, &want) {
                (Value::String(s), Value::String(w)) => s.contains(w.as_str()),
                (Value::Array(a), w) => a.iter().any(|x| same(x, w)),
                (Value::Object(m), Value::Object(w)) => {
                    w.iter().all(|(k, x)| m.get(k).is_some_and(|y| same(x, y)))
                }
                _ => false,
            };
            if ok {
                Ok(())
            } else {
                Err(format!("found {}", show(v)))
            }
        });
    }
    if let Some(keys) = &c.only_keys {
        return check_all(&|v| match v.as_object() {
            None => Err(format!("found {}, which is not a mapping", show(v))),
            Some(m) => {
                let extra: Vec<&String> = m.keys().filter(|k| !keys.contains(k)).collect();
                if extra.is_empty() {
                    Ok(())
                } else {
                    Err(format!(
                        "unexpected key(s): {}",
                        extra
                            .iter()
                            .map(|k| format!("`{k}`"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }
            }
        });
    }
    if c.len.is_some() || c.min_len.is_some() {
        return check_all(&|v| {
            let n = match v {
                Value::Array(a) => a.len(),
                Value::Object(m) => m.len(),
                Value::String(s) => s.chars().count(),
                _ => return Err(format!("found {}, which has no length", show(v))),
            };
            match (c.len, c.min_len) {
                (Some(want), _) if n != want => Err(format!("length {n}, expected {want}")),
                (_, Some(min)) if n < min => Err(format!("length {n}, expected at least {min}")),
                _ => Ok(()),
            }
        });
    }
    if c.at_most.is_some() || c.at_least.is_some() {
        return check_all(&|v| {
            let Some(x) = v.as_f64() else {
                return Err(format!("found {}, which is not a number", show(v)));
            };
            match (c.at_most, c.at_least) {
                (Some(max), _) if x > max => {
                    Err(format!("found {}, expected at most {max}", show(v)))
                }
                (_, Some(min)) if x < min => {
                    Err(format!("found {}, expected at least {min}", show(v)))
                }
                _ => Ok(()),
            }
        });
    }
    if let Some(t) = c.is {
        return check_all(&|v| {
            if t.holds(v) {
                Ok(())
            } else {
                Err(format!("found {}, expected {}", show(v), t.name()))
            }
        });
    }
    if let Some(r) = &c.same_as {
        let other = match resolve_ref(docs, &c.file, r) {
            Ok(o) => o,
            Err(e) => return fail(e),
        };
        let [want] = other.as_slice() else {
            return fail(format!(
                "the reference `{}` gives {} values, expected one",
                r.path,
                other.len()
            ));
        };
        return check_all(&|v| {
            if same(v, want) {
                Ok(())
            } else {
                Err(format!(
                    "found {}, but `{}` is {}",
                    show(v),
                    r.path,
                    show(want)
                ))
            }
        });
    }
    if let Some(r) = &c.among {
        let pool = match resolve_pool(docs, &c.file, r) {
            Ok(o) => o,
            Err(e) => return fail(e),
        };
        return check_all(&|v| {
            if pool.iter().any(|p| same(v, p)) {
                Ok(())
            } else {
                let opts: Vec<String> = pool.iter().map(|p| show(p)).collect();
                Err(format!(
                    "found {}, not one of `{}`: [{}]",
                    show(v),
                    r.path,
                    opts.join(", ")
                ))
            }
        });
    }
    if let Some(r) = &c.selects {
        let targets = match resolve_ref(docs, &c.file, r) {
            Ok(o) => o,
            Err(e) => return fail(e),
        };
        if targets.is_empty() {
            return fail(format!("`{}` is missing", r.path));
        }
        return check_all(&|v| {
            let Some(sel) = v.as_object() else {
                return Err(format!("found {}, which is not a mapping", show(v)));
            };
            if sel.is_empty() {
                return Err("the selector is empty (it would select everything)".into());
            }
            for t in &targets {
                let labels = t.as_object();
                let missing: Vec<String> = sel
                    .iter()
                    .filter(|(k, x)| !labels.and_then(|l| l.get(*k)).is_some_and(|y| same(x, y)))
                    .map(|(k, x)| format!("{k}={}", show(x)))
                    .collect();
                if !missing.is_empty() {
                    return Err(format!(
                        "selector {} does not match the labels {} at `{}` (missing {})",
                        show(v),
                        show(t),
                        r.path,
                        missing.join(", ")
                    ));
                }
            }
            Ok(())
        });
    }
    fail("no assertion".into())
}

// ── Cursos ───────────────────────────────────────────────────────────────────────────────

/// As ferramentas de que os desafios de um curso avaliado por verificações precisam (para o
/// `dxt plugin test` dizer com que versões passou).
pub fn course_tools(course: &crate::Course) -> BTreeSet<Tool> {
    let mut out = BTreeSet::new();
    for step in course.units.iter().flat_map(|u| &u.steps) {
        let Some(p) = &step.project else { continue };
        if let Some(raw) = p.tests.get(CHECKS_FILE) {
            if let Ok(c) = Checks::parse(raw) {
                out.extend(c.tools());
            }
        }
    }
    out
}

/// Erros de um passo de projecto de um curso avaliado por verificações (vazio = válido): o
/// [`CHECKS_FILE`] existe nos ocultos, lê-se e é válido contra os ficheiros do passo.
pub fn check_step(project: &crate::ProjectFiles) -> Vec<String> {
    check_step_with(project, None)
}

/// [`check_step`] com as imagens preparadas do curso (`Some` num curso de contentores: os comandos
/// só correm imagens construídas no passo ou estas).
pub fn check_step_with(
    project: &crate::ProjectFiles,
    images: Option<&[crate::build::ImageRef]>,
) -> Vec<String> {
    let Some(raw) = project.tests.get(CHECKS_FILE) else {
        return vec![format!(
            "project.tests has no `{CHECKS_FILE}`: a step graded by checks declares them there"
        )];
    };
    let checks = match Checks::parse(raw) {
        Ok(c) => c,
        Err(e) => return vec![e],
    };
    let files: BTreeSet<String> = project
        .starter
        .keys()
        .chain(project.tests.keys().filter(|k| *k != CHECKS_FILE))
        .cloned()
        .collect();
    match images {
        Some(imgs) => {
            let prepared = |r: &str| imgs.iter().any(|i| i.matches(r));
            checks.check_with_images(&files, Some(&prepared), Some(imgs))
        }
        None => checks.check(&files),
    }
}

/// As imagens preparadas de um curso de contentores (as linhas de `[build] dependencies`, já
/// validadas no parse); vazio noutro curso.
pub fn course_images(course: &crate::Course) -> Vec<crate::build::ImageRef> {
    if crate::build::CacheKind::of(&course.language) != Some(crate::build::CacheKind::Images) {
        return Vec::new();
    }
    course
        .build
        .dependencies
        .iter()
        .filter_map(|d| crate::build::image_reference(d).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn docs(pairs: &[(&str, Vec<Value>)]) -> BTreeMap<String, Result<Vec<Value>, String>> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), Ok(v.clone())))
            .collect()
    }

    fn deployment() -> Value {
        json!({
            "apiVersion": "apps/v1", "kind": "Deployment",
            "metadata": {"name": "web", "labels": {"app.kubernetes.io/name": "web"}},
            "spec": {"replicas": 3, "selector": {"matchLabels": {"app": "web"}},
              "template": {"metadata": {"labels": {"app": "web", "tier": "front"}},
                "spec": {"containers": [
                  {"name": "web", "image": "nginx:1.27", "ports": [{"containerPort": 80}]},
                  {"name": "log", "image": "busybox:1.36"}]}}}
        })
    }

    fn one(
        file: &str,
        toml_check: &str,
        d: &BTreeMap<String, Result<Vec<Value>, String>>,
    ) -> Outcome {
        let c = Checks::parse(&format!(
            "[[check]]\nfile = \"{file}\"\nmessage = \"m\"\n{toml_check}"
        ))
        .expect("parse");
        assert!(
            c.check(&d.keys().cloned().collect()).is_empty(),
            "{:?}",
            c.check(&d.keys().cloned().collect())
        );
        c.evaluate(d).remove(0)
    }

    #[test]
    fn paths_parse_and_resolve() {
        assert_eq!(
            parse_path("spec.template.spec.containers[name=web].ports[0].containerPort").unwrap(),
            vec![
                Seg::Key("spec".into()),
                Seg::Key("template".into()),
                Seg::Key("spec".into()),
                Seg::Key("containers".into()),
                Seg::Where {
                    key: "name".into(),
                    value: "web".into()
                },
                Seg::Key("ports".into()),
                Seg::Index(0),
                Seg::Key("containerPort".into()),
            ]
        );
        assert_eq!(
            parse_path(r#"metadata.labels["app.kubernetes.io/name"]"#).unwrap()[2],
            Seg::Key("app.kubernetes.io/name".into())
        );
        assert_eq!(
            parse_path(r#"["service web"].ports"#).unwrap()[0],
            Seg::Key("service web".into())
        );
        assert!(parse_path("").unwrap().is_empty());
        for bad in [
            "a..b", ".a", "a.", "a[", "a[]", "a[x=]", "a b", "a[\"x]", "a]b", "a[0]b",
        ] {
            assert!(parse_path(bad).is_err(), "{bad}");
        }
        let d = deployment();
        let imgs = resolve(
            &d,
            &parse_path("spec.template.spec.containers[*].image").unwrap(),
        );
        assert_eq!(imgs, vec![&json!("nginx:1.27"), &json!("busybox:1.36")]);
        assert!(resolve(&d, &parse_path("spec.nope[3]").unwrap()).is_empty());
    }

    #[test]
    fn every_assertion_passes_and_fails_with_a_reason() {
        let d = docs(&[("d.yaml", vec![deployment()])]);
        let ok = |t: &str| assert!(one("d.yaml", t, &d).ok, "should pass: {t}");
        let ko = |t: &str, frag: &str| {
            let o = one("d.yaml", t, &d);
            assert!(!o.ok, "should fail: {t}");
            assert!(
                o.detail.contains(frag),
                "{t}: `{}` lacks `{frag}`",
                o.detail
            );
            assert!(o.detail.starts_with('m'), "the course message comes first");
        };
        ok("path = \"spec.replicas\"\nequals = 3");
        ok("path = \"spec.replicas\"\nequals = 3.0");
        ko(
            "path = \"spec.replicas\"\nequals = \"3\"",
            "found 3, expected \"3\"",
        );
        ok("path = \"spec.replicas\"\nis = \"integer\"");
        ko(
            "path = \"metadata.name\"\nis = \"integer\"",
            "expected an integer",
        );
        ok("path = \"spec.selector\"\nexists = true");
        ok("path = \"spec.paused\"\nexists = false");
        ko("path = \"spec.paused\"\nexists = true", "missing");
        ko("path = \"spec.replicas\"\nexists = false", "found 3");
        ok("path = \"spec.template.spec.containers[*].image\"\nmatches = ':[0-9]'");
        ko(
            "path = \"spec.template.spec.containers[*].image\"\nmatches = '^nginx'",
            "busybox",
        );
        ok("path = \"spec.template.spec.containers[name=web].image\"\none_of = [\"nginx:1.27\", \"nginx:1.28\"]");
        ok("path = \"spec.template.metadata.labels\"\ncontains = { app = \"web\" }");
        ok("path = \"spec.template.spec.containers[0].image\"\ncontains = \"nginx\"");
        ok("path = \"spec.template.spec.containers[0]\"\nonly_keys = [\"name\", \"image\", \"ports\"]");
        ko(
            "path = \"spec.template.spec.containers[0]\"\nonly_keys = [\"name\", \"image\"]",
            "`ports`",
        );
        ok("path = \"spec.template.spec.containers\"\nlen = 2");
        ko(
            "path = \"spec.template.spec.containers\"\nmin_len = 3",
            "at least 3",
        );
        ok("path = \"spec.selector.matchLabels\"\nselects = { path = \"spec.template.metadata.labels\" }");
        ko("path = \"spec.template.metadata.labels\"\nselects = { path = \"spec.selector.matchLabels\" }", "missing tier");
        ok("path = \"spec.template.spec.containers[0].name\"\nsame_as = { path = \"metadata.name\" }");
        ok("path = \"spec.template.spec.containers[0].name\"\namong = { path = \"spec.template.spec.containers[*].name\" }");
        ko(
            "path = \"metadata.labels[\\\"app.kubernetes.io/name\\\"]\"\nequals = \"api\"",
            "found \"web\"",
        );
        ok("doc_count = 1");
        ok("doc = { kind = \"Deployment\" }\ndoc_count = 1");
        ko(
            "doc = { kind = \"Service\" }\npath = \"spec\"\nexists = true",
            "no document with kind Service",
        );
        ko(
            "path = \"spec.template.spec.containers[name=api].image\"\nequals = \"x\"",
            "missing",
        );
    }

    #[test]
    fn multi_document_files_need_a_selector_and_parse_errors_fail_the_check() {
        let svc = json!({"kind": "Service", "metadata": {"name": "web"}, "spec": {"selector": {"app": "web"}}});
        let mut d = docs(&[("all.yaml", vec![deployment(), svc])]);
        d.insert(
            "bad.yaml".into(),
            Err("bad.yaml: did not find expected key at line 3".into()),
        );
        let o = one("all.yaml", "path = \"kind\"\nexists = true", &d);
        assert!(!o.ok && o.detail.contains("2 documents"), "{o:?}");
        assert!(one(
            "all.yaml",
            "doc = { kind = \"Service\" }\npath = \"spec.selector\"\nselects = { doc = { kind = \"Deployment\" }, path = \"spec.template.metadata.labels\" }",
            &d
        )
        .ok);
        // `among` junta os valores de todos os documentos que a referência escolhe.
        assert!(one(
            "all.yaml",
            "doc = { kind = \"Service\" }\npath = \"metadata.name\"\namong = { path = \"metadata.name\" }",
            &d
        )
        .ok);
        let o = one(
            "all.yaml",
            "doc = { kind = \"Service\" }\npath = \"metadata.name\"\namong = { doc = { kind = \"Pod\" }, path = \"metadata.name\" }",
            &d,
        );
        assert!(!o.ok && o.detail.contains("not one of"), "{o:?}");
        let o = one("bad.yaml", "path = \"kind\"\nexists = true", &d);
        assert!(!o.ok && o.detail.contains("line 3"), "{o:?}");
    }

    #[test]
    fn the_form_is_checked_for_authors() {
        let files: BTreeSet<String> = ["a.yaml".to_string()].into();
        let errs = |raw: &str| Checks::parse(raw).map(|c| c.check(&files).join("\n"));
        assert!(errs("").unwrap().contains("nothing would be verified"));
        assert!(Checks::parse("[[check]]\nfile = \"a.yaml\"\nbogus = 1").is_err());
        let e = errs("[[check]]\nfile = \"b.yaml\"\npath = \"a..b\"\nequals = 1\nexists = true")
            .unwrap();
        for frag in [
            "`b.yaml` is not a file",
            "message` is empty",
            "path `a..b`",
            "exactly one assertion, has 2",
        ] {
            assert!(e.contains(frag), "{frag} in {e}");
        }
        let e = errs("[[check]]\nfile = \"a.yaml\"\nmessage = \"m\"\nmatches = \"(\"").unwrap();
        assert!(e.contains("not a valid regex"), "{e}");
        let e = errs("[[check]]\nfile = \"a.yaml\"\nmessage = \"m\"\npath = \"x\"\ndoc_count = 1")
            .unwrap();
        assert!(e.contains("leave `path` empty"), "{e}");
        // Um ficheiro guardado por um comando pode ser verificado; um guardado duas vezes, não.
        let ok = errs(
            "[[run]]\ncmd = [\"delonix\", \"manifest\", \"render\", \"-f\", \"a.yaml\"]\nsave = \"out.yaml\"\nmessage = \"m\"\n\
             [[check]]\nfile = \"out.yaml\"\nmessage = \"m\"\nexists = true",
        )
        .unwrap();
        assert_eq!(ok, "");
        let e =
            errs("[[run]]\ncmd = [\"kubectl\", \"apply\", \"-f\", \"a.yaml\"]\nmessage = \"m\"")
                .unwrap();
        assert!(e.contains("is not allowed"), "{e}");
        let e = errs("[[run]]\ncmd = [\"kubectl\", \"kustomize\", \".\"]\nsave = \"a.yaml\"\nmessage = \"m\"").unwrap();
        assert!(e.contains("already a file"), "{e}");
    }

    #[test]
    fn only_the_offline_commands_are_allowed() {
        let argv = |s: &str| s.split(' ').map(str::to_string).collect::<Vec<_>>();
        assert_eq!(
            parse_command(&argv("kubectl kustomize overlays/prod")).unwrap(),
            ToolCommand::KubectlKustomize {
                dir: "overlays/prod".into()
            }
        );
        assert_eq!(
            parse_command(&argv("kubectl kustomize .")).unwrap().tool(),
            Some(Tool::Kubectl)
        );
        let pod = parse_command(&argv("docker build -t app .")).unwrap();
        assert_eq!(
            (pod.tool(), pod.display()),
            (Some(Tool::Podman), "docker build -t app .".to_string())
        );
        assert_eq!(
            parse_command(&argv("append app.py x")).unwrap().tool(),
            None
        );
        let r = parse_command(&argv("delonix manifest render -f m.yaml")).unwrap();
        assert_eq!(r.display(), "delonix manifest render -f m.yaml");
        let c = parse_command(&argv("delonix compose config -f compose.yaml -p shop")).unwrap();
        assert_eq!(c.args(), argv("compose config -f compose.yaml -p shop"));
        for bad in [
            "kubectl apply --dry-run=client -f a.yaml",
            "kubectl create --dry-run=client -f a.yaml",
            "kubectl kustomize ../outside",
            "kubectl kustomize /etc",
            "kubectl kustomize . --enable-helm",
            "kubectl kustomize https://github.com/x/y",
            "kubectl exec web -- sh",
            "kubectl get pods",
            "delonix manifest validate -f m.yaml",
            "delonix apply -f m.yaml",
            "delonix compose up -f c.yaml",
            "delonix compose config -f c.yaml",
            "delonix compose config -f c.yaml -p Bad",
            "delonix manifest render -f /etc/passwd",
            "sh -c kubectl",
            "",
        ] {
            assert!(parse_command(&argv(bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn live_entries_split_the_checks_into_before_and_after_the_cluster() {
        let raw = r#"
[[live]]
cmd = ["kubectl", "apply", "-f", "web.yaml"]
message = "apply"

[[live]]
cmd = ["kubectl", "get", "deploy", "web", "-o", "json"]
save = "live.json"
until = { path = "status.readyReplicas", equals = 2 }
timeout_secs = 30
message = "ready"

[[check]]
file = "web.yaml"
path = "kind"
equals = "Deployment"
message = "pre"

[[check]]
file = "live.json"
path = "status.replicas"
equals = 2
message = "post"

[[check]]
file = "web.yaml"
path = "spec.replicas"
same_as = { file = "live.json", path = "status.replicas" }
message = "post by reference"
"#;
        let c = Checks::parse(raw).expect("parses");
        assert!(c.needs_cluster());
        assert_eq!(c.tools(), BTreeSet::from([Tool::Kubectl]));
        assert!(c
            .check(&BTreeSet::from(["web.yaml".to_string()]))
            .is_empty());
        let post: Vec<bool> = c.checks.iter().map(|k| c.is_post_live(k)).collect();
        assert_eq!(post, [false, true, true]);
        let offline = Checks::parse(
            "[[check]]\nfile = \"a.yaml\"\npath = \"kind\"\nexists = true\nmessage = \"m\"\n",
        )
        .unwrap();
        assert!(!offline.needs_cluster() && offline.tools().is_empty());
    }

    #[test]
    fn yaml_languages_are_graded_by_checks() {
        assert!(graded_by_checks("yaml") && graded_by_checks(" YML "));
        assert!(graded_by_checks("dockerfile") && containerfile_language("Containerfile"));
        assert!(!graded_by_checks("python") && !containerfile_language("yaml"));
    }

    #[test]
    fn numbers_compare_and_outputs_have_their_own_rules() {
        let d = docs(&[(
            "i.json",
            vec![json!([{"Size": 9_000_000, "RootFS": {"Layers": ["a", "b"]}}])],
        )]);
        assert!(one("i.json", "path = \"[0].Size\"\nat_most = 10000000", &d).ok);
        let o = one("i.json", "path = \"[0].Size\"\nat_most = 5000000", &d);
        assert!(!o.ok && o.detail.contains("at most 5000000"), "{o:?}");
        assert!(one("i.json", "path = \"[0].RootFS.Layers\"\nlen = 2", &d).ok);
        assert!(!one("i.json", "path = \"[0].Size\"\nat_least = 10000000", &d).ok);
        let files: BTreeSet<String> = ["Containerfile".to_string()].into();
        let c = Checks::parse(
            "[[run]]\ncmd = [\"podman\", \"build\", \"-t\", \"app\", \".\"]\nmessage = \"m\"\noutput_matches = [\"(\"]\nretries = 31\n",
        )
        .unwrap();
        let e = c.check(&files).join("\n");
        assert!(
            e.contains("not a valid regex") && e.contains("at most 30"),
            "{e}"
        );
        let c = Checks::parse("[[run]]\ncmd = [\"podman\", \"run\", \"app\"]\nmessage = \"m\"\n")
            .unwrap();
        assert!(c.check(&files).join("\n").contains("image `app`"));
        assert!(c.uses_sandbox());
    }
}
