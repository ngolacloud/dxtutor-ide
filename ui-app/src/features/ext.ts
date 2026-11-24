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
       por fachadas-alias sem o substring migrado: `window.vsxOn(id)` (=extOn),
       `window.vsxFmt()` (=formatDoc), `window.vsxCmds()` (=extCmds). */

import { $, hd, svg, esc, jsa } from "../core";
import { RP, VIEW } from "../app/store/registry";
import { type ExtItem, type ExsState } from "./ext/domain/types";
import { sectionsFor } from "./ext/domain/policy";
import { makeExtEngine } from "./ext/application/ext-engine";
import { makeContribEngine } from "./ext/application/contributions-engine";
import { isDesktop } from "../platform/tauri/core";
import { fetchOpenVsx } from "../platform/tauri/extensions";
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
  doSearch,
  goPane,
  openGraph,
  runTask,
  dxRun,
  dxStop,
  dxDeploy,
  callLoadJSZip,
  publishJSZipLoader,
  publish,
} from "./ext/infrastructure/legacy-bridge";

/* ── catálogo de extensões (Open VSX) — os `cmds` com efeito usam arrows preguiçosas
   que resolvem dxRun/dxStop/dxDeploy/runTask/openGraph/goPane/doSearch pelo bridge. ── */
const EXT: ExtItem[] = [
 {id:'rust-lang.rust-analyzer',n:'rust-analyzer',pub:'rust-lang',d:'Rust language support: diagnostics, completion, go to definition.',ctx:['rust'],bundled:1},
 {id:'usernamehw.errorlens',n:'Error Lens',pub:'usernamehw',d:'Shows diagnostics inline at the end of the line.',ctx:['all'],eff:'errorlens'},
 {id:'esbenp.prettier-vscode',n:'Prettier',pub:'esbenp',d:'Opinionated code formatter.',ctx:['node'],eff:'prettier',cmds:[['Prettier: Format Document','Shift+Alt+F']]},
 {id:'redhat.vscode-yaml',n:'YAML',pub:'redhat',d:'YAML validation, including Kubernetes schemas.',ctx:['k8s','compose'],eff:'yaml'},
 {id:'ms-azuretools.vscode-docker',n:'Docker',pub:'ms-azuretools',d:'Build, manage and run containers.',ctx:['compose'],cmds:[['Docker: Compose Up','',()=>dxRun()],['Docker: Compose Down','',()=>dxStop()]]},
 {id:'ms-kubernetes-tools.vscode-kubernetes-tools',n:'Kubernetes',pub:'ms-kubernetes-tools',d:'Develop, deploy and debug Kubernetes applications.',ctx:['k8s'],cmds:[['Kubernetes: Apply','',()=>dxDeploy()],['Kubernetes: Get Pods','',()=>runTask('kubectl get pods')]]},
 {id:'eamodio.gitlens',n:'GitLens',pub:'eamodio',d:'Git blame, history and commit graph.',ctx:['all'],cmds:[['GitLens: Show Commit Graph','',()=>openGraph()]]},
 {id:'gruntfuggly.todo-tree',n:'Todo Tree',pub:'Gruntfuggly',d:'Lists TODO and FIXME comments in a tree.',ctx:['all'],cmds:[['Todo Tree: Show TODOs','',()=>{goPane('search');($('#s-q') as HTMLInputElement).value='TODO';doSearch();}]]},
 {id:'dbaeumer.vscode-eslint',n:'ESLint',pub:'dbaeumer',d:'JavaScript and TypeScript linting.',ctx:['node']},
 {id:'golang.go',n:'Go',pub:'golang',d:'Go language support.',ctx:['go']},
 {id:'ms-python.python',n:'Python',pub:'ms-python',d:'Python language support.',ctx:['python','odoo']},
 {id:'streetsidesoftware.code-spell-checker',n:'Code Spell Checker',pub:'streetsidesoftware',d:'Spelling checker for source code.',ctx:['all']},
 {id:'editorconfig.editorconfig',n:'EditorConfig',pub:'EditorConfig',d:'Applies .editorconfig settings.',ctx:['all']}];

