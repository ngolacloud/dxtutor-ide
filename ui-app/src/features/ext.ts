/* ═════════ dxtutor IDE — feature `ext` (Open VSX): resíduo + raiz de composição ═════════
   O resíduo strangler da feature `ext` (FORA de `features/ext/`, logo não governado
   por A7/A8). Faz três coisas: (1) é a raiz de COMPOSIÇÃO que liga o bridge (infra) ao
   motor (application) — constrói os adaptadores das portas e injecta-os em
   `makeExtEngine`; (2) é DONO do DOM — `renderExtPane`, `renderExtd` (VIEW.extd),
   `extRow` e o re-render `rerExt`; (3) publica a superfície pública no `window`.

   Fase 3 (ADR-0002): os casos de uso do motor — `extAll/extOn/extCmds/saveExt/
   extInstall/extRemove/extToggle/loadVsix/formatDoc` — saíram daqui para
   `ext/application/ext-engine.ts`, puros e com deps injectadas por porta
   (`ext/application/ports.ts`). Este ficheiro deixou de os conter: só os COMPÕE (com
   os adaptadores do bridge) e os RE-PUBLICA. Do core importam-se só os helpers puros
   (`$`, `hd`, `svg`, `esc`). Tudo o que é do monólito resolve-se em runtime através do
   bridge (app.ts/v5/v6 avaliam DEPOIS desta feature).

   Chaves do padrão (iguais a Debug/BPS):
   (1) estado mutável é window-backed — `EXS` vem de `bridge.initExs()` que estabelece
       `window.EXS` — porque os `onclick="…extToggle(…)/extInstall(…)/extRemove(…)/
       loadVsix(…)"` inline resolvem no escopo GLOBAL ao clicar; o motor muta esse
       mesmo objecto através da porta `InstalledState` (`state.read()`);
   (2) nada de leitura global ANSIOSA no eval: `EXS` nasce com os defaults e hidrata de
       `LS` PREGUIÇOSAMENTE (`hydrateExs`, guard-once dentro da porta `state.read()`) —
       obrigatório porque este módulo avalia antes de `app.ts` publicar `LS`;
   (3) `RP.ext`/`VIEW.extd` são registados por este módulo (ADR-0004, U4g1): os registos
       `RP`/`VIEW` nascem em app/store/registry.ts, antes das features (antes nasciam
       no app.ts e o v6 mantinha os shims);
   (4) o resíduo de v6 (decorações diagnostics/paintEd/keydown + arranque) lê o motor
       por fachadas-alias sem o substring migrado (o `vsxOn` saiu na R6b do ADR-0006: o editor e os
       diagnósticos lêem `window.builtinOn(key)`),
       `window.vsxFmt()` (=formatDoc), `window.vsxCmds()` (=extCmds). */

import { $, hd, svg, esc } from "../core";
import { RP, VIEW } from "../app/store/registry";
import { type ExtItem, type ExsState } from "./ext/domain/types";
import { sectionsFor } from "./ext/domain/policy";
import { recommendationsFor, fromHit, BUILTINS, builtinOn, migrateExs } from "./ext/domain/recommend";
import { makeExtEngine } from "./ext/application/ext-engine";
import { makeContribEngine } from "./ext/application/contributions-engine";
import { isDesktop } from "../platform/tauri/core";
import { fetchOpenVsx, searchOpenVsx } from "../platform/tauri/extensions";
import { bindActions } from "./ext/ui/actions";
import { toggleLineComment, type ExtensionContributions } from "./ext/domain/contributions";
import {
  initExs,
  lsGet,
  lsSet,
  commands,
  panes,
  pane,
  files,
  cur,
  tabOf,
  openTab,
  paintEd,
  extOf,
  projectContext,
  refresh,
  rerender,
  toast,
  callLoadJSZip,
  publishJSZipLoader,
  publish,
} from "./ext/infrastructure/legacy-bridge";

/* ── ADR-0006, R6b: já não há catálogo fixo. O que se conhece sem estar instalado vem do Open VSX
   real (a pesquisa, na app desktop) e das recomendações pela pilha do projecto
   (`ext/domain/recommend.ts`); as três extensões «com efeito» eram funcionalidades do dxtutor e
   passam a dizer-se assim (`BUILTINS`). ── */
