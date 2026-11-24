/* ═════════ dxtutor IDE — feature: Pesquisa (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o render do pane «Pesquisa» que vivia no monólito
   `app.ts` como `RP.search`, mais os dois leaves que o acompanham: `doSearch`
   (procura incremental no workspace) e `replaceAll` (substituir tudo).

   AO CONTRÁRIO de run/test, este pane NÃO é render quase-puro: os leaves leem e
   mutam o sistema de ficheiros virtual (`FS`), re-renderizam a árvore (`refresh`)
   e compõem ícones (`fIcon`) — tudo ainda dono do monólito, por isso resolvido
   via `window` (fachada tipada no core). Do core importa-se só o que é dono de lá
   (`$`, `hd`, `esc`, `toast`).

   ADR-0006, R2b: no desktop com pasta aberta, a pesquisa corre em toda a pasta no disco
   (`search_project`), não só nos ficheiros carregados; os resultados abrem-se por um só
   listener em `#s-res` (data-p/data-l), sem `onclick` inline.

   Shim transitório: publica `renderSearchPane`, `doSearch` e `replaceAll` no
   `window` porque o residual invoca-os por nome livre — `app.ts` delega
   `RP.search=()=>window.renderSearchPane()` (lazy, no switch de pane), o
   a acção `search:replaceAll` do botão resolve `window.replaceAll` no clique, e o
   comando «Todo Tree» (v6.ts) chama `doSearch()` como global. Mesmo padrão de
   `features/test.ts` (hoje `features/testing/`), com o detalhe GOTCHA C: mover os leaves REMOVE as defs de
   topo do monólito, por isso as entradas `doSearch`/`replaceAll` saíram também do
   `Object.assign(window,…)` do `app.ts` (senão ReferenceError travava o chunk). */

import { $, hd, esc, toast } from "../core";
import { RP } from "../app/store/registry";
import { searchClient, type SearchHit } from "../platform/tauri/search";
import { registerActions, globalCalls } from "../app/actions";
import { translator } from "../app/i18n";
import { SEARCH_MESSAGES } from "./search.messages";
import { SEARCH_DESKTOP_MESSAGES } from "./search.desktop-messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(SEARCH_MESSAGES);
const txd = translator(SEARCH_DESKTOP_MESSAGES);

/** Uma ocorrência numa linha: nº da linha (1-based), a linha, o offset do match nela. */
interface Hit { line: number; text: string; at: number }
/** As ocorrências de um ficheiro. `key` é a chave no `FS` (null = não carregado na IDE). */
interface FileHits { label: string; key: string | null; hits: Hit[] }

/** Máximo de ocorrências pedidas ao backend (o resto diz-se, não se esconde). */
const MAX_HITS = 2000;

const G = window as unknown as { DXR?: { root?: string | null }; ROOT: string };
const dxr = (): { root?: string | null } | undefined => G.DXR;

/** O offset do match na linha, sem distinguir maiúsculas (a coluna do backend é em bytes). */
const findAt = (text: string, q: string): number => Math.max(0, text.toLowerCase().indexOf(q.toLowerCase()));

/** Pinta os resultados (o mesmo markup para o FS e para o backend). */
function paint(res: HTMLElement, q: string, groups: FileHits[], capped: boolean): void {
  const n = groups.reduce((a, g) => a + g.hits.length, 0);
  const h = groups.map((g) => {
    /* sem handlers inline: a linha leva o destino em data-*; um só listener em #s-res abre-a */
    const open = (line?: number): string => g.key ? `data-p="${esc(g.key)}"${line ? ` data-l="${line}"` : ""}` : `data-unloaded="1" title="${esc(txd("notLoadedTitle"))}"`;
    return `<div class="row" style="padding-left:8px${g.key ? "" : ";opacity:.6"}" ${open()}>${window.fIcon(g.label)}<span class="nm">${esc(g.label.split("/").pop())}</span><span class="deco" style="color:var(--fg-muted)">${g.hits.length}</span></div>` +
      g.hits.slice(0, 30).map((x) => `<div class="s-hit" ${open(x.line)}><span class="n">${x.line}</span><span>${esc(x.text.slice(Math.max(0, x.at - 18), x.at))}<mark>${esc(x.text.substr(x.at, q.length))}</mark>${esc(x.text.slice(x.at + q.length, x.at + q.length + 60))}</span></div>`).join("");
  }).join("");
  res.innerHTML = `<div class="sec-empty"><b style="color:var(--accent-hover)">${n}</b> ${txt("resultsIn")} <b style="color:var(--accent-hover)">${groups.length}</b> ${txd("files")}${capped ? txd("capped", { n: MAX_HITS }) : ""}</div><div class="tree">${h}</div>`;
}

