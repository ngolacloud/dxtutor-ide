/* ═════════ dxtutor IDE — feature: Explain · Code review · Under the hood ═════════
   Resíduo strangler + raiz de COMPOSIÇÃO da feature (FORA de `features/codereview/`,
   logo não governado por A7/A8). Faz três coisas: (1) liga os adaptadores do bridge
   (infra) às portas do motor (application) — constrói-os e injecta-os em
   `makeReviewEngine`; (2) é DONO do DOM/markup — `renderCreviewView` (VIEW.creview),
   `renderHoodView` (VIEW.hood), o presenter `explainCard` e o conteúdo `KNOW`/`SEVC`;
   (3) re-publica a superfície pública no `window`.

   ADR-0002, Fase 3: a orquestração — `curFile`/`reviewFindings`/`reviewCmd`/`hoodCmd`/
   `explainCmd` — saiu daqui para `codereview/application/review-engine.ts`, pura e com
   deps injectadas por porta (`codereview/application/ports.ts`). Este ficheiro deixou
   de a conter: só a COMPÕE (com os adaptadores do bridge) e a RE-PUBLICA. O motor não
   monta markup — o Explain colhe os factos e entrega-os à porta `view.explainCard`,
   implementada aqui (a view é dona do cartão e do mapa `KNOW`).

   Fronteira: fica em v6.ts a barra de acções do editor (EACT), o handler global de
   keydown (chords Ctrl+K E/R/U, F5/F9/F10), `badges`, `boot6` e os menus — chamam
   `explainCmd`/`reviewCmd`/`hoodCmd` por nome livre (resolvem via `window`, publicados
   por `publish(...)` no fim deste módulo). `dlg()` fica em v6.ts (partilhado com
   debug.ts/infra.ts). `lexVariant`/`LXL` (helpers de lexer) continuam donos de v6.ts —
   lidos por fachada do bridge. Mecânica (igual às migrações strict anteriores): publica-se
   `renderCreviewView`/`renderHoodView`, e `VIEW.creview`/`VIEW.hood` registam-se aqui
   (ADR-0004, U4g1 — antes eram shims no v6.ts). */

import { esc, svg, S, prov } from "../core";
import { VIEW } from "../app/store/registry";
import type { Finding } from "./codereview/domain/types";
import { scoreFor } from "./codereview/domain/scoring";
import { makeReviewEngine } from "./codereview/application/review-engine";
import type { ExplainCard } from "./codereview/application/ports";
import { bindActions, type ActionTable } from "./codereview/ui/actions";
import {
  files,
  currentTabId,
  tabOf,
  short,
  extOf,
  changes,
  openTab,
  openPath,
  focusAgent,
  user,
  card,
  liveChat,
  updateAgentUI,
  setActiveProvider,
  sample,
  diagnostics,
  symbols,
  selText,
  dbgState,
  composeServices,
  publish,
  type Svc,
} from "./codereview/infrastructure/legacy-bridge";

/* Presenter do cartão de Explain: a porta `view.explainCard` que o motor chama com
   dados simples. A view é dona do markup (o texto fixo `KNOW` dos ficheiros de demonstração
   saiu — ADR-0005, R1c1). */
function explainCard(c: ExplainCard): void {
  card('co-dev · explain', `${c.dbgEnd ? `<p>${c.dbgEnd}</p>` : `<p><b>${esc(short(c.path))}</b> — ${c.lineCount} lines${c.symbols.length ? `, defines ${c.symbols.slice(0, 6).map(s => `<code>${esc(s.n)}</code>`).join(', ')}` : ''}.</p>${c.firstComment ? `<p>${esc(c.firstComment)}</p>` : ''}`}
   ${c.diagnostics.length ? `<p><b>Right now:</b> ${c.diagnostics.map(m => esc(m)).join('; ')}.</p>` : ''}${c.findings.length ? `<p><b>What I would watch:</b></p><ul>${c.findings.map(r => `<li>${r.t} (line ${r.l})</li>`).join('')}</ul>` : ''}<p style="color:var(--fg-dim)">With Claude live, Explain answers about the exact code or selection instead of this summary.</p>`);
}

/* ───── raiz de composição: adaptadores do bridge (infra) → portas do motor (application).
   O motor fica puro (sem window/DOM/HTML); os adaptadores lêem o mundo pelo bridge. ───── */
const engine = makeReviewEngine({
  workspace: {
    files: () => files(),
    currentTabId: () => currentTabId(),
    tabOf: id => tabOf(id),
    short: p => short(p),
    extOf: p => extOf(p),
    changes: () => changes(),
    open: tab => openTab(tab),
  },
  agent: {
    focus: nofocus => focusAgent(nofocus),
    user: msg => user(msg),
    liveChat: q => liveChat(q),
    updateUI: () => updateAgentUI(),
    setActiveProvider: v => setActiveProvider(v),
    sample: () => sample(),
    claudeOn: () => prov().claude.on,
  },
  diagnostics: { all: () => diagnostics() },
  code: { symbols: p => symbols(p), selText: () => selText(), dbgState: () => dbgState() },
  view: { explainCard },
});
const { curFile, reviewFindings, reviewCmd, hoodCmd, explainCmd } = engine;

