/* ═════════ feature `testing` — raiz de composição (ADR-0006, R2a) ═════════
   O pane «Testing» e o `#st-tests` da barra de estado sobre os comandos reais do backend:
   descobre os testes Rust/Go/Python da pasta aberta (`list_tests`), corre um (`run_test`)
   ou a suíte (`run_all_tests`) e mostra o estado real de cada teste e a saída; o comando de
   testes detectado no projecto (p.ex. `npm test`) corre num terminal de tarefa.

   A6 (docs/v2/UI-AUDIT.md item 3): por cima, os runners que o projecto tem de facto
   (`test_runners`), as corridas com resultado por teste (`test_run`: todos, um, afectados,
   «Watch» a cada gravação), o histórico guardado em SQLite (`test_history`) e os pedidos ao
   Co-Dev (`codev.ask`); os resultados dos runners acendem a lista descoberta.

   Substitui `features/test.ts` (que só mostrava o comando detectado). No browser não há
   pasta: o pane diz como abrir uma e nada chama o backend. Liga as portas (Tauri + legado)
   ao serviço e à vista; o `window` só é tocado através do `legacy-bridge`. */

import { $ } from "../../core";
import { RP } from "../../app/store/registry";
import { countStates, statusBarText, testKey } from "./domain/results";
import { statesFromReport } from "./domain/runs";
import { makeTesting } from "./application/testing-service";
import { makeRuns } from "./application/runs-service";
import { renderTesting } from "./ui/testing-view";
import { renderRuns } from "./ui/runs-view";
import { bindActions, type ActionTable } from "./ui/actions";
import { tauriRunners, tauriTests, tauriResults } from "./infrastructure/tauri";
import * as L from "./infrastructure/legacy-bridge";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { RUNS_MESSAGES } from "./application/messages";
import { makeLiveRunner, type LiveResult } from "./application/live-runner";
import { findTestDef } from "./domain/live";
import { renderLive, fmtElapsed, type LiveUi } from "./ui/live-view";
import { LIVE_MESSAGES } from "./ui/live-messages";
import { isDesktop } from "../../platform/tauri/core";
import { services } from "../../app/services";

const workspace = { root: L.root, save: L.save, currentFile: L.currentFile };
/* as duas corridas excluem-se: o cargo/go/python não gostam de corridas sobrepostas na mesma pasta */
const testing = makeTesting({ tests: tauriTests(), workspace, busy: () => runs.busy() });
const runs = makeRuns({
  copy: translator(RUNS_MESSAGES),
  runners: tauriRunners(),
  workspace,
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  busy: () => testing.state().running || testing.state().loading,
  onReport: (rep) => testing.mark(statesFromReport(testing.state().items, rep)),
  results: tauriResults(),
});

/** Renderiza o pane «Testing» (e dispara a descoberta na primeira vez para a pasta aberta). */
function renderTestPane(): void {
  const el = $("#pane-test");
  if (!el) return;
  const open = !!L.root();
  if (open) testing.ensure();
  /* os runners carregam depois da descoberta (que é o que o pane mostra primeiro) */
  if (open && testing.state().loaded) runs.ensure();
  const extra = open ? renderRuns({ state: runs.state(), canAsk: codevAsk.available(), now: Date.now() }) : "";
  el.innerHTML = renderTesting({ open, state: testing.state(), projectCmd: open ? L.projectTestCmd() : null, ...(extra ? { runs: extra } : {}) });
}

/** O `#st-tests`: vazio sem resultados; contagens reais depois de correr. */
function drawStatus(): void {
  const s = $("#st-tests");
  if (!s) return;
  const st = testing.state(), open = !!L.root() && st.root === L.root();
  const c = countStates(st.items, st.states), text = open ? statusBarText(c, st.running) : "";
  s.textContent = text;
  s.style.color = !text ? "" : st.running ? "var(--accent-hover)" : c.failed ? "var(--red)" : "var(--green)";
  s.title = text ? `Testes: ${c.passed} passaram${c.failed ? `, ${c.failed} falharam` : ""} (de ${c.total})` : "Testes";
}