/** Clicar num resultado abre o ficheiro (na linha); um ficheiro não carregado explica-se. */
function onResultClick(e: Event): void {
  const row = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-p],[data-unloaded]");
  if (!row) return;
  if (row.dataset.unloaded) { toast(txd("notLoaded")); return; }
  window.openPath(row.dataset.p as string, row.dataset.l ? +row.dataset.l : undefined);
}

/** Procura nos ficheiros carregados na IDE (o browser, ou o desktop sem pasta). */
function searchLoaded(q: string): FileHits[] {
  const lq = q.toLowerCase(), out: FileHits[] = [];
  Object.keys(window.FS).sort().forEach((p) => {
    const hits: Hit[] = [];
    window.FS[p].content.split("\n").forEach((l, i) => { const k = l.toLowerCase().indexOf(lq); if (k >= 0) hits.push({ line: i + 1, text: l, at: k }); });
    if (hits.length) out.push({ label: p, key: p, hits });
  });
  return out;
}

/** Agrupa as ocorrências do backend por ficheiro (chegam pela ordem da travessia). */
function groupHits(hits: SearchHit[], q: string): FileHits[] {
  const by = new Map<string, FileHits>(), root = G.ROOT;
  for (const x of hits) {
    let g = by.get(x.file);
    if (!g) { const key = root + x.file; g = { label: x.file, key: window.FS[key] ? key : null, hits: [] }; by.set(x.file, g); }
    g.hits.push({ line: x.line, text: x.text, at: findAt(x.text, q) });
  }
  const out = [...by.values()].sort((a, b) => a.label.localeCompare(b.label));
  out.forEach((g) => g.hits.sort((a, b) => a.line - b.line));
  return out;
}

let seq = 0, timer: ReturnType<typeof setTimeout> | undefined;

/** Procura incremental pela query de `#s-q`: no desktop com pasta, em toda a pasta no disco
 *  (`search_project`, ADR-0006 R2b — também apanha o que o carregamento saltou); senão nos
 *  ficheiros carregados. Uma resposta atrasada nunca pinta por cima de uma mais recente. */
function doSearch(): void {
  const qel = $("#s-q") as HTMLInputElement | null;
  const res = $("#s-res");
  if (!qel || !res) return;
  const q = qel.value, my = ++seq, root = dxr()?.root ?? null;
  clearTimeout(timer);
  if (!q) {
    res.innerHTML = `<div class="sec-empty">${txd(root ? "typeFolder" : "typeOpen")}</div>`;
    return;
  }
  if (!root) { paint(res, q, searchLoaded(q), false); return; }
  res.innerHTML = `<div class="sec-empty">${txd("searching")}</div>`;
  timer = setTimeout(() => {
    searchClient().project(root, q, MAX_HITS, true).then(
      (hits) => { if (my === seq) paint(res, q, groupHits(hits, q), hits.length >= MAX_HITS); },
      (e) => { if (my === seq) res.innerHTML = `<div class="sec-empty" style="color:var(--red)">A pesquisa falhou: ${esc(e instanceof Error ? e.message : String(e))}</div>`; },
    );
  }, 200);
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
  toast(n ? txd("replaced", { n }) : "Nada para substituir");
}

/** Renderiza o pane «Pesquisa»: monta os inputs uma vez (`dataset.b`) e procura. */
function renderSearchPane(): void {
  const el = $("#pane-search");
  if (!el) return;
  if (!el.dataset.b) {
    el.dataset.b = "1";
    el.innerHTML =
      hd("Pesquisa") +
      `<div class="sections"><input class="inp" id="s-q" placeholder="${txt("searchInAllFiles")}"><input class="inp" id="s-r" placeholder="${txt("replaceWith")}"><button class="btn ghost" data-action="search:replaceAll">${txt("replaceAll")}</button><div id="s-res"></div></div>`;
    const qel = $("#s-q") as HTMLInputElement | null;
    if (qel) qel.oninput = doSearch;
    $("#s-res")?.addEventListener("click", onResultClick);
  }
  doSearch();
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.search delega em renderSearchPane; o botão «Substituir tudo» (onclick inline)
   e o comando Todo Tree de v6.ts resolvem replaceAll/doSearch por nome livre. */
/* exportado (ADR-0004, U7m): o auto-teste desktop e os testes importam-no */
export { renderSearchPane };
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.search = renderSearchPane;
window.doSearch = doSearch;
window.replaceAll = replaceAll;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
/* os resultados abrem-se pelo listener de #s-res (data-p/data-l, ADR-0006 R2b) */
registerActions(globalCalls("search", ["replaceAll"]));
