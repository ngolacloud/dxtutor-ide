//! Caso de uso «inteligência de código» — **independente de Tauri** (Etapa 3).
//!
//! Os comandos IPC de code-intel (`symbol_relations`, `file_outline`,
//! `resolve_definition`/`resolve_references`/`resolve_hover`) tinham embutidas
//! regras que não são do mecanismo de análise: tipar a falha do mapa de símbolos,
//! coordenar «servidor-de-língua primeiro, mapa sintáctico como recurso» no outline,
//! e traduzir coordenadas (o editor é 1-based, o LSP é 0-based) + dar forma ao DTO
//! resolvido. Essas regras saem para aqui, deixando `commands::codeintel` como um
//! adaptador fino — tal como `review::run_review` ↔ `commands::review`.
//!
//! Os restantes comandos do grupo (`symbol_ranges`, `list_symbols`, `diff_lines`,
//! `propose_entrypoint`, `project_entrypoint`) são passagens directas para funções já
//! Tauri-free (`tutor_eval` / `crate::fsops`) — sem regra para isolar, não têm camada
//! aqui, exactamente como `detect_analyzers`/`verify_fix` no grupo review.

use serde::Serialize;
use std::path::Path;
use tutor_eval::codemap::{self, Relations, SymbolRange};
use tutor_eval::lsp::{self, Location};

/// Localização resolvida pelo servidor de língua, já na convenção do editor
/// (1-based, caminho absoluto). DTO puro — serde camelCase estável para a UI. Nasceu
/// em `lib.rs` ao lado do comando; vive agora no caso de uso que o produz.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDef {
    pub file: String,
    pub line: u32,
    pub col: u32,
}

/// Erro tipado do caso de uso. A fronteira IPC ainda o mapeia para `String`, mas o
/// caso de uso nomeia a passagem que falhou. `Display` mantém estável a mensagem
/// histórica que a UI já observava (`"codemap failed: …"`).
#[derive(Debug)]
pub enum CodeIntelError {
    /// A construção do mapa de símbolos (`codemap::symbol_relations`) falhou.
    Codemap(String),
}

impl std::fmt::Display for CodeIntelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Mensagem histórica do comando `symbol_relations`, estável na UI.
            CodeIntelError::Codemap(e) => write!(f, "codemap failed: {e}"),
        }
    }
}

impl std::error::Error for CodeIntelError {}

/// Traduz uma posição do editor (1-based) para a do LSP (0-based), saturando em 0 para
/// que a linha/coluna 0 — ou um buraco de coordenada — nunca dê overflow. É a regra que
/// os três comandos de resolução repetiam inline (`line.saturating_sub(1)`).
fn editor_to_lsp(n: u32) -> u32 {
    n.saturating_sub(1)
}

/// Dá forma de DTO do editor (1-based) a uma [`Location`] do LSP (0-based), resolvendo o
/// URI para caminho. A conversão inversa de `editor_to_lsp`, partilhada por
/// `definition`/`references`.
fn resolved_from(loc: Location) -> ResolvedDef {
    ResolvedDef {
        file: lsp::uri_to_path(&loc.uri),
        line: loc.line + 1,
        col: loc.character + 1,
    }
}

/// Definições, referências e (inferidos) chamadores de `symbol` no projecto em `root`.
/// Delega o trabalho ao mecanismo sintáctico [`codemap::symbol_relations`] e tipa a
/// falha. O comando `symbol_relations` corre isto em `spawn_blocking`.
pub fn relations(root: &Path, symbol: &str) -> Result<Relations, CodeIntelError> {
    codemap::symbol_relations(root, symbol).map_err(|e| CodeIntelError::Codemap(e.to_string()))
}

