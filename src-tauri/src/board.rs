//! Comandos Tauri do Project (docs/v2/UI-AUDIT.md, item 5) — adaptadores finos sobre o
//! store SQLite [`tutor_board::project`]. Um projecto por *workspace* (a raiz aberta). A base
//! vive no directório de dados local da app (`app_local_data_dir/board.sqlite3`); a
//! migração 1 importa o Board antigo que lá estava. O quadro Tasks (ADR-0006, R3b) continua com
//! `board_load`/`board_save`, num ficheiro próprio (`tasks.sqlite3`, fim deste módulo).
//!
//! As regras (um passo de cada vez, WIP, DoR, DoD, bloqueio) são verificadas no store, numa
//! transacção por operação; aqui só se abre a base, se identifica quem age e se devolve o
//! projecto (ou o erro com o código da regra, para a UI oferecer a excepção com motivo).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use tutor_board::project::{
    reports::Reports, AuditEntry, ChangeSetGroup, IssueDetail, Op, Project, ProjectError,
    ProjectStore, TestResult,
};
use tutor_board::{Backlog, BoardStore};

/// Caminho do ficheiro SQLite do projecto, criando o directório se preciso.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("sem directório de dados: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui criar {dir:?}: {e}"))?;
    Ok(dir.join("board.sqlite3"))
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_err(e: String) -> ProjectError {
    ProjectError {
        code: "db".into(),
        message: e,
        overridable: false,
    }
}

fn open(app: &AppHandle) -> Result<ProjectStore, ProjectError> {
    ProjectStore::open(&db_path(app).map_err(db_err)?).map_err(db_err)
}

fn root_of(root: &str) -> Result<String, ProjectError> {
    let r = root.trim();
    if r.is_empty() {
        return Err(ProjectError {
            code: "invalid".into(),
            message: "o Project precisa de uma pasta aberta".into(),
            overridable: false,
        });
    }
    Ok(r.to_string())
}

/// Quem age: o `user.name` do git do projecto (em cache por raiz), ou o utilizador do SO.
pub fn actor(root: &str) -> String {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(a) = cache.lock().unwrap().get(root) {
        return a.clone();
    }
    let git = std::process::Command::new("git")
        .args(["config", "user.name"])
        .current_dir(Path::new(root))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    let a = git
        .or_else(|| std::env::var("USER").ok())
        .or_else(|| std::env::var("USERNAME").ok())
        .unwrap_or_else(|| "eu".into());
    cache.lock().unwrap().insert(root.to_string(), a.clone());
    a
}

/// O projecto da pasta `root` (criado vazio no primeiro uso).
#[tauri::command]
pub fn project_load(app: AppHandle, root: String) -> Result<Project, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.load(&root, now_ms())
}

/// Aplica uma operação (`{op: "move", key, to, reason?}`, `{op: "create_issue", …}`, …) de
/// forma atómica e devolve o projecto depois dela. Uma regra violada devolve o erro com o
/// `code` da regra e `overridable`.
#[tauri::command]
pub fn project_apply(
    app: AppHandle,
    root: String,
    op: serde_json::Value,
) -> Result<Project, ProjectError> {
    let root = root_of(&root)?;
    // RF-A06: the Ready (DoR) approval and Done are the Product Owner's or the Tech Lead's
    let need_role = match op.get("op").and_then(|v| v.as_str()) {
        Some("update_issue") if op.get("ready").and_then(|v| v.as_bool()) == Some(true) => {
            Some("aprovar o Ready (a Definition of Ready)")
        }
        Some("move") if op.get("to").and_then(|v| v.as_str()) == Some("done") => {
            Some("marcar uma issue como Done")
        }
        _ => None,
    };
    if let Some(what) = need_role {
        crate::roles::require(Path::new(&root), &["product_owner", "tech_lead"], what).map_err(
            |message| ProjectError {
                code: "role".into(),
                message,
                overridable: false,
            },
        )?;
    }
    // Multi Co-Dev (phase 2): the functional approval is the issue's responsible's (or a PO's / a
    // Tech Lead's); the store records who and when
    if let Some(k @ ("approve_functional" | "revoke_functional")) =
        op.get("op").and_then(|v| v.as_str())
    {
        let key = op.get("key").and_then(|v| v.as_str()).unwrap_or_default();
        let p = open(&app)?.load(&root, now_ms())?;
        let i = p
            .issues
            .iter()
            .find(|i| i.key == key)
            .ok_or_else(|| ProjectError {
                code: "not_found".into(),
                message: format!("a issue {key} não existe"),
                overridable: false,
            })?;
        let also = (k == "revoke_functional")
            .then(|| i.functional.as_ref().map(|a| a.by.as_str()))
            .flatten();
        let dir = Path::new(&root);
        let email = git_config(dir, "user.email");
        let me = actor(&root);
        crate::roles::functional_check(
            crate::roles::my_roles(dir).as_deref(),
            &i.assignee,
            also,
            &[me.as_str(), email.as_str()],
        )
        .map_err(|message| ProjectError {
            code: "role".into(),
            message,
            overridable: false,
        })?;
    }
    let op: Op = serde_json::from_value(op).map_err(|e| ProjectError {
        code: "invalid".into(),
        message: format!("operação inválida: {e}"),
        overridable: false,
    })?;
    open(&app)?.apply(&root, &actor(&root), now_ms(), op)
}

/// O que escolher o método `method` muda nas definições da pasta (Board B): o que passa aos valores
/// do método e o que fica porque o utilizador o definiu. Não escreve nada — o «settings» com
/// `method` aplica a mesma mudança. `lang`: a língua das sugestões de DoR/DoD (`pt`, senão inglês).
#[tauri::command]
pub fn project_method_preview(
    app: AppHandle,
    root: String,
    method: String,
    lang: Option<String>,
) -> Result<tutor_board::project::methods::MethodChange, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.method_preview(&root, &method, lang.as_deref().unwrap_or("pt"), now_ms())
}

fn git_config(dir: &Path, key: &str) -> String {
    std::process::Command::new("git")
        .args(["config", key])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// As verificações obrigatórias do projecto (Multi Co-Dev: a porta de integração da fase 4 corre-as
/// no commit actual). Vazio: não foram definidas — vale o comando de testes detectado.
#[tauri::command]
pub fn project_checks(
    app: AppHandle,
    root: String,
) -> Result<Vec<tutor_board::project::Check>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.checks(&root)
}

/// A actividade e os change sets do Co-Dev de uma issue (o painel da issue).
#[tauri::command]
pub fn project_issue(
    app: AppHandle,
    root: String,
    key: String,
) -> Result<IssueDetail, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.detail(&root, &key)
}

