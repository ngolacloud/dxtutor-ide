// Compositor do Co-Dev (estilo chat do Claude): domínio puro + o DOM do compositor em
// jsdom com um host falso. A delegação de cliques é a da feature (`bindActions`).
import { test, expect, beforeEach } from "vitest";
import {
  buildPrompt,
  exportMarkdown,
  filterActions,
  formatSize,
  isTextFile,
  modelLabel,
  nextMode,
  parseEffort,
  SLASH_ACTIONS,
  type Effort,
} from "../src/features/codev/domain/composer";
import { bindActions } from "../src/features/codev/ui/actions";
import {
  _composerState,
  composerActions,
  composerContext,
  composerRunChanged,
  mountComposer,
  resetComposer,
  trackSubagent,
  type ComposerHost,
} from "../src/features/codev/ui/composer";

/* ───── domínio ───── */

test("modelos: nomes curtos, catálogo e ids desconhecidos", () => {
  expect(modelLabel("claude", "claude-opus-5-5")).toBe("Opus 5.5");
  expect(modelLabel("claude", "claude-sonnet-6")).toBe("Sonnet 6");
  expect(modelLabel("gemini", "gemini-2.5-pro")).toBe("Gemini 2.5 Pro");
  expect(modelLabel("ollama", "qwen2.5-coder:14b")).toBe("qwen2.5-coder:14b");
  expect(parseEffort("max")).toBe("max");
  expect(parseEffort("turbo")).toBe("high");
  expect(parseEffort(null)).toBe("high");
});

test("modos: Shift+Tab percorre Manual → Assistido → Plano → Auto → Manual", () => {
  expect(nextMode("manual")).toBe("assist");
  expect(nextMode("assist")).toBe("plan");
  expect(nextMode("plan")).toBe("auto");
  expect(nextMode("auto")).toBe("manual");
});

test("menu «/»: filtra sem acentos, pelo grupo e pelo atalho", () => {
  const ids = (q: string) => filterActions(SLASH_ACTIONS, q).map((a) => a.id);
  expect(ids("")).toHaveLength(SLASH_ACTIONS.length);
  expect(ids("esforco")).toEqual(["effort"]);
  expect(ids("/reverter")).toEqual(["rewind"]);
  expect(ids("modelo")).toEqual(["model", "effort"]);
  expect(ids("zzz")).toEqual([]);
});

test("anexos: menções e ficheiros entram no pedido; comandos «/» vão sozinhos", () => {
  const atts = [
    { id: "1", kind: "mention" as const, name: "lexer.rs", path: "src/lexer.rs" },
    { id: "2", kind: "file" as const, name: 'notas "v2".md', content: "- corrigir tokens", size: 17 },
  ];
  const p = buildPrompt("  revê isto  ", atts);
  expect(p).toBe(
    'revê isto\n\nFicheiros mencionados (lê-os antes de responder): src/lexer.rs\n\n<anexo nome="notas \'v2\'.md">\n- corrigir tokens\n</anexo>',
  );
  expect(buildPrompt("/test", atts)).toBe("/test");
  expect(buildPrompt("olá", [])).toBe("olá");
  expect(formatSize(512)).toBe("512 B");
  expect(formatSize(2048)).toBe("2.0 KB");
  expect(isTextFile("main.rs", "")).toBe(true);
  expect(isTextFile("Dockerfile", "")).toBe(true);
  expect(isTextFile("foto.png", "image/png")).toBe(false);
  expect(exportMarkdown("C", [{ who: "tu", text: "olá " }], "hoje")).toBe("# C\n\n_hoje_\n\n### tu\n\nolá\n");
});

/* ───── DOM do compositor ───── */

