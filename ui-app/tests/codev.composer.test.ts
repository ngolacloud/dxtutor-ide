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
  effectiveModel,
  nextMode,
  parseEffort,
  SLASH_ACTIONS,
  type Effort,
} from "../src/features/codev/domain/composer";
import { bindActions } from "../src/features/codev/ui/actions";
import type { DictationPort } from "../src/features/codev/application/ports";
import {
  _composerState,
  composerActions,
  composerContext,
  composerRunChanged,
  refreshComposer,
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
  expect(effectiveModel("gpt-codex")).toBe("gpt-4.1"); // nomes de exemplo do protótipo
  expect(effectiveModel("gemini-pro")).toBe("gemini-2.5-flash");
  expect(effectiveModel("qwen3")).toBe("qwen3");
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
  const dictLang = { v: "pt" };
  const dict = { ready: true, recording: false, text: "olá mundo", calls: [] as string[] };
  const dictation: DictationPort = {
    available: () => true,
    status: async () => ({ ready: dict.ready, binary: "/b/whisper-cli", model: "/m/ggml-small.bin", recorder: "pw-record", missing: dict.ready ? [] : ["whisper.cpp (whisper-cli) — corre scripts/setup-whisper.sh"], recording: dict.recording, device: 1 }),
    start: async () => {
      dict.calls.push("start");
      dict.recording = true;
    },
    stop: async (lang) => {
      dict.calls.push("stop:" + lang);
      dict.recording = false;
      return dict.text;
    },
    cancel: async () => {
      dict.calls.push("cancel");
      dict.recording = false;
    },
  };
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
      { key: "claude", name: "Claude", model: state.provider === "claude" ? state.model : "claude-opus-5-5", on: true },
      { key: "gemini", name: "Gemini", model: "gemini-pro", on: true },
      { key: "ollama", name: "Ollama", model: state.provider === "ollama" ? state.model : "qwen2.5-coder:14b", on: true },
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
    pickPersona: () => sent.push("<persona>"),
    refreshPersona: () => undefined,
    openModelSettings: () => sent.push("<settings>"),
    switchProvider: () => sent.push("<providers>"),
    dictation: () => dictation,
    dictationLang: () => dictLang.v,
    setDictationLang: (l) => (dictLang.v = l),
    localModels: async () => ["llama3.1:8b", "qwen2.5-coder:14b"],
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
  return { host, state, sent, toasts, dict, dictLang, $, type, enter, click };
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
  expect(t.$("#cc-pop").textContent).toContain("Modelos Claude");
  t.click('[data-action="cc-effort"][data-on="max"]');
  expect(t.state.effort).toBe("max");
  expect(t.$("#cc-model").textContent).toBe("Opus 5.5 Máximo");
  // perfil Claude: só os modelos do Claude; os outros provedores ficam numa entrada à parte
  expect(document.querySelector('[data-on="ollama|qwen2.5-coder:14b"]')).toBeNull();
  t.click('[data-action="cc-model"][data-on="claude|claude-sonnet-5-5"]');
  expect(t.state.model).toBe("claude-sonnet-5-5");
  expect(t.$("#cc-pop").hidden).toBe(true);
  t.click("#cc-model");
  t.click('[data-action="cc-do"][data-on="providers"]');
  expect(t.sent).toContain("<providers>");
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
  resetComposer();
  expect(t.$("#cc-agents .cc-agl").textContent).toBe("0 agentes");
});


/* ───── o chat do Claude é o padrão para todos os provedores ───── */

const flush = () => new Promise((r) => setTimeout(r, 0));

