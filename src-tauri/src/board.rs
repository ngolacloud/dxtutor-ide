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
    ProjectStore,
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
    let op: Op = serde_json::from_value(op).map_err(|e| ProjectError {
        code: "invalid".into(),
        message: format!("operação inválida: {e}"),
        overridable: false,
    })?;
    open(&app)?.apply(&root, &actor(&root), now_ms(), op)
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
    // RF-B07: the error of the last failed test run goes with the next attempt
    let previous_failure = if i.attempts > 0 {
        st.detail(root, key)?
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
    };
    Ok(tutor_agent::issue_prompt::render_with(
        Path::new(root),
        &data,
        lang,
        &syntax_outline,
    ))
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

// ── O quadro Tasks (ADR-0006, R3b) ─────────────────────────────────────────────────────────
// O quadro da actividade Tasks continua a gravar o backlog inteiro (`tutor_board::Backlog`) por
// pasta. Vive num ficheiro próprio: o `board.sqlite3` é do Project, cuja migração 1 renomeia as
// tabelas do Board antigo para `legacy_*` (e o `sprints` do Project tem outro esquema). Os dois
// quadros coexistem até a Q3 (docs/v2/QUESTIONS.md) decidir se o Tasks passa a ser o Project.

/// Caminho do SQLite do quadro Tasks, criando o directório se preciso.
fn tasks_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(db_path(app)?.with_file_name("tasks.sqlite3"))
}

/// Chave de workspace: a raiz aberta, ou `"default"` sem pasta.
fn tasks_key(root: Option<String>) -> String {
    match root {
        Some(r) if !r.trim().is_empty() => r,
        _ => "default".to_string(),
    }
}

/// Lê o backlog persistido de `root` (ou `null` se ainda não existe).
#[tauri::command]
pub fn board_load(app: AppHandle, root: Option<String>) -> Result<Option<Backlog>, String> {
    let store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store
        .load_board(&tasks_key(root))
        .map_err(|e| e.to_string())
}

/// Grava (substitui atomicamente) o backlog de `root`. Idempotente.
#[tauri::command]
pub fn board_save(app: AppHandle, root: Option<String>, backlog: Backlog) -> Result<(), String> {
    let mut store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store
        .save_board(&tasks_key(root), &backlog, now_ms())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

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