/// Os change sets do Co-Dev ainda por commitar, agrupados por issue (RF-E08): os aceites depois
/// do último commit do `HEAD` (sem `HEAD` — repositório novo ou sem git — todos). O painel
/// Source Control cruza-os com os ficheiros alterados e oferece Stage/Discard por conjunto.
#[tauri::command]
pub fn project_change_sets(
    app: AppHandle,
    root: String,
) -> Result<Vec<ChangeSetGroup>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.change_sets_since(&root, head_commit_ms(Path::new(&root)))
}

/// A hora do commit do `HEAD` em ms (0 sem git, sem repositório ou sem commits).
fn head_commit_ms(root: &Path) -> i64 {
    std::process::Command::new("git")
        .args(["log", "-1", "--format=%ct", "HEAD"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .parse::<i64>()
                .ok()
        })
        .map_or(0, |s| s * 1000)
}

/// Os relatórios calculados do histórico (vazios sem histórico).
#[tauri::command]
pub fn project_reports(app: AppHandle, root: String) -> Result<Reports, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.reports(&root, now_ms())
}

/// O registo de auditoria do Co-Dev (RF-T01): de uma issue (`issue`) ou da pasta toda, por
/// ordem, com os segredos já mascarados. É o que «Exportar registo» grava em JSON.
#[tauri::command]
pub fn project_audit(
    app: AppHandle,
    root: String,
    issue: Option<String>,
) -> Result<Vec<AuditEntry>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.audit(&root, issue.as_deref().filter(|k| !k.trim().is_empty()))
}

/// What the IDE (outside the Co-Dev) asks to record (r23 F1, RF-BK-L01): an operation that changed
/// something outside the editor, the exact command, where it ran, the human's decision and what
/// happened. Who and when are decided HERE, not by the UI.
#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct IdeAudit {
    /// the feature that asked (`ops`, `scm`, `debug`, …)
    pub feature: String,
    /// what it did (`kube.undo`, `iac.apply`, `git.push`, …)
    pub action: String,
    /// the exact command shown in the approval dialog
    pub command: String,
    /// where it ran (`context kind-dev · namespace shop`, `folder infra · tofu`, `branch main`)
    #[serde(default)]
    pub scope: Option<String>,
    pub approved: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// `sent` (to a terminal), `ok`, `failed`; ignored when refused (`denied`)
    #[serde(default)]
    pub outcome: Option<String>,
    /// when the human decided (ms); the backend's clock when absent
    #[serde(default)]
    pub decided_at: Option<i64>,
}

const IDE_OUTCOMES: [&str; 3] = ["sent", "ok", "failed"];
const IDE_MAX_COMMAND: usize = 8 * 1024;

fn invalid(message: String) -> ProjectError {
    ProjectError {
        code: "invalid".into(),
        message,
        overridable: false,
    }
}

/// The audit row of an IDE operation: origin `ide`, the secrets masked (the `.env` values and the
/// well-known patterns), the actor and the time from the backend. Pure (tests).
pub fn ide_audit_entry(
    a: &IdeAudit,
    actor: &str,
    now: i64,
    redactor: &tutor_agent::redact::Redactor,
) -> Result<AuditEntry, ProjectError> {
    let slug = |v: &str| {
        !v.is_empty()
            && v.len() <= 64
            && v.chars().all(|c| {
                c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')
            })
    };
    if !slug(&a.feature) || !slug(&a.action) {
        return Err(invalid(format!(
            "feature/action inválidos: {:?}/{:?}",
            a.feature, a.action
        )));
    }
    if a.command.trim().is_empty() || a.command.len() > IDE_MAX_COMMAND {
        return Err(invalid(
            "o comando auditado tem de ter entre 1 e 8 KiB".into(),
        ));
    }
    let outcome = if !a.approved {
        "denied".to_string()
    } else {
        match a.outcome.as_deref() {
            Some(o) if IDE_OUTCOMES.contains(&o) => o.to_string(),
            None => "sent".to_string(),
            Some(o) => return Err(invalid(format!("resultado desconhecido: {o:?}"))),
        }
    };
    let clip = |s: &str| s.chars().take(2000).collect::<String>();
    Ok(AuditEntry {
        at: now,
        session: "ide".into(),
        event: "approval".into(),
        origin: "ide".into(),
        actor: actor.to_string(),
        mode: "manual".into(),
        tool: Some(a.feature.clone()),
        call: Some(a.action.clone()),
        path: a.scope.as_deref().map(|s| redactor.mask(&clip(s))),
        command: Some(redactor.mask(&a.command)),
        verdict: Some("ask".into()),
        outcome: Some(outcome),
        decided_by: Some(format!("human:{actor}")),
        decided_at: Some(a.decided_at.unwrap_or(now)),
        reason: a
            .reason
            .as_deref()
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .map(|r| redactor.mask(&clip(r))),
        ..AuditEntry::default()
    })
}

/// Records an IDE operation in the project's audit log (r23 F1: every operation that changes
/// something outside the editor goes there — who, when, command, approval, result). The same
/// table and export as the Co-Dev's (`project_audit`), with origin `ide`.
#[tauri::command]
pub fn audit_record(app: AppHandle, root: String, entry: IdeAudit) -> Result<(), ProjectError> {
    let root = root_of(&root)?;
    let redactor = tutor_agent::redact::Redactor::for_root(Path::new(&root));
    let e = ide_audit_entry(&entry, &actor(&root), now_ms(), &redactor)?;
    open(&app)?.record_audit(&root, &e)
}

/// A test run as the Testing pane reports it (r23 F3, UI-SCM-09); the commit is decided here.
#[derive(serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewTestRun {
    pub runner: String,
    pub command: String,
    pub passed: i64,
    pub failed: i64,
    #[serde(default)]
    pub ignored: i64,
}

/// Records a test run on the folder's current commit (HEAD), and whether the working tree had
/// uncommitted changes. Without a commit (not a repository, no commit yet) nothing is recorded.
#[tauri::command]
pub fn test_results_record(
    app: AppHandle,
    root: String,
    run: NewTestRun,
) -> Result<bool, ProjectError> {
    let root = root_of(&root)?;
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(Path::new(&root))
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    };
    let Some(sha) = git(&["rev-parse", "--verify", "HEAD"]).filter(|s| !s.is_empty()) else {
        return Ok(false);
    };
    let dirty = git(&["status", "--porcelain", "--untracked-files=no"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let clip = |s: &str| s.chars().take(500).collect::<String>();
    let r = TestResult {
        sha,
        dirty,
        at: now_ms(),
        runner: clip(&run.runner),
        command: clip(&run.command),
        passed: run.passed.max(0),
        failed: run.failed.max(0),
        ignored: run.ignored.max(0),
        ok: run.failed == 0,
    };
    open(&app)?.record_test_result(&root, &r)?;
    Ok(true)
}

/// The test runs on these commits (hashes or 7+ prefixes), newest first.
#[tauri::command]
pub fn test_results_for(
    app: AppHandle,
    root: String,
    shas: Vec<String>,
) -> Result<Vec<TestResult>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.test_results_for(&root, &shas)
}

