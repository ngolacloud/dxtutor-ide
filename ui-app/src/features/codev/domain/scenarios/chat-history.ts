/* ═══════════ Co-Dev scenario `b` — persistent chat history ═══════════
   Pure data + predicates, parameterised by `ScenarioEnv`. The generated code
   snippets come from `env.seed.gen`; the acceptance checks read the workspace
   through `env`. Verbatim transcription of the former `SCN_()[1]` in `codev.ts`
   (the self-reference `_SCN[1].checks` in `ready` becomes the local `checks`). */

import type { Scenario, ScenarioEnv, Check } from "../types";

export function buildChatHistory(env: ScenarioEnv): Scenario {
  const { root: ROOT, repo: P_REPO, mig: P_MIG, test: P_TEST, hist: P_HIST, adr: P_ADR, store: P_STORE } = env.paths;
  const G = env.seed.gen;

  const checks: Check[] = [
    { id: "tests", l: "Testes do store passam", w: 20, fn: () => { const r = env.runTests("store"); return r.ok && r.tests.length >= 4; }, cause: "<code>list_recent</code> não tem <code>ORDER BY</code>; o SQLite devolve por ordem de inserção.", fixd: "acrescentar <code>ORDER BY created_at DESC</code> à query." },
    { id: "reqs", l: "RF-03: CA1, CA2 e CA3 cobertos", w: 10, fn: () => { const fs = env.files(); return !!fs[P_MIG] && !!fs[P_HIST] && env.has(P_REPO, /ORDER BY created_at DESC/) && env.has(P_MIG, /ON DELETE CASCADE/); }, cause: "o CA2 (mais recentes primeiro) depende da ordenação em falta.", fixd: "fica coberto pela correcção da query." },
    { id: "arch", l: "ADR-002: a interface não contém SQL", w: 20, fn: () => { const fs = env.files(); return !!fs[P_HIST] && !env.has(P_HIST, /SELECT |INSERT /); }, cause: "há SQL fora do crate store.", fixd: "mover o acesso a dados para o Repository." },
    { id: "repo", l: "Padrão Repository: trait + implementação", w: 15, fn: () => env.has(P_REPO, /pub trait ConversationRepo/) && env.has(P_REPO, /impl ConversationRepo for/), cause: "falta o trait ou a implementação.", fixd: "repor o Repository." },
    { id: "fk", l: "BD: integridade referencial com cascata", w: 10, fn: () => env.has(P_MIG, /ON DELETE CASCADE/), cause: "faltam as chaves estrangeiras.", fixd: "acrescentar <code>ON DELETE CASCADE</code>." },
    { id: "ds", l: "Design System: zero cores fixas", w: 15, fn: () => { const fs = env.files(); return !!fs[P_HIST] && !env.dsLint().length; }, cause: "usei <code>#ff6600</code> em <code>history.ts</code> em vez de um token.", fixd: "trocar por <code>var(--accent)</code>." },
    { id: "idx", l: "BD: índice cobre o filtro e a ordenação", w: 10, fn: () => env.has(P_MIG, /CREATE INDEX/), cause: "a listagem ordenada faria um varrimento completo da tabela.", fixd: "criar o índice <code>(workspace_id, created_at DESC)</code>." },
  ];

  return {
    id: "b",
    title: "Histórico de conversas persistente",
    prompt: "Quero que as conversas do Co-Dev fiquem guardadas por workspace e apareçam numa lista, das mais recentes para as mais antigas.",
    match: /hist[óo]rico|conversas?/i,
    pkg: "store",
    flow: { kind: "feature", branch: "historico-conversas" },
    ready: () => {
      const fs = env.files();
      return fs[P_REPO] && checks.every((k) => k.fn())
        ? "O histórico de conversas já está implementado e a passar em todos os critérios. Usa «Repor protótipo» na paleta para voltar ao início."
        : null;
    },
    reads: [ROOT + ".dxtutor/regras.md", ROOT + ".dxtutor/requisitos.md", ROOT + ".dxtutor/arquitectura/ADR-001-local-first.md", ROOT + ".dxtutor/arquitectura/ADR-002-camadas.md", ROOT + ".dxtutor/design-system.md", ROOT + ".dxtutor/base-de-dados.md", ROOT + "db/migrations/0001_init.sql"],
    understand: "O pedido corresponde ao <b>RF-03</b> do backlog. Traduzi-o em critérios de aceitação verificáveis antes de escrever código:",
    reqs: [
      { t: "RF-03 · Histórico de conversas por workspace", ac: ["CA1 — as conversas sobrevivem ao fecho da aplicação", "CA2 — a lista mostra primeiro as mais recentes", "CA3 — apagar um workspace apaga as suas conversas"] },
      { t: "Restrições do projecto", ac: ["ADR-001: dados locais em SQLite", "ADR-002: só o crate <code>store</code> contém SQL", "Design System: sem cores fixas; listas no painel lateral"] },
    ],
    questions: [
      { q: "Onde guardar as conversas?", opts: [{ l: "SQLite local, no crate store", why: "segue o ADR-001 e reutiliza a ligação existente" }, { l: "Ficheiro JSON por workspace", why: "simples, mas sem integridade referencial" }, { l: "Postgres remoto", why: "permite sincronizar, mas viola local-first" }], best: 0, conf: 0.94, basis: "ADR-001 · base-de-dados.md" },
      { q: "Como mostrar o histórico na interface?", opts: [{ l: "Secção no painel lateral do Co-Dev", why: "é o padrão do Design System para listas" }, { l: "Janela modal", why: "interrompe o trabalho" }, { l: "Página nova no editor", why: "ocupa o espaço do código" }], best: 0, conf: 0.88, basis: "design-system.md · Componentes" },
      { q: "Durante quanto tempo guardar as conversas?", opts: [{ l: "90 dias, configurável", why: "reversível: basta mudar a definição" }, { l: "Para sempre", why: "a base de dados cresce sem limite" }, { l: "30 dias", why: "pode apagar contexto ainda útil" }], best: 0, conf: 0.55, basis: "sem regra no projecto — decisão de produto" },
    ],
    cands: [
      { prov: "claude", title: "SQLite + Repository (trait ConversationRepo)", sum: "Migração nova, trait no crate store, UI atrás de um comando Tauri. Respeita ADR-001 e ADR-002.", sc: { c: 9, a: 9, t: 9, r: 8, k: 7 } },
      { prov: "codex", title: "SQL directo a partir da UI", sum: "Menos código e mais rápido de escrever, mas põe queries em history.ts — viola o ADR-002.", sc: { c: 8, a: 4, t: 6, r: 6, k: 9 } },
      { prov: "gemini", title: "Postgres gerido com sincronização", sum: "Histórico em todos os dispositivos, mas torna um serviço remoto obrigatório — viola o ADR-001.", sc: { c: 8, a: 6, t: 7, r: 4, k: 3 } },
      { prov: "ollama", title: "Ficheiro JSON por workspace", sum: "Sem migração nem dependências, mas sem cascata nem ordenação indexada.", sc: { c: 6, a: 5, t: 5, r: 6, k: 10 } },
    ],
    best: 0,
    verify: ["cargo test -p store", "dx lint"],
    steps: [
      { l: "Migração 0002: conversations e messages", tools: [{ t: "edit", p: P_MIG, content: G["0002_conversations.sql"] }] },
      { l: "Repository no crate store", tools: [{ t: "edit", p: P_REPO, content: G["conversations.rs"] }, { t: "edit", p: P_STORE, make: (o: string) => (o.includes("pub mod conversations") ? o : o.replace("pub mod workspaces;", "pub mod conversations;\npub mod workspaces;")) }] },
      { l: "Secção «Histórico» na interface", tools: [{ t: "read", p: ROOT + "desktop/src/styles.css" }, { t: "edit", p: P_HIST, content: G["history.ts"] }] },
      { l: "Testes de integração", tools: [{ t: "edit", p: P_TEST, content: G["conversations_test.rs"] }] },
      { l: "Registar a decisão no ADR-003", tools: [{ t: "edit", p: P_ADR, content: G["ADR-003-historico.md"] }] },
    ],
    fix: {
      strategy: "inc",
      steps: [
        { for: "tests", l: "Ordenar a listagem por mais recente", tools: [{ t: "edit", p: P_REPO, make: (o: string) => o.replace("WHERE workspace_id = ?1 LIMIT ?2", "WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2") }] },
        { for: "ds", l: "Trocar a cor fixa pelo token --accent", tools: [{ t: "edit", p: P_HIST, make: (o: string) => o.replace('"2px solid #ff6600"', '"2px solid var(--accent)"') }] },
        { for: "idx", l: "Criar índice (workspace_id, created_at)", tools: [{ t: "edit", p: P_MIG, make: (o: string) => (/CREATE INDEX/.test(o) ? o : o.replace(/\n*$/, "\n\nCREATE INDEX idx_conversations_ws_created\n  ON conversations (workspace_id, created_at DESC);\n")) }] },
      ],
    },
    checks,
    done: ["Migração <code>0002_conversations.sql</code> com cascata e índice", "<code>ConversationRepo</code> (padrão Repository) no crate <code>store</code>", "Secção «Histórico» em <code>history.ts</code>, só com tokens do Design System", "3 testes de integração novos a passar", "Decisão registada em <code>ADR-003</code>"],
    commit: "feat(store): persistent chat history (RF-03, ADR-003)",
  };
}
