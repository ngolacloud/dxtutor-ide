// O mapa de agentes do Co-Dev: o domínio (redutor dos eventos de todas as sessões, formatos),
// o caso de uso (a loja que ouve o gateway) e o modal em jsdom (cartões, detalhe, Esc).
import { test, expect, beforeEach } from "vitest";
import {
  buildMapView,
  emptyMap,
  findCard,
  formatElapsed,
  formatTokens,
  listedAgents,
  mergeLive,
  parseLiveSessions,
  parseSubagentEvent,
  reduceAgentEvent,
  sessionFailed,
  sessionUsage,
  subagentSummary,
  totalTokens,
  turnStarted,
  workingAgents,
  type AgentMap,
} from "../src/features/codev/domain/agent-map";
import type { AgentEvent, Usage } from "../src/features/codev/domain/agent-events";
import { makeAgentMapStore } from "../src/features/codev/application/agent-map";
import type { AgentMapGateway } from "../src/features/codev/application/ports";
import { makeAgentMapView } from "../src/features/codev/ui/agent-map-view";
import { bindActions } from "../src/features/codev/ui/actions";

const U = (i: number, o: number, cr = 0, cw = 0): Usage => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: cw });
const ev = (m: AgentMap, s: string, e: AgentEvent, now: number) => reduceAgentEvent(m, s, e, now);
const sub = (m: AgentMap, s: string, raw: unknown, now: number) => reduceAgentEvent(m, s, null, now, parseSubagentEvent(raw));
const task = (id: string, description: string, extra: Record<string, unknown> = {}): AgentEvent => ({
  kind: "tool_start",
  id,
  name: "task",
  input: { description, prompt: `Investiga ${description}.`, ...extra },
});

/* ───── domínio ───── */

test("formatos: tempo «10m 16s» e tokens «270.5k»", () => {
  expect(formatElapsed(0)).toBe("0s");
  expect(formatElapsed(42_900)).toBe("42s");
  expect(formatElapsed(616_000)).toBe("10m 16s");
  expect(formatElapsed(3_725_000)).toBe("1h 02m");
  expect(formatTokens(950)).toBe("950");
  expect(formatTokens(12_345)).toBe("12.3k");
  expect(formatTokens(270_549)).toBe("270.5k");
  expect(formatTokens(1_250_000)).toBe("1.2M");
  expect(totalTokens(U(100, 20, 300, 4))).toBe(424);
});

test("o progresso de um sub-agente: forma do backend estreitada, o resto ignorado", () => {
  expect(parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "started", role: "tester" } })).toEqual({ call: "t1", step: { type: "started", role: "tester" } });
  expect(parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "usage", turn: { input_tokens: 5, output_tokens: 2 } } })?.step).toEqual({ type: "usage", turn: U(5, 2) });
  expect(parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "tool_start", name: "grep" } })).toBeNull();
  expect(parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "warp" } })).toBeNull();
  expect(parseSubagentEvent({ kind: "tool_start", id: "x", name: "read" })).toBeNull();
  expect(subagentSummary("em lexer.rs:1.\n\n[sub-agente: 4 mensagens, 14 tokens de entrada, 6 de saída]")).toBe("em lexer.rs:1.");
  expect(parseLiveSessions([{ id: "a", model: "m", issue: "DX-1", busy: true, opened: 5 }, { nope: 1 }, "x"])).toEqual([
    { id: "a", root: "", model: "m", issue: "DX-1", busy: true, opened: 5 },
  ]);
});

