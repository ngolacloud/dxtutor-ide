/* ═════════ dxtutor IDE — feature: Explain · Code review · Under the hood ═════════
   Resíduo strangler + raiz de COMPOSIÇÃO da feature (FORA de `features/codereview/`,
   logo não governado por A7/A8). Faz quatro coisas: (1) liga os adaptadores do bridge
   (infra) às portas do motor (`makeReviewEngine`) e do painel (`makeDocSession`); (2) é
   DONO do DOM — o painel de documento ao lado do código (`#cr-side`), a tab
   `renderCreviewView` (VIEW.creview) e `renderHoodView` (VIEW.hood); (3) tem a tabela de
   acções; (4) re-publica no `window` o que ainda é lido por nome (`hoodCmd`).

   O Explain e o Code review já não respondem no chat do Co-Dev: abrem o painel à direita
   do editor. O Explain mostra o documento markdown a chegar (pré-visualização com realce, ou
   o texto); sem modelo, o resumo local. O Code review mostra a revisão interactiva (pontuação,
   filtros por severidade, cartões com o excerto, «Fix with AI», «Dismiss», os analisadores)
   e a revisão com IA, de onde sai o ficheiro inteiro melhorado com «Compare», «Apply»,
   «Apply & test» (a suite do projecto, `run_tests`) e «Revert». A tab de Code review continua
   (o «Open as tab» do painel) com a mesma revisão interactiva.

   Fronteira: a barra de acções do editor (EACT, `tabs.ts`), os atalhos (Ctrl+K E/R/U,
   `shortcuts.ts`) e os comandos (`app/commands.ts`) chamam `explainCmd`/`reviewCmd` por
   import e o `hoodCmd` pelo `window`. */

import { esc, svg, S, toast, rerender } from "../core";
import { VIEW } from "../app/store/registry";
import type { AnalyzerReport, Finding } from "./codereview/domain/types";
import { tauriReview, tauriSuite } from "./codereview/infrastructure/tauri";
import { scoreFor } from "./codereview/domain/scoring";
import { makeReviewEngine } from "./codereview/application/review-engine";
import { makeDocSession, type DocState } from "./codereview/application/doc-session";
import { DOC_COPY } from "./codereview/application/messages";
import { bindActions, type ActionTable } from "./codereview/ui/actions";
import { docHtml, docBlocks, filterBar, findingCards, scoreRing, extOfLang, type ReviewFindingView, type ReviewUi } from "./codereview/ui/doc-view";
import { diffLines, MAX_CELLS } from "./diff/domain/diff";
import { codevAsk } from "../app/codev-ask";
import {
  files,
  currentTabId,
  tabOf,
  short,
  extOf,
  changes,
  openTab,
  openPath,
  diagnostics,
  symbols,
  selText,
  selLine,
  hlLine,
  writeFile,
  aiReady,
  aiStream,
  saveAll,
  composeServices,
  publish,
  desktopRoot,
  fsRoot,
  type Svc,
} from "./codereview/infrastructure/legacy-bridge";
import { translator, currentLocale } from "../app/i18n";
import { CODEREVIEW_MESSAGES } from "./codereview/ui/messages";
import { ANALYZER_MESSAGES } from "./codereview/ui/analyzer-messages";
import { DOC_MESSAGES } from "./codereview/ui/doc-messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(CODEREVIEW_MESSAGES);
const txa = translator(ANALYZER_MESSAGES);
const td = translator(DOC_MESSAGES);
const ic = (n: string): string => svg(n);

/* ───── o painel de documento ao lado do código ─────
   O Explain e a revisão com IA respondem num painel à direita do editor (não no chat): o
   caso de uso `doc-session.ts` pede ao modelo e guarda o estado; aqui vive o DOM (o `<aside
   id="cr-side">` dentro da `.ebody`, irmão do `#ebody` — sobrevive à troca de separadores) e
   o estado de apresentação. Desenha-se por `requestAnimationFrame` (um stream manda muitos
   pedaços) e o corpo mantém o scroll; colado ao fundo, acompanha o texto a chegar. */