/// O prompt exacto com que a issue vai ao Co-Dev (RF-B03/B04): o template do projecto
/// (`.dxtutor/prompts/issue.{pt,en}.md`) ou o embutido, com a story, os critérios, as regras do
/// arquitecto, o âmbito e o código com números de linha; a versão do template e uma estimativa
/// de tokens. É o que «Ver prompt» mostra e o que «Work on it with Co-Dev» envia.
#[tauri::command]
pub fn project_issue_prompt(
    app: AppHandle,
    root: String,
    key: String,
    lang: Option<String>,
) -> Result<tutor_agent::issue_prompt::Rendered, ProjectError> {
    let root = root_of(&root)?;
    let st = open(&app)?;
    issue_prompt_from(&st, &root, &key, lang.as_deref())
}

/// The prompt of `key` from the store (separate from the command for the tests).
pub fn issue_prompt_from(
    st: &ProjectStore,
    root: &str,
    key: &str,
    lang: Option<&str>,
) -> Result<tutor_agent::issue_prompt::Rendered, ProjectError> {
    let p = st.load(root, now_ms())?;
    let i = p
        .issues
        .iter()
        .find(|i| i.key == key)
        .ok_or_else(|| ProjectError {
            code: "not_found".into(),
            message: format!("a issue {key} não existe"),
            overridable: false,
        })?;
    let detail = st.detail(root, key)?;
    // RF-B07: the error of the last failed test run goes with the next attempt
    let previous_failure = if i.attempts > 0 {
        detail
            .activity
            .iter()
            .find(|a| a.kind == "tests" && a.note.starts_with("os testes falharam"))
            .map(|a| {
                a.note
                    .trim_start_matches("os testes falharam: ")
                    .to_string()
            })
    } else {
        None
    };
    let data = tutor_agent::issue_prompt::IssueData {
        key: i.key.clone(),
        title: i.title.clone(),
        kind: i.kind.clone(),
        story_as: i.story_as.clone(),
        story_want: i.story_want.clone(),
        story_so: i.story_so.clone(),
        description: i.description.clone(),
        criteria: i.acceptance.iter().map(|c| c.text.clone()).collect(),
        scope: i.scope.clone(),
        previous_failure,
        links: issue_links(&p, i, &detail),
        method: Some(methodology(&p, i, now_ms())),
    };
    Ok(tutor_agent::issue_prompt::render_with(
        Path::new(root),
        &data,
        lang,
        &syntax_outline,
    ))
}

/// How the board works, for the prompt (Board B): the method, the running sprint the issue is in
/// (goal and days left), the DoD, the WIP of the columns the work goes through (In progress and
/// Review, when limited), the pair, the class of service and, for XP, test-first.
fn methodology(
    p: &tutor_board::project::Project,
    i: &tutor_board::project::Issue,
    now: i64,
) -> tutor_agent::issue_prompt::Methodology {
    use tutor_agent::issue_prompt::{Methodology, SprintRef, WipRef};
    use tutor_board::project::methods;
    const DAY: i64 = 86_400_000;
    let sprint = i
        .sprint
        .as_ref()
        .filter(|_| methods::uses_capacity(&p.method))
        .and_then(|id| {
            p.sprints
                .iter()
                .find(|s| &s.id == id && s.state == "active")
        })
        .map(|s| SprintRef {
            name: s.name.clone(),
            goal: s.goal.clone(),
            days_left: ((s.end - now).max(0) + DAY - 1) / DAY,
        });
    let wip = ["progress", "review"]
        .iter()
        .filter_map(|st| {
            p.wip.get(*st).map(|limit| WipRef {
                state: st.to_string(),
                count: p.issues.iter().filter(|x| x.state == *st).count() as u32,
                limit: *limit,
            })
        })
        .collect();
    Methodology {
        label: methods::label(&p.method).to_string(),
        sprint,
        dod: p.dod.clone(),
        wip,
        pair: i.pair.clone(),
        cos: i.cos.clone(),
        test_first: methods::test_first(&p.method),
    }
}

/// Where the issue lives in the project, for the prompt (backlog phase 1, Q3): its branch, epic,
/// dependencies (title and state), the commits linked to it (newest first) and the files of its
/// change sets (most recent first, each once). The prompt caps each list.
fn issue_links(
    p: &tutor_board::project::Project,
    i: &tutor_board::project::Issue,
    detail: &tutor_board::project::IssueDetail,
) -> tutor_agent::issue_prompt::IssueLinks {
    use tutor_agent::issue_prompt::{CommitRef, DepRef, IssueLinks};
    let deps = i
        .deps
        .iter()
        .map(|k| {
            let d = p.issues.iter().find(|x| &x.key == k);
            DepRef {
                key: k.clone(),
                title: d.map(|d| d.title.clone()).unwrap_or_default(),
                state: d.map(|d| d.state.clone()).unwrap_or_default(),
            }
        })
        .collect();
    let commits = i
        .links
        .iter()
        .filter(|l| l.kind == "commit")
        .map(|l| CommitRef {
            sha: l.reference.clone(),
            subject: l.title.clone(),
        })
        .collect();
    let mut files: Vec<String> = Vec::new();
    for c in &detail.change_sets {
        if !files.contains(&c.path) {
            files.push(c.path.clone());
        }
    }
    IssueLinks {
        branch: i.branch.clone(),
        epic: i.epic.clone(),
        component: None,
        deps,
        commits,
        files,
    }
}

