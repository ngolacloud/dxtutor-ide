/* ═════════ dxtutor IDE — feature: Conta (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade (Fase 3). Consome o `core`
   tipado por import real e detém o render do pane «Conta» que vivia no monólito
   `app.ts` como `RP.account`.

   Diferente do `remote` (render puro): lê o mapa vivo de provedores `prov()` e o
   rótulo de estado `provState(k)` (fachadas do core sobre `window.PROV`/
   `window.provState`, cujos donos continuam no monólito). As acções
   `openSettings()`/`openManager()` são `onclick=` inline, resolvidas em `window`
   no clique — não são dependências de import.

   Nota: ao contrário do `ext` (cujo corpo vivo está na camada transitória v6.ts,
   que sobrepõe o `RP.ext` do monólito), o `RP.account` só existe no `app.ts` — é
   o render realmente mostrado, por isso é a folha migrável desta fase.

   Shim transitório: publica `renderAccountPane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar —
   em `app.ts`, `RP.account=()=>window.renderAccountPane()` delega aqui (lazy, no
   switch de pane). Quando o próprio registo `RP` migrar, o espelho cai. */

import { $, hd, svg, prov, provState } from "../core";
import { RP } from "../app/store/registry";
import { registerActions, globalCalls } from "../app/actions";

/** Renderiza o pane «Conta»: identidade do utilizador + estado de cada provedor de
 *  LLM (ao vivo/simulado/desligado), com atalhos para Definições e gestor de uso. */
function renderAccountPane(): void {
  const el = $("#pane-account");
  if (!el) return;
  const PROV = prov();
  el.innerHTML =
    hd("Conta") +
    `<div class="sections"><div class="kv"><span class="ic">${svg("account")}</span><b>walter</b><span class="v">Team SYS</span></div><div class="scm-grp">Provedores</div>${Object.entries(PROV)
      .map(
        ([k, p]) =>
          `<div class="kv"><span class="pdot${p.on ? "" : " off"}" style="background:${p.col}"></span>${p.name}<span class="v">${p.on ? provState(k) : "desligado"}</span></div>`,
      )
      .join("")}<button class="btn ghost" data-action="account:openSettings">Abrir Definições</button><button class="btn ghost" data-action="account:openManager">Uso e missões</button></div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.account delega aqui) ── */
window.renderAccountPane = renderAccountPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.account = renderAccountPane;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
registerActions(globalCalls("account", ["openSettings", "openManager"]));