function setup() {
  document.body.innerHTML = '<div id="ag-compose"><textarea id="ag-input"></textarea></div>';
  const sent: string[] = [];
  const toasts: string[] = [];
  const state = { running: false, mode: "assist", provider: "claude", model: "claude-opus-5-5", effort: "high" as Effort, ctx: true };
  const host: ComposerHost = {
    send: (q) => sent.push(q),
    stop: () => sent.push("<stop>"),
    running: () => state.running,
    mode: () => state.mode,
    setMode: (m) => (state.mode = m),
    provider: () => state.provider,
    model: () => state.model,
    providers: () => [
      { key: "claude", name: "Claude", model: state.model, on: true },
      { key: "ollama", name: "Ollama", model: "qwen2.5-coder:14b", on: false },
    ],
    selectModel: (p, m) => {
      state.provider = p;
      state.model = m;
    },
    effort: () => state.effort,
    setEffort: (e) => (state.effort = e),
    ctxOn: () => state.ctx,
    toggleCtx: () => (state.ctx = !state.ctx),
    projectFiles: () => ["src/lexer.rs"],
    palette: (_ph, items) => items[0].run(),
    newChat: () => sent.push("<new>"),
    exportConversation: () => sent.push("<export>"),
    toast: (m) => toasts.push(m),
    speech: () => null,
  };
  resetComposer();
  mountComposer(host);
  bindActions(composerActions());
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
  const type = (v: string) => {
    const i = $<HTMLTextAreaElement>("#ag-input");
    i.value = v;
    i.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const enter = (shiftKey = false) =>
    $("#ag-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true }));
  const click = (s: string) => $(s).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  return { host, state, sent, toasts, $, type, enter, click };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

test("barra: modelo + esforço, modo, agentes; Enter envia e Shift+Enter não", () => {
  const t = setup();
  expect(t.$("#cc-model").textContent).toBe("Opus 5.5 Alto");
  expect(t.$("#cc-mode").textContent).toBe("Assistido");
  expect(t.$("#cc-agents .cc-agl").textContent).toBe("0 agentes");
  expect(t.$("#pill-ctx").hidden).toBe(true); // sem ficheiro aberto não há chip de contexto
  expect(t.$("#cc-atts").hidden).toBe(true);
  composerContext("lexer.rs");
  expect(t.$("#cc-atts").hidden).toBe(false);
  t.click("#pill-ctx");
  expect(t.state.ctx).toBe(false);
  composerContext(null);
  expect(t.$("#cc-atts").hidden).toBe(true);
  expect(t.$(".comp-bar")).not.toBeNull(); // o app.ts põe aqui o #pill-agent
  t.type("olá");
  t.enter(true);
  expect(t.sent).toEqual([]);
  t.enter();
  expect(t.sent).toEqual(["olá"]);
  expect(t.$<HTMLTextAreaElement>("#ag-input").value).toBe("");
});

test("a trabalhar: o botão pára, Enter põe na fila e a fila sai no fim da execução", async () => {
  const t = setup();
  t.state.running = true;
  composerRunChanged(true);
  expect(t.$("#cc-send").classList.contains("stop")).toBe(true);
  expect(t.$<HTMLTextAreaElement>("#ag-input").placeholder).toBe("Põe outra mensagem na fila…");
  t.type("e depois os testes");
  t.enter();
  expect(t.sent).toEqual([]);
  expect(t.$("#cc-queue").textContent).toBe("1 na fila");
  t.click("#cc-send");
  expect(t.sent).toEqual(["<stop>"]);
  t.state.running = false;
  composerRunChanged(false);
  await new Promise((r) => setTimeout(r, 0));
  expect(t.sent).toEqual(["<stop>", "e depois os testes"]);
  expect(t.$("#cc-queue").hidden).toBe(true);
});

test("modos: o menu muda o modo de aprovação; Plano envia a próxima mensagem com /plano", () => {
  const t = setup();
  t.click("#cc-mode");
  expect(t.$("#cc-pop").hidden).toBe(false);
  expect(t.$("#cc-pop").textContent).toContain("Explora o código só com leitura");
  t.click('[data-action="cc-mode"][data-on="auto"]');
  expect(t.state.mode).toBe("auto");
  expect(t.$("#cc-pop").hidden).toBe(true);
  // Shift+Tab: auto → manual
  t.$("#ag-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  expect(t.state.mode).toBe("manual");
  t.click("#cc-mode");
  t.click('[data-action="cc-mode"][data-on="plan"]');
  expect(t.$("#cc-mode").textContent).toBe("Plano");
  t.type("paginação na API");
  t.enter();
  expect(t.sent).toEqual(["/plano paginação na API"]);
  expect(t.$("#cc-mode").textContent).toBe("Manual"); // o Plano vale para uma mensagem
});

test("modelo e esforço: escolher no popover; provedor desligado não muda", () => {
  const t = setup();
  t.click("#cc-model");
  expect(t.$("#cc-pop").textContent).toContain("Escolhe um modelo");
  t.click('[data-action="cc-effort"][data-on="max"]');
  expect(t.state.effort).toBe("max");
  expect(t.$("#cc-model").textContent).toBe("Opus 5.5 Máximo");
  t.click('[data-action="cc-model"][data-on="ollama|qwen2.5-coder:14b"]');
  expect(t.state.provider).toBe("claude");
  expect(t.toasts[0]).toContain("desligado");
  t.click('[data-action="cc-model"][data-on="claude|claude-sonnet-5-5"]');
  expect(t.state.model).toBe("claude-sonnet-5-5");
  expect(t.$("#cc-pop").hidden).toBe(true);
});

test("«/» numa caixa vazia abre as acções; filtrar e Enter corre a acção", () => {
  const t = setup();
  t.type("/");
  expect(t.$("#cc-pop").hidden).toBe(false);
  expect(t.$<HTMLTextAreaElement>("#ag-input").value).toBe("");
  const f = t.$<HTMLInputElement>("#cc-filter");
  f.value = "rever";
  f.dispatchEvent(new Event("input", { bubbles: true }));
  expect(t.$("#cc-pop .cc-list").textContent).toContain("Reverter ficheiros");
  f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(t.sent).toEqual(["/reverter"]);
});

test("anexos: mencionar ficheiro do projecto vira chip e entra no pedido; × remove", () => {
  const t = setup();
  t.click("#cc-plus");
  t.click('[data-action="cc-do"][data-on="mention"]');
  expect(t.$("#cc-atts").hidden).toBe(false);
  expect(t.$("#cc-atts").textContent).toContain("lexer.rs");
  t.type("explica");
  t.enter();
  expect(t.sent[0]).toBe("explica\n\nFicheiros mencionados (lê-os antes de responder): src/lexer.rs");
  expect(_composerState().attachments).toHaveLength(0);
  t.click("#cc-plus");
  t.click('[data-action="cc-do"][data-on="mention"]');
  t.click('[data-action="cc-unattach"]');
  expect(t.$("#cc-atts").hidden).toBe(true);
});

test("sub-agentes: o chip conta os que correm e o mapa lista-os; microfone sem motor avisa", () => {
  const t = setup();
  trackSubagent("tu1", "Mapear o lexer", "running");
  trackSubagent("tu2", "Ver os testes", "running");
  expect(t.$("#cc-agents .cc-agl").textContent).toBe("2 agentes");
  trackSubagent("tu1", "", "done");
  expect(t.$("#cc-agents .cc-agl").textContent).toBe("1 agente");
  t.click("#cc-agents");
  expect(t.$("#cc-pop").textContent).toContain("Mapa de agentes");
  expect(t.$("#cc-pop").textContent).toContain("Mapear o lexer");
  expect(t.$("#cc-pop").textContent).toContain("concluído");
  // clicar fora fecha
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  expect(t.$("#cc-pop").hidden).toBe(true);
  t.click("#cc-mic");
  expect(t.toasts.at(-1)).toContain("Ditado indisponível");
  resetComposer();
  expect(t.$("#cc-agents .cc-agl").textContent).toBe("0 agentes");
});