testing.subscribe(() => {
  drawStatus();
  if (L.activePane() === "test") renderTestPane();
});
runs.subscribe(() => {
  if (L.activePane() === "test") renderTestPane();
});
/* «Watch»: o desktop avisa cada gravação no disco, com os ficheiros (relativos à pasta) */
document.addEventListener("dx:saved", (e) => {
  const files = (e as CustomEvent<{ files?: unknown }>).detail?.files;
  if (Array.isArray(files)) runs.saved(files.filter((f): f is string => typeof f === "string"));
});
/* outra pasta aberta: os resultados eram da anterior */
document.addEventListener("dx:workspace", () => {
  drawStatus();
  if (L.activePane() === "test") renderTestPane();
});

/* ───── o separador «Tests» do painel inferior: a corrida ao vivo ─────
   O separador nasce na primeira corrida (só no desktop; os goldens e o browser não o vêem). A vista
   redesenha por `requestAnimationFrame` (uma suite manda centenas de linhas) e o tempo avança de
   meio em meio segundo enquanto corre. Quem quer correr os testes chama `runLive` (registado em
   `services.tests`): o «Accept & test» do Code review, a paleta. */
const lt = translator(LIVE_MESSAGES);
const LIVE_UI: LiveUi = { filter: "all", log: false };
const live = makeLiveRunner({
  proc: { run: (c, o) => L.streamCmd(c, o), kill: (id) => L.killCmd(id) },
  root: L.root,
  testCommand: L.projectTestCmd,
  save: L.save,
  reveal: () => { ensureTab(); L.setPanelTab("tests"); },
  render: () => scheduleLive(),
});

function ensureTab(): HTMLElement | null {
  let pc = document.getElementById("pc-tests");
  if (pc) return pc;
  const tools = document.querySelector(".panel-tabs .panel-tools"), body = document.querySelector(".panel-body");
  if (!tools || !body) return null;
  const b = document.createElement("button");
  b.className = "ptab";
  b.dataset.pt = "tests";
  b.innerHTML = `${lt("tab")} <span class="pb tl-badge" id="pb-tests"></span>`;
  b.addEventListener("click", () => L.setPanelTab("tests"));
  tools.insertAdjacentElement("beforebegin", b);
  pc = document.createElement("div");
  pc.className = "pcontent";
  pc.id = "pc-tests";
  body.appendChild(pc);
  return pc;
}

let liveRaf = 0;
let wasRunning = false;
let liveTimer: ReturnType<typeof setInterval> | null = null;
function scheduleLive(): void {
  /* acabada: desenha já (e desliga o relógio) — nada fica agendado depois da corrida */
  if (!live.running()) {
    if (liveRaf) { if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(liveRaf); clearTimeout(liveRaf); liveRaf = 0; }
    drawLive();
    return;
  }
  if (liveRaf) return;
  const run = () => { liveRaf = 0; drawLive(); };
  liveRaf = typeof requestAnimationFrame === "function" ? (requestAnimationFrame(run) as unknown as number) : (setTimeout(run, 0) as unknown as number);
}
function elapsed(): number {
  const r = live.state();
  return r ? (r.endedAt ?? Date.now()) - r.startedAt : 0;
}
function drawLive(): void {
  const pc = ensureTab();
  if (!pc) return;
  const list = pc.querySelector<HTMLElement>("[data-live-list],[data-live-log]");
  const atEnd = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 30, top = list?.scrollTop ?? 0;
  pc.innerHTML = renderLive(live.state(), LIVE_UI, lt, elapsed());
  const nl = pc.querySelector<HTMLElement>("[data-live-list],[data-live-log]");
  if (nl) nl.scrollTop = live.running() && atEnd ? nl.scrollHeight : top;
  /* acabou agora com falhas: a lista salta para a primeira (a causa costuma estar lá) */
  const justEnded = wasRunning && !live.running();
  wasRunning = live.running();
  const firstFail = justEnded && nl ? nl.querySelector<HTMLElement>(".tl-row.fail") : null;
  if (nl && firstFail) nl.scrollTop = Math.max(0, firstFail.offsetTop - nl.offsetTop - 6);
  const badge = document.getElementById("pb-tests"), r = live.state();
  if (badge && r) {
    const fail = r.cases.filter((c) => c.status === "fail").length;
    badge.textContent = live.running() ? "…" : fail ? String(fail) : r.phase === "passed" ? "✓" : "";
    badge.className = `pb tl-badge ${live.running() ? "run" : fail || r.phase === "failed" ? "bad" : r.phase === "passed" ? "ok" : ""}`;
  }
  if (live.running() && !liveTimer) liveTimer = setInterval(() => {
    if (typeof document === "undefined" || !live.running()) { if (liveTimer) clearInterval(liveTimer); liveTimer = null; return; }
    const el = document.querySelector("#pc-tests [data-live-time]");
    if (el) el.textContent = fmtElapsed(elapsed());
  }, 500);
  if (!live.running() && liveTimer) { clearInterval(liveTimer); liveTimer = null; }
}

