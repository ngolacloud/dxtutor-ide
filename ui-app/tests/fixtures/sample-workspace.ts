/* Fixture de testes: o projecto-exemplo `dxtutor/` (um workspace Rust + desktop TS) sobre o qual os
   goldens e os testes de caracterização desenham. Era a semente que a app carregava sem pasta aberta
   (`features/workspace/seed.ts`, `VITE_SEED=1`); a app deixou de trazer dados de demonstração
   (ADR-0006, R1a) e a semente passou a ser só dado de teste. `applySampleWorkspace` repõe o estado
   que o antigo `loadSeed` deixava: os ficheiros base com três diferenças deterministas face ao git
   (styles.css e assistant.ts modificados, theme.css novo). */

export const SAMPLE_FILES: Record<string, string> = {
 "Cargo.toml": "[workspace]\nmembers = [\"crates/lexer\", \"crates/store\"]\nresolver = \"2\"\n\n[workspace.dependencies]\nrusqlite = { version = \"0.32\", features = [\"bundled\"] }\n",
 "README.md": "# dxtutor\n\nIDE com um Co-Dev integrado. Local-first, multi-modelo.\n\n- `desktop/` — interface (TypeScript + Tauri)\n- `crates/lexer` — tokenizador de exemplo\n- `crates/store` — persistência SQLite\n- `db/migrations` — esquema da base de dados\n- `.dxtutor/` — conhecimento do projecto que o Co-Dev lê antes de agir\n",
 "desktop/index.html": "<!doctype html>\n<html lang=\"pt\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <title>dxtutor IDE</title>\n    <link rel=\"stylesheet\" href=\"/src/styles.css\" />\n  </head>\n  <body>\n    <div id=\"app\"></div>\n    <script type=\"module\" src=\"/src/main.ts\"></script>\n  </body>\n</html>\n",
 "desktop/package.json": "{\n  \"name\": \"dxtutor-desktop\",\n  \"version\": \"0.2.0\",\n  \"scripts\": {\n    \"dev\": \"vite\",\n    \"build\": \"tsc && vite build\",\n    \"lint\": \"dx lint\"\n  },\n  \"dependencies\": {\n    \"@tauri-apps/api\": \"^2.0.0\"\n  }\n}\n",
 "desktop/src/styles.css": "/* dxtutor — tema Grafite + laranja */\n:root {\n  --bg-base: #0f0f11;\n  --bg-editor: #161618;\n  --accent: #e06c3b;\n  --accent-hover: #f08a4b;\n  --radius: 9px;\n}\n\n.agent {\n  background: var(--bg-editor);\n  border-radius: var(--radius);\n}\n\n.send {\n  background: var(--accent);\n}\n",
 "desktop/src/assistant.ts": "// Painel Co-Dev — render das mensagens.\nimport { state } from \"./workspace\";\n\nexport function renderMessages(): void {\n  const host = document.querySelector(\"#ag-msgs\");\n  if (!host) return;\n  host.innerHTML = state.messages.map(bubble).join(\"\");\n}\n\nfunction bubble(m: Message): string {\n  return `<div class=\"m ${m.role}\"><div class=\"bd\">${m.html}</div></div>`;\n}\n\n// v2: suporte a cartões de plano\nexport function renderPlan(steps: Step[]): string {\n  return steps.map((s) => `<div class=\"stp ${s.state}\">${s.label}</div>`).join(\"\");\n}\n",
 "desktop/src/workspace.ts": "// Estado do workspace aberto.\nexport const state = {\n  root: \"\",\n  messages: [] as Message[],\n};\n\nexport async function openWorkspace(name: string): Promise<void> {\n  state.root = name;\n}\n",
 "desktop/src/i18n.ts": "// Textos da interface (pt-AO).\nconst STRINGS: Record<string, string> = {\n  \"app.title\": \"dxtutor IDE\",\n  \"agent.name\": \"Co-Dev\",\n  \"mode.manual\": \"Manual\",\n  \"mode.auto\": \"Automático\",\n};\n\nexport function t(key: string): string {\n  return STRINGS[key] ?? key;\n}\n",
 "desktop/src/theme.css": "/* Tokens alternativos — Slate índigo */\n:root[data-theme=\"slate\"] {\n  --bg-base: #0e1016;\n  --bg-editor: #141722;\n  --accent: #6d7cff;\n  --accent-hover: #8f9bff;\n}\n",
 "desktop/src/main.ts": "// Arranque da aplicação desktop.\nimport { renderMessages } from \"./assistant\";\nimport { openWorkspace } from \"./workspace\";\nimport { t } from \"./i18n\";\n\nexport async function main(): Promise<void> {\n  document.title = t(\"app.title\");\n  await openWorkspace(\"projects\");\n  renderMessages();\n}\n\nmain();\n",
 "crates/lexer/src/lib.rs": "// Tokeniza uma expressão aritmética.\npub fn tokenize(src: &str) -> Vec<Token> {\n    let mut tokens = Vec::new();\n    let mut chars = src.chars().peekable();\n    for c in chars {\n        if c.is_ascii_digit() {\n            tokens.push(Token::Num(c));\n        }\n    }\n    if chars.peek().is_none() {\n        tokens.push(Token::Eof);\n    }\n    tokens\n}\n\n#[derive(Debug, PartialEq)]\npub enum Token {\n    Num(char),\n    Eof,\n}\n",
 "crates/store/src/lib.rs": "// Camada de persistência (ADR-002): só este crate fala com o SQLite.\npub mod workspaces;\n\npub type Result<T> = std::result::Result<T, StoreError>;\n\n#[derive(Debug)]\npub enum StoreError {\n    Sqlite(rusqlite::Error),\n    NotFound,\n}\n",
 "crates/store/src/workspaces.rs": "use crate::Result;\nuse rusqlite::{params, Connection};\n\npub struct Workspace {\n    pub id: String,\n    pub name: String,\n    pub created_at: i64,\n}\n\npub fn insert(conn: &Connection, w: &Workspace) -> Result<()> {\n    conn.execute(\n        \"INSERT INTO workspaces (id, name, created_at) VALUES (?1, ?2, ?3)\",\n        params![w.id, w.name, w.created_at],\n    )?;\n    Ok(())\n}\n",
 ".dxtutor/regras.md": "# Regras do Co-Dev neste projecto\n\n1. Ler os ADRs e o Design System antes de propor uma solução.\n2. Não quebrar a API pública de um crate sem perguntar ao humano.\n3. Toda a alteração de esquema entra como migração nova em `db/migrations`.\n4. Nenhuma cor fixa na UI: usar sempre tokens (`var(--…)`).\n5. Código novo só é entregue com testes a passar e auto-avaliação ≥ limiar.\n6. `git push` e acções destrutivas exigem sempre aprovação humana.\n7. Se a confiança numa decisão for baixa, escolher a opção reversível e assinalar o pressuposto.\n",
 ".dxtutor/padroes.md": "# Padrões de projecto adoptados\n\n1. **Camadas** — ver ADR-002.\n2. **Repository** — acesso a dados atrás de um `trait`; a implementação SQLite é um detalhe.\n3. **Command** — cada acção da UI é um comando Tauri com entrada e saída tipadas.\n4. **Strategy** — provedores de LLM implementam o mesmo `trait ModelProvider`.\n5. **Observer** — a UI subscreve eventos do agente (plano, ferramenta, avaliação).\n",
 ".dxtutor/design-system.md": "# Design System\n\n## Tokens\n- Cor: `--bg-base`, `--bg-editor`, `--accent`, `--accent-hover` (ver `desktop/src/styles.css`)\n- Raio: `--radius`\n- Nunca usar valores hexadecimais fora da definição dos tokens.\n\n## Componentes\n- Listas e históricos vivem em **secções do painel lateral**, não em modais.\n- Acção primária: um único botão com `--accent` por vista.\n- Estados: vazio, a carregar, erro — sempre os três.\n",
 ".dxtutor/requisitos.md": "# Requisitos (backlog vivo)\n\n## RF-01 · Editor e navegação\nComo programador quero abrir, editar e procurar ficheiros sem sair do teclado.\n\n## RF-02 · Co-Dev multi-modelo\nComo programador quero escolher entre Claude, Gemini, Codex e Ollama local por papel.\n\n## RF-03 · Histórico de conversas\nComo programador quero retomar conversas anteriores do Co-Dev por workspace.\n- CA1: as conversas ficam guardadas depois de fechar a aplicação.\n- CA2: a lista mostra primeiro as mais recentes.\n- CA3: apagar um workspace apaga as suas conversas.\n\n## RNF-01 · Local-first\nOs dados do utilizador ficam na máquina; nada sai sem consentimento.\n",
 ".dxtutor/base-de-dados.md": "# Base de dados\n\n- Motor: SQLite (ficheiro por instalação), acesso via `rusqlite`.\n- Chaves: `TEXT` (ULID). Datas: `INTEGER` (epoch ms).\n- Integridade: chaves estrangeiras com `ON DELETE CASCADE` quando o filho não vive sem o pai.\n- Desempenho: toda a listagem ordenada precisa de um índice que cubra o filtro e a ordenação.\n- Migrações: ficheiros numerados, só para a frente, nunca editar uma migração aplicada.\n",
 ".dxtutor/arquitectura/ADR-001-local-first.md": "# ADR-001 · Local-first\n\n**Estado:** aceite\n\n**Decisão:** os dados do utilizador (workspaces, conversas, definições) são guardados\nlocalmente em SQLite. Serviços remotos são opcionais e nunca a fonte de verdade.\n\n**Consequências:** funciona offline; sincronização é uma funcionalidade futura, não um requisito.\n",
 ".dxtutor/arquitectura/ADR-002-camadas.md": "# ADR-002 · Camadas\n\n**Estado:** aceite\n\n**Decisão:** UI (`desktop/`) → comandos Tauri → crates de domínio → `crates/store`.\nSó o crate `store` contém SQL. A UI nunca acede à base de dados directamente.\n\n**Consequências:** a persistência pode mudar sem tocar na interface; testes do `store` não precisam de UI.\n",
 "db/migrations/0001_init.sql": "-- 0001 · esquema inicial\nCREATE TABLE workspaces (\n  id         TEXT PRIMARY KEY,\n  name       TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n);\n"
};

interface SampleWindow {
  FS: Record<string, { content: string; orig: string | null }>;
  ROOT: string;
}

/** Escreve o projecto-exemplo no FS da app já arrancada (depois do `resetWorkspace`). */
export function applySampleWorkspace(w: SampleWindow): void {
  const { FS, ROOT } = w;
  Object.entries(SAMPLE_FILES).forEach(([p, c]) => {
    FS[ROOT + p] = { content: c, orig: c };
  });
  const s = FS[ROOT + "desktop/src/styles.css"];
  s.orig = s.content.replace("  --accent-hover: #f08a4b;\n", "");
  const a = FS[ROOT + "desktop/src/assistant.ts"];
  a.orig = a.content.replace(/\n\/\/ v2[\s\S]*$/, "\n");
  FS[ROOT + "desktop/src/theme.css"].orig = null;
}