/// The symbols of a file for the prompt's code context (RF-E03): the syntax map — quick and the
/// same on every machine, with no language server to wait for. Empty for a file it does not know.
fn syntax_outline(path: &str, code: &str) -> Vec<tutor_agent::issue_prompt::Symbol> {
    let Some(lang) = crate::codeintel::outline_lang(path) else {
        return Vec::new();
    };
    tutor_eval::codemap::outline(code, lang)
        .into_iter()
        .map(|s| tutor_agent::issue_prompt::Symbol {
            kind: serde_json::to_value(s.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            name: s.name,
            start: s.start_line as usize,
            end: s.end_line as usize,
        })
        .collect()
}

// ── O plano paralelo da sprint (Multi Co-Dev, fase 1) ─────────────────────────────────────────

/// Os ficheiros da pasta que o plano lê no máximo (o resto não entra nas sobreposições).
const PLAN_MAX_FILES: usize = 50_000;

/// O plano paralelo da sprint (Multi Co-Dev, fase 1): como as issues Ready da sprint se repartem por
/// N Co-Devs a trabalhar ao mesmo tempo, sem dois nos mesmos ficheiros. SÓ LEITURA: lê a pasta (o
/// `.gitignore` respeitado), os ficheiros dos change sets, dos commits ligados e do ramo de cada
/// issue, e prevê os conflitos dos ramos com o HEAD (`merge-tree`, nada muda). `sprint`: sem ela,
/// a activa ou a próxima planeada; `codevs`: sem ele, o da sprint (ou 1).
#[tauri::command]
pub async fn project_sprint_plan(
    app: AppHandle,
    root: String,
    sprint: Option<String>,
    codevs: Option<u32>,
) -> Result<tutor_board::project::plan::SprintPlan, ProjectError> {
    let root = root_of(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let st = open(&app)?;
        sprint_plan_from(&st, &root, sprint.as_deref(), codevs, now_ms())
    })
    .await
    .map_err(|e| db_err(format!("o plano da sprint falhou: {e}")))?
}

/// O plano de `sprint` a partir do store e da pasta (separado do comando para os testes).
pub fn sprint_plan_from(
    st: &ProjectStore,
    root: &str,
    sprint: Option<&str>,
    codevs: Option<u32>,
    now: i64,
) -> Result<tutor_board::project::plan::SprintPlan, ProjectError> {
    use tutor_board::project::plan::{plan_sprint, MAX_CODEVS};
    if codevs.is_some_and(|n| n == 0 || n > MAX_CODEVS) {
        return Err(ProjectError {
            code: "invalid".into(),
            message: format!("uma sprint tem de 1 a {MAX_CODEVS} Co-Devs"),
            overridable: false,
        });
    }
    let mut src = st.plan_source(root, sprint, now)?;
    let dir = Path::new(root);
    let files = tutor_agent::issue_prompt::project_files(dir, PLAN_MAX_FILES);
    known_from_git(dir, &mut src.issues, &src.commits, &src.branches);
    let n = codevs.or(src.sprint.codevs).unwrap_or(1);
    let mut plan = plan_sprint(&src.issues, &src.states, n, &files);
    plan.sprint = Some(src.sprint.id.clone());
    Ok(plan)
}

/// Junta aos ficheiros conhecidos de cada issue (não Done) os dos commits ligados e do ramo, e os
/// conflitos previstos do ramo com o HEAD (`merge-tree`, nada muda).
fn known_from_git(
    dir: &Path,
    issues: &mut [tutor_board::project::plan::PlanIssue],
    commits: &std::collections::BTreeMap<String, Vec<String>>,
    branches: &std::collections::BTreeMap<String, String>,
) {
    let names: Vec<String> = branches.values().cloned().collect();
    let predicted = if names.is_empty() {
        vec![]
    } else {
        tutor_eval::gitwork::predict_conflicts(dir, &names).unwrap_or_default()
    };
    for i in issues {
        if i.state == "done" {
            continue;
        }
        let mut known: std::collections::BTreeSet<String> = i.known_files.drain(..).collect();
        if let Some(shas) = commits.get(&i.key) {
            known.extend(tutor_eval::gitwork::commit_files(dir, shas).unwrap_or_default());
        }
        if let Some(b) = branches.get(&i.key) {
            known.extend(tutor_eval::gitwork::branch_files(dir, b).unwrap_or_default());
            if let Some(p) = predicted.iter().find(|p| &p.branch == b) {
                i.branch_conflicts = p.files.clone();
            }
        }
        i.known_files = known.into_iter().collect();
    }
}

// ── A verificação de âmbito antes de outro Co-Dev (Multi Co-Dev, fase 2) ─────────────────────

/// O que a verificação de âmbito devolve: as sobreposições de `key` com cada issue em curso e
/// quantos ficheiros da pasta entraram na conta.
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScopeCheck {
    pub overlaps: Vec<tutor_board::project::plan::Overlap>,
    pub files: u32,
}

/// Pode outra sessão Co-Dev começar `key` enquanto as de `running` correm na MESMA árvore de
/// trabalho (fase 2; as worktrees são a fase 3)? SÓ LEITURA: a regra das sobreposições do plano
/// paralelo (`plan::overlaps_with`) — um ficheiro que as duas podem mudar, pelo âmbito de cada uma
/// ou por ser conhecido de cada uma (change sets, commits ligados, o ramo). Vazio: pode.
#[tauri::command]
pub async fn project_scope_overlap(
    app: AppHandle,
    root: String,
    key: String,
    running: Vec<String>,
) -> Result<ScopeCheck, ProjectError> {
    let root = root_of(&root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let st = open(&app)?;
        scope_overlap_from(&st, &root, &key, &running, now_ms())
    })
    .await
    .map_err(|e| db_err(format!("a verificação de âmbito falhou: {e}")))?
}

/// A verificação de `key` contra `running` a partir do store e da pasta (separada para os testes).
pub fn scope_overlap_from(
    st: &ProjectStore,
    root: &str,
    key: &str,
    running: &[String],
    now: i64,
) -> Result<ScopeCheck, ProjectError> {
    let others: Vec<String> = running
        .iter()
        .filter(|k| k.as_str() != key)
        .cloned()
        .collect();
    if others.is_empty() {
        return Ok(ScopeCheck {
            overlaps: vec![],
            files: 0,
        });
    }
    let mut keys = vec![key.to_string()];
    keys.extend(others.iter().cloned());
    let mut src = st.scope_source(root, &keys, now)?;
    let dir = Path::new(root);
    let files = tutor_agent::issue_prompt::project_files(dir, PLAN_MAX_FILES);
    known_from_git(dir, &mut src.issues, &src.commits, &src.branches);
    let Some(me) = src.issues.iter().find(|i| i.key == key).cloned() else {
        return Err(ProjectError {
            code: "not_found".into(),
            message: format!("a issue {key} não existe"),
            overridable: false,
        });
    };
    let rest: Vec<_> = src.issues.into_iter().filter(|i| i.key != key).collect();
    Ok(ScopeCheck {
        overlaps: tutor_board::project::plan::overlaps_with(&me, &rest, &files),
        files: files.len() as u32,
    })
}

