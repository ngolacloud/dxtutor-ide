/* ═════════ dxtutor IDE — feature: Pesquisa (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o render do pane «Pesquisa» que vivia no monólito
   `app.ts` como `RP.search`, mais os dois leaves que o acompanham: `doSearch`
   (procura incremental no workspace) e `replaceAll` (substituir tudo).

   AO CONTRÁRIO de run/test, este pane NÃO é render quase-puro: os leaves leem e
   mutam o sistema de ficheiros virtual (`FS`), re-renderizam a árvore (`refresh`)
   e compõem ícones (`fIcon`) — tudo ainda dono do monólito, por isso resolvido
   via `window` (fachada tipada no core). Do core importa-se só o que é dono de lá
   (`$`, `hd`, `esc`, `toast`). Os `onclick="openPath(...)"` inline resolvem
   `window.openPath` no clique (continua global via o `Object.assign` do monólito).

   Shim transitório: publica `renderSearchPane`, `doSearch` e `replaceAll` no
   `window` porque o residual invoca-os por nome livre — `app.ts` delega
   `RP.search=()=>window.renderSearchPane()` (lazy, no switch de pane), o
   a acção `search:replaceAll` do botão resolve `window.replaceAll` no clique, e o
   comando «Todo Tree» (v6.ts) chama `doSearch()` como global. Mesmo padrão de
   `features/test.ts`, com o detalhe GOTCHA C: mover os leaves REMOVE as defs de
   topo do monólito, por isso as entradas `doSearch`/`replaceAll` saíram também do
   `Object.assign(window,…)` do `app.ts` (senão ReferenceError travava o chunk). */

import { $, hd, esc, toast } from "../core";
import { RP } from "../app/store/registry";
import { registerActions, globalCalls, callGlobal, args } from "../app/actions";

/** Tupla de ocorrência numa linha: [nº da linha (1-based), linha, offset do match]. */
type Hit = [number, string, number];

/** Procura incremental: varre todo o `FS` pela query de `#s-q` e pinta `#s-res`. */
function doSearch(): void {
  const qel = $("#s-q") as HTMLInputElement | null;
  const res = $("#s-res");
  if (!qel || !res) return;
  const q = qel.value;
  if (!q) {
    res.innerHTML =
      '<div class="sec-empty">Escreve para procurar no workspace dxtutor.</div>';
    return;
  }
  const lq = q.toLowerCase();
  let n = 0,
    files = 0,
    h = "";
  Object.keys(window.FS)
    .sort()
    .forEach((p) => {
      const hits: Hit[] = [];
      window.FS[p].content.split("\n").forEach((l, i) => {
        const k = l.toLowerCase().indexOf(lq);
        if (k >= 0) hits.push([i + 1, l, k]);
      });
      if (!hits.length) return;
      files++;
      n += hits.length;
      h +=
        `<div class="row" style="padding-left:8px" data-action="search:open" data-on="${esc(p)}">${window.fIcon(
          p,
        )}<span class="nm">${esc(
          p.split("/").pop(),
        )}</span><span class="deco" style="color:var(--fg-muted)">${hits.length}</span></div>` +
        hits
          .slice(0, 30)
          .map(
            (x) =>
              `<div class="s-hit" data-action="search:hit" data-on="${esc(JSON.stringify([p, x[0]]))}"><span class="n">${x[0]}</span><span>${esc(
                x[1].slice(Math.max(0, x[2] - 18), x[2]),
              )}<mark>${esc(x[1].substr(x[2], q.length))}</mark>${esc(
                x[1].slice(x[2] + q.length, x[2] + q.length + 60),
              )}</span></div>`,
          )
          .join("");
    });
  res.innerHTML = `<div class="sec-empty"><b style="color:var(--accent-hover)">${n}</b> resultados em <b style="color:var(--accent-hover)">${files}</b> ficheiros</div><div class="tree">${h}</div>`;
}

/** Substituir tudo: aplica `#s-q`→`#s-r` em todo o `FS`, refresca e re-procura. */
function replaceAll(): void {
  const qel = $("#s-q") as HTMLInputElement | null;
  const rel = $("#s-r") as HTMLInputElement | null;
  if (!qel || !rel) return;
  const q = qel.value,
    r = rel.value;
  if (!q) {
    toast("Indica o texto a procurar");
    return;
  }
  let n = 0;
  Object.keys(window.FS).forEach((p) => {
    const c = window.FS[p].content;
    if (c.includes(q)) {
      n += c.split(q).length - 1;
      window.FS[p].content = c.split(q).join(r);
    }
  });
  window.refresh();
  doSearch();
  toast(n ? `${n} ocorrências substituídas` : "Nada para substituir");
}

/** Renderiza o pane «Pesquisa»: monta os inputs uma vez (`dataset.b`) e procura. */
function renderSearchPane(): void {
  const el = $("#pane-search");
  if (!el) return;
  if (!el.dataset.b) {
    el.dataset.b = "1";
    el.innerHTML =
      hd("Pesquisa") +
      `<div class="sections"><input class="inp" id="s-q" placeholder="Procurar em todos os ficheiros"><input class="inp" id="s-r" placeholder="Substituir por…"><button class="btn ghost" data-action="search:replaceAll">Substituir tudo</button><div id="s-res"></div></div>`;
    const qel = $("#s-q") as HTMLInputElement | null;
    if (qel) qel.oninput = doSearch;
  }
  doSearch();
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.search delega em renderSearchPane; o botão «Substituir tudo» (onclick inline)
   e o comando Todo Tree de v6.ts resolvem replaceAll/doSearch por nome livre. */
window.renderSearchPane = renderSearchPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.search = renderSearchPane;
window.doSearch = doSearch;
window.replaceAll = replaceAll;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
registerActions({
  ...globalCalls("search", ["replaceAll"]),
  "search:open": { click: (c) => void callGlobal("openPath", c.on) },
  "search:hit": { click: (c) => void callGlobal("openPath", ...args<[string, number]>(c)) },
});