interface PanelUi {
  mode: "explain" | "review";
  path: string;
  tab: "findings" | "ai";
  view: "preview" | "markdown";
  codeView: "code" | "diff";
  width: number;
}
const PANEL: PanelUi = { mode: "explain", path: "", tab: "findings", view: "preview", codeView: "code", width: 480 };
/** filtros, descartados e «mostrar descartados» da revisão, por ficheiro (o painel e a tab partilham-nos) */
const RV = new Map<string, ReviewUi>();
const rvUi = (p: string): ReviewUi => { let u = RV.get(p); if (!u) RV.set(p, (u = { filter: [], dismissed: [], showDismissed: false })); return u; };
/** o relatório dos analisadores no painel, por ficheiro (não se repete a cada pedaço do stream) */
const AN = new Map<string, { html: string; done: boolean }>();

const session = makeDocSession({
  ai: { ready: () => aiReady(), stream: (q, o) => aiStream(q, o) },
  files: {
    read: (p) => files()[p]?.content ?? null,
    write: (p, c) => writeFile(p, c),
    ext: (p) => extOf(p),
    short: (p) => short(p),
  },
  tests: {
    unavailable: () => (!desktopRoot() ? td("noTestsBrowser") : null),
    run: async () => {
      await saveAll();
      const r = await tauriSuite().run(desktopRoot()!);
      return { ran: true, passed: r.ok, output: `$ ${r.command}\n${r.stdout}${r.stderr ? "\n" + r.stderr : ""}` };
    },
  },
  view: { render: () => schedule() },
  lang: () => currentLocale(),
  copy: translator(DOC_COPY),
});

const ebodyHost = (): HTMLElement | null => document.getElementById("ebody")?.parentElement ?? null;
const sideEl = (): HTMLElement | null => document.getElementById("cr-side");

function ensurePanel(): HTMLElement | null {
  const host = ebodyHost();
  if (!host) return null;
  let el = sideEl();
  if (!el) {
    el = document.createElement("aside");
    el.id = "cr-side";
    el.className = "cr-side";
    el.innerHTML = `<div class="cr-resize" title="${esc(td("resize"))}"></div><div class="cr-hd"></div><div class="cr-sub"></div><div class="cr-body"></div>`;
    host.appendChild(el);
    bindResize(el, host);
  }
  host.classList.add("cr-split");
  host.style.setProperty("--cr-w", PANEL.width + "px");
  return el;
}

function bindResize(el: HTMLElement, host: HTMLElement): void {
  const grip = el.querySelector<HTMLElement>(".cr-resize")!;
  grip.addEventListener("mousedown", (ev) => {
    ev.preventDefault();
    const x0 = ev.clientX, w0 = PANEL.width;
    const move = (e: MouseEvent) => {
      const max = Math.max(320, host.clientWidth - 260);
      PANEL.width = Math.round(Math.min(max, Math.max(300, w0 + (x0 - e.clientX))));
      host.style.setProperty("--cr-w", PANEL.width + "px");
    };
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); document.body.classList.remove("cr-dragging"); };
    document.body.classList.add("cr-dragging");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}

function closePanel(): void {
  session.close();
  sideEl()?.remove();
  const host = ebodyHost();
  if (host) { host.classList.remove("cr-split"); host.style.removeProperty("--cr-w"); }
}

let raf = 0;
function schedule(): void {
  if (raf) return;
  const run = () => { raf = 0; renderPanel(); };
  if (typeof requestAnimationFrame === "function") raf = requestAnimationFrame(run) as unknown as number;
  else { raf = 1; setTimeout(run, 0); }
}

/** O estado do documento que o painel mostra agora (no modo revisão, só o deste ficheiro). */
function shownDoc(): DocState | null {
  const s = session.state();
  if (!s) return null;
  if (PANEL.mode === "explain") return s.kind === "explain" ? s : null;
  return s.kind !== "explain" && s.path === PANEL.path ? s : null;
}

function statusTag(s: DocState | null): string {
  if (!s) return "";
  const k = s.status === "streaming" ? "writing" : s.status === "local" ? "local" : s.status === "stopped" ? "stopped" : s.status === "error" ? "failed" : s.status === "done" ? "done" : null;
  return k ? `<span class="cr-st st-${s.status}">${s.status === "streaming" ? '<span class="cr-dot"></span>' : ""}${esc(td(k))}</span>` : "";
}