test("trocar de provedor mantém a disposição; a lista só tem os modelos desse provedor", () => {
  const t = setup();
  t.type("rever o lexer");
  t.state.provider = "gemini";
  t.state.model = "gemini-pro"; // nome de exemplo do protótipo → o modelo por omissão
  refreshComposer();
  expect(t.$<HTMLTextAreaElement>("#ag-input").value).toBe("rever o lexer");
  for (const id of ["#cc-plus", "#cc-slash", "#cc-agents", "#cc-mode", "#pill-agent"]) expect(t.$(id)).not.toBeNull();
  expect(t.$("#cc-model").textContent).toBe("Gemini 2.5 Flash"); // sem esforço: só o Claude o usa
  t.click("#cc-model");
  const pop = t.$("#cc-pop").textContent!;
  expect(pop).toContain("Modelos Gemini");
  expect(pop).toContain("Gemini 2.5 Pro");
  expect(pop).not.toContain("Opus");
  expect(pop).not.toContain("GPT-4.1");
  expect(pop).not.toContain("Esforço");
  t.click('[data-action="cc-do"][data-on="settings"]');
  expect(t.sent).toContain("<settings>");
});

test("Ollama: a lista são os modelos instalados no servidor local", async () => {
  const t = setup();
  t.state.provider = "ollama";
  t.state.model = "qwen2.5-coder:14b";
  refreshComposer();
  t.click("#cc-model");
  await flush();
  const pop = t.$("#cc-pop").textContent!;
  expect(pop).toContain("llama3.1:8b");
  expect(pop).toContain("Instalado no Ollama");
  t.click('[data-action="cc-model"][data-on="ollama|llama3.1:8b"]');
  expect(t.state.model).toBe("llama3.1:8b");
});

test("microfone (whisper.cpp): grava, pára, transcreve para o cursor; Esc cancela; por configurar avisa", async () => {
  const t = setup();
  t.type("explica");
  t.click("#cc-mic");
  await flush();
  expect(t.dict.calls).toEqual(["start"]);
  expect(t.$("#cc-mic").classList.contains("rec")).toBe(true);
  expect(t.$<HTMLTextAreaElement>("#ag-input").placeholder).toBe("A ouvir… clica no microfone para terminar");
  t.click("#cc-mic");
  await flush();
  await flush();
  expect(t.dict.calls).toEqual(["start", "stop:pt"]);
  expect(t.$<HTMLTextAreaElement>("#ag-input").value).toBe("explica olá mundo");
  expect(t.$("#cc-mic").classList.contains("rec")).toBe(false);
  // Esc durante a gravação deita fora
  t.click("#cc-mic");
  await flush();
  t.$("#ag-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(t.dict.calls.at(-1)).toBe("cancel");
  expect(t.$("#cc-mic").classList.contains("rec")).toBe(false);
  // transcrição vazia → aviso
  t.dict.text = "";
  t.click("#cc-mic");
  await flush();
  t.click("#cc-mic");
  await flush();
  await flush();
  expect(t.toasts.at(-1)).toContain("Não percebi nada");
  // sem whisper/modelo: diz o que falta e não grava
  t.dict.ready = false;
  const n = t.dict.calls.length;
  t.click("#cc-mic");
  await flush();
  expect(t.toasts.at(-1)).toContain("setup-whisper.sh");
  expect(t.dict.calls.length).toBe(n);
});

test("língua do ditado: português por omissão, escolhida no «/», vai ao whisper", async () => {
  const t = setup();
  expect(t.$("#cc-mic").title).toBe("Ditar (voz) — Português");
  t.type("/");
  expect(t.$("#cc-pop .cc-list").textContent).toContain("Língua do ditado…Português");
  t.click('[data-action="cc-do"][data-on="dictlang"]'); // a palette falsa escolhe a 1.ª (Português)
  t.dictLang.v = "en";
  refreshComposer();
  expect(t.$("#cc-mic").title).toBe("Ditar (voz) — English");
  t.click("#cc-mic");
  await flush();
  t.click("#cc-mic");
  await flush();
  await flush();
  expect(t.dict.calls.at(-1)).toBe("stop:en");
});

test("RF-G07: Esc na caixa pára o Co-Dev a correr; parado, não faz nada", () => {
  const t = setup();
  const esc = () => t.$("#ag-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  esc();
  expect(t.sent).toEqual([]);
  t.state.running = true;
  esc();
  expect(t.sent).toEqual(["<stop>"]);
});
