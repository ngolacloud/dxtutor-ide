//! **Verificações ao vivo** dos cursos de Kubernetes (Learn P3b): os manifestos do aluno aplicam-se
//! num cluster de prática (kind sobre Podman sem root, `tutor_eval::kindbox`), num namespace novo,
//! e verificam-se com consultas de leitura.
//!
//! Um passo declara-as no seu `checks.toml` oculto, como `[[live]]`, pela ordem em que correm:
//!
//! ```toml
//! [[live]]
//! cmd = ["kubectl", "apply", "-f", "deployment.yaml"]
//! message = "The API server must accept the Deployment."
//!
//! [[live]]
//! cmd = ["kubectl", "rollout", "status", "deployment/web", "--timeout=90s"]
//! message = "The Deployment must roll out: 3 ready replicas."
//!
//! [[live]]
//! cmd = ["kubectl", "get", "endpointslices", "-l", "kubernetes.io/service-name=web", "-o", "json"]
//! until = { path = "items[0].endpoints", len = 3 }
//! timeout_secs = 60
//! save = "slices.json"
//! message = "The Service must end up with 3 ready endpoints."
//!
//! [[check]]
//! file = "slices.json"
//! path = "items[0].ports[0].name"
//! equals = "http"
//! message = "The endpoints carry the port name http."
//! ```
//!
//! # A lista permitida (a regra, aqui no modelo)
//!
//! Os comandos vêm dos dados do curso, mas só correm os de [`parse_live_command`]: `kubectl
//! apply -f <ficheiro do passo>`, `get` (só `-o json|yaml`), `rollout status|undo|history`, `wait
//! --for=condition=…` e `logs`. Nada de `exec`, `port-forward`, `proxy`, `cp`, `run`, `create`,
//! `delete`, `patch`, `scale`, `config`… nem de `--kubeconfig`, `--context`, `--namespace`/`-n`,
//! `-A`, `--server`, `--token` ou `--as`: quem corre ([`tutor_eval::kindbox`]) junta sempre o
//! kubeconfig do cluster de prática, o seu contexto e o namespace da avaliação. A única escrita
//! fora do namespace — criá-lo e apagá-lo — é do avaliador, não do curso.
//!
//! Antes de um `apply`, [`manifest_problems`] lê os documentos e recusa o que sairia do namespace
//! ou do cluster: um tipo fora de [`APPLY_KINDS`] (nada de `Namespace`, RBAC, CRDs, volumes
//! persistentes de cluster…), um `metadata.namespace`, `hostNetwork`/`hostPID`/`hostIPC`, volumes
//! `hostPath`, `hostPort`, contentores privilegiados ou com capacidades a mais, e uma imagem que
//! não seja uma das imagens preparadas do curso (ou que o Kubernetes fosse buscar à internet:
//! `:latest` ou `imagePullPolicy: Always`). O cluster nunca descarrega nada durante a avaliação.
//!
//! As `[[check]]` que lêem uma saída guardada por um `[[live]]` correm DEPOIS dele; as outras
//! correm antes — se falharem, as verificações ao vivo nem começam (corrigir o que se vê sem
//! cluster primeiro).

use std::collections::BTreeSet;

use serde::Deserialize;
use serde_json::Value;

use crate::project::safe_project_path;
use crate::toolcheck::{Check, Expect};

/// Máximo de entradas `[[live]]` de um passo.
pub const MAX_LIVE: usize = 24;
/// Tempo limite por omissão (s) de uma espera (`rollout status`, `wait`, `until`).
pub const DEFAULT_WAIT_SECS: u64 = 60;
/// Tempo limite máximo (s) de uma espera.
pub const MAX_WAIT_SECS: u64 = 300;

/// Uma entrada `[[live]]`: um comando `kubectl` da lista permitida e o que se espera dele.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Live {
    /// O comando, palavra a palavra; nunca passa por uma shell.
    pub cmd: Vec<String>,
    /// Guarda a saída (stdout) como um ficheiro virtual, para as `[[check]]` seguintes.
    #[serde(default)]
    pub save: Option<String>,
    /// O código de saída esperado (`failure`: um passo que ensina o que o cluster recusa).
    #[serde(default)]
    pub expect: Expect,
    /// Textos que a saída (stdout + stderr) tem de conter.
    #[serde(default)]
    pub output_contains: Vec<String>,
    /// Só com `kubectl get … -o json`: repete a consulta até esta afirmação valer (sem `file`;
    /// o documento é a saída), ou até ao tempo limite.
    #[serde(default)]
    pub until: Option<Check>,
    /// O tempo limite (s) de um `until` (o de `rollout status`/`wait` é o seu `--timeout`).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// O que dizer ao aluno quando o comando não faz o esperado.
    #[serde(default)]
    pub message: String,
}

