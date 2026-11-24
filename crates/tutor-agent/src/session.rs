//! Sessões em disco (F5): JSONL append-only, uma por conversa.
//!
//! Linha 1 — o cabeçalho com **tudo o que define o prefixo do pedido**: modelo, effort,
//! system prompt (já montado), opções das ferramentas (os comandos de testes/lint entram
//! nas descrições) e compactação. Linhas seguintes — cada mensagem do histórico, com os
//! blocos tal como vieram do servidor.
//!
//! Retomar uma sessão reconstrói o pedido **byte a byte** a partir deste ficheiro, sem
//! voltar a ler o `AGENTS.md` nem a detectar comandos: o *preserved thinking* verifica que
//! o system prompt, as ferramentas e as mensagens anteriores de cada bloco `thinking` são
//! as mesmas que o produziram, e contas recentes recebem 400 quando não são.
//!
//! Ficam fora do repositório (`~/.config/dxtutor/sessions/<projecto>/`) e só legíveis
//! pelo dono: contêm código e conversa.

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::types::{Message, Role, Transcript};

/// O que define o prefixo do pedido — gravado no início e reutilizado ao retomar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionMeta {
    pub id: String,
    pub root: String,
    pub model: String,
    pub effort: String,
    /// `(texto, breakpoint de cache)` de cada bloco do system prompt.
    pub system: Vec<(String, bool)>,
    pub test_cmd: Option<String>,
    pub lint_cmd: Option<String>,
    pub compaction: bool,
    /// Segundos desde a época.
    pub created: u64,
    /// Versão do conjunto de ferramentas com que a sessão começou
    /// ([`crate::tools::TOOLSET_VERSION`]); ficheiros anteriores à F6 não a têm → 1.
    #[serde(default = "toolset_v1")]
    pub toolset: u32,
    /// As definições das ferramentas MCP anunciadas no início (a retoma reenvia estas, mesmo
    /// que o servidor tenha mudado entretanto).
    #[serde(default)]
    pub mcp_tools: Vec<crate::mcp::McpToolDef>,
    /// O provedor da sessão (`claude`/`codex`/`gemini`/`ollama`, F8); ficheiros anteriores
    /// não o têm → `claude`. Uma retoma usa sempre o mesmo provedor.
    #[serde(default = "provider_claude")]
    pub provider: String,
}

fn toolset_v1() -> u32 {
    1
}

fn provider_claude() -> String {
    "claude".into()
}

/// Uma linha do ficheiro.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Line {
    Meta { meta: SessionMeta },
    Message { message: Message },
}

/// Resumo para a lista de sessões.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    /// O início da primeira mensagem do utilizador.
    pub title: String,
    pub messages: usize,
    pub model: String,
    pub created: u64,
    /// Última modificação do ficheiro (segundos desde a época).
    pub updated: u64,
}

/// Uma vista simplificada do histórico, para a UI redesenhar a conversa retomada.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HistoryItem {
    pub role: String,
    pub text: String,
    /// Nomes das ferramentas chamadas nesta mensagem do assistente.
    pub tools: Vec<String>,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Pasta das sessões de um projecto: `<base>/<hash do caminho>` (o caminho não entra no
/// nome do ficheiro).
pub fn project_dir(base: &Path, root: &str) -> PathBuf {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    root.trim_end_matches('/').hash(&mut h);
    let name = Path::new(root)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    base.join(format!("{safe}-{:016x}", h.finish()))
}

/// `~/.config/dxtutor/sessions`.
pub fn default_base() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".config/dxtutor/sessions"))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// O ficheiro de uma sessão (recusa ids com caminhos: o id vem da UI).
pub fn session_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(format!("id de sessão inválido: {id}"));
    }
    Ok(dir.join(format!("{id}.jsonl")))
}

/// O registo em disco de uma sessão: acrescenta as mensagens novas do histórico.
pub struct SessionLog {
    path: PathBuf,
    persisted: usize,
    meta: SessionMeta,
}

fn open_append(path: &Path, create: bool) -> std::io::Result<std::fs::File> {
    let mut o = OpenOptions::new();
    o.append(true);
    if create {
        o.create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            o.mode(0o600);
        }
    }
    o.open(path)
}

fn write_line(f: &mut std::fs::File, line: &Line) -> std::io::Result<()> {
    let mut s = serde_json::to_string(line).map_err(std::io::Error::other)?;
    s.push('\n');
    f.write_all(s.as_bytes())
}

impl SessionLog {
    /// Cria o ficheiro com o cabeçalho.
    pub fn create(dir: &Path, meta: &SessionMeta) -> Result<Self, String> {
        let path = session_path(dir, &meta.id)?;
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let mut f = open_append(&path, true).map_err(|e| format!("{}: {e}", path.display()))?;
        write_line(&mut f, &Line::Meta { meta: meta.clone() }).map_err(|e| e.to_string())?;
        Ok(SessionLog {
            path,
            persisted: 0,
            meta: meta.clone(),
        })
    }

