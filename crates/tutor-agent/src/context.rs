//! O system prompt do agente (F5): núcleo estável + instruções do projecto.
//!
//! Ordem de render da API: `tools` → `system` → `messages`. O system prompt é montado
//! **uma vez, no início da sessão**, e gravado com ela ([`crate::session`]): retomar uma
//! sessão reenvia exactamente o mesmo texto, mesmo que o `AGENTS.md` tenha mudado — um
//! system prompt diferente invalidaria a cache e os blocos `thinking` já assinados.
//! Nada volátil (hora, ficheiro activo, modo) entra aqui: isso vai como mensagem
//! `system` a meio da conversa.

use std::path::Path;

use crate::provider::SystemBlock;

/// Ficheiros de instruções do projecto, por ordem (os mais gerais primeiro).
/// Pasta da memória do projecto (todos os `.md`, por ordem alfabética).
pub const MEMORY_DIR: &str = ".dxtutor/memory";
pub const INSTRUCTION_FILES: &[&str] =
    &["AGENTS.md", "CLAUDE.md", "DELONIX.md", ".dxtutor/regras.md"];
/// Tamanho máximo de cada ficheiro de instruções incluído.
const MAX_FILE_BYTES: usize = 40 * 1024;
/// Tamanho máximo do conjunto das instruções do projecto.
const MAX_TOTAL_BYTES: usize = 120 * 1024;

/// Em que língua o Co-Dev responde ao humano: a da interface (o `LOCALE` da UI), escolhida
/// quando a sessão começa. As instruções ao modelo continuam em português; só a regra da
/// resposta muda. Sem língua (UIs antigas, testes) fica o português, como antes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ReplyLang {
    #[default]
    Pt,
    En,
}

impl ReplyLang {
    /// O código da UI (`en`, `ptAO`, …) → língua da resposta; desconhecido → português.
    pub fn from_ui(code: Option<&str>) -> Self {
        match code.map(|c| c.trim().to_ascii_lowercase()) {
            Some(c) if c == "en" || c.starts_with("en-") || c.starts_with("en_") => ReplyLang::En,
            _ => ReplyLang::Pt,
        }
    }

    /// A regra do núcleo do system prompt.
    pub fn core_rule(self) -> &'static str {
        match self {
            ReplyLang::Pt => "Respondes em português (ortografia pré-AO90), de forma curta e concreta.",
            ReplyLang::En => "You always answer the human in English, briefly and concretely (even though these instructions are in Portuguese).",
        }
    }

    /// A frase curta que fecha os briefs dos sub-agentes.
    pub fn reply_rule(self) -> &'static str {
        match self {
            ReplyLang::Pt => "Responde em português.",
            ReplyLang::En => "Answer in English.",
        }
    }
}

/// O núcleo do Co-Dev em português (a língua por omissão).
pub fn core_prompt() -> String {
    core_prompt_in(ReplyLang::Pt)
}

/// O núcleo do Co-Dev: como trabalha e o que nunca faz. Só muda com a língua da resposta,
/// escolhida no início da sessão (e gravada com ela).
pub fn core_prompt_in(lang: ReplyLang) -> String {
    format!(
        "És o Co-Dev do dxtutor IDE: um co-programador sénior que trabalha orientado por um \
     programador humano, dentro do projecto aberto. {}\n\
     \n\
     Como trabalhas:\n\
     - Lê antes de alterar: usa read/grep/glob para perceber o código antes de editar.\n\
     - Prefere `edit` (substituições pequenas e exactas) a reescrever ficheiros inteiros.\n\
     - Depois de alterar código, verifica: corre `run_tests`/`lint` quando existirem, ou o \
     comando de verificação adequado com `bash`. Não declares uma tarefa feita sem a \
     verificares, e diz o que verificaste.\n\
     - Se a verificação falhar, lê o erro real, corrige e volta a verificar.\n\
     - Pergunta quando o pedido for ambíguo ou a decisão for do humano; não inventes requisitos.\n\
     - Algumas acções pedem aprovação ao humano; se ele recusar, respeita e propõe alternativa.\n\
     - Nunca faças push, apagues dados ou mexas fora do projecto sem o humano pedir.\n\
     - Em tarefas grandes, podes começar por propor um plano; em trabalho com vários passos, \
     regista-os com `todo_write`.\n\
     - Memória do projecto: guarda em `.dxtutor/memory/` (markdown) decisões e factos \
     duradouros que valha a pena lembrar noutra conversa; é lida no início de cada sessão.",
        lang.core_rule()
    )
}

