/* ═════════ dxtutor IDE — feature: Explain · Code review · Under the hood ═════════
   Feature-folha da reestruturação por funcionalidade. Detém o cluster co-dev que
   vivia em `v6.ts`: `explainCmd`, `reviewCmd`+`reviewFindings`, `hoodCmd`, e o corpo
   das duas tabs que esses comandos abrem — `renderCreviewView` (VIEW.creview) e
   `renderHoodView` (VIEW.hood) — mais os dados auxiliares `KNOW` (resumos por
   ficheiro para Explain) e `SEVC` (cor por severidade no Code review).

   Fronteira: fica em v6.ts a barra de acções do editor (EACT), o handler global de
   keydown (chords Ctrl+K E/R/U, F5/F9/F10), `badges`, `boot6` e os menus — chamam
   `explainCmd`/`reviewCmd`/`hoodCmd` por nome livre (continuam a resolver via
   `window`, publicados por `bridge.publish(...)` no fim deste módulo). `dlg()` fica em
   v6.ts (partilhado com debug.ts/infra.ts). `lexVariant`/`LXL` (helpers de lexer)
   continuam donos de v6.ts — esta feature lê-os por fachada do bridge.

   ADR-0002, Fase 1: TODA a leitura/escrita de globais passa por
   `./codereview/infrastructure/legacy-bridge` — o ÚNICO ficheiro da feature autorizado
   a tocar `window.*`. Este resíduo deixa de usar nomes globais livres e tipa-se em
   estrito. O bridge lê `window`/`G` no ACTO da chamada (esta feature avalia ANTES de
   app.ts/v6.ts publicarem os seus globais), por isso nada é capturado ansiosamente:
   `FS`/`P_LX`/`cur`/… só são tocados DENTRO das funções, chamadas depois do arranque.
   Mecânica (igual às migrações strict anteriores — diff/graph/tasks): publica-se
   `renderCreviewView`/`renderHoodView` no eval e `VIEW.creview`/`VIEW.hood` (v6.ts)
   ficam shim: `VIEW.creview=(t,host)=>window.renderCreviewView(t,host)`. */

import { esc, svg, S, prov } from "../core";
import type { Finding } from "./codereview/domain/types";
import { reviewFindings as reviewRules } from "./codereview/domain/review";
import { scoreFor } from "./codereview/domain/scoring";
import {
  files,
  currentTabId,
  tabOf,
  short,
  extOf,
  changes,
  openTab,
  pathLexer,
  root,
  pathHistory,
  focusAgent,
  user,
  card,
  liveChat,
  updateAgentUI,
  setActiveProvider,
  sample,
  diagnostics,
  dsLint,
  lexBug,
  LXL,
  lexVariant,
  symbols,
  selText,
  dbgState,
  composeServices,
  publish,
  type Svc,
} from "./codereview/infrastructure/legacy-bridge";

/* ───── Explain ───── */

function curFile(): string {
  const t = tabOf(currentTabId());
  if (t && t.path && files()[t.path]) return t.path;
  const c = changes();
  if (c[0]) return c[0];
  // P_LX (lexer-protótipo) só existe no projecto simulado; num projecto desktop real sem
  // ele, cai para qualquer ficheiro aberto em FS em vez de devolver um caminho inexistente.
  return files()[pathLexer()] ? pathLexer() : Object.keys(files())[0] || pathLexer();
}

/* GOTCHA: esta feature carrega ANTES de app.ts — um `[P_LX]`/`ROOT`/`P_HIST` ansioso
   no eval do módulo seria ReferenceError e pararia o chunk inteiro (como hydrate() em
   features/tasks.ts). KNOW só se constrói na primeira chamada a know(). */