const OVSX: { q: string; items: ExtItem[]; loading: boolean; err: string } = { q: "", items: [], loading: false, err: "" };
let ovsxT: ReturnType<typeof setTimeout> | undefined, ovsxSeq = 0;
const recs = (): ExtItem[] => recommendationsFor(projectContext().map(c => c[0]), id => !!EXS.inst[id]);

/* ── estado instalado: window-backed (mutado por inline onclick no escopo global),
   nasce vazio e hidrata de LS preguiçosamente (app.ts ainda não correu). A chave passa a
   `ext7`: a `ext6` misturava o catálogo fixo com os VSIX reais — migra-se uma vez. ── */
const EXS: ExsState = initExs();
let _exsHydrated = false;
function hydrateExs(){
  if(_exsHydrated) return; _exsHydrated = true;
  try{
    const v = lsGet<Partial<ExsState> | null>('ext7', null);
    if (v && typeof v === 'object') Object.assign(EXS, { inst: v.inst || {}, vsix: v.vsix || [], builtin: v.builtin || {} });
    else { const old = lsGet<unknown>('ext6', null); if (old) { Object.assign(EXS, migrateExs(old)); lsSet('ext7', EXS); lsSet('ext6', {}); } }
  }catch{ /* LS inválido: fica vazio */ }
}
/** Uma funcionalidade do dxtutor está ligada? (lida pelo editor, pelos diagnósticos e pelos atalhos). */
const isBuiltinOn = (key: string): boolean => { hydrateExs(); return builtinOn(EXS, key); };

/** Filtro de pesquisa do pane «Extensions» — estado-folha, dono desta feature. */
let EXQ = "";

/* ── VSIX: o corpo do carregador (document/window.JSZip) vive no bridge; aqui só se
   publica o CDN por omissão (desktop sobrepõe-no depois). ── */
publishJSZipLoader();

/* ── Fase 4 (ADR-0005): contribuições declarativas dos VSIX (temas, gramáticas TextMate,
   snippets, language-configuration). Guardadas em LS; o tema activo vive numa <style>
   própria confinada ao editor (`.ed`). ── */
const CONTRIB_KEY = "vsx-contrib";
const contrib = makeContribEngine({
  store: {
    load: () => {
      const v = lsGet(CONTRIB_KEY, []);
      return Array.isArray(v) ? (v as ExtensionContributions[]) : [];
    },
    save: all => {
      try {
        lsSet(CONTRIB_KEY, all);
        const back = lsGet<unknown>(CONTRIB_KEY, null);
        return Array.isArray(back) && back.length === all.length;
      } catch {
        return false;
      }
    },
  },
  style: {
    set: css => {
      let el = document.getElementById("vsx-theme");
      if (!el) {
        el = document.createElement("style");
        el.id = "vsx-theme";
        document.head.appendChild(el);
      }
      el.textContent = css;
    },
  },
  prefs: {
    get: k => {
      const v = lsGet<unknown>(k, null);
      return typeof v === "string" ? v : null;
    },
    set: (k, v) => lsSet(k, v),
  },
  editorScope: ".ed",
});

/** Marcador de comentário por omissão quando nenhuma extensão traz language-configuration. */
const DEFAULT_LINE_COMMENT: Record<string, string> = {
  rs: "//", go: "//", ts: "//", tsx: "//", js: "//", jsx: "//", java: "//", kt: "//", swift: "//", cs: "//",
  cpp: "//", cc: "//", hpp: "//", c: "//", h: "//", py: "#", sh: "#", rb: "#", toml: "#", yaml: "#", yml: "#",
  sql: "--", lua: "--",
};