function docTools(s: DocState | null): string {
  if (!s) return "";
  const seg = `<span class="cr-seg"><button class="${PANEL.view === "preview" ? "on" : ""}" data-action="cr:view" data-on="preview">${esc(td("preview"))}</button><button class="${PANEL.view === "markdown" ? "on" : ""}" data-action="cr:view" data-on="markdown">${esc(td("markdown"))}</button></span>`;
  const run = s.status === "streaming"
    ? `<button class="cr-ib" data-action="cr:stop" title="${esc(td("stop"))}">■</button>`
    : s.status !== "local" ? `<button class="cr-ib" data-action="cr:regenerate" title="${esc(td("regenerate"))}">${ic("refresh")}</button>` : "";
  const chat = codevAsk.available() && s.text ? `<button class="cr-ib" data-action="cr:to-chat" title="${esc(td("toChat"))}">${ic("sparkle")}</button>` : "";
  return `${seg}${s.text ? `<button class="cr-ib" data-action="cr:copy-doc" title="${esc(td("copy"))}">⧉</button>` : ""}${run}${chat}`;
}

function reviewFindingViews(p: string): ReviewFindingView[] {
  const ls = (files()[p]?.content ?? "").split("\n");
  return reviewFindings(p).map((f) => {
    const from = Math.max(1, f.l - 2), to = Math.min(ls.length, f.l + 2);
    return { key: `${f.l}:${f.t}`, line: f.l, sev: f.sev, title: f.t, why: f.why, fix: f.fix, snippet: { from, code: ls.slice(from - 1, to).join("\n") } };
  });
}

function improvedDiff(s: DocState) {
  if (!s.improved) return null;
  const cur = files()[s.path]?.content ?? s.original;
  const base = s.applied ? s.applied.prev : cur;
  const a = base.split("\n").length, b = s.improved.code.split("\n").length;
  return a * b > MAX_CELLS ? [] : diffLines(base, s.improved.code);
}

function renderPanel(): void {
  const el = sideEl();
  if (!el) return;
  const p = PANEL.path, s = shownDoc(), name = p.split("/").pop() || p;
  el.dataset.mode = PANEL.mode;
  const title = PANEL.mode === "explain"
    ? `${ic("bulb")}<div class="cr-ttl"><b>${esc(td("explain"))}</b><small class="notr" title="${esc(short(p))}">${esc(name)}${s?.from ? " · " + esc(td("excerpt", { n: s.from })) : ""}</small></div>`
    : `${ic("review")}<div class="cr-ttl"><b>${esc(td("review"))}</b><small class="notr" title="${esc(short(p))}">${esc(name)}</small></div>`;
  const right = PANEL.mode === "review"
    ? `${PANEL.tab === "ai" ? docTools(s) : `<button class="cr-ib" data-action="cr:rerun" title="${esc(td("rerun"))}">${ic("refresh")}</button>`}<button class="cr-ib" data-action="cr:as-tab" title="${esc(td("asTab"))}">${ic("popout")}</button>`
    : docTools(s);
  el.querySelector(".cr-hd")!.innerHTML = `${title}${statusTag(PANEL.mode === "review" && PANEL.tab !== "ai" ? null : s)}<span class="sp"></span>${right}<button class="cr-ib" data-action="cr:close" title="${esc(td("close"))}">${ic("close")}</button>`;
  const sub = el.querySelector<HTMLElement>(".cr-sub")!;
  const body = el.querySelector<HTMLElement>(".cr-body")!;
  /* o mesmo conteúdo (o stream, um filtro) mantém o scroll; outro documento, modo ou separador começa no topo */
  const key = `${PANEL.mode}|${p}|${PANEL.tab}|${s ? s.id : ""}`, same = el.dataset.key === key;
  el.dataset.key = key;
  const atEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 40, top = same ? body.scrollTop : 0;
  if (PANEL.mode === "review") {
    const fv = reviewFindingViews(p), ui = rvUi(p), score = scoreFor(reviewFindings(p));
    sub.innerHTML = `<div class="cr-rsum">${scoreRing(score, score >= S.THRESH)}<div class="cr-rsum-t">${filterBar(p, fv, ui, td)}</div></div><div class="cr-tabs"><button class="${PANEL.tab === "findings" ? "on" : ""}" data-action="cr:tab" data-on="findings">${esc(td("findings"))} <b>${fv.filter((f) => !ui.dismissed.includes(f.key)).length}</b></button><button class="${PANEL.tab === "ai" ? "on" : ""}" data-action="cr:tab" data-on="ai">${ic("sparkle")} ${esc(td("aiReview"))}</button></div>`;
    if (PANEL.tab === "findings") {
      const an = AN.get(p);
      body.innerHTML = `<div class="sub cr-rules">${esc(td("rulesNote"))}</div>${findingCards(p, fv, ui, hlLine, td, extOf(p), aiReady(), ic)}${an ? `<div class="cr-analyzers">${an.html}</div>` : ""}`;
    } else {
      body.innerHTML = s
        ? docHtml(s, PANEL, hlLine, td, s.improved ? extOfLang(s.improved.lang) || extOf(p) : extOf(p), improvedDiff(s), ic)
        : aiCta();
    }
  } else {
    sub.innerHTML = "";
    body.innerHTML = s ? docHtml(s, PANEL, hlLine, td, extOf(s.path), null, ic) : "";
  }
  body.scrollTop = same && s?.status === "streaming" && atEnd ? body.scrollHeight : top;
}

