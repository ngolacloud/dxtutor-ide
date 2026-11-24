//! `read`, `edit` e `write`.

use std::sync::Arc;

use serde_json::{json, Value};

use super::{looks_binary, FileState};
use crate::sandbox;
use crate::tool::{Tool, ToolCtx, ToolOutput};

/// Linhas devolvidas por omissão e no máximo por `read`.
pub const READ_MAX_LINES: usize = 2000;
/// Bytes máximos devolvidos por `read`.
pub const READ_MAX_BYTES: usize = 256 * 1024;
/// Linhas mais longas são cortadas (minificados, dados).
const LINE_MAX_CHARS: usize = 2000;

pub struct Read {
    pub state: Arc<FileState>,
}

impl Tool for Read {
    fn name(&self) -> &str {
        "read"
    }
    fn description(&self) -> &str {
        "Lê um ficheiro de texto do projecto, com números de linha. `offset` (1 = primeira \
         linha) e `limit` (até 2000) lêem um excerto de ficheiros grandes. Lê sempre um \
         ficheiro antes de o editar."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "caminho relativo à raiz do projecto"},
                "offset": {"type": "integer", "minimum": 1},
                "limit": {"type": "integer", "minimum": 1, "maximum": READ_MAX_LINES}
            },
            "required": ["path"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let given = input["path"].as_str().unwrap_or_default();
        let p = match sandbox::resolve(&ctx.root, given) {
            Ok(p) => p,
            Err(e) => return ToolOutput::err(e),
        };
        if p.is_dir() {
            return ToolOutput::err(format!("{given} é uma pasta — usa glob para listar"));
        }
        let bytes = match std::fs::read(&p) {
            Ok(b) => b,
            Err(e) => return ToolOutput::err(format!("{given}: {e}")),
        };
        if looks_binary(&bytes) {
            return ToolOutput::err(format!(
                "{given} parece binário ({} bytes): não é lido",
                bytes.len()
            ));
        }
        self.state.record(&p, &bytes);
        let text = String::from_utf8_lossy(&bytes);
        let total = text.lines().count();
        let offset = input["offset"].as_u64().unwrap_or(1).max(1) as usize;
        let limit = input["limit"]
            .as_u64()
            .map(|l| l as usize)
            .unwrap_or(READ_MAX_LINES)
            .min(READ_MAX_LINES);
        if total == 0 {
            return ToolOutput::ok(format!("{given}: (ficheiro vazio)"));
        }
        if offset > total {
            return ToolOutput::err(format!(
                "{given} tem {total} linhas; offset {offset} está para lá do fim"
            ));
        }
        let mut out = String::new();
        let mut shown = 0;
        for (i, line) in text.lines().enumerate().skip(offset - 1).take(limit) {
            let line = if line.chars().count() > LINE_MAX_CHARS {
                format!(
                    "{}…[linha cortada]",
                    line.chars().take(LINE_MAX_CHARS).collect::<String>()
                )
            } else {
                line.to_string()
            };
            let row = format!("{:>6}\t{}\n", i + 1, line);
            if out.len() + row.len() > READ_MAX_BYTES {
                break;
            }
            out.push_str(&row);
            shown += 1;
        }
        let last = offset + shown - 1;
        if last < total {
            out.push_str(&format!(
                "…[mostradas as linhas {offset}–{last} de {total}; usa offset={} para continuar]\n",
                last + 1
            ));
        }
        ToolOutput::ok(out)
    }
}

/// Recusa mexer num ficheiro existente que o agente não leu, ou que mudou desde a leitura.
pub(crate) fn check_fresh(
    state: &FileState,
    p: &std::path::Path,
    given: &str,
) -> Result<Vec<u8>, String> {
    let cur = std::fs::read(p).map_err(|e| format!("{given}: {e}"))?;
    match state.seen(p) {
        None => Err(format!("{given}: lê o ficheiro com `read` antes de o alterar")),
        Some(fp) if fp != FileState::fingerprint(&cur) => Err(format!(
            "{given} mudou desde a última leitura (alguém o editou): lê-o outra vez antes de alterar"
        )),
        Some(_) => Ok(cur),
    }
}