/* ───── Code review — markup da tab (dono da view) ───── */

const SEVC: Record<string, string> = { bug: 'var(--red)', risk: 'var(--yellow)', perf: 'var(--blue)', style: 'var(--fg-muted)' };

function renderCreviewView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const fs: Finding[] = reviewFindings(t.path), score = scoreFor(fs);
  host.innerHTML = `<div class="page" style="max-width:860px"><div style="display:flex;align-items:center;gap:14px"><div class="score ${score >= S.THRESH ? 'ok' : 'bad'}">${score}<small>/100</small></div><div><h1 style="margin:0">Code review</h1><div class="sub notr" style="margin:0">${esc(short(t.path))}</div></div><span style="flex:1"></span><button class="mini" data-action="open-file" data-on="${esc(t.path)}">Open file</button>${sample() && prov().claude.on ? `<button class="mini pri" data-action="deeper-review" data-on="${esc(t.path)}">Deeper review with Claude</button>` : ''}</div>
   <div class="sub" style="margin-top:12px">Rule-based checks for correctness, security, performance and the project rules. They point at evidence; you decide what to change.</div>
   ${fs.length ? fs.map(f => `<div class="rv"><div class="rv-h"><span class="tag" style="color:${SEVC[f.sev]};border-color:${SEVC[f.sev]}">${f.sev}</span><b>${f.t}</b><span class="sp"></span><button class="lnk" data-action="open-line" data-on="${f.l}:${esc(t.path)}">line ${f.l}</button></div><div class="rv-b"><p>${f.why}</p><p><b>Suggested:</b> ${f.fix}</p></div></div>`).join('') : '<div class="adv agent" style="margin-top:16px">' + svg('check') + '<div>No findings from the rule set. That is not proof of correctness — the tests are.</div></div>'}</div>`;
}

/* ───── Under the hood — markup da tab (dono da view) ───── */