function aiCta(): string {
  const ready = aiReady();
  return `<div class="cr-cta">${ic("sparkle")}<h3>${esc(td("aiCta"))}</h3><p>${esc(td("aiCtaSub"))}</p>${ready ? `<button class="btn pri" data-action="cr:ai-review">${esc(td("aiCta"))}</button>` : `<div class="cr-note">${esc(td("aiNeedsModel"))}</div>`}</div>`;
}

/** O ficheiro fica à vista ao lado do painel: se o separador activo não é ele, abre-o. */
function showFile(p: string): void {
  const t = tabOf(currentTabId());
  if (!t || t.path !== p || (t.kind !== "file" && t.kind !== "creview")) openPath(p);
}

function openDoc(mode: "explain" | "review", p: string): void {
  PANEL.mode = mode;
  PANEL.path = p;
  if (!ensurePanel()) return;
  renderPanel();
}

function openReviewPanel(p: string, tab: "findings" | "ai" = "findings"): void {
  showFile(p);
  PANEL.tab = tab;
  openDoc("review", p);
  loadAnalyzers(p);
}

function loadAnalyzers(p: string, force = false): void {
  const root = desktopRoot(), pre = fsRoot();
  if (!root || !p.startsWith(pre) || (AN.get(p) && !force)) return;
  AN.set(p, { html: '<h2>Analisadores do projecto</h2><div class="sub">' + txa("running") + "</div>", done: false });
  tauriReview().file(root, p.slice(pre.length)).then(
    (r) => { AN.set(p, { html: analyzersHtml(r, pre), done: true }); schedule(); },
    (e) => { AN.set(p, { html: `<h2>Analisadores do projecto</h2><div class="sub" style="color:var(--red)">A revisão falhou: ${esc(e instanceof Error ? e.message : String(e))}</div>`, done: true }); schedule(); },
  );
}

function findingsFor(p: string): { line: number; sev: string; title: string }[] {
  const strip = (h: string) => h.replace(/<[^>]+>/g, "");
  const ui = rvUi(p);
  return reviewFindings(p).filter((f) => !ui.dismissed.includes(`${f.l}:${f.t}`)).map((f) => ({ line: f.l, sev: f.sev, title: strip(f.t) }));
}

function startAiReview(p: string, focusKey: string | null = null): void {
  const f = focusKey ? reviewFindings(p).find((x) => `${x.l}:${x.t}` === focusKey) : null;
  openReviewPanel(p, "ai");
  session.review(p, findingsFor(p), f ? { line: f.l, title: f.t.replace(/<[^>]+>/g, "") } : null);
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
  diagnostics: { all: () => diagnostics() },
  code: { symbols: p => symbols(p), selText: () => selText(), selLine: () => selLine() },
  doc: {
    explain: (req) => { openDoc("explain", req.path); session.explain(req); },
    review: (req) => openReviewPanel(req.path),
  },
});
const { curFile, reviewFindings, reviewCmd, reviewTab, hoodCmd, explainCmd } = engine;