/// The checks `edit` makes before changing anything (also used to plan live hunks, so both
/// paths refuse the same inputs with the same message). Returns the resolved path, the
/// current bytes, the text and how many times `old_string` occurs.
pub(crate) fn edit_check(
    state: &FileState,
    root: &std::path::Path,
    input: &Value,
) -> Result<(std::path::PathBuf, Vec<u8>, String, usize), String> {
    let given = input["path"].as_str().unwrap_or_default();
    let old = input["old_string"].as_str().unwrap_or_default();
    let new = input["new_string"].as_str().unwrap_or_default();
    let all = input["replace_all"].as_bool().unwrap_or(false);
    if old.is_empty() {
        return Err("old_string vazio: para criar um ficheiro usa `write`".into());
    }
    if old == new {
        return Err("old_string e new_string são iguais: nada a mudar".into());
    }
    let p = sandbox::resolve(root, given)?;
    let cur = check_fresh(state, &p, given)?;
    let text = String::from_utf8_lossy(&cur).to_string();
    let n = text.matches(old).count();
    if n == 0 {
        return Err(format!(
            "{given}: old_string não encontrado (confirma espaços e indentação)"
        ));
    }
    if n > 1 && !all {
        return Err(format!(
            "{given}: old_string aparece {n} vezes — acrescenta contexto para o tornar único, ou usa replace_all"
        ));
    }
    Ok((p, cur, text, n))
}

/// The checks `write` makes before writing: the resolved path and, for an existing file,
/// its current bytes (it must have been read and be unchanged since).
pub(crate) fn write_check(
    state: &FileState,
    root: &std::path::Path,
    input: &Value,
) -> Result<(std::path::PathBuf, Option<Vec<u8>>), String> {
    let given = input["path"].as_str().unwrap_or_default();
    let p = sandbox::resolve(root, given)?;
    if p.is_dir() {
        return Err(format!("{given} é uma pasta"));
    }
    if p.exists() {
        let cur = check_fresh(state, &p, given)?;
        return Ok((p, Some(cur)));
    }
    Ok((p, None))
}

pub struct Edit {
    pub state: Arc<FileState>,
}

impl Tool for Edit {
    fn name(&self) -> &str {
        "edit"
    }
    fn description(&self) -> &str {
        "Substitui texto exacto num ficheiro já lido: `old_string` tem de existir uma única vez \
         (inclui contexto suficiente para o tornar único) ou usa `replace_all`. Preserva a \
         indentação exacta. Falha se o ficheiro mudou desde o último `read`."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"}
            },
            "required": ["path", "old_string", "new_string"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false
    }
    fn eager_input(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let given = input["path"].as_str().unwrap_or_default();
        let old = input["old_string"].as_str().unwrap_or_default();
        let new = input["new_string"].as_str().unwrap_or_default();
        let all = input["replace_all"].as_bool().unwrap_or(false);
        let (p, _, text, n) = match edit_check(&self.state, &ctx.root, input) {
            Ok(t) => t,
            Err(e) => return ToolOutput::err(e),
        };
        // linha (1-based) onde começa a primeira substituição, no texto original
        let first = text
            .find(old)
            .map(|i| text[..i].matches('\n').count() + 1)
            .unwrap_or(1);
        let updated = if all {
            text.replace(old, new)
        } else {
            text.replacen(old, new, 1)
        };
        if let Err(e) = std::fs::write(&p, updated.as_bytes()) {
            return ToolOutput::err(format!("{given}: {e}"));
        }
        self.state.record(&p, updated.as_bytes());
        ToolOutput::ok(format!(
            "{given}: {} substituição(ões); a primeira a partir da linha {first}",
            if all { n } else { 1 }
        ))
    }
}