let _KNOW: Record<string, string> | null = null;
function know(p: string): string | undefined {
  if (!_KNOW) {
    _KNOW = {
      [pathLexer()]: `<b>What it does.</b> <code>tokenize</code> walks a string once and turns each ASCII digit into <code>Token::Num</code>, then appends <code>Token::Eof</code> when the input is exhausted.<br><b>How.</b> <code>chars()</code> yields characters; <code>.peekable()</code> adds a one-item look-ahead so the code can ask “is there anything left?” without consuming it.<br><b>The subtle part.</b> The Eof decision depends on <code>chars</code> being exhausted <i>after</i> the loop — so whatever the loop iterates over must be the same iterator, not a copy and not something it takes ownership of.`,
      [root() + 'crates/store/src/conversations.rs']: `<b>What it does.</b> The Repository for conversations: a trait (<code>ConversationRepo</code>) that callers depend on, and a SQLite implementation behind it (ADR-002).<br><b>Why the trait.</b> The UI and the tests depend on the operations, not on SQLite — swapping storage or mocking it needs no UI change.<br><b>Watch.</b> <code>list_recent</code> promises “most recent first”, so its SQL needs <code>ORDER BY created_at DESC</code> and an index that covers it.`,
      [pathHistory()]: `<b>What it does.</b> Renders the “History” section: asks the backend (a Tauri command) for recent conversations and draws a button per conversation.<br><b>Layering.</b> No SQL here — it only talks to the command, as ADR-002 requires.<br><b>Watch.</b> Titles are user text inserted with <code>innerHTML</code>; they must be escaped or set with <code>textContent</code>.`,
    };
  }
  return _KNOW[p];
}

function explainCmd(fromDebug?: boolean): void {
  const p = curFile(), sel = fromDebug ? '' : selText(), f = files()[p];
  focusAgent(true);
  const _ds = dbgState();
  const what = fromDebug && _ds ? `the debugging session I just ran (${_ds.end ? _ds.end.t : ''})` : sel ? `this excerpt from ${short(p)}` : short(p);
  if (sample() && prov().claude.on) {
    setActiveProvider('claude'); updateAgentUI();
    liveChat(fromDebug && _ds ? `Explain in depth, as a senior engineer teaching me, what this debug session found and the underlying concept:\n${_ds.feed.map(x => x.h.replace(/<[^>]+>/g, '')).join('\n')}` : `Explain ${what}: what it does, how, and what a senior would watch out for. Be concrete.\n${sel || f.content.slice(0, 5000)}`);
    return;
  }
  user(`Explain ${what}.`);
  const sy = symbols(p), dg = diagnostics().filter(d => d.p === p), rv = reviewFindings(p).slice(0, 2);
  const kn = know(p);
  card('co-dev · explain', `${fromDebug && _ds && _ds.end ? `<p>${_ds.end.b}</p>` : kn ? `<p>${kn}</p>` : `<p><b>${esc(short(p))}</b> — ${f.content.split('\n').length} lines${sy.length ? `, defines ${sy.slice(0, 6).map(s => `<code>${esc(s.n)}</code>`).join(', ')}` : ''}.</p>${(f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m) || [])[2] ? `<p>${esc((f.content.match(/^\s*(\/\/|#|--)\s*(.+)$/m) || [])[2])}</p>` : ''}`}
   ${dg.length ? `<p><b>Right now:</b> ${dg.map(d => esc(d.msg)).join('; ')}.</p>` : ''}${rv.length ? `<p><b>What I would watch:</b></p><ul>${rv.map(r => `<li>${r.t} (line ${r.l})</li>`).join('')}</ul>` : ''}<p style="color:var(--fg-dim)">With Claude live, Explain answers about the exact code or selection instead of this summary.</p>`);
}

/* ───── Code review ───── */

/* Resíduo: colhe do mundo (FS/extOf/window.lexBug/LXL/dsLint) o que a regra pura
   precisa e delega em `reviewRules` (domain). `lexer` só vai não-nulo para o
   lexer-protótipo (P_LX); o `dsLint` já chega filtrado para este ficheiro. */