/* ───── Code review — a tab (a mesma revisão interactiva, em ecrã inteiro) ───── */

function renderCreviewView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const fs: Finding[] = reviewFindings(t.path), score = scoreFor(fs);
  const fv = reviewFindingViews(t.path), ui = rvUi(t.path), P = esc(t.path), ai = aiReady();
  host.innerHTML = `<div class="page cr-page" style="max-width:900px"><div class="cr-top">${scoreRing(score, score >= S.THRESH)}<div><h1 style="margin:0">Code review</h1><div class="sub notr" style="margin:0">${esc(short(t.path))}</div></div><span style="flex:1"></span><button class="mini" data-action="open-file" data-on="${P}">${txt("openFile")}</button>${ai ? `<button class="mini pri" data-action="cr:ai-review" data-on="${P}">${ic("sparkle")}<span>${esc(td("aiCta"))}</span></button>` : ""}</div>
   <div class="sub" style="margin-top:12px">${esc(td("rulesNote"))}</div>${filterBar(t.path, fv, ui, td)}${findingCards(t.path, fv, ui, hlLine, td, extOf(t.path), ai, ic)}</div>`;
  analyzersSection(t.path, host);
}

/* ───── os analisadores reais do projecto (ADR-0006, R2e2) ─────
   No desktop com pasta aberta, a tab junta às regras locais (instantâneas) o que os
   analisadores instalados dizem do ficheiro no disco (`review_code`, âmbito `file`):
   clippy/rustc, go vet, ruff, … com a classe honesta (bug/risco/oportunidade), a regra, a
   evidência, a consequência e como verificar — e que analisadores correram ou faltam. No
   browser não há backend: a secção não aparece (os goldens ficam intactos). Um resultado que
   chega depois de a tab mudar de ficheiro (ou de ser fechada) não pinta. */
const CLASS_COL: Record<string, string> = { bug: 'var(--red)', risk: 'var(--yellow)', opportunity: 'var(--blue)' };
const CLASS_PT: Record<string, string> = { bug: 'bug', risk: 'risco', opportunity: 'oportunidade' };
const STATUS_PT: Record<string, string> = { ran: 'correu', failed: 'falhou', unavailable: 'não instalado', skipped: 'não se aplica' };

function analyzersSection(path: string, host: HTMLElement): void {
  const root = desktopRoot(), pre = fsRoot();
  if (!root || !path.startsWith(pre)) return;
  const page = host.querySelector('.page') || host;
  const sec = document.createElement('div');
  sec.className = 'cr-analyzers';
  sec.innerHTML = '<h2>Analisadores do projecto</h2><div class="sub">' + txa("running") + '</div>';
  page.appendChild(sec);
  const rel = path.slice(pre.length);
  tauriReview().file(root, rel).then(
    (r) => { if (sec.isConnected) sec.innerHTML = analyzersHtml(r, pre); },
    (e) => { if (sec.isConnected) sec.innerHTML = `<h2>Analisadores do projecto</h2><div class="sub" style="color:var(--red)">A revisão falhou: ${esc(e instanceof Error ? e.message : String(e))}</div>`; },
  );
}