function renderHoodView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const p = t.path, f = files()[p], ext = extOf(p),
    stg = (n: string, ok: boolean | null, d: string) => `<div class="hs ${ok === false ? 'bad' : ok === null ? 'skip' : 'ok'}"><span>${ok === false ? '✖' : ok === null ? '○' : '✓'}</span><div><b>${n}</b><small>${d}</small></div></div>`;
  let h = '';
  /* O plano deriva do código: a tabela e a coluna do WHERE e os CREATE INDEX das
     migrações deste workspace (ADR-0005, R1c1 — antes o nome do índice era o do demo). */
  function qplan(fe: { content: string }): string {
    const q = (fe.content.match(/SELECT[^"]*/) || [])[0];
    if (!q) return '';
    const table = (q.match(/\bFROM\s+(\w+)/i) || [])[1], col = (q.match(/\bWHERE\s+(\w+)\s*=/i) || [])[1];
    const idx = table && col ? Object.keys(files()).map(k => files()[k].content.match(new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF NOT EXISTS\\s+)?(\\w+)\\s+ON\\s+${table}\\s*\\(\\s*${col}\\b`, 'i'))).find(Boolean) : null;
    return `<h2>Query plan</h2><div class="sub">What the planner can do with this query, derived from the CREATE INDEX statements in this workspace. Run <code>EXPLAIN QUERY PLAN</code> against the database to confirm.</div><pre class="hood-q notr">${esc(q)}</pre><div class="hood-p">${!table || !col ? stg('No WHERE on a column', null, 'nothing to look up by index') : idx ? stg(`SEARCH ${esc(table)} USING INDEX ${esc(idx[1])} (${esc(col)}=?)`, true, 'jumps straight to the matching rows') : stg(`SCAN ${esc(table)}`, false, `no index on ${esc(table)}(${esc(col)}) in this workspace — every row is read`)}</div>`;
  }
  if (ext === 'rs') {
    /* as fases do compilador explicadas, sem as dar por verificadas: nada aqui compilou o ficheiro */
    h = `<h2>Compiler pipeline</h2><div class="sub">What rustc does with this file. Build it (or open the Problems panel) to see where it actually stops.</div><div class="hood-p">${stg('Lex & parse', null, 'source → tokens → syntax tree')}${stg('Name resolution & macros', null, 'paths, use statements, derives and macro expansion')}${stg('Type check', null, 'every expression gets a type')}${stg('Borrow check', null, 'ownership and lifetimes')}${stg('MIR & optimisation', null, 'mid-level IR, inlining')}${stg('LLVM codegen', null, 'machine code for the target')}</div>`;
  }
  if (ext === 'rs' && /SELECT/.test(f.content)) h += qplan(f);
  else if (ext === 'sql') h = qplan(f);
  if (ext === 'rs' || ext === 'sql') { /* já tratado acima */ }
  else if (['ts', 'js', 'jsx'].includes(ext)) h = `<h2>Build & runtime</h2><div class="hood-p">${stg('tsc type check', !/:\s*any\b/.test(f.content) || null, 'types erased after checking')}${stg('esbuild / Vite transform', true, 'TS → JS, one module per file in dev')}${stg('Bundle', true, 'tree-shaken into the desktop app')}${/innerHTML/.test(f.content) ? stg('innerHTML write', false, 'the browser parses the string as HTML: costs a parse + style recalc, and runs any markup inside it') : ''}${/invoke</.test(f.content) ? stg('Tauri IPC', true, 'JSON-serialised call into the Rust backend, async') : ''}</div>`;
  else if (/Dockerfile$/.test(p)) h = `<h2>Image layers</h2><div class="sub">Each instruction is a cached layer; a change invalidates it and every layer after it.</div><div class="hood-p">${f.content.split('\n').filter(l => /^(FROM|COPY|RUN|USER|ENV|EXPOSE|CMD|ENTRYPOINT|WORKDIR)/.test(l)).map(l => stg(esc(l), /^COPY src/.test(l) && /cargo build/.test(f.content) ? false : true, /^FROM/.test(l) ? 'base layer' : /^COPY src/.test(l) ? 'changes on every edit — everything below rebuilds' : /^RUN/.test(l) ? 'cached until a layer above changes' : 'metadata only')).join('')}</div>`;
  else if (/docker-compose\.yml$/.test(p)) {
    const sv: Svc[] = composeServices() || [], order: Svc[] = [];
    const vis = (s: Svc): void => { if (order.includes(s)) return; s.deps.forEach(d => { const x = sv.find(y => y.name === d); if (x) vis(x); }); order.push(s); };
    sv.forEach(vis);
    h = `<h2>Start order</h2><div class="hood-p">${order.map((s, i) => stg(`${i + 1}. ${esc(s.name)}`, true, `${s.build ? 'build ./' + esc(s.build) : esc(s.image || '')}${s.deps.length ? ' · after ' + s.deps.map(esc).join(', ') : ''}${s.hc ? ' · healthcheck' : ''}`)).join('')}</div>`;
  } else h = `<div class="sub">${f.content.split('\n').length} lines · ${f.content.length} bytes. No deeper view for this file type yet.</div>`;
  host.innerHTML = `<div class="page" style="max-width:860px"><h1>Under the hood</h1><div class="sub notr">${esc(short(p))}</div>${h}<div class="sub" style="margin-top:20px">Derived from the code in this workspace.</div></div>`;
}

/* ── publicação no window (confinada ao bridge via `publish`): `renderCreviewView`/
   `renderHoodView` (também registados em VIEW.creview/VIEW.hood, abaixo); o resto
   (curFile/explainCmd/reviewCmd/hoodCmd/reviewFindings) é lido por nome livre pelo
   resíduo @ts-nocheck de v6.ts (EACT, keydown, boot6/menus) e por debug.ts (onclick
   "explainCmd(true)"). ── */
publish({ renderCreviewView, renderHoodView, curFile, explainCmd, hoodCmd, reviewCmd, reviewFindings });

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (emitido como `data-action` pelo markup de
   `renderCreviewView`) ao efeito. Fica aqui — no resíduo de composição, não na
   subárvore `features/codereview/` governada por A7/A8 — porque só este ficheiro tem
   à mão o bridge (`openPath`/`focusAgent`/`liveChat`/`files`). Os três handlers
   substituem os `onclick` inline, todos `click`:
     • open-file     — `openPath(p)`         (botão «Open file»)
     • open-line     — `openPath(p, linha)`  (botão «line N» de cada achado)
     • deeper-review — lê o ficheiro NO CLIQUE e pede revisão ao Claude ao vivo
   O payload viaja SÓ em `data-on` (o golden strippa data-action/data-on; um `data-*`
   à medida vazava). `open-line` carrega `linha:caminho` — linha primeiro (inteiro
   puro, sem `:`), por isso parte-se no PRIMEIRO `:` e o resto é o caminho intacto.
   O caminho é escapado com `esc` à saída (era interpolado cru num literal JS dentro
   do `onclick` — o vector de injecção que o ADR apontou); nos caminhos semeados/de
   teste (`crates/lexer/src/lib.rs`, `svc/load.rs`, …) `esc` é no-op, logo a saída
   visível não muda. `deeper-review` reproduz o antigo `focusAgent(true);liveChat(…)`
   que compunha o prompt a partir de `FS[path].content.slice(0,6000)` no momento do
   clique — aqui `files()[e.on].content`, idêntico. */
const DEEPER_PROMPT =
  "Review this file as a senior engineer: bugs first, then risks, performance and style. Cite line numbers.\n";
const ACTIONS: ActionTable = {
  "open-file": { on: "click", run: (e) => openPath(e.on) },
  "open-line": {
    on: "click",
    run: (e) => { const i = e.on.indexOf(":"); openPath(e.on.slice(i + 1), +e.on.slice(0, i)); },
  },
  "deeper-review": {
    on: "click",
    run: (e) => { focusAgent(true); liveChat(DEEPER_PROMPT + files()[e.on].content.slice(0, 6000)); },
  },
};
bindActions(ACTIONS);

/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts; o visualizer decora o
   VIEW.hood no boot7, e continua a decorar esta versão) */
VIEW.creview = renderCreviewView;
VIEW.hood = renderHoodView;