/// O esqueleto de símbolos de um ficheiro: **servidor de língua primeiro** (quando
/// `root`+`file` dão e algum servidor responde), **mapa sintáctico como recurso**. Esta é
/// a regra de coordenação que estava inline no comando `file_outline`. Pura/off-thread.
pub fn outline(code: &str, lang: &str, root: Option<&str>, file: Option<&str>) -> Vec<SymbolRange> {
    if let (Some(r), Some(f)) = (root, file) {
        let via_lsp = lsp::document_symbols(Path::new(r), Path::new(f), lang, code);
        if !via_lsp.is_empty() {
            return via_lsp;
        }
    }
    codemap::outline(code, lang)
}

/// Resolve a definição do símbolo em (`line`, `col`) — ambos 1-based do editor — via
/// servidor de língua. `None` quando ausente/irresolúvel (a UI cai no mapa sintáctico).
pub fn definition(
    root: &Path,
    file: &Path,
    line: u32,
    col: u32,
    text: Option<&str>,
) -> Option<ResolvedDef> {
    lsp::resolve_definition(root, file, editor_to_lsp(line), editor_to_lsp(col), text)
        .map(resolved_from)
}

/// Resolve TODAS as referências ao símbolo em (`line`, `col`) — ambos 1-based do editor.
/// Vazio quando ausente/irresolúvel.
pub fn references(
    root: &Path,
    file: &Path,
    line: u32,
    col: u32,
    text: Option<&str>,
) -> Vec<ResolvedDef> {
    lsp::resolve_references(root, file, editor_to_lsp(line), editor_to_lsp(col), text)
        .into_iter()
        .map(resolved_from)
        .collect()
}

/// Informação de hover (tipo/docs em markdown) do símbolo em (`line`, `col`) — ambos
/// 1-based do editor. `None` quando ausente/irresolúvel.
pub fn hover(root: &Path, file: &Path, line: u32, col: u32, text: Option<&str>) -> Option<String> {
    lsp::resolve_hover(root, file, editor_to_lsp(line), editor_to_lsp(col), text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_eval::lsp::Location;

    #[test]
    fn editor_1_based_maps_to_lsp_0_based_and_saturates() {
        assert_eq!(editor_to_lsp(1), 0, "a 1ª linha do editor é a 0 no LSP");
        assert_eq!(editor_to_lsp(42), 41);
        // Coordenada 0 (ou em falta) nunca faz underflow — satura em 0.
        assert_eq!(editor_to_lsp(0), 0);
    }

    #[test]
    fn resolved_from_shapes_the_dto_back_to_1_based() {
        let loc = Location {
            uri: "file:///x/src/main.rs".into(),
            line: 0,
            character: 4,
        };
        let def = resolved_from(loc);
        assert_eq!(def.line, 1, "linha 0 do LSP é a 1 do editor");
        assert_eq!(def.col, 5, "coluna 4 do LSP é a 5 do editor");
        assert_eq!(def.file, "/x/src/main.rs", "o URI é resolvido para caminho");
    }

    #[test]
    fn outline_falls_back_to_the_syntactic_map_without_root() {
        // Sem root/file não há servidor de língua: cai no mapa sintáctico (AST Rust),
        // que acha a função real. Prova a regra de coordenação sem depender de toolchain.
        let code = "fn hello() {}\nstruct Point { x: i32 }\n";
        let syms = outline(code, "rust", None, None);
        assert!(
            syms.iter().any(|s| s.name == "hello"),
            "o mapa sintáctico deve encontrar a função `hello`: {syms:?}"
        );
    }

    #[test]
    fn codemap_error_wears_the_historical_prefix() {
        let err = CodeIntelError::Codemap("boom".into());
        assert_eq!(err.to_string(), "codemap failed: boom");
    }
}

/// The agent's `outline` tool (toolset 8, RF-E04, docs/v2/RF-DELONIX-PLANO.md F2.2): before
/// writing, Co-Dev finds the symbol and its exact line range (the language server's document
/// symbols, or the syntax map as a fallback) — the plan then says `src/lib.rs: 40–52 (fn parse)`.
pub struct OutlineTool;

/// The outline language of a file, by extension (`None`: not a source file the map knows).
pub fn outline_lang(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "rust",
        "go" => "go",
        "py" => "python",
        "ts" | "tsx" | "mts" | "cts" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "cs" => "csharp",
        "swift" => "swift",
        "c" | "h" | "cc" | "cpp" | "cxx" | "hpp" | "hh" => "cpp",
        _ => return None,
    })
}