function analyzersHtml(r: AnalyzerReport, pre: string): string {
  const runs = r.analyzers.map((a) => `<span class="tag" title="${esc(a.detail || '')}" style="${a.status === 'ran' ? 'color:var(--green);border-color:var(--green)' : a.status === 'failed' ? 'color:var(--red);border-color:var(--red)' : ''}">${esc(a.id)} · ${STATUS_PT[a.status] || esc(a.status)}</span>`).join(' ');
  const ran = r.analyzers.some((a) => a.status === 'ran');
  const fs = r.findings.map((f) => {
    const col = CLASS_COL[f.class] || 'var(--fg-muted)', key = pre + f.primary.file;
    const extra = [f.evidence ? `<pre class="notr" style="font-size:11px;white-space:pre-wrap">${esc(f.evidence)}</pre>` : '', f.consequence ? `<div><b>Se ficar:</b> ${esc(f.consequence)}</div>` : '', f.verification ? `<div><b>Verificar:</b> ${esc(f.verification)}</div>` : ''].join('');
    return `<div class="rv"><div class="rv-h"><span class="tag" style="color:${col};border-color:${col}">${CLASS_PT[f.class] || esc(f.class)}</span><b>${esc(f.message)}</b><span class="sp"></span><button class="lnk" data-action="open-line" data-on="${f.primary.startLine}:${esc(key)}">line ${f.primary.startLine}</button></div><div class="rv-b"><div class="notr" style="color:var(--fg-muted)">${esc(f.analyzer)}${f.rule ? ' · ' + esc(f.rule) : ''}</div>${extra}</div></div>`;
  }).join('');
  return `<h2>Analisadores do projecto</h2><div class="sub">Os linters e compiladores instalados, sobre o ficheiro gravado no disco. Cada achado traz a evidência do analisador; tu decides.</div><div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0">${runs || `<span class="sub">${txa("noneApplies")}</span>`}</div>${fs || (ran ? `<div class="sub">${txa("noFindings")}</div>` : '')}`;
}

/* ───── Under the hood — markup da tab (dono da view) ───── */

function renderHoodView(tab: unknown, host: HTMLElement): void {
  const t = tab as { path: string };
  const p = t.path, f = files()[p], ext = extOf(p),
    stg = (n: string, ok: boolean | null, d: string) => `<div class="hs ${ok === false ? 'bad' : ok === null ? 'skip' : 'ok'}"><span>${ok === false ? '✖' : ok === null ? '○' : '✓'}</span><div><b>${n}</b><small>${d}</small></div></div>`;
  let h = '';
  /* O plano deriva do código: a tabela e a coluna do WHERE e os CREATE INDEX das
     migrações deste workspace (ADR-0006, R1c1 — antes o nome do índice era o do demo). */
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
  host.innerHTML = `<div class="page" style="max-width:860px"><h1>${txt("underTheHood")}</h1><div class="sub notr">${esc(short(p))}</div>${h}<div class="sub" style="margin-top:20px">Derived from the code in this workspace.</div></div>`;
}

/* ── publicação no window (confinada ao bridge via `publish`): só o `hoodCmd` (o e2e do hood
   chama-o); o resto lê-se por import desde a U7p5 do ADR-0004. ── */
publish({ hoodCmd });
export { renderCreviewView, renderHoodView, curFile, explainCmd, reviewCmd, reviewFindings, closePanel };

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   Liga o nome de acção (`data-action`) ao efeito; o payload viaja SÓ em `data-on` (o golden
   strippa data-action/data-on; um `data-*` à medida vazava). Fica no resíduo porque só ele tem à
   mão o bridge e o painel.
     • open-file / open-line — abrir o ficheiro (na linha `linha:caminho`, partido no 1.º `:`)
     • cr:* — o painel de documento e a revisão interactiva. As da revisão levam `caminho|valor`
       (o painel e a tab partilham filtros e descartados por ficheiro); `cr:goto` leva `linha` (o
       ficheiro do painel) ou `linha:caminho`. */