/// Os tipos de recurso que um comando pode nomear (todos com namespace), com os nomes curtos que o
/// `kubectl` aceita. O primeiro é o canónico.
const RESOURCES: &[&[&str]] = &[
    &["pods", "pod", "po"],
    &["deployments", "deployment", "deploy"],
    &["replicasets", "replicaset", "rs"],
    &["statefulsets", "statefulset", "sts"],
    &["daemonsets", "daemonset", "ds"],
    &["jobs", "job"],
    &["cronjobs", "cronjob", "cj"],
    &["services", "service", "svc"],
    &["endpointslices", "endpointslice"],
    &["configmaps", "configmap", "cm"],
    &["secrets", "secret"],
    &["serviceaccounts", "serviceaccount", "sa"],
    &["persistentvolumeclaims", "persistentvolumeclaim", "pvc"],
    &["limitranges", "limitrange", "limits"],
    &["resourcequotas", "resourcequota", "quota"],
    &["events", "event", "ev"],
    &["poddisruptionbudgets", "poddisruptionbudget", "pdb"],
    &["networkpolicies", "networkpolicy", "netpol"],
    &["horizontalpodautoscalers", "horizontalpodautoscaler", "hpa"],
];

/// Os tipos que o `rollout` conhece.
const ROLLOUT: &[&str] = &["deployments", "statefulsets", "daemonsets"];
/// Os tipos cujos registos o `logs TIPO/NOME` lê.
const LOGS: &[&str] = &[
    "pods",
    "deployments",
    "replicasets",
    "statefulsets",
    "daemonsets",
    "jobs",
];

/// Os `kind` que um `apply` pode criar: todos com namespace, nenhum que dê poderes sobre o
/// cluster (sem RBAC, sem `Namespace`, CRDs, webhooks, volumes persistentes de cluster, nós…).
pub const APPLY_KINDS: &[&str] = &[
    "Pod",
    "Deployment",
    "ReplicaSet",
    "StatefulSet",
    "DaemonSet",
    "Job",
    "CronJob",
    "Service",
    "ConfigMap",
    "Secret",
    "ServiceAccount",
    "PersistentVolumeClaim",
    "LimitRange",
    "ResourceQuota",
    "PodDisruptionBudget",
    "NetworkPolicy",
    "HorizontalPodAutoscaler",
];

/// O formato de saída de um `get`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Output {
    Json,
    Yaml,
}

impl Output {
    fn as_str(self) -> &'static str {
        match self {
            Output::Json => "json",
            Output::Yaml => "yaml",
        }
    }
}

/// `TIPO/NOME`, com o tipo canónico.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Named {
    pub resource: String,
    pub name: String,
}

impl Named {
    pub fn display(&self) -> String {
        format!("{}/{}", self.resource, self.name)
    }
}

/// Um comando ao vivo permitido, já reconhecido. [`LiveCommand::args`] dá os argumentos
/// canónicos; quem corre junta-lhes o kubeconfig, o contexto e o namespace (e nunca outra coisa).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveCommand {
    /// `kubectl apply -f <ficheiro do passo>`.
    Apply { file: String },
    /// `kubectl get TIPO[/NOME] [NOME] [-l SELECTOR] -o json|yaml`.
    Get {
        resource: String,
        name: Option<String>,
        selector: Option<String>,
        output: Output,
    },
    /// `kubectl rollout status TIPO/NOME --timeout=Ns`.
    RolloutStatus { target: Named, timeout: u64 },
    /// `kubectl rollout undo TIPO/NOME [--to-revision=N]` (uma escrita no namespace).
    RolloutUndo {
        target: Named,
        revision: Option<u32>,
    },
    /// `kubectl rollout history TIPO/NOME`.
    RolloutHistory { target: Named },
    /// `kubectl wait --for=condition=C[=V] TIPO/NOME --timeout=Ns`.
    Wait {
        condition: String,
        value: Option<String>,
        target: Named,
        timeout: u64,
    },
    /// `kubectl logs POD|TIPO/NOME [-c CONTENTOR] [--previous]`.
    Logs {
        target: String,
        container: Option<String>,
        previous: bool,
    },
}

/// Os comandos permitidos, para as mensagens.
pub const ALLOWED_LIVE: &str = "`kubectl apply -f <file>`, `kubectl get <type>[/<name>] [-l <selector>] -o json|yaml`, \
     `kubectl rollout status|undo|history <type>/<name>`, `kubectl wait --for=condition=<c> <type>/<name>` \
     and `kubectl logs <pod>|<type>/<name> [-c <container>] [--previous]`";