/// Lê as instruções do projecto em `root` (só os ficheiros que existem), cortando
/// ficheiros grandes. Devolve o texto pronto a entrar no system prompt.
pub fn project_instructions(root: &Path) -> Option<String> {
    let mut out = String::new();
    for name in INSTRUCTION_FILES {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        let mut body: String = text.chars().take(MAX_FILE_BYTES).collect();
        if body.len() < text.len() {
            body.push_str("\n…[ficheiro cortado]");
        }
        if out.len() + body.len() > MAX_TOTAL_BYTES {
            out.push_str(&format!(
                "\n\n(instruções de {name} omitidas: limite de tamanho)"
            ));
            continue;
        }
        out.push_str(&format!(
            "\n\n<instructions file=\"{name}\">\n{}\n</instructions>",
            body.trim_end()
        ));
    }
    // memória do projecto: .dxtutor/memory/*.md
    if let Ok(rd) = std::fs::read_dir(root.join(MEMORY_DIR)) {
        let mut files: Vec<_> = rd
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "md"))
            .collect();
        files.sort();
        for p in files {
            let Ok(text) = std::fs::read_to_string(&p) else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            let name = format!(
                "{MEMORY_DIR}/{}",
                p.file_name().unwrap_or_default().to_string_lossy()
            );
            let body: String = text.chars().take(MAX_FILE_BYTES).collect();
            if out.len() + body.len() > MAX_TOTAL_BYTES {
                out.push_str(&format!("\n\n(memória {name} omitida: limite de tamanho)"));
                continue;
            }
            out.push_str(&format!(
                "\n\n<memory file=\"{name}\">\n{}\n</memory>",
                body.trim_end()
            ));
        }
    }
    (!out.is_empty()).then(|| {
        format!(
            "Instruções do projecto (escritas pela equipa; seguem-se ao núcleo acima e \
             prevalecem sobre preferências gerais, nunca sobre a segurança):{out}"
        )
    })
}

/// O system prompt de uma sessão nova, em português (ver [`system_prompt_in`]).
pub fn system_prompt(root: &Path) -> Vec<SystemBlock> {
    system_prompt_in(root, ReplyLang::Pt)
}

/// O system prompt de uma sessão nova: núcleo + instruções do projecto, com o breakpoint
/// de cache no fim (cobre ferramentas + system).
pub fn system_prompt_in(root: &Path, lang: ReplyLang) -> Vec<SystemBlock> {
    let mut v = vec![SystemBlock {
        text: core_prompt_in(lang),
        cache: false,
    }];
    if let Some(p) = project_instructions(root) {
        v.push(SystemBlock {
            text: p,
            cache: false,
        });
    }
    if let Some(sk) = crate::extensions::skills_index(root) {
        v.push(SystemBlock {
            text: sk,
            cache: false,
        });
    }
    if let Some(last) = v.last_mut() {
        last.cache = true;
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn core_only_when_there_are_no_instruction_files() {
        let d = tempfile::tempdir().unwrap();
        let s = system_prompt(d.path());
        assert_eq!(s.len(), 1);
        assert!(s[0].cache, "o breakpoint fica no último bloco");
        assert!(!s[0].text.contains("<instructions"));
    }

    #[test]
    fn instruction_files_are_included_in_order_and_capped() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("CLAUDE.md"), "Usa tabs.").unwrap();
        std::fs::write(d.path().join("AGENTS.md"), "Testes com `cargo test`.").unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(d.path().join(".dxtutor/regras.md"), "x".repeat(60 * 1024)).unwrap();
        let s = system_prompt(d.path());
        assert_eq!(s.len(), 2);
        assert!(!s[0].cache && s[1].cache);
        let p = &s[1].text;
        let (a, c) = (
            p.find("file=\"AGENTS.md\"").unwrap(),
            p.find("file=\"CLAUDE.md\"").unwrap(),
        );
        assert!(a < c, "AGENTS.md antes de CLAUDE.md");
        assert!(p.contains("[ficheiro cortado]"));
    }

    #[test]
    fn project_memory_is_read_in_order() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor/memory")).unwrap();
        std::fs::write(d.path().join(".dxtutor/memory/b.md"), "Usamos sqlx.").unwrap();
        std::fs::write(d.path().join(".dxtutor/memory/a.md"), "API em axum.").unwrap();
        std::fs::write(d.path().join(".dxtutor/memory/x.txt"), "ignorado").unwrap();
        let p = &system_prompt(d.path())[1].text;
        assert!(p.find("memory/a.md").unwrap() < p.find("memory/b.md").unwrap());
        assert!(!p.contains("ignorado"));
    }

    #[test]
    fn the_reply_language_follows_the_interface() {
        let d = tempfile::tempdir().unwrap();
        let pt = &system_prompt(d.path())[0].text;
        assert!(pt.contains("Respondes em português (ortografia pré-AO90)"));
        assert_eq!(
            system_prompt(d.path()),
            system_prompt_in(d.path(), ReplyLang::Pt)
        );
        let en = &system_prompt_in(d.path(), ReplyLang::En)[0].text;
        assert!(en.contains("answer the human in English"));
        assert!(!en.contains("Respondes em português"));
        assert_eq!(ReplyLang::from_ui(Some("en")), ReplyLang::En);
        assert_eq!(ReplyLang::from_ui(Some("ptAO")), ReplyLang::Pt);
        assert_eq!(ReplyLang::from_ui(None), ReplyLang::Pt);
    }

    #[test]
    fn the_prompt_is_deterministic() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("AGENTS.md"), "regra").unwrap();
        assert_eq!(system_prompt(d.path()), system_prompt(d.path()));
    }
}