/** Tab no editor: expande o snippet cujo prefixo acaba no cursor. `true` se expandiu. */
function vsxSnippet(ta: HTMLTextAreaElement, path: string): boolean {
  if (ta.selectionStart !== ta.selectionEnd) return false;
  const v = ta.value, pos = ta.selectionStart;
  const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
  const lineBefore = v.slice(lineStart, pos);
  const indent = (/^\s*/.exec(lineBefore) || [""])[0];
  const r = contrib.expandAt(extOf(path), lineBefore, { filename: path, now: new Date() }, indent, "    ");
  if (!r) return false;
  const start = pos - r.prefix.length;
  ta.setSelectionRange(start, pos);
  if (!document.execCommand("insertText", false, r.expansion.text)) ta.setRangeText(r.expansion.text, start, pos, "end");
  ta.setSelectionRange(start + r.expansion.selStart, start + r.expansion.selEnd);
  return true;
}

/** Ctrl+/ no editor: comenta/descomenta as linhas da selecção. `true` se mudou. */
function vsxToggleComment(ta: HTMLTextAreaElement, path: string): boolean {
  const ext = extOf(path);
  const marker = contrib.lineCommentFor(ext) || DEFAULT_LINE_COMMENT[ext];
  if (!marker) return false;
  const r = toggleLineComment(ta.value, ta.selectionStart, ta.selectionEnd, marker);
  ta.value = r.text;
  ta.setSelectionRange(r.selStart, r.selEnd);
  return true;
}

let contribRestored = false;
/** Realce do documento com a gramática TextMate da linguagem, se alguma extensão a trouxer. */
function vsxHighlight(ext: string, lines: string[]): string[] | null {
  if (!contribRestored) {
    contribRestored = true;
    contrib.restore();
  }
  return contrib.highlight(ext, lines);
}

/** Aplica um tema de cor de uma extensão (ou `null` para o tema do dxtutor) e repinta. */
function vsxApplyTheme(label: string | null) {
  contrib.applyTheme(label);
  toast(label ? `Color theme: ${label}` : "Color theme: dxtutor default");
  rerExt();
}

/* ── raiz de composição: liga os adaptadores do bridge (infra) às portas do motor
   (application). O motor fica puro; o `window`/DOM ficam deste lado. ── */
const engine = makeExtEngine({
  catalogue: () => OVSX.items.concat(recs()),
  remote: () => (isDesktop() ? { fetch: (id: string) => fetchOpenVsx(id) } : null),
  state: { read: () => { hydrateExs(); return EXS; } },
  storage: { save: s => lsSet("ext7", s) },
  palette: { entries: () => commands() },
  editor: {
    files: () => files(),
    current: () => cur(),
    tabOf: id => tabOf(id),
    extOf: p => extOf(p),
    refresh: (...a: [boolean?, boolean?]) => refresh(...a),
  },
  tabs: { open: tab => openTab(tab) },
  vsix: { load: () => callLoadJSZip() },
  notifier: { toast: m => toast(m) },
  rerender: () => rerExt(),
  contrib,
});
const { extAll, extOn, extCmds, saveExt, extInstall, extRemove, extToggle, loadVsix, formatDoc } = engine;

/* ── re-render da UI de extensões (dono do DOM): injectado no motor como `rerender`. ── */
function rerExt(){ if(pane()==='ext')panes().ext();rerender('extd');refresh(true);const t=tabOf(cur());if(t&&t.kind==='file'&&t.path)paintEd(t.path); }
const extIcon = (x: ExtItem, big = false) => `<span class="ex-ic${big ? " big" : ""}" style="background:hsl(${[...x.id].reduce((a,c)=>a+c.charCodeAt(0),0)%360} 45% 45%)">${esc(x.n.charAt(0))}</span>`;
const nfmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n);
function extRow(x: ExtItem){ const i=EXS.inst[x.id];
  const meta=x.remote?` · ${nfmt(x.remote.downloads)} downloads${x.remote.verified?' · verified':''}`:x.vsix?' · VSIX':'';
  return `<div class="ex-row" data-action="ext-open" data-on="${esc(x.id)}">${extIcon(x)}<div class="ex-t"><b class="notr">${esc(x.n)}</b><small class="notr">${esc(x.why || x.d)}</small><span class="notr">${esc(x.pub)}${meta}</span></div>${i?`<button class="mini" data-action="ext-toggle" data-on="${esc(x.id)}">${i.on?'Disable':'Enable'}</button>`:`<button class="mini pri" data-action="ext-install" data-on="${esc(x.id)}">Install</button>`}</div>`; }

