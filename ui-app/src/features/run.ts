/* ═════════ dxtutor IDE — feature: Run and Debug (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade (Fase 4). Consome o `core`
   tipado por import real e detém o render do pane «Run and Debug» que vivia no
   monólito `app.ts` como `RP.run`.

   É um render quase-puro: lê o DOM (`$`), compõe o cabeçalho (`hd`) e o ícone
   (`svg`), e emite HTML estático com a lista de configurações de arranque. Os
   `onclick="runTask(...)"` inline resolvem `window.runTask` no clique (continua
   global via o `Object.assign(window,…)` do monólito), por isso não é
   dependência de import.

   Shim transitório: publica `renderRunPane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar
   — em `app.ts`, `RP.run=()=>window.renderRunPane()` delega aqui (lazy, no switch
   de pane). Mesmo padrão de `features/remote.ts`. */

import { $, hd, svg } from "../core";

/** Configurações de arranque do workspace: [comando, descrição]. Cada linha
 *  corre no terminal integrado via `runTask` (window-resolved no clique). */
const TASKS: ReadonlyArray<readonly [string, string]> = [
  ["cargo build", "Compilar todos os crates"],
  ["cargo test", "Correr todos os testes"],
  ["cargo test -p lexer", "Testes do lexer"],
  ["cargo test -p store", "Testes do store"],
  ["dx lint", "Lint do Design System"],
  ["npm run dev", "Servidor de desenvolvimento"],
];

/** Renderiza o pane «Run and Debug»: lista de configurações de arranque. */
function renderRunPane(): void {
  const el = $("#pane-run");
  if (!el) return;
  el.innerHTML =
    hd("Run and Debug") +
    `<div class="sections"><div class="sec-empty">Configurações de arranque do workspace. Cada uma corre no terminal integrado.</div>${TASKS.map(
      (c) =>
        `<div class="scm-row" onclick="runTask('${c[0]}')"><span class="ic" style="color:var(--green)">${svg("run")}</span><span class="nm">${c[0]}</span><span class="pth">${c[1]}</span></div>`,
    ).join("")}</div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.run delega aqui) ── */
window.renderRunPane = renderRunPane;