function reviewFindings(p: string): Finding[] {
  const f = files()[p];
  if (!f) return [];
  return reviewRules({
    path: p,
    content: f.content,
    ext: extOf(p),
    lexer: p === pathLexer() ? { bug: lexBug(), peekLine: LXL(/chars\.peek/) } : null,
    dsLint: dsLint().filter(v => v.p === p).map(v => ({ line: v.line, hex: v.hex })),
  });
}

function reviewCmd(): void {
  const p = curFile();
  openTab({ id: 'creview:' + p, title: 'Review · ' + p.split('/').pop(), kind: 'creview', path: p });
}

const SEVC: Record<string, string> = { bug: 'var(--red)', risk: 'var(--yellow)', perf: 'var(--blue)', style: 'var(--fg-muted)' };

function renderCreviewView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const fs = reviewFindings(t.path), score = scoreFor(fs);
  host.innerHTML = `<div class="page" style="max-width:860px"><div style="display:flex;align-items:center;gap:14px"><div class="score ${score >= S.THRESH ? 'ok' : 'bad'}">${score}<small>/100</small></div><div><h1 style="margin:0">Code review</h1><div class="sub notr" style="margin:0">${esc(short(t.path))}</div></div><span style="flex:1"></span><button class="mini" onclick="openPath('${t.path}')">Open file</button>${sample() && prov().claude.on ? `<button class="mini pri" onclick="focusAgent(true);liveChat('Review this file as a senior engineer: bugs first, then risks, performance and style. Cite line numbers.\\n'+FS['${t.path}'].content.slice(0,6000))">Deeper review with Claude</button>` : ''}</div>
   <div class="sub" style="margin-top:12px">Rule-based checks for correctness, security, performance and the project rules. They point at evidence; you decide what to change.</div>
   ${fs.length ? fs.map(f => `<div class="rv"><div class="rv-h"><span class="tag" style="color:${SEVC[f.sev]};border-color:${SEVC[f.sev]}">${f.sev}</span><b>${f.t}</b><span class="sp"></span><button class="lnk" onclick="openPath('${t.path}',${f.l})">line ${f.l}</button></div><div class="rv-b"><p>${f.why}</p><p><b>Suggested:</b> ${f.fix}</p></div></div>`).join('') : '<div class="adv agent" style="margin-top:16px">' + svg('check') + '<div>No findings from the rule set. That is not proof of correctness — the tests are.</div></div>'}</div>`;
}

/* ───── Under the hood ───── */

function hoodCmd(): void {
  const p = curFile();
  openTab({ id: 'hood:' + p, title: 'Under the hood · ' + p.split('/').pop(), kind: 'hood', path: p });
}