impl LiveCommand {
    /// Os argumentos (sem o executável nem as opções que o avaliador junta), na forma canónica.
    pub fn args(&self) -> Vec<String> {
        let s = |x: &str| x.to_string();
        match self {
            LiveCommand::Apply { file } => vec![s("apply"), s("-f"), file.clone()],
            LiveCommand::Get {
                resource,
                name,
                selector,
                output,
            } => {
                let mut a = vec![s("get"), resource.clone()];
                if let Some(n) = name {
                    a.push(n.clone());
                }
                if let Some(sel) = selector {
                    a.push(s("-l"));
                    a.push(sel.clone());
                }
                a.push(s("-o"));
                a.push(s(output.as_str()));
                a
            }
            LiveCommand::RolloutStatus { target, timeout } => vec![
                s("rollout"),
                s("status"),
                target.display(),
                format!("--timeout={timeout}s"),
            ],
            LiveCommand::RolloutUndo { target, revision } => {
                let mut a = vec![s("rollout"), s("undo"), target.display()];
                if let Some(r) = revision {
                    a.push(format!("--to-revision={r}"));
                }
                a
            }
            LiveCommand::RolloutHistory { target } => {
                vec![s("rollout"), s("history"), target.display()]
            }
            LiveCommand::Wait {
                condition,
                value,
                target,
                timeout,
            } => vec![
                s("wait"),
                match value {
                    Some(v) => format!("--for=condition={condition}={v}"),
                    None => format!("--for=condition={condition}"),
                },
                target.display(),
                format!("--timeout={timeout}s"),
            ],
            LiveCommand::Logs {
                target,
                container,
                previous,
            } => {
                let mut a = vec![s("logs"), target.clone()];
                if let Some(c) = container {
                    a.push(s("-c"));
                    a.push(c.clone());
                }
                if *previous {
                    a.push(s("--previous"));
                }
                a
            }
        }
    }

    /// O comando como se escreve (para o relatório).
    pub fn display(&self) -> String {
        let mut parts = vec!["kubectl".to_string()];
        parts.extend(self.args());
        parts.join(" ")
    }

    /// O tempo limite (s) que o próprio comando espera (`rollout status`, `wait`), ou `None`.
    pub fn wait_secs(&self) -> Option<u64> {
        match self {
            LiveCommand::RolloutStatus { timeout, .. } | LiveCommand::Wait { timeout, .. } => {
                Some(*timeout)
            }
            _ => None,
        }
    }

    /// `true` num `get … -o json` (o único que um `until` pode repetir).
    pub fn is_json_get(&self) -> bool {
        matches!(
            self,
            LiveCommand::Get {
                output: Output::Json,
                ..
            }
        )
    }
}

/// O tipo canónico de `word` (`deploy` → `deployments`), se for um dos [`RESOURCES`].
pub fn canonical_resource(word: &str) -> Option<&'static str> {
    let w = word.to_ascii_lowercase();
    RESOURCES
        .iter()
        .find(|names| names.contains(&w.as_str()))
        .map(|names| names[0])
}

/// Um nome de objecto DNS-1123 (subdomínio: minúsculas, dígitos, `-` e `.`).
pub fn object_name_ok(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 253
        && n.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && n.ends_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.')
}

fn label_name_ok(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 63
        && n.starts_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && n.ends_with(|c: char| c.is_ascii_lowercase() || c.is_ascii_digit())
        && n.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Um selector de etiquetas simples: `k=v`, `k!=v`, `k` ou `!k`, separados por `,`.
fn selector_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.split(',').all(|part| {
            let part = part.trim_start_matches('!');
            let key = part.split(['=', '!']).next().unwrap_or("");
            !key.is_empty()
                && part.chars().all(|c| {
                    c.is_ascii_alphanumeric() || matches!(c, '.' | '/' | '_' | '-' | '=' | '!')
                })
        })
}