/** Corre a suite do projecto no separador «Tests» e devolve o resultado (a forma do `run_tests`). */
function runLive(o: { source: string; command?: string } = { source: "Tests" }): Promise<LiveResult> {
  return live.start(o);
}
if (isDesktop()) {
  services.tests = { runLive };
  /* a paleta só existe depois do arranque: regista-se na primeira oportunidade */
  setTimeout(() => L.addPaletteCommand("Tests: Run All (live)", "", () => { void runLive({ source: "Tests" }); }), 0);
}

/** Abre o teste `i` da corrida: o sítio da falha, senão onde o teste está definido. */
function openLiveCase(i: number): void {
  const c = live.state()?.cases[i];
  if (!c) return;
  const key = c.spot ? L.keyOf(c.spot.file) : null;
  if (key && c.spot) { L.openKey(key, c.spot.line); return; }
  const def = findTestDef(L.workspaceFiles(), c.name);
  if (def) L.openKey(def.key, def.line);
}

const ACTIONS: ActionTable = {
  "live:open": { on: "click", run: (e) => openLiveCase(+e.on) },
  "live:stop": { on: "click", run: () => { void live.stop(); } },
  "live:rerun": { on: "click", run: () => { void live.rerun(); } },
  "live:filter": { on: "click", run: (e) => { LIVE_UI.filter = e.on === "failed" ? "failed" : "all"; drawLive(); } },
  "live:log": { on: "click", run: () => { LIVE_UI.log = !LIVE_UI.log; drawLive(); } },
  refresh: { on: "click", run: () => { void testing.refresh().then(() => runs.reload()); } },
  "run-all": { on: "click", run: () => { void testing.runAll(); } },
  /* A6 */
  "runner-all": { on: "click", run: (e) => { void runs.run(e.on, { kind: "all" }); } },
  "runner-changed": { on: "click", run: (e) => { void runs.run(e.on, { kind: "changed", files: [] }); } },
  "case-select": { on: "click", run: (e) => runs.select(e.on) },
  "case-open": { on: "click", run: (e) => L.openFile(e.on, 1) },
  "case-run": { on: "click", run: (e) => { void runs.runCase(e.on); } },
  "ask-failure": { on: "click", run: (e) => { const i = e.on.indexOf("|"); runs.askFailure(e.on.slice(0, i) === "fix" ? "fix" : "explain", e.on.slice(i + 1)); } },
  "ask-flaky": { on: "click", run: (e) => runs.askFlaky(e.on) },
  "write-test": { on: "click", run: () => runs.writeMissingTest() },
  watch: { on: "change", run: (e) => runs.setWatch((e.el as HTMLInputElement).checked) },
  "run-test": { on: "click", run: (e) => { void testing.runOne(e.on); } },
  "open-test": {
    on: "click",
    run: (e) => {
      const t = testing.state().items.find((x) => testKey(x) === e.on);
      if (t) L.openFile(t.file, t.line);
    },
  },
  "run-project-cmd": { on: "click", run: () => { const c = L.projectTestCmd(); if (c) L.runTask(c); } },
};
bindActions(ACTIONS);

/* a feature regista o seu pane (ADR-0004, U4j2) */
RP.test = renderTestPane;
/* o auto-teste importa-o (ADR-0004, U7p6 — era publicado no window) */
export { renderTestPane, runLive };