function renderHoodView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const p = t.path, f = files()[p], ext = extOf(p),
    stg = (n: string, ok: boolean | null, d: string) => `<div class="hs ${ok === false ? 'bad' : ok === null ? 'skip' : 'ok'}"><span>${ok === false ? '✖' : ok === null ? '○' : '✓'}</span><div><b>${n}</b><small>${d}</small></div></div>`;
  let h = '';
  function qplan(fe: { content: string }): string {
    const q = (fe.content.match(/SELECT[^"]*/) || [])[0], idx = Object.keys(files()).some(k => /migrations/.test(k) && /CREATE INDEX idx_conversations_ws_created/.test(files()[k].content));
    return `<h2>Query plan</h2><div class="sub">What SQLite's planner does with the listing query, derived from the migrations in this workspace.</div><pre class="hood-q notr">${esc(q || 'SELECT … FROM conversations WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?')}</pre><div class="hood-p">${idx ? stg('SEARCH conversations USING INDEX idx_conversations_ws_created (workspace_id=?)', true, 'jumps to the workspace, rows already in created_at order — no sort') : stg('SCAN conversations', false, 'reads every row of every workspace') + stg('USE TEMP B-TREE FOR ORDER BY', false, 'sorts the matches in memory before applying LIMIT')}</div>`;
  }
  if (ext === 'rs') {
    const bug = p === pathLexer() && lexBug(), v = p === pathLexer() ? lexVariant() : '';
    h = `<h2>Compiler pipeline</h2><div class="hood-p">${stg('Lex & parse', true, 'source → tokens → syntax tree')}${stg('Name resolution & macros', true, 'paths, use statements, derive(Debug, PartialEq)')}${stg('Type check', true, 'every expression gets a type')}${stg('Borrow check', !bug, bug ? `<code>chars</code> moved into the loop at line ${LXL(/for c in/)}, used again at line ${LXL(/chars\.peek/)} (E0382)` : 'ownership and lifetimes verified')}${stg('MIR & optimisation', bug ? null : true, bug ? 'not reached' : 'mid-level IR, inlining of the iterator chain')}${stg('LLVM codegen', bug ? null : true, bug ? 'not reached' : 'machine code for x86-64 / aarch64')}</div>`;
    if (p === pathLexer()) h += `<h2>Memory</h2><div class="tbl-wrap"><table class="tbl"><tr><th>Value</th><th>Where</th><th>Size</th><th>Why</th></tr><tr><td><code>Token</code></td><td class="c">—</td><td>4 bytes</td><td class="c"><code>Num(char)</code> and <code>Eof</code> fit in one <code>char</code>: Eof uses an invalid code point as its tag (niche optimisation).</td></tr><tr><td><code>tokens: Vec&lt;Token&gt;</code></td><td class="c">stack + heap</td><td>24 B + 4×cap</td><td class="c">pointer, capacity, length on the stack; the first push allocates capacity 4.</td></tr><tr><td><code>chars: Peekable&lt;Chars&gt;</code></td><td class="c">stack</td><td>≈24 bytes</td><td class="c">two pointers into the string plus the peeked slot; no heap allocation.</td></tr></table></div>
      <h2>Ownership of <code>chars</code></h2><div class="hood-o">${[['line ' + LXL(/let mut chars/), 'created', 'owned by tokenize'], ['line ' + LXL(/for c in|while let/), v === 'bug' ? 'moved' : v === 'clone' ? 'copied' : 'borrowed (&mut)', v === 'bug' ? 'into_iter() takes it — gone after the loop' : v === 'clone' ? 'loop owns a second cursor; the original never moves' : 'loop advances the same cursor, then gives it back'], ['line ' + LXL(/chars\.peek/), v === 'bug' ? '✖ use after move' : 'used', v === 'bug' ? 'rejected by the borrow checker' : v === 'clone' ? "peek() sees '1' — Eof skipped" : 'peek() sees the end — Eof pushed']].map(x => `<div><b>${x[0]}</b><span class="tag ${/✖|copied/.test(x[1]) ? 'bad' : ''}">${x[1]}</span><small>${x[2]}</small></div>`).join('')}</div><div class="sub">Time O(n), one pass; memory O(n) for the tokens.</div>`;
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
  host.innerHTML = `<div class="page" style="max-width:860px"><h1>Under the hood</h1><div class="sub notr">${esc(short(p))}</div>${h}<div class="sub" style="margin-top:20px">Derived from the code in this workspace. The desktop app adds measured CPU, memory and I/O from a real run.</div></div>`;
}

/* ── publicação no window (confinada ao bridge via `publish`): `renderCreviewView`/
   `renderHoodView` são o alvo directo do shim VIEW.creview/VIEW.hood (v6.ts); o resto
   (curFile/explainCmd/reviewCmd/hoodCmd/reviewFindings) é lido por nome livre pelo
   resíduo @ts-nocheck de v6.ts (EACT, keydown, boot6/menus) e por debug.ts (onclick
   "explainCmd(true)"). ── */
publish({ renderCreviewView, renderHoodView, curFile, explainCmd, hoodCmd, reviewCmd, reviewFindings });