// ── O quadro Tasks (ADR-0006, R3b) ─────────────────────────────────────────────────────────
// O quadro da actividade Tasks continua a gravar o backlog inteiro (`tutor_board::Backlog`) por
// pasta. Vive num ficheiro próprio: o `board.sqlite3` é do Project, cuja migração 1 renomeia as
// tabelas do Board antigo para `legacy_*` (e o `sprints` do Project tem outro esquema). A Q3
// (docs/v2/QUESTIONS.md) decidiu juntá-los no Project; até à fase 5 os dois quadros coexistem.

/// Caminho do SQLite do quadro Tasks, criando o directório se preciso.
fn tasks_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(db_path(app)?.with_file_name("tasks.sqlite3"))
}

/// Chave de workspace: a raiz aberta. Sem pasta não há backlog (backlog fase 1, Q3): cada issue
/// pertence a um projecto — nada de um backlog `"default"` solto.
fn tasks_key(root: Option<String>) -> Result<String, String> {
    match root {
        Some(r) if !r.trim().is_empty() => Ok(r),
        _ => Err("no project folder is open: the backlog belongs to a project".to_string()),
    }
}

/// Lê o backlog persistido de `root` (ou `null` se ainda não existe).
#[tauri::command]
pub fn board_load(app: AppHandle, root: Option<String>) -> Result<Option<Backlog>, String> {
    let key = tasks_key(root)?;
    let store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store.load_board(&key).map_err(|e| e.to_string())
}