/// Toolset 8 (RF-E01/E02, docs/v2/RF-DELONIX-PLANO.md F2.1): the main way to change a file —
/// replace (or insert) a range of lines, anchored on their current text. With live hunks on, the
/// IDE turns the call into a hunk the human reviews; without (TUI/CLI) it writes directly.
pub struct EditLines {
    pub state: Arc<FileState>,
}

impl Tool for EditLines {
    fn name(&self) -> &str {
        "edit_lines"
    }
    fn description(&self) -> &str {
        "A forma principal de alterar um ficheiro: substitui as linhas start..end (1-based, como \
         o `read` as numera) por new_text; com start = end + 1 insere antes da linha start. \
         `anchor` é o texto actual dessas linhas (vazio ao inserir): se o ficheiro mudou, a \
         alteração é recusada e relês o ficheiro. Muda só as linhas necessárias; o fim de linha \
         (LF/CRLF) do ficheiro mantém-se. Exige ter lido o ficheiro antes."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start": {"type": "integer", "minimum": 1},
                "end": {"type": "integer", "minimum": 0, "description": "start - 1 para inserir"},
                "new_text": {"type": "string", "description": "as linhas novas (vazio = apagar o intervalo)"},
                "anchor": {"type": "string", "description": "o texto actual das linhas start..end"}
            },
            "required": ["path", "start", "end", "new_text", "anchor"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false
    }
    fn mutates_files(&self) -> bool {
        true
    }
    fn eager_input(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let given = input["path"].as_str().unwrap_or_default();
        let (abs, _, changes) = match crate::hunks::plan_edit_lines(&self.state, &ctx.root, input) {
            Ok(p) => p,
            Err(e) => return ToolOutput::err(e),
        };
        let text = match std::fs::read(&abs) {
            Ok(b) => String::from_utf8_lossy(&b).to_string(),
            Err(e) => return ToolOutput::err(format!("{given}: {e}")),
        };
        let refs: Vec<&crate::hunks::Change> = changes.iter().collect();
        let updated = match crate::hunks::splice(&text, &refs) {
            Ok(t) => t,
            Err(e) => return ToolOutput::err(format!("{given}: {e}")),
        };
        if let Err(e) = std::fs::write(&abs, updated.as_bytes()) {
            return ToolOutput::err(format!("{given}: {e}"));
        }
        self.state.record(&abs, updated.as_bytes());
        let c = &changes[0];
        let l = c.lines();
        ToolOutput::ok(format!(
            "{given}: linhas {}–{} (+{} −{})",
            c.range.start, c.range.end, l.added, l.removed
        ))
    }
}

pub struct Write {
    pub state: Arc<FileState>,
}

impl Tool for Write {
    fn name(&self) -> &str {
        "write"
    }
    fn description(&self) -> &str {
        "Cria um ficheiro com o conteúdo COMPLETO indicado (cria as pastas que faltem). Para \
         alterar um ficheiro existente prefere `edit`; sobrescrever exige tê-lo lido antes."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string", "description": "conteúdo completo do ficheiro"}
            },
            "required": ["path", "content"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false
    }
    fn eager_input(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let given = input["path"].as_str().unwrap_or_default();
        let content = input["content"].as_str().unwrap_or_default();
        let (p, cur) = match write_check(&self.state, &ctx.root, input) {
            Ok(t) => t,
            Err(e) => return ToolOutput::err(e),
        };
        let existed = cur.is_some();
        if let Some(dir) = p.parent() {
            if let Err(e) = std::fs::create_dir_all(dir) {
                return ToolOutput::err(format!("{given}: {e}"));
            }
            // a pasta acabada de criar também tem de ficar dentro da raiz
            if let Err(e) = sandbox::ensure_within(&ctx.root, dir) {
                return ToolOutput::err(e);
            }
        }
        if let Err(e) = std::fs::write(&p, content.as_bytes()) {
            return ToolOutput::err(format!("{given}: {e}"));
        }
        self.state.record(&p, content.as_bytes());
        ToolOutput::ok(format!(
            "{given}: {} ({} linhas)",
            if existed { "sobrescrito" } else { "criado" },
            content.lines().count()
        ))
    }
}