    /// Abre uma sessão existente: devolve o cabeçalho, o histórico e o registo pronto a
    /// continuar a acrescentar.
    pub fn open(dir: &Path, id: &str) -> Result<(SessionMeta, Transcript, Self), String> {
        let path = session_path(dir, id)?;
        let f = std::fs::File::open(&path).map_err(|e| format!("sessão {id}: {e}"))?;
        let mut meta = None;
        let mut t = Transcript::new();
        for (n, line) in BufReader::new(f).lines().enumerate() {
            let line = line.map_err(|e| e.to_string())?;
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Line>(&line) {
                Ok(Line::Meta { meta: m }) if n == 0 => meta = Some(m),
                Ok(Line::Message { message }) => t.push(message),
                Ok(Line::Meta { .. }) => {
                    return Err(format!(
                        "sessão {id}: cabeçalho fora do sítio (linha {})",
                        n + 1
                    ))
                }
                // uma última linha cortada (o processo morreu a meio da escrita) não estraga o resto
                Err(_) => break,
            }
        }
        let meta = meta.ok_or_else(|| format!("sessão {id}: sem cabeçalho"))?;
        let persisted = t.len();
        Ok((
            meta.clone(),
            t,
            SessionLog {
                path,
                persisted,
                meta,
            },
        ))
    }

    /// Acrescenta ao ficheiro as mensagens do histórico que ainda não estão lá.
    pub fn sync(&mut self, t: &Transcript) -> Result<(), String> {
        let new = &t.messages()[self.persisted.min(t.len())..];
        if new.is_empty() {
            return Ok(());
        }
        let mut f = open_append(&self.path, false).map_err(|e| e.to_string())?;
        for m in new {
            write_line(&mut f, &Line::Message { message: m.clone() }).map_err(|e| e.to_string())?;
        }
        self.persisted = t.len();
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Replaces the file with the header and `t` ("Rewind to here" cuts the conversation back
    /// to a checkpoint). Written to a temporary file and renamed, so a crash never leaves a
    /// half-written session.
    pub fn rewrite(&mut self, t: &Transcript) -> Result<(), String> {
        let tmp = self.path.with_extension("jsonl.tmp");
        let _ = std::fs::remove_file(&tmp);
        {
            let mut f = open_append(&tmp, true).map_err(|e| format!("{}: {e}", tmp.display()))?;
            write_line(
                &mut f,
                &Line::Meta {
                    meta: self.meta.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
            for m in t.messages() {
                write_line(&mut f, &Line::Message { message: m.clone() })
                    .map_err(|e| e.to_string())?;
            }
            f.sync_all().map_err(|e| e.to_string())?;
        }
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())?;
        self.persisted = t.len();
        Ok(())
    }
}

/// As sessões de um projecto, das mais recentes para as mais antigas.
pub fn list(dir: &Path) -> Vec<SessionSummary> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return vec![];
    };
    let mut out: Vec<SessionSummary> = rd
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|e| {
            let id = e.path().file_stem()?.to_string_lossy().to_string();
            let updated = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            let (meta, t, _) = SessionLog::open(dir, &id).ok()?;
            let title = t
                .messages()
                .iter()
                .find(|m| m.role == Role::User && !m.text().trim().is_empty())
                .map(|m| m.text().chars().take(80).collect::<String>())
                .unwrap_or_else(|| "(sem mensagens)".into());
            Some(SessionSummary {
                id,
                title,
                messages: t.len(),
                model: meta.model,
                created: meta.created,
                updated,
            })
        })
        .collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated).then(b.created.cmp(&a.created)));
    out
}

