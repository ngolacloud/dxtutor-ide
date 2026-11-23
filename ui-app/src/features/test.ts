/* ═════════ dxtutor IDE — feature: Testing (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o render do pane «Testing» que vivia no monólito
   `app.ts` como `RP.test`.

   Sem motor simulado (ADR-0005, R1c1): o pane lê o comando de testes detectado
   no projecto aberto (`DXR.projectCmd`, desktop) e corre-o com `window.runTask`
   (no desktop, um PTY real).

   Shim transitório: publica `renderTestPane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar
   — em `app.ts`, `RP.test=()=>window.renderTestPane()` delega aqui (lazy, no
   switch de pane). Mesmo padrão de `features/run.ts`. */

import { $, hd, esc } from "../core";
import { RP } from "../app/store/registry";

interface DesktopRunner {
  root?: string | null;
  projectCmd?: (kind: "test" | "lint") => { cmd: string } | null;
}

/** Renderiza o pane «Testing». Sem resultados inventados (ADR-0005, R1c1): mostra o comando de
 *  testes detectado no projecto aberto e corre-o a sério no terminal; a lista de testes por
 *  ficheiro (`list_tests`/`run_test`) chega na R2. */
function renderTestPane(): void {
  const el = $("#pane-test");
  if (!el) return;
  const w = window as unknown as { DXR?: DesktopRunner; runTask: (cmd: string) => unknown };
  const dxr = w.DXR;
  const open = !!(dxr && dxr.root);
  const test = open && dxr!.projectCmd ? dxr!.projectCmd("test") : null;
  const body = !open
    ? '<div class="sec-empty">Abre uma pasta (File → Open Folder…) para correr os testes do projecto.</div>'
    : !test
      ? '<div class="sec-empty">Não detectei um comando de testes neste projecto. Define-o em <code>.dxtutor/commands.json</code>.</div>'
      : `<div class="sec-empty">Comando de testes: <code>${esc(test.cmd)}</code></div><button class="btn ghost" id="test-run">Correr os testes</button>`;
  el.innerHTML = hd("Testing", "") + `<div class="sections">${body}</div>`;
  const b = el.querySelector("#test-run");
  if (b && test) b.addEventListener("click", () => w.runTask(test.cmd));
}

/* ── publicação transitória no window (shim para o residual: RP.test delega aqui) ── */
window.renderTestPane = renderTestPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.test = renderTestPane;