/// Grava (substitui atomicamente) o backlog de `root`. Idempotente.
#[tauri::command]
pub fn board_save(app: AppHandle, root: Option<String>, backlog: Backlog) -> Result<(), String> {
    let key = tasks_key(root)?;
    let mut store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store
        .save_board(&key, &backlog, now_ms())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sprint_plan_reads_the_folder_the_commits_and_the_branches() {
        use std::process::Command;
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| {
            let o = Command::new("git")
                .arg("-C")
                .arg(d.path())
                .args(a)
                .output()
                .unwrap();
            assert!(
                o.status.success(),
                "git {a:?}: {}",
                String::from_utf8_lossy(&o.stderr)
            );
        };
        let w = |f: &str, t: &str| {
            let p = d.path().join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, t).unwrap();
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.name", "Ana"]);
        g(&["config", "user.email", "ana@example.com"]);
        g(&["config", "commit.gpgsign", "false"]);
        w(".gitignore", "target/\n");
        w("target/big.rs", "x");
        w("src/cart.rs", "cart\n");
        w("src/pay.rs", "pay\n");
        w("docs/a.md", "a\n");
        g(&["add", "."]);
        g(&["commit", "-q", "-m", "base"]);
        // the docs issue's branch also changes src/pay.rs
        g(&["checkout", "-q", "-b", "feature/docs"]);
        w("src/pay.rs", "pay on the branch\n");
        g(&["commit", "-q", "-am", "docs touches pay"]);
        g(&["checkout", "-q", "main"]);
        let root = d.path().to_string_lossy().to_string();
        let mut st = ProjectStore::in_memory().unwrap();
        let ap = |st: &mut ProjectStore, v: serde_json::Value| {
            st.apply(&root, "Ana", 1, serde_json::from_value(v).unwrap())
                .unwrap()
        };
        let p = ap(
            &mut st,
            serde_json::json!({"op": "create_sprint", "name": "S1", "start": 0, "end": 10}),
        );
        let sid = p.sprints[0].id.clone();
        ap(
            &mut st,
            serde_json::json!({"op": "set_sprint_codevs", "id": sid, "codevs": 2}),
        );
        let gwt = ["Given x When y Then z"];
        let mut keys = vec![];
        for (title, scope) in [
            ("Pay", "src/pay.rs"),
            ("Docs", "docs/**"),
            ("Cart", "src/cart.rs"),
        ] {
            let p = ap(
                &mut st,
                serde_json::json!({"op": "create_issue", "title": title, "kind": "task", "sprint": sid, "acceptance": gwt}),
            );
            let k = p.issues.last().unwrap().key.clone();
            ap(
                &mut st,
                serde_json::json!({"op": "update_issue", "key": k, "scope": [scope], "ready": true}),
            );
            keys.push(k);
        }
        ap(
            &mut st,
            serde_json::json!({"op": "update_issue", "key": keys[1], "branch": "feature/docs"}),
        );
        let plan = sprint_plan_from(&st, &root, None, None, 1).unwrap();
        assert_eq!(plan.sprint.as_deref(), Some(sid.as_str()));
        assert_eq!(plan.codevs, 2, "the sprint's own count");
        assert_eq!(plan.files, 4, "the ignored folder is not read: {plan:?}");
        // Pay and Docs meet in src/pay.rs (Docs' branch): never in the same wave
        assert_eq!(plan.overlaps.len(), 1, "{plan:?}");
        assert_eq!(plan.overlaps[0].paths, vec!["src/pay.rs"]);
        let wave = |k: &str| {
            plan.lanes
                .iter()
                .flat_map(|l| &l.issues)
                .find(|i| i.key == k)
                .map(|i| i.wave)
        };
        assert_eq!(
            (wave(&keys[0]), wave(&keys[1]), wave(&keys[2])),
            (Some(1), Some(2), Some(1))
        );
        // the count asked for wins; outside 1…8 it is refused
        assert_eq!(
            sprint_plan_from(&st, &root, Some(&sid), Some(3), 1)
                .unwrap()
                .codevs,
            3
        );
        assert_eq!(
            sprint_plan_from(&st, &root, None, Some(0), 1)
                .unwrap_err()
                .code,
            "invalid"
        );
        assert_eq!(
            sprint_plan_from(&st, &root, Some("nope"), None, 1)
                .unwrap_err()
                .code,
            "not_found"
        );
        // Multi Co-Dev, phase 2: another session starts only without an overlap with the running
        // ones — Docs' branch changes src/pay.rs, which Pay's session may change
        let c =
            scope_overlap_from(&st, &root, &keys[1], std::slice::from_ref(&keys[0]), 1).unwrap();
        assert_eq!(c.overlaps.len(), 1, "{c:?}");
        assert_eq!(c.overlaps[0].paths, vec!["src/pay.rs"]);
        assert_eq!(
            (c.overlaps[0].a.as_str(), c.overlaps[0].b.as_str()),
            (keys[1].as_str(), keys[0].as_str())
        );
        let c = scope_overlap_from(&st, &root, &keys[2], &[keys[0].clone(), keys[2].clone()], 1)
            .unwrap();
        assert!(c.overlaps.is_empty(), "Cart and Pay do not meet: {c:?}");
        assert!(scope_overlap_from(&st, &root, &keys[2], &[], 1)
            .unwrap()
            .overlaps
            .is_empty());
        assert_eq!(
            scope_overlap_from(&st, &root, "NOPE-1", std::slice::from_ref(&keys[0]), 1)
                .unwrap_err()
                .code,
            "not_found"
        );
    }

    fn ide(approved: bool) -> IdeAudit {
        IdeAudit {
            feature: "ops".into(),
            action: "kube.undo".into(),
            command: "kubectl --context kind-dev -n shop rollout undo deploy/web --to-revision=1"
                .into(),
            scope: Some("context kind-dev · namespace shop".into()),
            approved,
            reason: Some("  bad release ".into()),
            outcome: None,
            decided_at: Some(7),
        }
    }

    #[test]
    fn an_ide_operation_is_audited_with_origin_ide_and_the_actor_from_the_backend() {
        let r = tutor_agent::redact::Redactor::new();
        let e = ide_audit_entry(&ide(true), "ana", 100, &r).unwrap();
        assert_eq!(
            (e.origin.as_str(), e.event.as_str(), e.actor.as_str()),
            ("ide", "approval", "ana")
        );
        assert_eq!(e.tool.as_deref(), Some("ops"));
        assert_eq!(e.call.as_deref(), Some("kube.undo"));
        assert_eq!(e.path.as_deref(), Some("context kind-dev · namespace shop"));
        assert_eq!(e.outcome.as_deref(), Some("sent"));
        assert_eq!(e.decided_by.as_deref(), Some("human:ana"));
        assert_eq!((e.at, e.decided_at), (100, Some(7)));
        assert_eq!(e.reason.as_deref(), Some("bad release"));
        let refused = ide_audit_entry(
            &IdeAudit {
                outcome: Some("ok".into()),
                ..ide(false)
            },
            "ana",
            100,
            &r,
        )
        .unwrap();
        assert_eq!(refused.outcome.as_deref(), Some("denied"));
    }

    #[test]
    fn an_ide_audit_masks_secrets_and_refuses_bad_input() {
        let mut r = tutor_agent::redact::Redactor::new();
        r.add_values(["s3cr3t-value-123".to_string()]);
        let a = IdeAudit {
            command: "vault kv put secret/app PASSWORD=s3cr3t-value-123".into(),
            reason: Some("rotate s3cr3t-value-123".into()),
            ..ide(true)
        };
        let e = ide_audit_entry(&a, "ana", 1, &r).unwrap();
        assert!(
            !e.command.as_deref().unwrap().contains("s3cr3t-value-123"),
            "{:?}",
            e.command
        );
        assert!(!e.reason.as_deref().unwrap().contains("s3cr3t-value-123"));
        for bad in [
            IdeAudit {
                feature: "Ops!".into(),
                ..ide(true)
            },
            IdeAudit {
                command: "  ".into(),
                ..ide(true)
            },
            IdeAudit {
                command: "x".repeat(IDE_MAX_COMMAND + 1),
                ..ide(true)
            },
            IdeAudit {
                outcome: Some("maybe".into()),
                ..ide(true)
            },
        ] {
            assert_eq!(
                ide_audit_entry(&bad, "ana", 1, &r).unwrap_err().code,
                "invalid"
            );
        }
    }

    #[test]
    fn the_last_commit_time_bounds_the_change_sets_and_is_zero_without_one() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(head_commit_ms(d.path()), 0, "not a repository");
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .args(args)
                .current_dir(d.path())
                .env("GIT_COMMITTER_DATE", "1763000000 +0000")
                .env("GIT_AUTHOR_DATE", "1763000000 +0000")
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q"]);
        assert_eq!(head_commit_ms(d.path()), 0, "no commits yet");
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@x",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "x",
        ]);
        assert_eq!(head_commit_ms(d.path()), 1_763_000_000_000);
    }

    #[test]
    fn the_tasks_board_has_no_backlog_without_a_project_folder() {
        assert_eq!(tasks_key(Some("/w/app".into())).unwrap(), "/w/app");
        for none in [None, Some(String::new()), Some("   ".into())] {
            assert!(tasks_key(none).unwrap_err().contains("no project folder"));
        }
    }

    #[test]
    fn the_issue_prompt_knows_the_branch_epic_deps_commits_and_changed_files() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().to_string_lossy().to_string();
        let mut st = ProjectStore::in_memory().unwrap();
        let op = |v: serde_json::Value| -> tutor_board::project::Op {
            serde_json::from_value(v).unwrap()
        };
        let prefix = st.load(&root, 1).unwrap().key_prefix;
        let k = |n: u32| format!("{prefix}-{n}");
        st.apply(
            &root,
            "ana",
            2,
            op(serde_json::json!({"op": "create_issue", "title": "Order model"})),
        )
        .unwrap();
        st.apply(&root, "ana", 3, op(serde_json::json!({"op": "create_issue", "title": "Paginate the orders", "epic": "Orders"})))
            .unwrap();
        st.apply(&root, "ana", 4, op(serde_json::json!({"op": "update_issue", "key": k(2), "branch": "feature/paginate", "deps": [k(1)]})))
            .unwrap();
        st.apply(
            &root,
            "ana",
            5,
            op(serde_json::json!({"op": "link_commits", "commits": [
                {"hash": "aaaaaaa1111", "subject": format!("feat: page size ({})", k(2)), "at": 10},
                {"hash": "bbbbbbb2222", "subject": format!("fix: last page ({})", k(2)), "at": 20}
            ]})),
        )
        .unwrap();
        for (path, at) in [("src/api.rs", 30), ("tests/api.rs", 40), ("src/api.rs", 50)] {
            st.record_change_set(
                &root,
                &tutor_board::project::NewChangeSet {
                    session: "s".into(),
                    call: "c".into(),
                    hunk: format!("h{at}"),
                    path: path.into(),
                    start: 1,
                    end: 2,
                    added: 1,
                    removed: 0,
                    decided_by: "human".into(),
                    issue_key: Some(k(2)),
                },
                at,
            )
            .unwrap();
        }
        let r = issue_prompt_from(&st, &root, &k(2), Some("en")).unwrap();
        let expected = format!(
            "# Issue links\nBranch: feature/paginate\nEpic: Orders\nDepends on: {} Order model (todo)\n\
             Linked commits:\n- bbbbbbb fix: last page ({})\n- aaaaaaa feat: page size ({})\n\
             Files already changed for this issue: src/api.rs, tests/api.rs\n",
            k(1),
            k(2),
            k(2)
        );
        assert!(r.text.contains(&expected), "{}", r.text);
    }

    #[test]
    fn the_issue_prompt_tells_the_board_method_sprint_dod_wip_and_test_first() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().to_string_lossy().to_string();
        let mut st = ProjectStore::in_memory().unwrap();
        let op = |v: serde_json::Value| -> tutor_board::project::Op {
            serde_json::from_value(v).unwrap()
        };
        let now = now_ms();
        let day = 86_400_000;
        let prefix = st.load(&root, now).unwrap().key_prefix;
        let k = format!("{prefix}-1");
        for v in [
            serde_json::json!({"op": "settings", "method": "scrumxp", "lang": "en", "dor": [], "dod": ["Tests passing"], "wip": {"progress": 2, "review": 1}}),
            serde_json::json!({"op": "create_sprint", "name": "Sprint 2", "goal": "Payments", "start": now - day, "end": now + 3 * day + 3_600_000}),
            serde_json::json!({"op": "start_sprint", "id": "S1"}),
            serde_json::json!({"op": "create_issue", "title": "Pay by card", "sprint": "S1"}),
            serde_json::json!({"op": "update_issue", "key": k, "pair": "rui"}),
        ] {
            st.apply(&root, "ana", now, op(v)).unwrap();
        }
        let r = issue_prompt_from(&st, &root, &k, Some("en")).unwrap();
        let block = r
            .text
            .split("# Method\n")
            .nth(1)
            .unwrap()
            .split("\n\n# ")
            .next()
            .unwrap();
        assert_eq!(
            block,
            "Scrum + XP · Sprint 2 «Payments» · 4 days left\n\
             WIP: In progress 0/2 · Review 0/1\n\
             Pair: rui\n\
             DoD (answer each item in finish_issue):\n\
             1. Tests passing\n\
             TDD (mandatory): write the test first and run run_tests — it must fail; only then the least code to pass; small steps. Without that red run the issue does not reach Review."
        );
        // Kanban: no sprint and no TDD line
        st.apply(
            &root,
            "ana",
            now,
            op(serde_json::json!({"op": "settings", "method": "kanban", "wip": {}, "dod": []})),
        )
        .unwrap();
        let r = issue_prompt_from(&st, &root, &k, Some("en")).unwrap();
        assert!(
            r.text.contains("# Method\nKanban\nPair: rui\n\n# "),
            "{}",
            r.text
        );
    }

    #[test]
    fn the_issue_prompt_shows_the_mentioned_symbols_of_a_long_file_with_the_real_syntax_map() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        let mut code = String::new();
        for k in 0..40 {
            let name = if k == 25 {
                "parse_header".to_string()
            } else {
                format!("step{k}")
            };
            code.push_str(&format!("pub fn {name}(x: u32) -> u32 {{\n"));
            for n in 0..6 {
                code.push_str(&format!("    let y{n} = x + {n};\n"));
            }
            code.push_str("    x\n}\n\n");
        }
        std::fs::write(d.path().join("src/lexer.rs"), &code).unwrap();
        std::fs::write(
            d.path().join("src/util.py"),
            "def helper():\n    return 1\n",
        )
        .unwrap();
        // the syntax map knows Rust and Python, not a text file
        let rs = syntax_outline("src/lexer.rs", &code);
        assert_eq!(rs.len(), 40);
        let p = rs.iter().find(|s| s.name == "parse_header").unwrap();
        // header, 6 lines, `x`, `}` and a blank line: 10 lines each
        assert_eq!((p.start, p.end), (251, 259));
        assert_eq!(
            syntax_outline("src/util.py", "def helper():\n    return 1\n")[0].name,
            "helper"
        );
        assert!(syntax_outline("notes.txt", "fn x() {}").is_empty());
        let data = tutor_agent::issue_prompt::IssueData {
            key: "DX-9".into(),
            title: "Header".into(),
            description: "`parse_header` drops the last field.".into(),
            scope: vec!["src/lexer.rs".into()],
            ..Default::default()
        };
        let r =
            tutor_agent::issue_prompt::render_with(d.path(), &data, Some("en"), &syntax_outline);
        assert!(r.text.contains("src/lexer.rs: 251–259 ("), "{}", r.text);
        assert!(r
            .text
            .contains(" 251 │ pub fn parse_header(x: u32) -> u32 {"));
        assert!(
            !r.text.contains("   1 │ pub fn step0"),
            "not the whole file"
        );
    }
}

