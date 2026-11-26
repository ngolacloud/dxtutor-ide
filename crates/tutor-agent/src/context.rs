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
/// Tamanho máximo de cada ficheiro de instruções incluído. As instruções vão em TODOS os
/// pedidos da sessão; um ficheiro maior entra condensado ([`condense`]): o início, o índice
/// das secções com os números de linha, e a indicação de as ler com `read` quando a tarefa lhes
/// tocar — em vez de um corte arbitrário a meio do texto.
pub const MAX_FILE_BYTES: usize = 12 * 1024;
/// O início de um ficheiro condensado (cortado no fim de uma linha).
const HEAD_BYTES: usize = 6 * 1024;
/// Tamanho máximo do conjunto das instruções do projecto (e da memória).
pub const MAX_TOTAL_BYTES: usize = 32 * 1024;
/// O que se reserva, num ficheiro condensado, para a nota que explica o corte.
const NOTE_BYTES: usize = 700;

/// O maior prefixo de `text` com até `max` bytes que acaba no fim de uma linha (ou, sem
/// nenhuma, numa fronteira de carácter).
fn cut_at_line(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind('\n') {
        Some(i) => &text[..=i],
        None => &text[..end],
    }
}

/// Os títulos markdown (`#`…`######`) de `text`, fora de blocos de código: `(linha 1-based,
/// nível, título)`.
fn headings(text: &str) -> Vec<(usize, usize, &str)> {
    let mut out = vec![];
    let mut fence: Option<&str> = None;
    for (i, line) in text.lines().enumerate() {
        let t = line.trim_start();
        let mark = if t.starts_with("```") {
            Some("```")
        } else if t.starts_with("~~~") {
            Some("~~~")
        } else {
            None
        };
        if let Some(m) = mark {
            fence = match fence {
                Some(f) if f == m => None,
                None => Some(m),
                other => other,
            };
            continue;
        }
        if fence.is_some() || !line.starts_with('#') {
            continue;
        }
        let level = line.chars().take_while(|&c| c == '#').count();
        let rest = &line[level..];
        if level <= 6 && rest.starts_with(' ') && !rest.trim().is_empty() {
            out.push((i + 1, level, rest.trim()));
        }
    }
    out
}

/// O índice das secções (as que começam depois da linha `after`), no máximo `budget` bytes: o
/// nível mais fundo que cabe; se nem o primeiro nível couber, os primeiros títulos que couberem.
fn toc(text: &str, after: usize, budget: usize) -> String {
    let hs: Vec<_> = headings(text)
        .into_iter()
        .filter(|(l, _, _)| *l > after)
        .collect();
    // profundidade relativa ao nível mais alto que aparece (o índice pode começar em `##`)
    let min_level = hs.iter().map(|h| h.1).min().unwrap_or(1);
    let render = |depth: usize| -> String {
        hs.iter()
            .filter(|h| h.1 - min_level < depth)
            .map(|(l, lv, t)| format!("{}- {t} (linha {l})\n", "  ".repeat(lv - min_level)))
            .collect()
    };
    for depth in (1..=6).rev() {
        let s = render(depth);
        if s.len() <= budget {
            return s;
        }
    }
    let top = render(1);
    let mut s = cut_at_line(&top, budget.saturating_sub("- …\n".len())).to_string();
    s.push_str("- …\n");
    s
}

/// O texto de um ficheiro de instruções tal como entra no system prompt. Até
/// [`MAX_FILE_BYTES`], inteiro; maior, o início (`head` bytes, cortado no fim de uma linha) e o
/// índice das secções seguintes, com a indicação de as ler com `read` quando for preciso.
/// Determinístico (só depende do conteúdo): o prefixo do pedido fica estável e a cache serve.
fn condense(name: &str, text: &str, head: usize) -> String {
    let text = text.trim_end();
    if text.len() <= MAX_FILE_BYTES {
        return text.to_string();
    }
    let head = cut_at_line(text, head);
    let head_lines = head.lines().count();
    let total_lines = text.lines().count();
    let index = toc(
        text,
        head_lines,
        MAX_FILE_BYTES.saturating_sub(head.len() + NOTE_BYTES),
    );
    let mut out = head.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str(&format!(
        "[{name} tem {total_lines} linhas ({} KB); aqui estão só {} e o índice das secções \
         seguintes. Quando a tarefa tocar numa delas, lê essa secção com `read` (path \"{name}\", \
         offset = a linha do título, limit até à secção seguinte) antes de agir; não leias o \
         ficheiro inteiro.]",
        text.len() / 1024,
        if head_lines > 0 {
            format!("as primeiras {head_lines} linhas")
        } else {
            "o título".to_string()
        },
    ));
    if !index.is_empty() {
        out.push_str("\nSecções:\n");
        out.push_str(index.trim_end());
    }
    out
}