fn condition_ok(c: &str) -> bool {
    !c.is_empty()
        && c.len() <= 63
        && c.starts_with(|ch: char| ch.is_ascii_uppercase())
        && c.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn named(word: &str, allowed: Option<&[&str]>) -> Option<Named> {
    let (kind, name) = word.split_once('/')?;
    let resource = canonical_resource(kind)?;
    if allowed.is_some_and(|a| !a.contains(&resource)) || !object_name_ok(name) {
        return None;
    }
    Some(Named {
        resource: resource.to_string(),
        name: name.to_string(),
    })
}

fn timeout_flag(word: &str) -> Option<u64> {
    let n: u64 = word
        .strip_prefix("--timeout=")?
        .strip_suffix('s')?
        .parse()
        .ok()?;
    (1..=MAX_WAIT_SECS).contains(&n).then_some(n)
}

/// Reconhece um comando ao vivo da lista permitida, ou diz porque é recusado.
pub fn parse_live_command(argv: &[String]) -> Result<LiveCommand, String> {
    let words: Vec<&str> = argv.iter().map(String::as_str).collect();
    let refuse = || {
        format!(
            "command `{}` is not allowed in a live check: only {ALLOWED_LIVE} run, always against the practice cluster and the grading namespace",
            words.join(" ")
        )
    };
    // As opções que escolhem o cluster, o namespace ou a identidade são do avaliador.
    const OWNED: &[&str] = &[
        "--kubeconfig",
        "--context",
        "--cluster",
        "--user",
        "--namespace",
        "-n",
        "-A",
        "--all-namespaces",
        "--server",
        "-s",
        "--token",
        "--as",
        "--as-group",
        "--as-uid",
        "--certificate-authority",
        "--client-certificate",
        "--client-key",
        "--insecure-skip-tls-verify",
        "--username",
        "--password",
    ];
    if let Some(w) = words.iter().find(|w| {
        OWNED
            .iter()
            .any(|o| **w == *o || w.starts_with(&format!("{o}=")))
    }) {
        return Err(format!(
            "command `{}`: `{w}` is set by the grader (the practice cluster, its context and a fresh namespace), never by a course",
            words.join(" ")
        ));
    }
    let Some((&"kubectl", rest)) = words.split_first() else {
        return Err(refuse());
    };
    match rest {
        ["apply", "-f", file] if safe_project_path(file) => Ok(LiveCommand::Apply {
            file: file.to_string(),
        }),
        ["get", target, tail @ ..] => {
            let (resource, mut name) = match target.split_once('/') {
                Some(_) => {
                    let n = named(target, None).ok_or_else(refuse)?;
                    (n.resource, Some(n.name))
                }
                None => (
                    canonical_resource(target).ok_or_else(refuse)?.to_string(),
                    None,
                ),
            };
            let mut selector = None;
            let mut output = None;
            let mut i = 0;
            while i < tail.len() {
                match (tail[i], tail.get(i + 1)) {
                    ("-l", Some(sel)) if selector.is_none() && selector_ok(sel) => {
                        selector = Some(sel.to_string());
                        i += 2;
                    }
                    ("-o", Some(&"json")) if output.is_none() => {
                        output = Some(Output::Json);
                        i += 2;
                    }
                    ("-o", Some(&"yaml")) if output.is_none() => {
                        output = Some(Output::Yaml);
                        i += 2;
                    }
                    (n, _) if i == 0 && name.is_none() && object_name_ok(n) => {
                        name = Some(n.to_string());
                        i += 1;
                    }
                    _ => return Err(refuse()),
                }
            }
            let output = output.ok_or_else(|| {
                format!(
                    "command `{}`: a live `get` says `-o json` or `-o yaml` (the output is checked as a document)",
                    words.join(" ")
                )
            })?;
            if name.is_some() && selector.is_some() {
                return Err(refuse());
            }
            Ok(LiveCommand::Get {
                resource,
                name,
                selector,
                output,
            })
        }
        ["rollout", "status", target, tail @ ..] => {
            let target = named(target, Some(ROLLOUT)).ok_or_else(refuse)?;
            let timeout = match tail {
                [] => DEFAULT_WAIT_SECS,
                [t] => timeout_flag(t).ok_or_else(refuse)?,
                _ => return Err(refuse()),
            };
            Ok(LiveCommand::RolloutStatus { target, timeout })
        }
        ["rollout", "undo", target, tail @ ..] => {
            let target = named(target, Some(ROLLOUT)).ok_or_else(refuse)?;
            let revision = match tail {
                [] => None,
                [r] => Some(
                    r.strip_prefix("--to-revision=")
                        .and_then(|n| n.parse::<u32>().ok())
                        .filter(|n| *n > 0)
                        .ok_or_else(refuse)?,
                ),
                _ => return Err(refuse()),
            };
            Ok(LiveCommand::RolloutUndo { target, revision })
        }
        ["rollout", "history", target] => Ok(LiveCommand::RolloutHistory {
            target: named(target, Some(ROLLOUT)).ok_or_else(refuse)?,
        }),
        ["wait", cond, target, tail @ ..] => {
            let spec = cond.strip_prefix("--for=condition=").ok_or_else(refuse)?;
            let (condition, value) = match spec.split_once('=') {
                Some((c, v)) => (c, Some(v)),
                None => (spec, None),
            };
            if !condition_ok(condition)
                || value.is_some_and(|v| !matches!(v, "true" | "false" | "True" | "False"))
            {
                return Err(refuse());
            }
            let target = named(target, None).ok_or_else(refuse)?;
            let timeout = match tail {
                [] => DEFAULT_WAIT_SECS,
                [t] => timeout_flag(t).ok_or_else(refuse)?,
                _ => return Err(refuse()),
            };
            Ok(LiveCommand::Wait {
                condition: condition.to_string(),
                value: value.map(str::to_string),
                target,
                timeout,
            })
        }
        ["logs", target, tail @ ..] => {
            let target = match target.split_once('/') {
                Some(_) => named(target, Some(LOGS)).ok_or_else(refuse)?.display(),
                None if object_name_ok(target) => target.to_string(),
                None => return Err(refuse()),
            };
            let mut container = None;
            let mut previous = false;
            let mut i = 0;
            while i < tail.len() {
                match (tail[i], tail.get(i + 1)) {
                    ("-c", Some(c)) if container.is_none() && label_name_ok(c) => {
                        container = Some(c.to_string());
                        i += 2;
                    }
                    ("--previous", _) if !previous => {
                        previous = true;
                        i += 1;
                    }
                    _ => return Err(refuse()),
                }
            }
            Ok(LiveCommand::Logs {
                target,
                container,
                previous,
            })
        }
        _ => Err(refuse()),
    }
}

/// Erros de forma das entradas `[[live]]` (vazio = válidas). `known` são os ficheiros do passo
/// (do aluno e ocultos) e as saídas guardadas antes; as que estas entradas guardam juntam-se-lhe.
pub fn check_live(live: &[Live], known: &mut BTreeSet<String>) -> Vec<String> {
    let mut errs = Vec::new();
    if live.len() > MAX_LIVE {
        errs.push(format!(
            "{}: more than {MAX_LIVE} live entries",
            crate::toolcheck::CHECKS_FILE
        ));
    }
    if !live.is_empty()
        && !live
            .iter()
            .any(|l| matches!(parse_live_command(&l.cmd), Ok(LiveCommand::Apply { .. })))
    {
        errs.push(format!(
            "{}: live checks apply nothing (add a `kubectl apply -f <file>` entry)",
            crate::toolcheck::CHECKS_FILE
        ));
    }
    for (n, l) in live.iter().enumerate() {
        let at = format!("{}: live #{}", crate::toolcheck::CHECKS_FILE, n + 1);
        let cmd = match parse_live_command(&l.cmd) {
            Ok(c) => Some(c),
            Err(e) => {
                errs.push(format!("{at}: {e}"));
                None
            }
        };
        if let Some(LiveCommand::Apply { file }) = &cmd {
            if !known.contains(file) {
                errs.push(format!("{at}: `{file}` is not a file of the step"));
            }
        }
        if l.message.trim().is_empty() {
            errs.push(format!(
                "{at}: `message` is empty (tell the learner what the cluster should show)"
            ));
        }
        if l.output_contains.iter().any(|s| s.is_empty()) {
            errs.push(format!("{at}: an empty `output_contains` entry"));
        }
        if let Some(save) = &l.save {
            if !safe_project_path(save) {
                errs.push(format!("{at}: save `{save}` is not a safe relative path"));
            } else if !known.insert(save.clone()) {
                errs.push(format!(
                    "{at}: save `{save}` is already a file of the step (or saved twice)"
                ));
            }
            if l.expect == Expect::Failure {
                errs.push(format!(
                    "{at}: a command expected to fail has no output to `save`"
                ));
            }
            if cmd
                .as_ref()
                .is_some_and(|c| !matches!(c, LiveCommand::Get { .. }))
            {
                errs.push(format!(
                    "{at}: only a `kubectl get … -o json|yaml` output can be saved as a document"
                ));
            }
        }
        match (&l.until, &cmd) {
            (Some(u), Some(c)) => {
                if !c.is_json_get() {
                    errs.push(format!(
                        "{at}: `until` repeats a `kubectl get … -o json` only"
                    ));
                }
                if l.expect == Expect::Failure {
                    errs.push(format!("{at}: `until` waits for success; drop `expect`"));
                }
                if !u.file.is_empty() {
                    errs.push(format!(
                        "{at}: leave `file` out of `until` (the document is the command's output)"
                    ));
                }
                errs.extend(
                    crate::toolcheck::check_assertion_form(u)
                        .into_iter()
                        .map(|e| format!("{at}: until: {e}")),
                );
                if u.same_as.is_some() || u.among.is_some() || u.selects.is_some() {
                    errs.push(format!(
                        "{at}: until: compare with values (`equals`, `len`, …), not with other files"
                    ));
                }
            }
            (None, _) if l.timeout_secs.is_some() => errs.push(format!(
                "{at}: `timeout_secs` is for `until` (rollout status and wait take `--timeout=Ns`)"
            )),
            _ => {}
        }
        if let Some(t) = l.timeout_secs {
            if !(1..=MAX_WAIT_SECS).contains(&t) {
                errs.push(format!(
                    "{at}: `timeout_secs` must be between 1 and {MAX_WAIT_SECS}"
                ));
            }
        }
    }
    errs
}

/// Porque uma imagem de um manifesto não corre no cluster de prática (`None`: é uma das imagens
/// preparadas, pelo nome e a etiqueta com que o cluster a conhece).
fn image_problem(img: &str, images: &[crate::ImageRef]) -> Option<String> {
    let prepared = || {
        if images.is_empty() {
            "none".to_string()
        } else {
            images
                .iter()
                .map(|i| format!("`{}`", i.short()))
                .collect::<Vec<_>>()
                .join(", ")
        }
    };
    let Some(n) = crate::normalize_image(img) else {
        return Some(format!("`{img}` is not an image reference"));
    };
    if n.digest.is_some() {
        return Some(format!(
            "write the image by its tag (one of {}), not by digest: the practice cluster knows its images by name",
            prepared()
        ));
    }
    match n.tag.as_deref() {
        None | Some("latest") => Some(format!(
            "`{img}` has no version tag, so Kubernetes would pull it every time; use one of {}",
            prepared()
        )),
        Some(_) if images.iter().any(|i| i.matches(img)) => None,
        Some(_) => Some(format!(
            "the image `{img}` is not one of this course's prepared images ({}); the practice cluster never downloads images",
            prepared()
        )),
    }
}

/// `true` quando o passo se verifica ao vivo (o seu `checks.toml` tem `[[live]]`).
pub fn step_is_live(project: &crate::ProjectFiles) -> bool {
    project
        .tests
        .get(crate::toolcheck::CHECKS_FILE)
        .and_then(|raw| crate::toolcheck::Checks::parse(raw).ok())
        .is_some_and(|c| c.needs_cluster())
}

/// `true` quando avaliar `phase` precisa da cache preparada do curso. Num curso de cluster só os
/// passos ao vivo a usam: os outros (manifestos lidos, `kubectl kustomize`) continuam offline e
/// avaliam-se sem preparar nada, nem Podman.
pub fn phase_needs_cache(phase: &crate::Phase) -> bool {
    match phase.build.cache.as_ref().and_then(|c| c.kind()) {
        None => false,
        Some(crate::CacheKind::Cluster) => phase.project.as_ref().is_some_and(step_is_live),
        Some(_) => true,
    }
}

// ── O que um `apply` pode criar ──────────────────────────────────────────────────────────

/// O `PodSpec` de um documento (Pod, os controladores com `template`, CronJob), se tiver um.
fn pod_spec(doc: &Value) -> Option<&Value> {
    let spec = doc.get("spec")?;
    match doc.get("kind").and_then(Value::as_str)? {
        "Pod" => Some(spec),
        "CronJob" => spec
            .get("jobTemplate")?
            .get("spec")?
            .get("template")?
            .get("spec"),
        "Deployment" | "ReplicaSet" | "StatefulSet" | "DaemonSet" | "Job" => {
            spec.get("template")?.get("spec")
        }
        _ => None,
    }
}

fn truthy(v: Option<&Value>) -> bool {
    v.and_then(Value::as_bool).unwrap_or(false)
}

/// Problemas dos documentos de um ficheiro que um `apply` ao vivo criaria (vazio = pode correr).
/// `images` são os nomes completos das imagens preparadas do curso (`docker.io/library/nginx:…`,
/// [`crate::ImageRef::named`]). A regra está explicada no cabeçalho do módulo.
pub fn manifest_problems(file: &str, docs: &[Value], images: &[crate::ImageRef]) -> Vec<String> {
    let mut out = Vec::new();
    if docs.is_empty() {
        out.push(format!("`{file}` has no document to apply"));
    }
    for d in docs {
        let kind = d.get("kind").and_then(Value::as_str).unwrap_or("");
        let name = d
            .get("metadata")
            .and_then(|m| m.get("name"))
            .and_then(Value::as_str)
            .unwrap_or("?");
        let at = format!("`{file}` › {kind}/{name}");
        if !APPLY_KINDS.contains(&kind) {
            out.push(format!(
                "{at}: a `{}` is not created in the practice cluster (only namespaced objects: {})",
                if kind.is_empty() {
                    "document without kind"
                } else {
                    kind
                },
                APPLY_KINDS.join(", ")
            ));
            continue;
        }
        if d.get("metadata").and_then(|m| m.get("namespace")).is_some() {
            out.push(format!(
                "{at}: leave `metadata.namespace` out — grading applies your files to a fresh namespace of its own"
            ));
        }
        if kind == "Service" {
            if let Some(ips) = d.get("spec").and_then(|s| s.get("externalIPs")) {
                if ips.as_array().is_some_and(|a| !a.is_empty()) {
                    out.push(format!(
                        "{at}: `externalIPs` is not used in the practice cluster"
                    ));
                }
            }
        }
        let Some(spec) = pod_spec(d) else { continue };
        for key in ["hostNetwork", "hostPID", "hostIPC"] {
            if truthy(spec.get(key)) {
                out.push(format!(
                    "{at}: `{key}: true` shares the node's namespaces; the practice cluster runs Pods isolated"
                ));
            }
        }
        if let Some(vols) = spec.get("volumes").and_then(Value::as_array) {
            for v in vols {
                if v.get("hostPath").is_some() {
                    let vn = v.get("name").and_then(Value::as_str).unwrap_or("?");
                    out.push(format!(
                        "{at}: volume `{vn}` uses `hostPath`, which mounts the node's files; use a configMap, secret or emptyDir"
                    ));
                }
            }
        }
        for list in ["initContainers", "containers", "ephemeralContainers"] {
            let Some(cs) = spec.get(list).and_then(Value::as_array) else {
                continue;
            };
            for c in cs {
                let cn = c.get("name").and_then(Value::as_str).unwrap_or("?");
                let cat = format!("{at} › container `{cn}`");
                match c.get("image").and_then(Value::as_str) {
                    None => out.push(format!("{cat}: no `image`")),
                    Some(img) => {
                        if let Some(why) = image_problem(img, images) {
                            out.push(format!("{cat}: {why}"));
                        }
                    }
                }
                if c.get("imagePullPolicy").and_then(Value::as_str) == Some("Always") {
                    out.push(format!(
                        "{cat}: `imagePullPolicy: Always` asks a registry every time; the practice cluster is offline (use IfNotPresent)"
                    ));
                }
                let sc = c.get("securityContext");
                if truthy(sc.and_then(|s| s.get("privileged"))) {
                    out.push(format!(
                        "{cat}: privileged containers are not run in the practice cluster"
                    ));
                }
                if sc
                    .and_then(|s| s.get("capabilities"))
                    .and_then(|c| c.get("add"))
                    .and_then(Value::as_array)
                    .is_some_and(|a| !a.is_empty())
                {
                    out.push(format!(
                        "{cat}: `capabilities.add` is not allowed in the practice cluster (drop capabilities, never add them)"
                    ));
                }
                if let Some(ports) = c.get("ports").and_then(Value::as_array) {
                    if ports.iter().any(|p| p.get("hostPort").is_some()) {
                        out.push(format!(
                            "{cat}: `hostPort` publishes on the node; use a Service instead"
                        ));
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn argv(s: &str) -> Vec<String> {
        s.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn the_allowed_commands_parse_to_their_canonical_form() {
        let ok = |s: &str| parse_live_command(&argv(s)).unwrap_or_else(|e| panic!("{s}: {e}"));
        assert_eq!(
            ok("kubectl apply -f k8s/web.yaml").display(),
            "kubectl apply -f k8s/web.yaml"
        );
        assert_eq!(
            ok("kubectl get deploy/web -o json").display(),
            "kubectl get deployments web -o json"
        );
        assert_eq!(
            ok("kubectl get pods -l app=web,tier!=db -o yaml").display(),
            "kubectl get pods -l app=web,tier!=db -o yaml"
        );
        assert_eq!(
            ok("kubectl get svc web -o json").display(),
            "kubectl get services web -o json"
        );
        assert_eq!(
            ok("kubectl rollout status deployment/web").display(),
            "kubectl rollout status deployments/web --timeout=60s"
        );
        assert_eq!(
            ok("kubectl rollout status sts/db --timeout=120s").wait_secs(),
            Some(120)
        );
        assert_eq!(
            ok("kubectl rollout undo deploy/web --to-revision=2").display(),
            "kubectl rollout undo deployments/web --to-revision=2"
        );
        assert_eq!(
            ok("kubectl rollout history deploy/web").display(),
            "kubectl rollout history deployments/web"
        );
        assert_eq!(
            ok("kubectl wait --for=condition=Ready=false pod/probe --timeout=45s").display(),
            "kubectl wait --for=condition=Ready=false pods/probe --timeout=45s"
        );
        assert_eq!(
            ok("kubectl logs job/sum -c sum --previous").display(),
            "kubectl logs jobs/sum -c sum --previous"
        );
        assert_eq!(ok("kubectl logs hog").display(), "kubectl logs hog");
        assert!(ok("kubectl get deploy web -o json").is_json_get());
        assert!(!ok("kubectl get deploy web -o yaml").is_json_get());
    }

    #[test]
    fn everything_else_is_refused_with_a_reason() {
        for bad in [
            "kubectl exec web -- sh",
            "kubectl port-forward svc/web 8080:80",
            "kubectl proxy",
            "kubectl cp a b",
            "kubectl run x --image=nginx",
            "kubectl create namespace x",
            "kubectl delete namespace kube-system",
            "kubectl delete pod web",
            "kubectl scale deploy/web --replicas=9",
            "kubectl patch deploy web -p {}",
            "kubectl config view",
            "kubectl get nodes -o json",
            "kubectl get namespaces -o json",
            "kubectl get clusterroles -o json",
            "kubectl get pods",
            "kubectl get pods -o wide",
            "kubectl get pods web -l app=web -o json",
            "kubectl apply -f /etc/passwd",
            "kubectl apply -f ../x.yaml",
            "kubectl apply -k .",
            "kubectl rollout status pod/web",
            "kubectl rollout status deploy/web --timeout=9999s",
            "kubectl rollout restart deploy/web",
            "kubectl wait --for=delete pod/web",
            "kubectl wait --for=jsonpath={.x}=1 pod/web",
            "kubectl wait --for=condition=Ready=maybe pod/web",
            "kubectl logs svc/web",
            "kubectl logs web -f",
            "helm install x",
            "sh -c kubectl",
        ] {
            assert!(
                parse_live_command(&argv(bad)).is_err(),
                "{bad} must be refused"
            );
        }
        for owned in [
            "kubectl get pods -n kube-system -o json",
            "kubectl get pods --namespace=default -o json",
            "kubectl get pods -A -o json",
            "kubectl --kubeconfig /home/u/.kube/config get pods -o json",
            "kubectl --context delonix-financivo get pods -o json",
            "kubectl get pods --server=https://x -o json",
            "kubectl get pods --as=system:admin -o json",
        ] {
            let e = parse_live_command(&argv(owned)).unwrap_err();
            assert!(e.contains("set by the grader"), "{owned}: {e}");
        }
    }

    fn live(cmd: &str) -> Live {
        Live {
            cmd: argv(cmd),
            save: None,
            expect: Expect::Success,
            output_contains: vec![],
            until: None,
            timeout_secs: None,
            message: "m".into(),
        }
    }

    #[test]
    fn the_form_of_live_entries_is_checked() {
        let mut known = BTreeSet::from(["web.yaml".to_string()]);
        let mut get = live("kubectl get deploy web -o json");
        get.save = Some("web.json".into());
        get.until = Some(Check {
            path: "status.readyReplicas".into(),
            equals: Some(toml::Value::Integer(3)),
            ..Default::default()
        });
        get.timeout_secs = Some(90);
        let good = vec![live("kubectl apply -f web.yaml"), get];
        assert!(check_live(&good, &mut known).is_empty());
        assert!(
            known.contains("web.json"),
            "the saved output becomes a file"
        );

        let mut known = BTreeSet::from(["web.yaml".to_string()]);
        let mut bad_until = live("kubectl rollout status deploy/web");
        bad_until.until = Some(Check {
            file: "x".into(),
            ..Default::default()
        });
        let mut bad_save = live("kubectl logs web");
        bad_save.save = Some("web.yaml".into());
        let mut bad_timeout = live("kubectl apply -f web.yaml");
        bad_timeout.timeout_secs = Some(10);
        let mut empty = live("kubectl apply -f nope.yaml");
        empty.message = " ".into();
        let errs = check_live(&[bad_until, bad_save, bad_timeout, empty], &mut known);
        let all = errs.join("\n");
        for want in [
            "`until` repeats a `kubectl get … -o json` only",
            "leave `file` out of `until`",
            "until: needs exactly one assertion",
            "already a file of the step",
            "only a `kubectl get",
            "`timeout_secs` is for `until`",
            "`nope.yaml` is not a file of the step",
            "`message` is empty",
        ] {
            assert!(all.contains(want), "missing {want:?} in:\n{all}");
        }
        let errs = check_live(&[live("kubectl get pods -o json")], &mut BTreeSet::new());
        assert!(errs.iter().any(|e| e.contains("apply nothing")), "{errs:?}");
    }

    #[test]
    fn manifests_stay_inside_the_namespace_and_use_prepared_images() {
        let digest = "@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10";
        let images = vec![
            crate::image_reference(&format!("docker.io/library/nginx:1.27.5-alpine{digest}"))
                .unwrap(),
            crate::image_reference(&format!("docker.io/library/busybox:1.37.0{digest}")).unwrap(),
        ];
        let by_digest = json!({"kind": "Pod", "metadata": {"name": "d"}, "spec": {"containers": [
            {"name": "d", "image": format!("nginx:1.27.5-alpine{digest}")}]}});
        let p = manifest_problems("d.yaml", &[by_digest], &images);
        assert!(p[0].contains("not by digest"), "{p:?}");
        let other = json!({"kind": "Pod", "metadata": {"name": "o"}, "spec": {"containers": [
            {"name": "o", "image": "nginx:1.28.0-alpine"}]}});
        let p = manifest_problems("o.yaml", &[other], &images);
        assert!(
            p[0].contains("not one of this course's prepared images (`nginx:1.27.5-alpine`, `busybox:1.37.0`)"),
            "{p:?}"
        );
        let deploy = json!({
            "apiVersion": "apps/v1", "kind": "Deployment", "metadata": {"name": "web"},
            "spec": {"template": {"spec": {"containers": [
                {"name": "web", "image": "nginx:1.27.5-alpine"},
                {"name": "side", "image": "docker.io/library/busybox:1.37.0", "imagePullPolicy": "IfNotPresent"}
            ]}}}
        });
        assert!(manifest_problems("d.yaml", &[deploy], &images).is_empty());

        let cron = json!({"kind": "CronJob", "metadata": {"name": "c"}, "spec": {"jobTemplate": {"spec": {"template": {"spec": {
            "containers": [{"name": "c", "image": "busybox"}]}}}}}});
        let p = manifest_problems("c.yaml", &[cron], &images);
        assert!(p[0].contains("no version tag"), "{p:?}");

        let bad = json!({
            "apiVersion": "v1", "kind": "Pod", "metadata": {"name": "x", "namespace": "kube-system"},
            "spec": {"hostNetwork": true, "volumes": [{"name": "root", "hostPath": {"path": "/"}}],
                "containers": [{"name": "x", "image": "nginx:1.27.5-alpine", "imagePullPolicy": "Always",
                    "securityContext": {"privileged": true, "capabilities": {"add": ["SYS_ADMIN"]}},
                    "ports": [{"containerPort": 80, "hostPort": 80}]}]}
        });
        let ns = json!({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": "x"}});
        let crb = json!({"kind": "ClusterRoleBinding", "metadata": {"name": "x"}});
        let svc = json!({"kind": "Service", "metadata": {"name": "s"}, "spec": {"externalIPs": ["1.2.3.4"]}});
        let all = manifest_problems("bad.yaml", &[bad, ns, crb, svc], &images).join("\n");
        for want in [
            "leave `metadata.namespace` out",
            "`hostNetwork: true`",
            "`hostPath`",
            "`imagePullPolicy: Always`",
            "privileged",
            "`capabilities.add`",
            "`hostPort`",
            "a `Namespace` is not created",
            "a `ClusterRoleBinding` is not created",
            "`externalIPs`",
        ] {
            assert!(all.contains(want), "missing {want:?} in:\n{all}");
        }
        assert!(manifest_problems("e.yaml", &[], &images)[0].contains("no document"));
    }
}