// ───── r23 F4b: accepted IaC risks and ignored drift (P03/P04) ─────

/// The keys of the accepted IaC risks still in force in this folder (what the pipeline does not
/// block on). An unreadable base accepts nothing.
pub fn accepted_keys(app: &AppHandle, root: &str) -> std::collections::HashSet<String> {
    open(app)
        .and_then(|s| s.accepted_risks(root.trim(), now_ms()))
        .map(|v| v.into_iter().map(|r| r.key).collect())
        .unwrap_or_default()
}

fn audit_iac(
    app: &AppHandle,
    root: &str,
    action: &str,
    label: &str,
    reason: Option<&str>,
) -> Result<(), ProjectError> {
    audit_backend(app, root, "iac", action, label, reason)
}

/// An operation the backend itself records in the audit log before it runs (r23 F4b/F4c: accepted
/// risks, a Vault value revealed, dynamic credentials issued): who and when from here, secrets
/// masked. An operation that cannot be recorded does not run.
pub fn audit_backend(
    app: &AppHandle,
    root: &str,
    feature: &str,
    action: &str,
    label: &str,
    reason: Option<&str>,
) -> Result<(), ProjectError> {
    let root = root_of(root)?;
    let root = root.as_str();
    let redactor = tutor_agent::redact::Redactor::for_root(Path::new(root));
    let e = ide_audit_entry(
        &IdeAudit {
            feature: feature.into(),
            action: action.into(),
            command: label.into(),
            scope: None,
            approved: true,
            reason: reason.map(String::from),
            outcome: Some("ok".into()),
            decided_at: None,
        },
        &actor(root),
        now_ms(),
        &redactor,
    )?;
    open(app)?.record_audit(root, &e)
}