/* ── corpo do tab de detalhe (VIEW.extd) — publicado; v6 mantém o shim. ── */
function renderExtd(t: { ext?: string }, host: HTMLElement){ hydrateExs(); const x=extAll().find(e=>e.id===t.ext);if(!x){host.innerHTML='<div class="empty">Extension removed.</div>';return;}const i=EXS.inst[x.id];
  const about = x.vsix && x.contrib ? contribSection(x)
    : x.vsix ? `<h2>What this extension adds here</h2><div class="adv mix">${svg('bulb')}<div>Installed from a VSIX. Its own JavaScript does not run: there is no VS Code extension host in dxtutor.</div></div>`
    : `<h2>Before you install</h2><div class="adv mix">${svg('bulb')}<div>${x.why ? `Recommended because of this project: ${esc(x.why)}. ` : ''}Installing downloads the VSIX from Open VSX${isDesktop() ? '' : ' (in the desktop app)'}. dxtutor applies what it contributes declaratively — colour themes, TextMate grammars, snippets, language settings, and a known language server when it is on your PATH; its JavaScript does not run.</div></div>`;
  host.innerHTML=`<div class="page" style="max-width:760px"><div style="display:flex;gap:16px;align-items:center">${extIcon(x, true)}<div><h1 class="notr" style="margin:0">${esc(x.n)}</h1><div class="sub notr" style="margin:0">${esc(x.pub)} · <code>${esc(x.id)}</code>${x.ver?' · v'+esc(x.ver):''}${x.remote?` · ${nfmt(x.remote.downloads)} downloads${x.remote.verified?' · verified publisher':''}`:''}</div></div></div>
   ${x.d?`<div class="sub" style="margin-top:12px">${esc(x.d)}</div>`:''}<div style="display:flex;gap:8px;margin:12px 0">${i?`<button class="mini" data-action="ext-toggle" data-on="${esc(x.id)}">${i.on?'Disable':'Enable'}</button><button class="mini" data-action="ext-remove" data-on="${esc(x.id)}">Uninstall</button>`:`<button class="mini pri" data-action="ext-install" data-on="${esc(x.id)}">Install</button>`}</div>
   ${about}
   ${x.cmds&&x.cmds.length?`<h2>Commands</h2><div class="tbl-wrap">${x.cmds.map(c=>`<div class="rowline"><span class="notr">${esc(c[0])}</span><span class="sp"></span>${c[1]?`<kbd>${esc(c[1])}</kbd>`:''}</div>`).join('')}</div>`:''}
   ${x.cfg&&x.cfg.length?`<h2>Settings</h2><div class="tbl-wrap">${x.cfg.map(c=>`<div class="rowline"><code class="notr">${esc(c)}</code></div>`).join('')}</div>`:''}${x.engines?`<div class="sub" style="margin-top:12px">Requires VS Code API <code>${esc(x.engines)}</code>.</div>`:''}</div>`; }

/** Fase 4: o que uma extensão instalada por VSIX contribui e o dxtutor aplica — e, com
 *  honestidade, o que não corre (o JavaScript da extensão: não há extension host). */
function contribSection(x: ExtItem): string {
  const c = x.contrib!;
  const active = contrib.activeTheme();
  const rows: string[] = [];
  c.themes.forEach(label => rows.push(`<div class="rowline"><span>Color theme <b class="notr">${esc(label)}</b></span><span class="sp"></span>${active === label ? '<span class="tag live">active</span>' : `<button class="mini" data-action="vsx-theme" data-on="${esc(label)}">Apply</button>`}</div>`));
  if (c.grammars.length) rows.push(`<div class="rowline"><span>Syntax highlighting (TextMate) for <span class="notr">${c.grammars.map(esc).join(", ")}</span></span></div>`);
  if (c.snippets) rows.push(`<div class="rowline"><span>${c.snippets} snippet${c.snippets === 1 ? "" : "s"} — type the prefix and press <kbd>Tab</kbd></span></div>`);
  if (c.languages.length) rows.push(`<div class="rowline"><span>Languages <span class="notr">${c.languages.map(esc).join(", ")}</span> (file extensions, comments: <kbd>Ctrl+/</kbd>)</span></div>`);
  if (c.lsp) rows.push(`<div class="rowline"><span>Language server: dxtutor runs <code>${esc(c.lsp)}</code> for this language when it is installed</span></div>`);
  const warn = c.warnings.length ? `<div class="sub" style="margin-top:8px">${c.warnings.map(w => `⚠ ${esc(w)}`).join("<br>")}</div>` : "";
  return `<h2>What this extension adds here</h2><div class="adv agent">${svg("check")}<div>dxtutor applies the extension's declarative contributions below. Its own JavaScript code does not run: there is no VS Code extension host, so commands that need it are listed but inactive.</div></div>
   ${rows.length ? `<div class="tbl-wrap">${rows.join("")}</div>` : '<div class="sub">This extension has no declarative contributions dxtutor can use.</div>'}${warn}`;
}

