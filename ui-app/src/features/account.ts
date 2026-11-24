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

import { $, hd, svg, esc, prov, provState } from "../core";
import { RP } from "../app/store/registry";

interface Identity { user?: string; host?: string; gitName?: string; gitEmail?: string }
const dxr = (): Identity | undefined => (window as unknown as { DXR?: Identity }).DXR;

/** Renderiza o pane «Conta»: a identidade real (no desktop: o utilizador e a máquina, e a
 *  identidade git que assina os commits; no browser não há sessão local) + o estado de cada
 *  provedor de LLM. ADR-0006, R2e1: sai a identidade fixa «walter · Team SYS». */
function renderAccountPane(): void {
  const el = $("#pane-account");
  if (!el) return;
  const PROV = prov(), id = dxr();
  const who = id
    ? `<div class="kv"><span class="ic">${svg("account")}</span><b class="notr">${esc(id.user || "?")}</b><span class="v notr">${esc(id.host || "")}</span></div>` +
      `<div class="kv"><span class="ic">${svg("branch-sm")}</span>git<span class="v notr">${id.gitName ? esc(id.gitName) + (id.gitEmail ? " &lt;" + esc(id.gitEmail) + "&gt;" : "") : "sem user.name configurado"}</span></div>`
    : '<div class="sec-empty">Sem sessão local: a conta (utilizador, máquina e identidade git) só existe na app desktop.</div>';
  el.innerHTML =
    hd("Conta") +
    `<div class="sections">${who}<div class="scm-grp">Provedores</div>${Object.entries(PROV)
      .map(
        ([k, p]) =>
          `<div class="kv"><span class="pdot${p.on ? "" : " off"}" style="background:${p.col}"></span>${p.name}<span class="v">${p.on ? provState(k) : "desligado"}</span></div>`,
      )
      .join("")}<button class="btn ghost" onclick="openSettings()">Abrir Definições</button><button class="btn ghost" onclick="openManager()">Uso</button></div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.account delega aqui) ── */
window.renderAccountPane = renderAccountPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.account = renderAccountPane;