const splitOn = (on: string): [string, string] => { const i = on.indexOf("|"); return i < 0 ? [PANEL.path, on] : [on.slice(0, i), on.slice(i + 1)]; };
/** Redesenha o que mostra a revisão: o painel e, se estiver à vista, a tab. */
const refreshReview = (): void => { renderPanel(); rerender("creview"); };
const copyText = (s: string): void => {
  const done = () => toast(td("copied"));
  try { void navigator.clipboard.writeText(s).then(done, () => toast(s.slice(0, 60))); } catch { toast(s.slice(0, 60)); }
};
const ACTIONS: ActionTable = {
  "open-file": { on: "click", run: (e) => openPath(e.on) },
  "open-line": {
    on: "click",
    run: (e) => { const i = e.on.indexOf(":"); openPath(e.on.slice(i + 1), +e.on.slice(0, i)); },
  },
  "cr:goto": {
    on: "click",
    run: (e) => { const i = e.on.indexOf(":"); const line = +(i < 0 ? e.on : e.on.slice(0, i)), p = i < 0 ? PANEL.path : e.on.slice(i + 1); if (p) openPath(p, line); },
  },
  "cr:close": { on: "click", run: () => closePanel() },
  "cr:view": { on: "click", run: (e) => { PANEL.view = e.on === "markdown" ? "markdown" : "preview"; renderPanel(); } },
  "cr:code-view": { on: "click", run: (e) => { PANEL.codeView = e.on === "diff" ? "diff" : "code"; renderPanel(); } },
  "cr:tab": { on: "click", run: (e) => { PANEL.tab = e.on === "ai" ? "ai" : "findings"; renderPanel(); } },
  "cr:stop": { on: "click", run: () => session.stop() },
  "cr:regenerate": { on: "click", run: () => session.regenerate() },
  "cr:copy-doc": { on: "click", run: () => { const s = shownDoc(); if (s) copyText(s.text); } },
  "cr:copy-improved": { on: "click", run: () => { const s = shownDoc(); if (s?.improved) copyText(s.improved.code); } },
  "cr:copy-block": {
    on: "click",
    run: (e) => { const s = shownDoc(); if (!s) return; const b = docBlocks(s).filter((x) => x.k === "code")[+e.on]; if (b && b.k === "code") copyText(b.v); },
  },
  "cr:to-chat": {
    on: "click",
    run: () => {
      const s = shownDoc();
      if (!s) return;
      const name = s.path.split("/").pop() || s.path;
      void codevAsk.ask({
        intent: "chat", text: "", send: false, scope: "file",
        context: [
          { kind: "file", label: name, path: s.path, text: (files()[s.path]?.content ?? "").slice(0, 16000) },
          { kind: "comment", label: `${td(s.kind === "explain" ? "explain" : "review")} · ${name}`, text: s.text.slice(0, 16000) },
        ],
      });
    },
  },
  "cr:apply": { on: "click", run: () => { session.apply(); } },
  "cr:revert": { on: "click", run: () => session.revert() },
  "cr:test": { on: "click", run: () => { void session.test(); } },
  "cr:fix-tests": { on: "click", run: () => session.fixTests() },
  "cr:as-tab": { on: "click", run: () => { if (PANEL.path) reviewTab(PANEL.path); } },
  "cr:rerun": { on: "click", run: () => { loadAnalyzers(PANEL.path, true); renderPanel(); } },
  "cr:ai-review": { on: "click", run: (e) => { const p = e.on || PANEL.path; if (p) startAiReview(p); } },
  "cr:fix-ai": { on: "click", run: (e) => { const [p, key] = splitOn(e.on); startAiReview(p, key); } },
  "cr:filter": {
    on: "click",
    run: (e) => {
      const [p, sev] = splitOn(e.on), ui = rvUi(p);
      ui.filter = !sev ? [] : ui.filter.includes(sev) ? ui.filter.filter((x) => x !== sev) : [...ui.filter, sev];
      refreshReview();
    },
  },
  "cr:dismiss": { on: "click", run: (e) => { const [p, key] = splitOn(e.on), ui = rvUi(p); if (!ui.dismissed.includes(key)) ui.dismissed.push(key); refreshReview(); } },
  "cr:restore": { on: "click", run: (e) => { const [p, key] = splitOn(e.on), ui = rvUi(p); ui.dismissed = ui.dismissed.filter((k) => k !== key); refreshReview(); } },
  "cr:show-dismissed": { on: "click", run: (e) => { const ui = rvUi(splitOn(e.on)[0]); ui.showDismissed = !ui.showDismissed; refreshReview(); } },
};
bindActions(ACTIONS);
/** os nomes das acções da feature — o teste das notas (`tests/notes.docs.test.ts`) prova que cada um tem nota */
export const CODEREVIEW_ACTION_NAMES = Object.keys(ACTIONS);

/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts; o visualizer decora o
   VIEW.hood no boot7, e continua a decorar esta versão) */
VIEW.creview = renderCreviewView;
VIEW.hood = renderHoodView;