/** Fase 4: instalar do Open VSX pelo id (`publisher.name`). Só no desktop: o download é do
 *  backend (o browser não tem como). Vazio no protótipo de browser. */
function openVsxRow(): string {
  if (!isDesktop()) return "";
  return `<div class="ovsx-row"><input class="inp notr" id="ovsx-id" placeholder="Install from Open VSX: publisher.name" spellcheck="false"><button class="mini" data-action="vsx-open-vsx">Install</button></div>`;
}

/** Instala pelo id escrito na caixa (o mesmo caminho do botão Install: descarrega o VSIX real). */
async function vsxInstallOpenVsx(): Promise<void> {
  const input = $("#ovsx-id") as HTMLInputElement | null;
  const id = (input ? input.value : "").trim();
  if (!id) { toast("Type an extension id, e.g. llvm-vs-code-extensions.vscode-clangd"); return; }
  await extInstall(id);
}

/** Pesquisa no Open VSX (desktop), com debounce; uma resposta atrasada não pinta por cima. */
function searchSoon(q: string): void {
  clearTimeout(ovsxT);
  const t = q.trim();
  if (!isDesktop() || t.length < 2) { OVSX.q = ""; OVSX.items = []; OVSX.loading = false; OVSX.err = ""; return; }
  OVSX.loading = true;
  ovsxT = setTimeout(() => {
    const seq = ++ovsxSeq;
    searchOpenVsx(t).then(hits => { if (seq !== ovsxSeq) return; OVSX.q = t; OVSX.items = hits.map(fromHit); OVSX.err = ""; },
      e => { if (seq !== ovsxSeq) return; OVSX.items = []; OVSX.err = e instanceof Error ? e.message : String(e); })
      .finally(() => { if (seq !== ovsxSeq) return; OVSX.loading = false; if (pane() === "ext") renderExtPane(); });
  }, 300);
}

