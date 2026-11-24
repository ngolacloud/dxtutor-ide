/* ═════════ dxtutor IDE — feature: Remote Explorer (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade (Fase 2). Consome o `core`
   tipado por import real e detém o render do pane «Remote Explorer» que vivia no
   monólito `app.ts` como `RP.remote`.

   É a folha mais isolada do registo de panes: render PURO, sem estado mutável
   partilhado — só lê o DOM (`$`), compõe o cabeçalho (`hd`) e emite HTML estático
   (Local + hosts SSH do protótipo). A acção `remote:toast` (era `onclick` inline — U5b) resolve
   `window.toast` no clique (continua global), por isso não é dependência de import.

   Shim transitório: publica `renderRemotePane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar —
   em `app.ts`, `RP.remote=()=>window.renderRemotePane()` delega aqui (lazy, no
   switch de pane). Quando o próprio registo `RP` migrar para uma feature, o espelho
   cai. Este é o padrão para migrar qualquer render de pane do `RP`. */

import { $, hd, esc } from "../core";
import { RP } from "../app/store/registry";
import { registerActions, callGlobal } from "../app/actions";

/** Renderiza o pane «Remote Explorer»: ligação local do protótipo + hosts SSH
 *  (desligados — ligações remotas reais dependem do backend da aplicação). */
function renderRemotePane(): void {
  const el = $("#pane-remote");
  if (!el) return;
  el.innerHTML =
    hd("Remote Explorer") +
    `<div class="sections"><div class="scm-grp">Local</div><div class="scm-row" style="cursor:default"><span class="pdot" style="background:var(--green)"></span><span class="nm">delonix</span><span class="pth">ligado · este protótipo</span></div><div class="scm-grp">SSH</div>${["kaeso-preprod", "ngolacloud-cp-01"]
      .map(
        (h) =>
          `<div class="scm-row" data-action="remote:toast" data-on="${esc(`${h}: ligação remota não disponível no protótipo`)}"><span class="pdot off"></span><span class="nm">${h}</span><span class="pth">desligado</span></div>`,
      )
      .join("")}<div class="sec-empty">Ligações remotas reais dependem do backend da aplicação.</div></div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.remote delega aqui) ── */
window.renderRemotePane = renderRemotePane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.remote = renderRemotePane;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
registerActions({ "remote:toast": { click: (c) => void callGlobal("toast", c.on) } });