/// Acrescenta um ficheiro a `out` respeitando o total: inteiro ou condensado; se não couber,
/// só o índice; se nem isso, uma linha a dizer que ficou de fora.
fn push_file(out: &mut String, tag: &str, name: &str, text: &str) {
    let body = condense(name, text, HEAD_BYTES);
    let body = if out.len() + body.len() > MAX_TOTAL_BYTES {
        condense(name, text, 0)
    } else {
        body
    };
    if out.len() + body.len() > MAX_TOTAL_BYTES {
        out.push_str(&format!(
            "\n\n({tag} {name} omitido: limite de tamanho das instruções; lê-o com `read` se a \
             tarefa precisar)"
        ));
        return;
    }
    out.push_str(&format!("\n\n<{tag} file=\"{name}\">\n{body}\n</{tag}>"));
}

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
     - Lê antes de alterar, mas só o que precisas: localiza primeiro (`outline` quando existir, \
     `grep` com mode=\"content\", `glob`) e lê com `read` só o excerto relevante (offset/limit; \
     sem limit vêm 500 linhas). Não releias o que já tens na conversa.\n\
     - Para alterar ficheiros, `edit` é a ferramenta preferida: old_string curto mas único, \
     copiado do `read`. `edit_lines` (quando existir) só para inserir linhas num ponto ou trocar \
     um bloco grande que acabaste de ler; `write` só para ficheiros novos ou reescritas \
     completas pedidas.\n\
     - Saídas longas de comandos são cortadas (fica sobretudo o fim): filtra-as \
     (`| tail -n 80`, `| grep -n erro`) em vez de as pedir inteiras.\n\
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

/// Lê as instruções do projecto em `root` (só os ficheiros que existem), condensando os
/// grandes ([`condense`]). Devolve o texto pronto a entrar no system prompt.
pub fn project_instructions(root: &Path) -> Option<String> {
    let mut out = String::new();
    for name in INSTRUCTION_FILES {
        let Ok(text) = std::fs::read_to_string(root.join(name)) else {
            continue;
        };
        if text.trim().is_empty() {
            continue;
        }
        push_file(&mut out, "instructions", name, &text);
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
            push_file(&mut out, "memory", &name, &text);
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
        // o ficheiro grande entra condensado: o início e a indicação de o ler com `read`
        assert!(p.contains("[.dxtutor/regras.md tem 1 linhas (60 KB)"));
        assert!(p.len() < MAX_FILE_BYTES + 2048, "{}", p.len());
    }

    /// Um ficheiro de instruções grande como o CLAUDE.md deste repositório: secções com
    /// títulos, blocos de código com `#` lá dentro.
    fn big_markdown() -> String {
        let mut s = String::from("# Projecto\n\nRegras gerais.\n\n");
        for i in 1..=40 {
            s.push_str(&format!("## Secção {i}\n\n"));
            s.push_str("```bash\n# não é um título\ncargo test\n```\n\n");
            for j in 0..12 {
                s.push_str(&format!(
                    "Linha {j} da secção {i}: texto de exemplo para encher.\n"
                ));
            }
            s.push_str(&format!("\n### Detalhe {i}\n\nMais texto.\n\n"));
        }
        s
    }

    #[test]
    fn a_big_instruction_file_brings_its_beginning_and_an_index_with_line_numbers() {
        let text = big_markdown();
        assert!(text.len() > MAX_FILE_BYTES * 2);
        let c = condense("CLAUDE.md", &text, HEAD_BYTES);
        assert!(c.len() <= MAX_FILE_BYTES, "{}", c.len());
        assert!(c.starts_with("# Projecto\n\nRegras gerais."));
        assert!(c.contains("lê essa secção com `read` (path \"CLAUDE.md\""));
        // o índice aponta para a linha certa de cada título que ficou fora do início
        let line_of = |title: &str| {
            text.lines()
                .position(|l| l == title)
                .map(|i| i + 1)
                .unwrap()
        };
        let last = format!("- Secção 40 (linha {})", line_of("## Secção 40"));
        assert!(c.contains(&last), "{c}");
        assert!(
            !c.contains("não é um título (linha"),
            "títulos dentro de código não contam"
        );
        // corta no fim de uma linha
        let head_end = c.find("\n\n[CLAUDE.md tem").unwrap();
        assert!(text.starts_with(&c[..head_end]));
        // determinístico: o mesmo texto dá o mesmo prefixo (a cache serve entre turnos)
        assert_eq!(c, condense("CLAUDE.md", &text, HEAD_BYTES));
        // pequeno: entra inteiro
        assert_eq!(condense("AGENTS.md", "regra\n", HEAD_BYTES), "regra");
    }

    #[test]
    fn the_index_drops_deeper_levels_before_dropping_sections() {
        let text = big_markdown();
        let full = toc(&text, 0, usize::MAX);
        assert!(full.contains("    - Detalhe 3"));
        // depois do título (linha 1) o índice começa nas secções `##`
        let full = toc(&text, 1, usize::MAX);
        assert!(full.starts_with("- Secção 1 (linha 5)"), "{full}");
        let small = toc(&text, 1, full.len() / 2);
        assert!(!small.contains("Detalhe"));
        assert!(small.contains("- Secção 40"));
        let tiny = toc(&text, 1, 200);
        assert!(tiny.len() <= 200 && tiny.ends_with("- …\n"), "{tiny}");
    }

    #[test]
    fn the_total_keeps_every_file_at_least_as_an_index() {
        let d = tempfile::tempdir().unwrap();
        for f in ["AGENTS.md", "CLAUDE.md", "DELONIX.md"] {
            std::fs::write(d.path().join(f), big_markdown()).unwrap();
        }
        std::fs::create_dir_all(d.path().join(".dxtutor/memory")).unwrap();
        std::fs::write(d.path().join(".dxtutor/memory/a.md"), big_markdown()).unwrap();
        let p = project_instructions(d.path()).unwrap();
        assert!(p.len() <= MAX_TOTAL_BYTES + 1024, "{}", p.len());
        for f in ["AGENTS.md", "CLAUDE.md", "DELONIX.md"] {
            assert!(
                p.contains(&format!("file=\"{f}\""))
                    || p.contains(&format!("instructions {f} omitido")),
                "{f}"
            );
        }
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