/* ── estado instalado: window-backed (mutado por inline onclick no escopo global),
   nasce com defaults e hidrata de LS preguiçosamente (app.ts ainda não correu). ── */
const EXS: ExsState = initExs();
let _exsHydrated = false;
/** Funde o estado persistido de `LS` sobre `EXS` uma única vez. Preguiçoso porque
 *  este módulo avalia antes de app.ts publicar `LS`; chamado pela porta `state.read()`
 *  (o motor só vê o `EXS` já hidratado). */
function hydrateExs(){ if(_exsHydrated) return; _exsHydrated = true; try{ Object.assign(EXS, lsGet('ext6', {})); }catch{} }

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
  catalogue: EXT,
  state: { read: () => { hydrateExs(); return EXS; } },
  storage: { save: s => lsSet("ext6", s) },
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
function extRow(x: ExtItem){ const i=EXS.inst[x.id],col=`hsl(${[...x.id].reduce((a,c)=>a+c.charCodeAt(0),0)%360} 45% 45%)`;return `<div class="ex-row" onclick="openTab({id:${jsa(`extd:${x.id}`)},title:${jsa(x.n)},kind:'extd',ext:${jsa(x.id)}})"><span class="ex-ic" style="background:${col}">${esc(x.n.charAt(0))}</span><div class="ex-t"><b class="notr">${esc(x.n)}</b><small class="notr">${esc(x.d)}</small><span class="notr">${esc(x.pub)}${x.vsix?' · VSIX':''}${x.bundled?' · bundled':''}</span></div>${i?(x.bundled?'':`<button class="mini" onclick="event.stopPropagation();extToggle(${jsa(x.id)})">${i.on?'Disable':'Enable'}</button>`):`<button class="mini pri" onclick="event.stopPropagation();extInstall(${jsa(x.id)})">Install</button>`}</div>`; }