/// Accepts an IaC finding (`kind: finding`) or ignores a drift (`kind: drift`) with a reason, for 30
/// days; who and when are decided here, and the acceptance goes to the audit log first — one that
/// cannot be audited is not kept.
#[tauri::command]
pub fn iac_risk_accept(
    app: AppHandle,
    root: String,
    key: String,
    kind: String,
    label: String,
    reason: String,
) -> Result<tutor_board::project::risks::AcceptedRisk, ProjectError> {
    let root = root_of(&root)?;
    if reason.trim().chars().count() < 3 {
        return Err(invalid("an accepted risk needs a reason".into()));
    }
    let action = if kind == "drift" {
        "drift.ignore"
    } else {
        "risk.accept"
    };
    audit_iac(
        &app,
        &root,
        action,
        &format!("{label} · 30 days"),
        Some(&reason),
    )?;
    open(&app)?.accept_risk(
        &root,
        &key,
        &kind,
        &label,
        &reason,
        &actor(&root),
        now_ms(),
        tutor_board::project::risks::MAX_DAYS,
    )
}

/// The accepted IaC risks still in force.
#[tauri::command]
pub fn iac_risks(
    app: AppHandle,
    root: String,
) -> Result<Vec<tutor_board::project::risks::AcceptedRisk>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.accepted_risks(&root, now_ms())
}

/// Ends an accepted risk now (audited): the pipeline blocks on it again.
#[tauri::command]
pub fn iac_risk_revoke(app: AppHandle, root: String, id: i64) -> Result<bool, ProjectError> {
    let root = root_of(&root)?;
    let gone = open(&app)?.revoke_risk(&root, id, now_ms())?;
    if let Some(r) = &gone {
        audit_iac(&app, &root, "risk.revoke", &r.label, None)?;
    }
    Ok(gone.is_some())
}

// ───── r23 F4c2: deploy records (D04) ─────

/// Keeps a rollout of the guided deploy; who deployed is decided here.
pub fn record_deploy(
    app: &AppHandle,
    root: &str,
    mut r: tutor_board::project::deploys::DeployRecord,
) -> Result<i64, ProjectError> {
    let root = root_of(root)?;
    r.actor = actor(&root);
    r.at = now_ms();
    open(app)?.record_deploy(&root, &r)
}

/// The deploys of these commits (hashes or 7+ prefixes), or all of them, newest first.
#[tauri::command]
pub fn deploy_records(
    app: AppHandle,
    root: String,
    shas: Option<Vec<String>>,
) -> Result<Vec<tutor_board::project::deploys::DeployRecord>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.deploys(&root, shas.as_deref())
}

// ───── r23 F5a: runbook runs and the evidence export (RF-BK-R02, A03) ─────

/// Keeps a runbook step that ran (or was decided); who and when are decided here.
pub fn record_runbook_step(
    app: &AppHandle,
    root: &str,
    mut r: tutor_board::project::runbooks::RunbookStepRun,
) -> Result<tutor_board::project::runbooks::RunbookStepRun, ProjectError> {
    let root = root_of(root)?;
    r.actor = actor(&root);
    r.at = now_ms();
    let id = open(app)?.record_runbook_step(&root, &r)?;
    Ok(tutor_board::project::runbooks::RunbookStepRun { id, ..r })
}

/// A person's judgement of a step's result (a prose expectation), with a note.
#[tauri::command]
pub fn runbook_judge(
    app: AppHandle,
    root: String,
    id: i64,
    matched: bool,
    note: String,
) -> Result<bool, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.judge_runbook_step(&root, id, matched, note.trim())
}

/// The runbook steps run in the last 90 days (of one runbook, or all), oldest first.
#[tauri::command]
pub fn runbook_runs(
    app: AppHandle,
    root: String,
    path: Option<String>,
) -> Result<Vec<tutor_board::project::runbooks::RunbookStepRun>, ProjectError> {
    let root = root_of(&root)?;
    let now = now_ms();
    open(&app)?.runbook_runs(&root, path.as_deref(), now - 90 * 86_400_000, now + 1)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceFile {
    /// relative to the project (`docs/audit/evidence-YYYY-MM.md`)
    pub path: String,
    pub content: String,
}

/// Writes the evidence of a period (`from`..`to`, ms; default: this month so far) to
/// `docs/audit/evidence-YYYY-MM.md` INSIDE the project, grouped by ISO/IEC 27001:2022 control from the
/// real audit rows, deploy records and runbook runs; the export itself goes to the audit log.
#[tauri::command]
pub fn audit_export_evidence(
    app: AppHandle,
    root: String,
    from: Option<i64>,
    to: Option<i64>,
) -> Result<EvidenceFile, ProjectError> {
    let root = root_of(&root)?;
    let now = now_ms();
    let to = to.unwrap_or(now + 1);
    let from = from.unwrap_or_else(|| {
        // the first day of `to`'s month (UTC)
        let d = tutor_board::project::evidence::day(to - 1);
        let (y, m) = (
            d[..4].parse::<i64>().unwrap_or(1970),
            d[5..7].parse::<i64>().unwrap_or(1),
        );
        let days_from_civil = |y: i64, m: i64| {
            let y = if m <= 2 { y - 1 } else { y };
            let era = y.div_euclid(400);
            let yoe = y - era * 400;
            let mp = (m + 9) % 12;
            let doy = (153 * mp + 2) / 5;
            let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
            era * 146_097 + doe - 719_468
        };
        days_from_civil(y, m) * 86_400_000
    });
    if from >= to {
        return Err(invalid("the period is empty".into()));
    }
    let store = open(&app)?;
    let audit = store.audit(&root, None)?;
    let deploys = store.deploys(&root, None)?;
    let runs = store.runbook_runs(&root, None, from, to)?;
    drop(store);
    let name = Path::new(&root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".into());
    let content =
        tutor_board::project::evidence::markdown(&name, from, to, now, &audit, &deploys, &runs);
    let rel = format!(
        "docs/audit/evidence-{}.md",
        &tutor_board::project::evidence::day(from)[..7]
    );
    crate::workspace::write(Path::new(&root), &rel, &content).map_err(invalid)?;
    audit_backend(
        &app,
        &root,
        "audit",
        "export-evidence",
        &format!(
            "{rel} ({} to {})",
            tutor_board::project::evidence::day(from),
            tutor_board::project::evidence::day(to - 1)
        ),
        None,
    )?;
    Ok(EvidenceFile { path: rel, content })
}

// ───── r23 F5b: the queue, the PR review and incidents read and write the project base through this ─────

/// Runs `f` on the project base of `root` (a trimmed, non-empty root).
pub fn with_store<T>(
    app: &AppHandle,
    root: &str,
    f: impl FnOnce(&mut ProjectStore, &str) -> Result<T, ProjectError>,
) -> Result<T, ProjectError> {
    let root = root_of(root)?;
    let mut s = open(app)?;
    f(&mut s, &root)
}

/// Who acts in `root` and now (for the records the backend writes).
pub fn who_and_when(root: &str) -> (String, i64) {
    (actor(root.trim()), now_ms())
}