test("redutor: a sessão da conversa e os seus sub-agentes, do arranque ao fim do turno", () => {
  let m = turnStarted(emptyMap(), "s1", 1000, { request: "onde está o lexer?", model: "claude-opus-5-5", issue: null });
  m = ev(m, "s1", task("t1", "Mapear o lexer"), 2000);
  m = ev(m, "s1", task("t2", "Ver os testes", { role: "tester" }), 2100);
  m = sub(m, "s1", { kind: "subagent", call: "t1", step: { type: "started", role: "explorer" } }, 2200);
  m = sub(m, "s1", { kind: "subagent", call: "t1", step: { type: "tool_start", id: "g1", name: "grep", input: { pattern: "fn lex" } } }, 2300);
  m = sub(m, "s1", { kind: "subagent", call: "t1", step: { type: "tool_result", id: "g1", name: "grep", is_error: false } }, 2400);
  m = sub(m, "s1", { kind: "subagent", call: "t1", step: { type: "usage", turn: { input_tokens: 200_000, output_tokens: 70_500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }, 2500);
  m = ev(m, "s1", { kind: "usage", request: U(10, 2), turn: U(1000, 200, 500) }, 2600);
  expect(workingAgents(m, "s1")).toBe(2);
  expect(listedAgents(m, "s1")).toBe(2);

  const v = buildMapView(m, "s1", 618_000, "Co-Dev");
  expect(v.root).toMatchObject({ key: "s:s1", label: "Co-Dev", status: "running", tokens: 1700 });
  expect(v.cards.map((c) => [c.label, c.status, c.depth])).toEqual([
    ["Mapear o lexer", "running", 0],
    ["Ver os testes", "running", 0],
  ]);
  expect(formatElapsed(v.cards[0].elapsedMs)).toBe("10m 16s");
  expect(formatTokens(v.cards[0].tokens)).toBe("270.5k");
  const t1 = findCard(m, "a:s1:t1")!.agent!;
  expect(t1.tools).toEqual([{ id: "g1", name: "grep", label: "/fn lex/", status: "ok" }]);
  expect(t1.prompt).toBe("Investiga Mapear o lexer.");
  expect(findCard(m, "a:s1:t2")!.agent!.role).toBe("tester");

  // t1 devolve o relatório; o turno acaba com t2 ainda sem resultado (cancelado com o turno)
  m = ev(m, "s1", { kind: "tool_result", id: "t1", name: "task", is_error: false, content: "em lexer.rs:1.\n\n[sub-agente: 4 mensagens, 1 tokens de entrada, 1 de saída]" }, 3000);
  m = ev(m, "s1", { kind: "stream", event: { type: "text_delta", index: 0, text: "Está em lexer.rs." } }, 3100);
  m = ev(m, "s1", { kind: "done", outcome: { type: "cancelled" } }, 4000);
  const s1 = m.sessions[0];
  expect(s1.status).toBe("done");
  expect(s1.outcome).toBe("cancelled");
  expect(s1.lastText).toBe("Está em lexer.rs.");
  expect(s1.agents.map((a) => [a.id, a.status, a.summary])).toEqual([
    ["t1", "done", "em lexer.rs:1."],
    ["t2", "failed", ""],
  ]);
  expect(workingAgents(m, "s1")).toBe(0);
  // um aviso do anfitrião depois do fim não abre um turno nem esquece os sub-agentes
  m = ev(m, "s1", { kind: "notice", text: "hooks: ok" }, 4100);
  expect(m.sessions[0].status).toBe("done");
  expect(m.sessions[0].agents).toHaveLength(2);
  // ficam no mapa até ao turno seguinte da sessão; aí saem, e o uso do turno passa a acumulado
  m = turnStarted(m, "s1", 5000, { request: "e o parser?", model: "claude-opus-5-5", issue: null });
  expect(m.sessions[0].agents).toEqual([]);
  expect(sessionUsage(m.sessions[0])).toEqual(U(1000, 200, 500));
});

test("várias sessões (uma sprint): cada Co-Dev é um agente, com os sub-agentes por baixo", () => {
  let m = turnStarted(emptyMap(), "chat", 0, { request: "olá", model: "m", issue: null });
  // uma sessão que a conversa não conhece começa a trabalhar (eventos de outra sessão)
  m = ev(m, "dx12", { kind: "stream", event: { type: "message_start", model: "claude-sonnet-5-5" } }, 1000);
  m = ev(m, "dx12", task("t9", "Rever o diff"), 1100);
  m = mergeLive(m, [
    { id: "chat", root: "/p", model: "m", issue: null, busy: false, opened: 0 },
    { id: "dx12", root: "/p", model: "claude-sonnet-5-5", issue: "DX-12", busy: true, opened: 900 },
    { id: "dx13", root: "/p", model: "claude-sonnet-5-5", issue: "DX-13", busy: true, opened: 950 },
  ], 2000);
  const v = buildMapView(m, "chat", 3000, "Co-Dev");
  expect(v.cards.map((c) => [c.key, c.label, c.depth])).toEqual([
    ["s:dx12", "Co-Dev · DX-12", 0],
    ["a:dx12:t9", "Rever o diff", 1],
    ["s:dx13", "Co-Dev · DX-13", 0],
  ]);
  // as duas sessões a correr e o sub-agente; a da conversa é a raiz e não conta
  expect(v.working).toBe(3);
  m = sessionFailed(m, "dx13", 4000, "rede em baixo");
  expect(m.sessions.find((s) => s.id === "dx13")).toMatchObject({ status: "failed", outcome: "rede em baixo" });
  // a lista seguinte já não tem a dx13 (fechada): sai do mapa
  m = mergeLive(m, [{ id: "chat", root: "/p", model: "m", issue: null, busy: false, opened: 0 }, { id: "dx12", root: "/p", model: "m", issue: "DX-12", busy: true, opened: 900 }], 5000);
  expect(m.sessions.map((s) => s.id)).toEqual(["chat", "dx12"]);
});

/* ───── caso de uso ───── */

type H = Parameters<AgentMapGateway["subscribe"]>[0];
function fakeGateway(live: unknown[] = []) {
  const g = { h: null as H | null, live, subscribed: 0 };
  const gateway: AgentMapGateway = {
    available: () => true,
    subscribe: async (h) => {
      g.h = h;
      g.subscribed++;
      return () => {
        g.h = null;
      };
    },
    live: async () => parseLiveSessions(g.live),
  };
  return { g, gateway };
}

test("a loja ouve todas as sessões, avisa quem a segue e esquece a sessão fechada", async () => {
  const { g, gateway } = fakeGateway();
  let now = 0;
  let primary: string | null = null;
  const store = makeAgentMapStore({ gateway, primary: () => primary, now: () => now });
  await Promise.all([store.start(), store.start()]);
  expect(g.subscribed).toBe(1);
  let changes = 0;
  const off = store.onChange(() => changes++);
  primary = "s1";
  store.sink.turn("s1", { request: "olá", model: "claude-opus-5-5", issue: null });
  now = 50;
  g.h!.event("s1", task("t1", "Mapear"), null);
  g.h!.event("s1", null, parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "started", role: "explorer" } }));
  expect(store.working()).toBe(1);
  expect(changes).toBe(3);
  g.h!.error("s1", "falhou");
  expect(store.working()).toBe(0);
  g.live = [{ id: "s1", model: "m", busy: false, opened: 1 }, { id: "s2", model: "m", issue: "DX-2", busy: true, opened: 2 }];
  await store.refresh();
  expect(store.view("Co-Dev").cards.map((c) => c.label)).toEqual(["Mapear", "Co-Dev · DX-2"]);
  store.sink.closed("s1");
  expect(store.snapshot().sessions.map((s) => s.id)).toEqual(["s2"]);
  off();
  store.stop();
  expect(g.h).toBeNull();
});