/// O histórico simplificado para a UI: mensagens do utilizador com texto (não os
/// tool_result) e as do assistente com o texto e as ferramentas chamadas.
pub fn history(t: &Transcript) -> Vec<HistoryItem> {
    t.messages()
        .iter()
        .filter_map(|m| match m.role {
            Role::User => {
                let text = m.text();
                (!text.trim().is_empty()).then(|| HistoryItem {
                    role: "user".into(),
                    text,
                    tools: vec![],
                })
            }
            Role::Assistant => Some(HistoryItem {
                role: "assistant".into(),
                text: m.text(),
                tools: m.tool_uses().into_iter().map(|u| u.name).collect(),
            }),
            Role::System => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(id: &str) -> SessionMeta {
        SessionMeta {
            id: id.into(),
            root: "/proj".into(),
            model: "claude-opus-5-5".into(),
            effort: "high".into(),
            system: vec![("núcleo".into(), false), ("instruções".into(), true)],
            test_cmd: Some("cargo test".into()),
            lint_cmd: None,
            compaction: true,
            created: 100,
            toolset: 2,
            provider: "claude".into(),
            mcp_tools: vec![],
        }
    }

    #[test]
    fn round_trip_is_byte_faithful_and_append_only() {
        let d = tempfile::tempdir().unwrap();
        let mut log = SessionLog::create(d.path(), &meta("s1")).unwrap();
        let mut t = Transcript::new();
        t.push(Message::user_text("corrige o lexer"));
        let thinking = json!({"type":"thinking","thinking":"hmm","signature":"EqQB=="});
        t.push(Message::assistant(vec![
            thinking.clone(),
            json!({"type":"tool_use","id":"t1","name":"read","input":{"path":"a.rs"}}),
        ]));
        log.sync(&t).unwrap();
        log.sync(&t).unwrap(); // idempotente
        t.push(Message::tool_results(&[crate::types::ToolResult {
            tool_use_id: "t1".into(),
            content: "x".into(),
            is_error: false,
        }]));
        t.push(Message::system("O modo passou a Auto."));
        log.sync(&t).unwrap();

        let (m, back, mut log2) = SessionLog::open(d.path(), "s1").unwrap();
        assert_eq!(m, meta("s1"));
        assert_eq!(
            back, t,
            "o histórico volta igual, incluindo a assinatura do thinking"
        );
        assert_eq!(back.messages()[1].content[0], thinking);
        // continua a acrescentar a partir de onde ficou
        let mut t2 = back.clone();
        t2.push(Message::user_text("e agora?"));
        log2.sync(&t2).unwrap();
        assert_eq!(SessionLog::open(d.path(), "s1").unwrap().1.len(), 5);
        let lines = std::fs::read_to_string(log2.path())
            .unwrap()
            .lines()
            .count();
        assert_eq!(lines, 6, "1 cabeçalho + 5 mensagens, sem duplicados");
    }

    #[cfg(unix)]
    #[test]
    fn files_are_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let log = SessionLog::create(d.path(), &meta("s2")).unwrap();
        assert_eq!(
            std::fs::metadata(log.path()).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(
            SessionLog::create(d.path(), &meta("s2")).is_err(),
            "não sobrescreve uma sessão"
        );
    }

    #[test]
    fn a_truncated_last_line_does_not_lose_the_session() {
        let d = tempfile::tempdir().unwrap();
        let mut log = SessionLog::create(d.path(), &meta("s3")).unwrap();
        let mut t = Transcript::new();
        t.push(Message::user_text("olá"));
        log.sync(&t).unwrap();
        let mut f = OpenOptions::new().append(true).open(log.path()).unwrap();
        f.write_all(b"{\"type\":\"message\",\"message\":{\"role\":\"assi")
            .unwrap();
        assert_eq!(SessionLog::open(d.path(), "s3").unwrap().1.len(), 1);
    }

    #[test]
    fn ids_cannot_escape_the_folder_and_list_is_newest_first() {
        let d = tempfile::tempdir().unwrap();
        assert!(session_path(d.path(), "../x").is_err());
        assert!(session_path(d.path(), "a/b").is_err());
        assert!(SessionLog::open(d.path(), "nada").is_err());
        for (id, text) in [("a", "primeira conversa"), ("b", "segunda")] {
            let mut log = SessionLog::create(d.path(), &meta(id)).unwrap();
            let mut t = Transcript::new();
            t.push(Message::user_text(text));
            log.sync(&t).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(1100));
        }
        let l = list(d.path());
        assert_eq!(
            l.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert_eq!(l[1].title, "primeira conversa");
        assert!(list(&d.path().join("nao-existe")).is_empty());
    }

    #[test]
    fn project_dirs_are_stable_and_distinct() {
        let b = Path::new("/base");
        assert_eq!(
            project_dir(b, "/home/x/proj"),
            project_dir(b, "/home/x/proj/")
        );
        assert_ne!(
            project_dir(b, "/home/x/proj"),
            project_dir(b, "/home/y/proj")
        );
        assert!(project_dir(b, "/home/x/my proj")
            .to_string_lossy()
            .contains("my_proj-"));
    }

    #[test]
    fn history_view_hides_tool_results_and_system_notes() {
        let mut t = Transcript::new();
        t.push(Message::user_text("lê a.rs"));
        t.push(Message::assistant(vec![
            json!({"type":"text","text":"Vou ler."}),
            json!({"type":"tool_use","id":"1","name":"read","input":{}}),
        ]));
        t.push(Message::tool_results(&[crate::types::ToolResult {
            tool_use_id: "1".into(),
            content: "…".into(),
            is_error: false,
        }]));
        t.push(Message::system("modo"));
        t.push(Message::assistant(vec![
            json!({"type":"text","text":"Feito."}),
        ]));
        let h = history(&t);
        assert_eq!(h.len(), 3);
        assert_eq!(h[1].tools, vec!["read"]);
        assert_eq!(h[2].text, "Feito.");
    }
}