impl tutor_agent::Tool for OutlineTool {
    fn name(&self) -> &str {
        "outline"
    }
    fn description(&self) -> &str {
        "Os símbolos de um ficheiro (funções, métodos, structs, classes…) com o intervalo exacto \
         de linhas de cada um. Usa-o antes de alterar código para apontar o intervalo certo no \
         plano e no edit_lines (ex.: «src/lib.rs: 40–52 (fn parse)»)."
    }
    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "symbol": {"type": "string", "description": "só os símbolos com este nome (opcional)"}
            },
            "required": ["path"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(
        &self,
        input: &serde_json::Value,
        ctx: &tutor_agent::ToolCtx,
    ) -> tutor_agent::ToolOutput {
        let given = input["path"].as_str().unwrap_or_default();
        let abs = match tutor_agent::sandbox::resolve(&ctx.root, given) {
            Ok(p) => p,
            Err(e) => return tutor_agent::ToolOutput::err(e),
        };
        let Some(lang) = outline_lang(given) else {
            return tutor_agent::ToolOutput::err(format!(
                "{given}: não sei os símbolos deste tipo de ficheiro; usa grep/read"
            ));
        };
        let code = match std::fs::read_to_string(&abs) {
            Ok(c) => c,
            Err(e) => return tutor_agent::ToolOutput::err(format!("{given}: {e}")),
        };
        let root = ctx.root.display().to_string();
        let file = abs.display().to_string();
        let want = input["symbol"]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let syms: Vec<String> = outline(&code, lang, Some(&root), Some(&file))
            .into_iter()
            .filter(|s| want.is_none_or(|w| s.name == w))
            .map(|s| {
                let kind = serde_json::to_value(s.kind)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default();
                format!("{}–{} {kind} {}", s.start_line, s.end_line, s.name)
            })
            .collect();
        if syms.is_empty() {
            return tutor_agent::ToolOutput::ok(format!(
                "{given}: sem símbolos{}",
                want.map(|w| format!(" com o nome {w}")).unwrap_or_default()
            ));
        }
        tutor_agent::ToolOutput::ok(format!("{given}\n{}", syms.join("\n")))
    }
}

#[cfg(test)]
mod outline_tool_tests {
    use super::*;
    use tutor_agent::Tool;

    #[test]
    fn the_agent_gets_each_symbol_with_its_line_range() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        std::fs::write(
            d.path().join("src/lib.rs"),
            "struct P;\n\nfn parse(s: &str) -> P {\n    let _ = s;\n    P\n}\n",
        )
        .unwrap();
        let ctx = tutor_agent::ToolCtx {
            root: d.path().to_path_buf(),
            cancel: Default::default(),
        };
        let r = OutlineTool.run(&serde_json::json!({"path": "src/lib.rs"}), &ctx);
        assert!(!r.is_error, "{}", r.content);
        assert!(
            r.content.contains("3–6 fn parse") || r.content.contains("3–6 function parse"),
            "{}",
            r.content
        );
        let only = OutlineTool.run(
            &serde_json::json!({"path": "src/lib.rs", "symbol": "parse"}),
            &ctx,
        );
        assert!(
            !only.content.contains(" P\n") && only.content.contains("parse"),
            "{}",
            only.content
        );
        assert!(
            OutlineTool
                .run(&serde_json::json!({"path": "notes.txt"}), &ctx)
                .is_error
        );
        assert_eq!(outline_lang("a/b.TSX"), Some("typescript"));
    }
}