test("no browser (sem backend) a loja não subscreve e fica vazia", async () => {
  const store = makeAgentMapStore({
    gateway: { available: () => false, subscribe: () => Promise.reject(new Error("não")), live: () => Promise.reject(new Error("não")) },
    primary: () => null,
    now: () => 0,
  });
  await store.start();
  await store.refresh();
  expect(store.working()).toBe(0);
  expect(store.view("Co-Dev").cards).toEqual([]);
});

/* ───── o modal ───── */

beforeEach(() => {
  document.body.innerHTML = "";
});

test("o modal: a raiz ligada aos agentes, o detalhe de um agente, Esc fecha", async () => {
  const { g, gateway } = fakeGateway([{ id: "s1", model: "claude-opus-5-5", busy: true, opened: 0 }]);
  let now = 0;
  const store = makeAgentMapStore({ gateway, primary: () => "s1", now: () => now });
  await store.start();
  store.sink.turn("s1", { request: "onde está o lexer?", model: "claude-opus-5-5", issue: null });
  g.h!.event("s1", task("t1", "Co-Dev tokens phase 1"), null);
  g.h!.event("s1", null, parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "tool_start", id: "r1", name: "read", input: { path: "src/lexer.rs" } } }));
  g.h!.event("s1", null, parseSubagentEvent({ kind: "subagent", call: "t1", step: { type: "usage", turn: { input_tokens: 200_000, output_tokens: 70_500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
  now = 616_000;
  let ticks = 0;
  let chat = 0;
  const view = makeAgentMapView(store, {
    base: () => "Co-Dev",
    showInChat: () => chat++,
    openRun: () => undefined,
    now: () => now,
    every: () => {
      ticks++;
      return () => ticks--;
    },
  });
  bindActions(view.actions());
  view.open();
  const $ = (q: string) => document.querySelector<HTMLElement>(q);
  expect($("#agent-map")).not.toBeNull();
  expect($(".agmap-sub-h")!.textContent).toBe("1 agent · click an agent for details · 1 working");
  expect($(".agmap-rootcol .agmap-card")!.textContent).toContain("Co-Dev");
  const card = $('.agmap-col [data-on="a:s1:t1"]')!;
  expect(card.textContent).toBe("Co-Dev tokens phase 1" + "10m 16s · 270.5k tokens");
  expect(card.querySelector(".cc-dot")!.classList.contains("live")).toBe(true);
  expect(ticks).toBe(1);

  card.click();
  const d = $(".agmap-detail")!;
  expect(d.classList.contains("on")).toBe(true);
  expect(d.textContent).toContain("Investiga Co-Dev tokens phase 1.");
  expect(d.textContent).toContain("src/lexer.rs");
  expect(d.textContent).toContain("$2.21"); // 200k × $4/M + 70.5k × $20/M (Opus 5.5)
  // um evento novo redesenha o modal aberto (o detalhe fica)
  g.h!.event("s1", { kind: "tool_result", id: "t1", name: "task", is_error: true, content: "o sub-agente falhou: rede" }, null);
  expect($('.agmap-col [data-on="a:s1:t1"] .cc-dot')!.classList.contains("error")).toBe(true);
  expect($(".agmap-detail")!.textContent).toContain("o sub-agente falhou: rede");

  $('[data-action="agmap-chat"]')!.click();
  expect(chat).toBe(1);
  expect($("#agent-map")).toBeNull();
  expect(ticks).toBe(0);

  view.open();
  // um clique dentro do modal (fora dos botões) não fecha; no fundo escuro fecha
  $(".agmap-ht")!.click();
  expect(view.isOpen()).toBe(true);
  $("#agent-map")!.click();
  expect(view.isOpen()).toBe(false);

  view.open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(view.isOpen()).toBe(false);
  // fechado, o Esc já não é do mapa
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("o modal sem agentes explica o que vai aparecer", () => {
  const store = makeAgentMapStore({ gateway: { available: () => false, subscribe: () => Promise.reject(new Error()), live: () => Promise.resolve([]) }, primary: () => null, now: () => 0 });
  const view = makeAgentMapView(store, { base: () => "Co-Dev", showInChat: () => undefined, openRun: () => undefined, now: () => 0, every: () => () => undefined });
  view.open();
  expect(document.querySelector(".agmap-sub-h")!.textContent).toBe("No agents yet");
  expect(document.querySelector(".agmap-empty")!.textContent).toContain("sub-agents");
  expect(document.querySelector(".agmap-rootcol")!.textContent).toContain("Co-Dev");
  view.close();
});
