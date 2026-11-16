/* ═════════ dxtutor IDE — feature: Testing (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o render do pane «Testing» que vivia no monólito
   `app.ts` como `RP.test`.

   Render quase-puro: corre `window.runTests()` (motor de testes simulado que
   ainda vive no monólito, tipado no core), lê o DOM (`$`), compõe o cabeçalho
   (`hd`) e o ícone (`svg`), escapa texto (`esc`) e emite HTML. Os
   `onclick="runTask(...)"` / `onclick="openPath(P_LX,10)"` inline resolvem
   `window.runTask` / `window.openPath` / `window.P_LX` no clique (continuam
   globais via o `Object.assign(window,…)` do monólito), por isso não são
   dependências de import.

   Shim transitório: publica `renderTestPane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar
   — em `app.ts`, `RP.test=()=>window.renderTestPane()` delega aqui (lazy, no
   switch de pane). Mesmo padrão de `features/run.ts`. */

import { $, hd, svg, esc } from "../core";

/** Renderiza o pane «Testing»: estado do build + lista de testes passados/falhados. */
function renderTestPane(): void {
  const el = $("#pane-test");
  if (!el) return;
  const r = window.runTests();
  const body = !r.build
    ? `<div class="sec-empty" style="color:var(--red)">Build falhou — ${esc(
        r.err.split("\n")[0],
      )}</div><button class="btn ghost" onclick="openPath(P_LX,10)">Ir para o erro</button>`
    : `<div class="sec-empty"><b style="color:var(--green)">${
        r.tests.filter((t) => t.ok).length
      } passados</b> · <b style="color:${
        r.ok ? "var(--fg-muted)" : "var(--red)"
      }">${r.tests.filter((t) => !t.ok).length} falhados</b></div>` +
      r.tests
        .map(
          (t) =>
            `<div class="scm-row" onclick="runTask('cargo test -p ${t.n.split(
              "::",
            )[0]}')"><span style="color:${
              t.ok ? "var(--green)" : "var(--red)"
            };width:14px;text-align:center">${t.ok ? "✓" : "✖"}</span><span class="nm" style="max-width:none">${t.n}</span></div>`,
        )
        .join("") +
      `<div class="sec-empty">O resultado é calculado a partir do conteúdo actual dos ficheiros.</div>`;
  el.innerHTML =
    hd(
      "Testing",
      `<button title="Correr todos" onclick="runTask('cargo test')">${svg(
        "run",
      )}</button>`,
    ) + `<div class="sections">${body}</div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.test delega aqui) ── */
window.renderTestPane = renderTestPane;