/* ── corpo do tab de detalhe (VIEW.extd) — publicado; v6 mantém o shim. ── */
function renderExtd(t: { ext?: string }, host: HTMLElement){ hydrateExs(); const x=extAll().find(e=>e.id===t.ext);if(!x){host.innerHTML='<div class="empty">Extension removed.</div>';return;}const i=EXS.inst[x.id],live=({errorlens:'Diagnostics appear at the end of each line in the editor.',prettier:'Prettier: Format Document (Shift+Alt+F) trims trailing spaces, normalises indentation and the final newline.',yaml:'YAML files are validated: tabs, missing kind, and Deployments without resource requests show in Problems.'} as Record<string, string | undefined>)[x.eff??''];
  host.innerHTML=`<div class="page" style="max-width:760px"><div style="display:flex;gap:16px;align-items:center"><span class="ex-ic big" style="background:hsl(${[...x.id].reduce((a,c)=>a+c.charCodeAt(0),0)%360} 45% 45%)">${esc(x.n.charAt(0))}</span><div><h1 class="notr" style="margin:0">${esc(x.n)}</h1><div class="sub notr" style="margin:0">${esc(x.pub)} · <code>${esc(x.id)}</code>${x.ver?' · v'+esc(x.ver):''}</div></div></div>
   <div class="sub" style="margin-top:12px">${esc(x.d)}</div><div style="display:flex;gap:8px;margin:12px 0">${i?(x.bundled?'<span class="tag live">bundled</span>':`<button class="mini" onclick="extToggle(${jsa(x.id)})">${i.on?'Disable':'Enable'}</button><button class="mini" onclick="extRemove(${jsa(x.id)})">Uninstall</button>`):`<button class="mini pri" onclick="extInstall(${jsa(x.id)})">Install</button>`}</div>
   ${x.vsix&&x.contrib?contribSection(x):`<h2>In this prototype</h2><div class="adv ${live?'agent':'mix'}">${svg(live?'check':'bulb')}<div>${live||'Runs in the desktop app\'s VS Code–compatible extension host. Here its commands are listed in the palette but do not run.'}</div></div>`}
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

/** Descarrega o VSIX do Open VSX (backend) e instala-o pelo mesmo caminho de um VSIX do disco. */
async function vsxInstallOpenVsx(): Promise<void> {
  const input = $("#ovsx-id") as HTMLInputElement | null;
  const id = (input ? input.value : "").trim();
  if (!id) {
    toast("Type an extension id, e.g. llvm-vs-code-extensions.vscode-clangd");
    return;
  }
  toast(`Downloading ${id} from Open VSX…`);
  try {
    const bytes = await fetchOpenVsx(id);
    await loadVsix(new File([bytes], `${id}.vsix`));
  } catch (e) {
    toast(`Open VSX: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Renderiza o pane «Extensions»: pesquisa, instaladas, recomendadas e catálogo. */
function renderExtPane(){
  hydrateExs();
  const el = $("#pane-ext"), cx = projectContext().map(c => c[0]), q = EXQ.toLowerCase();
  const { inst, rec, rest } = sectionsFor(extAll(), EXT, id => !!EXS.inst[id], cx, q);
  if (!el) return;
  el.innerHTML = hd("Extensions", `<button title="Install from VSIX…" onclick="$('#vsix-in').click()">${svg("plus")}</button>`) + `<div class="sections"><input class="inp" id="ex-q" placeholder="Search extensions in Open VSX" value="${esc(EXQ)}"><input type="file" id="vsix-in" accept=".vsix" style="display:none">${openVsxRow()}
   <div class="scm-grp">Installed<span class="cnt">${inst.length}</span></div>${inst.map(extRow).join("") || '<div class="sec-empty">None.</div>'}
   ${rec.length ? `<div class="scm-grp">Recommended for this project<span class="cnt">${rec.length}</span></div>${rec.map(extRow).join("")}` : ""}${rest.length ? `<div class="scm-grp">Open VSX</div>${rest.map(extRow).join("")}` : ""}
   <div class="sec-empty">Extensions come from Open VSX — the Microsoft Marketplace terms only allow Microsoft's own products. Availability varies by extension. In the browser only a few behave live (Error Lens, Prettier, YAML); the desktop app runs them all in a VS Code–compatible extension host.</div></div>`;
  const qi = $("#ex-q") as HTMLInputElement | null;
  if (qi) qi.oninput = () => { EXQ = qi.value; renderExtPane(); const n = $("#ex-q") as HTMLInputElement | null; if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } };
  const vi = $("#vsix-in") as HTMLInputElement | null;
  if (vi) vi.onchange = e => { const fs = (e.target as HTMLInputElement).files; if (fs && fs[0]) loadVsix(fs[0]); };
}

/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts) */
RP.ext = renderExtPane;
VIEW.extd = (t, host) => renderExtd(t as { ext?: string }, host);

/* ── publicação no window (via bridge) ──
   Nomes reais (resolvem os onclick inline e as chamadas do resíduo @ts-nocheck de v6).
   Aliases sem o substring migrado p/ as decorações de v6 (diagnostics/paintEd/keydown/
   arranque) lerem o motor: vsxOn=extOn, vsxFmt=formatDoc, vsxCmds=extCmds. */
publish({
  EXT, EXS, saveExt, extOn, extAll, extCmds, extInstall, extRemove, extToggle,
  rerExt, extRow, loadVsix, formatDoc, renderExtPane, renderExtd,
  vsxOn: extOn, vsxFmt: formatDoc, vsxCmds: extCmds,
  // Fase 4: contribuições declarativas — o editor (paintEd/Tab/Ctrl+/) chama-as por global.
  vsxHighlight, vsxSnippet, vsxToggleComment, vsxApplyTheme, vsxInstallOpenVsx,
});

/* Fase 4: os botões novos usam o listener delegado (data-action), não onclick inline. */
bindActions({
  "vsx-theme": { on: "click", run: e => vsxApplyTheme(e.on) },
  "vsx-open-vsx": { on: "click", run: () => { void vsxInstallOpenVsx(); } },
});
