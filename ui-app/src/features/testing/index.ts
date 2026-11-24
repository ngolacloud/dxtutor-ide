/* ═════════ feature `testing` — raiz de composição (ADR-0006, R2a) ═════════
   O pane «Testing» e o `#st-tests` da barra de estado sobre os comandos reais do backend:
   descobre os testes Rust/Go/Python da pasta aberta (`list_tests`), corre um (`run_test`)
   ou a suíte (`run_all_tests`) e mostra o estado real de cada teste e a saída; o comando de
   testes detectado no projecto (p.ex. `npm test`) corre num terminal de tarefa.

   Substitui `features/test.ts` (que só mostrava o comando detectado). No browser não há
   pasta: o pane diz como abrir uma e nada chama o backend. Liga as portas (Tauri + legado)
   ao serviço e à vista; o `window` só é tocado através do `legacy-bridge`. */

import { $ } from "../../core";
import { RP } from "../../app/store/registry";
import { countStates, statusBarText, testKey } from "./domain/results";
import { makeTesting } from "./application/testing-service";
import { renderTesting } from "./ui/testing-view";
import { bindActions, type ActionTable } from "./ui/actions";
import { tauriTests } from "./infrastructure/tauri";
import * as L from "./infrastructure/legacy-bridge";

const testing = makeTesting({ tests: tauriTests(), workspace: { root: L.root, save: L.save } });

/** Renderiza o pane «Testing» (e dispara a descoberta na primeira vez para a pasta aberta). */
function renderTestPane(): void {
  const el = $("#pane-test");
  if (!el) return;
  const open = !!L.root();
  if (open) testing.ensure();
  el.innerHTML = renderTesting({ open, state: testing.state(), projectCmd: open ? L.projectTestCmd() : null });
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
/* outra pasta aberta: os resultados eram da anterior */
document.addEventListener("dx:workspace", () => {
  drawStatus();
  if (L.activePane() === "test") renderTestPane();
});

const ACTIONS: ActionTable = {
  refresh: { on: "click", run: () => { void testing.refresh(); } },
  "run-all": { on: "click", run: () => { void testing.runAll(); } },
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

/* a feature regista o seu pane (ADR-0004, U4j2); `window.renderTestPane` fica para o selftest e o i18n */
RP.test = renderTestPane;
L.publish({ renderTestPane });
