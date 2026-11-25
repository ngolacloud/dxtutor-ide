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
import { tauriRunners, tauriTests } from "./infrastructure/tauri";
import * as L from "./infrastructure/legacy-bridge";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { RUNS_MESSAGES } from "./application/messages";

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

const ACTIONS: ActionTable = {
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
export { renderTestPane };