/** Renderiza o pane «Extensions»: pesquisa, instaladas, recomendadas, Open VSX e as funcionalidades do dxtutor. */
function renderExtPane(){
  hydrateExs();
  const el = $("#pane-ext"), q = EXQ.toLowerCase(), desk = isDesktop();
  const { inst, rec, rest } = sectionsFor(EXS.vsix, recs(), OVSX.items, id => !!EXS.inst[id], q);
  if (!el) return;
  const results = !desk ? "" : OVSX.loading ? '<div class="sec-empty">Searching Open VSX…</div>' : OVSX.err ? `<div class="sec-empty" style="color:var(--red)">Open VSX: ${esc(OVSX.err)}</div>` : EXQ.trim().length >= 2 ? (rest.length ? rest.map(extRow).join("") : '<div class="sec-empty">No results on Open VSX.</div>') : '<div class="sec-empty">Type to search Open VSX.</div>';
  const builtins = BUILTINS.map(b => `<div class="ex-row"><div class="ex-t"><b>${esc(b.n)}</b><small>${esc(b.d)}</small><span>dxtutor</span></div><button class="mini" data-action="builtin-toggle" data-on="${esc(b.key)}">${builtinOn(EXS, b.key) ? "Disable" : "Enable"}</button></div>`).join("")
    + '<div class="ex-row"><div class="ex-t"><b>Format Document</b><small>Shift+Alt+F trims trailing spaces, normalises indentation and the final newline.</small><span>dxtutor · always on</span></div></div>';
  el.innerHTML = hd("Extensions", `<button title="Install from VSIX…" data-action="vsix-pick">${svg("plus")}</button>`) + `<div class="sections"><input class="inp" id="ex-q" placeholder="${desk ? "Search extensions in Open VSX" : "Filter installed extensions"}" value="${esc(EXQ)}"><input type="file" id="vsix-in" accept=".vsix" style="display:none">${openVsxRow()}
   <div class="scm-grp">Installed<span class="cnt">${inst.length}</span></div>${inst.map(extRow).join("") || '<div class="sec-empty">None. Install from Open VSX or from a .vsix file (+).</div>'}
   ${rec.length ? `<div class="scm-grp">Recommended for this project<span class="cnt">${rec.length}</span></div>${rec.map(extRow).join("")}` : ""}
   ${desk ? `<div class="scm-grp">Open VSX</div>${results}` : ""}
   <div class="scm-grp">Built into dxtutor</div>${builtins}
   <div class="sec-empty">Extensions come from Open VSX — the Microsoft Marketplace terms only allow Microsoft's own products. dxtutor applies what an extension contributes declaratively (themes, grammars, snippets, language settings, known language servers); there is no VS Code extension host, so extension code does not run.${desk ? "" : " Searching and installing from Open VSX needs the desktop app."}</div></div>`;
  const qi = $("#ex-q") as HTMLInputElement | null;
  if (qi) qi.oninput = () => { EXQ = qi.value; searchSoon(EXQ); renderExtPane(); const n = $("#ex-q") as HTMLInputElement | null; if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
  const vi = $("#vsix-in") as HTMLInputElement | null;
  if (vi) vi.onchange = e => { const fs = (e.target as HTMLInputElement).files; if (fs && fs[0]) loadVsix(fs[0]); };
}

/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts) */
RP.ext = renderExtPane;
VIEW.extd = (t, host) => renderExtd(t as { ext?: string }, host);

/* ── publicação no window (via bridge) ──
   Nomes reais (resolvem os onclick inline e as chamadas do resíduo @ts-nocheck de v6).
   Aliases sem o substring migrado p/ as decorações de v6 (diagnostics/paintEd/keydown/
   arranque) lerem o motor: vsxFmt=formatDoc, vsxCmds=extCmds; builtinOn = as funcionalidades do dxtutor. */
publish({
  EXS, saveExt, extOn, extAll, extCmds, extInstall, extRemove, extToggle, builtinOn: isBuiltinOn,
  rerExt, extRow, loadVsix, formatDoc, renderExtPane, renderExtd,
  vsxFmt: formatDoc, vsxCmds: extCmds,
  // Fase 4: contribuições declarativas — o editor (paintEd/Tab/Ctrl+/) chama-as por global.
  vsxHighlight, vsxSnippet, vsxToggleComment, vsxApplyTheme, vsxInstallOpenVsx,
});

/* Fase 4: os botões novos usam o listener delegado (data-action), não onclick inline. */
bindActions({
  "vsx-theme": { on: "click", run: e => vsxApplyTheme(e.on) },
  "vsx-open-vsx": { on: "click", run: () => { void vsxInstallOpenVsx(); } },
  /* ADR-0006, R6b: as linhas e o detalhe deixam os onclick inline */
  "ext-open": { on: "click", run: e => { const x = extAll().find(y => y.id === e.on); openTab({ id: `extd:${e.on}`, title: x ? x.n : e.on, kind: "extd", ext: e.on }); } },
  "ext-install": { on: "click", run: e => { void extInstall(e.on); } },
  "ext-toggle": { on: "click", run: e => extToggle(e.on) },
  "ext-remove": { on: "click", run: e => extRemove(e.on) },
  "builtin-toggle": { on: "click", run: e => { hydrateExs(); EXS.builtin[e.on] = !builtinOn(EXS, e.on); saveExt(); rerExt(); } },
  "vsix-pick": { on: "click", run: () => { ($("#vsix-in") as HTMLInputElement | null)?.click(); } },
});

