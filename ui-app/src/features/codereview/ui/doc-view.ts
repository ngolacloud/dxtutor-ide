/* ═══════ feature Explain · Code-Review — a view do painel de documento ═══════
   Markup puro (funções de dados → HTML) do painel à direita do editor: o documento markdown
   (pré-visualização com realce de código, ou o texto), o cartão do código melhorado (código
   com realce ou diferenças, «Apply», «Apply & test», «Revert», o resultado dos testes) e a
   revisão interactiva (pontuação, filtros por severidade, cartões com o excerto do código,
   «Fix with AI», «Dismiss»). Todas as acções são `data-action="cr:…"` + `data-on` (o
   despachante da feature, `ui/actions.ts`). Sem `window`; o realce chega por argumento. */

import { esc } from "../../../core";
import { parseMarkdown, withoutImproved, type Block, type Inline } from "../domain/markdown";
import type { DocState } from "../application/doc-session";
import type { DiffRow } from "../../diff/domain/diff";
import type { DocMsgKey } from "./doc-messages";
import { parseTestOutput, type TestReport } from "../domain/test-report";

export type T = (k: DocMsgKey, p?: Record<string, string | number>) => string;
/** Realce de uma linha (`hlLine` do editor). */
export type Hl = (line: string, ext: string) => string;
export type Icon = (name: string) => string;

const LANG_EXT: Record<string, string> = { rust: "rs", typescript: "ts", javascript: "js", python: "py", golang: "go", kotlin: "kt", csharp: "cs", "c++": "cpp", shell: "sh", bash: "sh", yaml: "yml", markdown: "md" };
export const extOfLang = (lang: string): string => LANG_EXT[lang] || lang;

/* ───── markdown → HTML ───── */

function inl(xs: Inline[]): string {
  return xs.map((x) => {
    switch (x.k) {
      case "text": return esc(x.v);
      case "code": return `<code>${esc(x.v)}</code>`;
      case "b": return `<b>${inl(x.v)}</b>`;
      case "i": return `<i>${inl(x.v)}</i>`;
      case "link": return `<span class="cr-link" title="${esc(x.href)}">${esc(x.v)}</span>`;
      case "line": return `<button class="cr-ln" data-action="cr:goto" data-on="${x.line}">${esc(x.v)}</button>`;
    }
  }).join("");
}

/** Um bloco de código com números de linha, realce e «Copy». `idx` identifica-o para a cópia. */
export function codeBlock(code: string, ext: string, hl: Hl, t: T, idx: number | null, from = 1, mark: number | null = null, canApply = false, applied: "applied" | "done" | null = null): string {
  const rows = code.split("\n");
  if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
  const body = rows.map((l, i) => `<div class="cr-cl${mark === i + from ? " mark" : ""}"><span class="ln">${i + from}</span><span class="tx">${hl(l, ext) || " "}</span></div>`).join("");
  const copy = idx === null ? "" : `<button class="cr-copy" data-action="cr:copy-block" data-on="${idx}" title="${esc(t("copy"))}">${esc(t("copy"))}</button>`;
  /* uma sugestão já aplicada não se aplica outra vez: mostra o estado (feita = validada pelos testes) */
  const apply = idx === null || !canApply ? ""
    : applied ? `<span class="cr-mark-b ${applied}" title="${esc(t(applied === "done" ? "doneMarkTip" : "appliedMarkTip"))}">${esc(t(applied === "done" ? "doneMark" : "appliedMark"))}</span>`
    : `<button class="cr-apply-b" data-action="cr:apply-block" data-on="${idx}" title="${esc(t("applyBlockTip"))}">${esc(t("applyBlock"))}</button>`;
  return `<div class="cr-code notr">${idx === null ? "" : `<span class="cr-code-acts">${apply}${copy}</span>`}${body}</div>`;
}

/** Blocos que não são código do ficheiro (comandos, saída): sem «Apply». */
const NOT_CODE = new Set(["", "text", "txt", "bash", "sh", "shell", "console", "output", "plaintext", "diff", "json", "toml", "yaml", "yml", "markdown", "md"]);

export function markdownHtml(blocks: Block[], hl: Hl, t: T, canApply = false, markOf: (code: string) => "applied" | "done" | null = () => null): string {
  let codeIdx = 0;
  return blocks.map((b) => {
    switch (b.k) {
      case "h": return `<h${b.level + 1} class="cr-h">${inl(b.v)}</h${b.level + 1}>`;
      case "p": return `<p>${inl(b.v)}</p>`;
      case "hr": return "<hr>";
      case "quote": return `<blockquote>${inl(b.v)}</blockquote>`;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        return `<${tag}>${b.items.map((it) => `<li${it.check === null ? "" : ` class="chk${it.check ? " on" : ""}"`}>${inl(it.v)}</li>`).join("")}</${tag}>`;
      }
      case "table":
        return `<div class="cr-tblw"><table class="cr-tbl"><thead><tr>${b.head.map((c) => `<th>${inl(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inl(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      case "code":
        { const can = canApply && !b.open && !NOT_CODE.has(b.lang); return codeBlock(b.v, extOfLang(b.lang), hl, t, codeIdx++, 1, null, can, can ? markOf(b.v) : null); }
    }
  }).join("");
}

/** Os blocos de código do documento, pela ordem (o «Copy» de cada um usa o índice). */
export function docBlocks(s: DocState): Block[] {
  return parseMarkdown(s.status === "done" && s.improved ? withoutImproved(s.text) : s.text);
}

/* ───── o documento (Explain, revisão com IA, correcção) ───── */

export interface DocUi {
  view: "preview" | "markdown";
  codeView: "code" | "diff";
}

/** O que a view precisa de saber do mundo: se há modelo (o «Apply» das sugestões), se há onde
 *  testar, e a chave do editor de um caminho que a saída dos testes cita (`null` se não está aberto). */
export interface DocCtx {
  canApply: boolean;
  testsHere: boolean;
  resolve: (file: string) => string | null;
  canAskChat: boolean;
  /** há o editor com a revisão bloco a bloco (o Co-Dev) */
  canEditor: boolean;
  /** se um trecho do documento já foi aplicado / feito neste ficheiro */
  markOf: (code: string) => "applied" | "done" | null;
}

function statusNote(s: DocState, t: T): string {
  if (s.status === "error") {
    const msg = s.error === "no-model" ? t("noModel") : t("modelError", { e: s.error || "?" });
    return `<div class="cr-note bad">${esc(msg)}</div>`;
  }
  if (s.status === "stopped") return `<div class="cr-note">${esc(t("stoppedNote"))}</div>`;
  return "";
}

function reportHtml(r: TestReport, t: T, ctx: DocCtx): string {
  const tip = r.kind === "compile" ? "tipCompile" : r.kind === "assert" ? "tipAssert" : r.kind === "panic" ? "tipPanic" : "tipUnknown";
  const spots = r.spots.length
    ? `<div class="cr-rep-h">${esc(t("whereBroke"))}</div><ul class="cr-spots">${r.spots.map((sp) => {
        const key = ctx.resolve(sp.file);
        const loc = `${esc(sp.file)}:${sp.line}`;
        return `<li>${key ? `<button class="cr-ln" data-action="cr:goto" data-on="${sp.line}:${esc(key)}">${loc}</button>` : `<code>${loc}</code>`}<span>${esc(sp.message)}</span></li>`;
      }).join("")}</ul>`
    : "";
  const failed = r.failed.length ? `<div class="cr-rep-h">${esc(t("failedTests"))}</div><div class="cr-failed notr">${r.failed.slice(0, 12).map((f) => `<code>${esc(f)}</code>`).join(" ")}</div>` : "";
  return `<div class="cr-tip">💡 ${esc(t(tip))}</div>${r.headline ? `<div class="cr-headline notr">${esc(r.headline)}</div>` : ""}${spots}${failed}`;
}

function testBox(s: DocState, t: T, ctx: DocCtx): string {
  const r = s.test;
  if (!r) return "";
  if (r.status === "running") return `<div class="cr-test run"><span class="cr-spin"></span>${esc(t("testing"))}</div>`;
  if (r.status === "unavailable") return `<div class="cr-test">${esc(s.applied ? t("appliedNoTests") : r.output)}</div>`;
  const ok = r.status === "passed";
  const head = r.status === "error" ? t("testError", { e: r.output.split("\n")[0] }) : ok ? t("passed") : t("testsFailed");
  const rep = r.status === "failed" ? reportHtml(parseTestOutput(r.output), t, ctx) : "";
  const out = r.output.trim() ? `<details${ok || rep ? "" : " open"}><summary>${esc(t("output"))}</summary><pre class="cr-out notr">${esc(r.output.slice(-8000))}</pre></details>` : "";
  const fix = r.status === "failed" ? `<div class="cr-acts"><button class="btn pri" data-action="cr:fix-tests">${esc(t("fixTests"))}</button>${ctx.canAskChat ? `<button class="btn ghost" data-action="cr:fix-in-chat">${esc(t("askChat"))}</button>` : ""}<button class="btn ghost" data-action="cr:revert">${esc(t("revert"))}</button></div>` : "";
  return `<div class="cr-test ${ok ? "ok" : "bad"}"><b>${esc(head)}</b>${rep}${out}${fix}</div>`;
}

function diffHtml(rows: DiffRow[], ext: string, hl: Hl): string {
  return `<div class="cr-code cr-diff notr">${rows.map(([op, tx, a, b]) => `<div class="cr-cl ${op === "+" ? "add" : op === "-" ? "del" : ""}"><span class="ln">${a}</span><span class="ln">${b}</span><span class="op">${op === " " ? "" : op}</span><span class="tx">${hl(tx, ext) || " "}</span></div>`).join("")}</div>`;
}

/** O cartão do código melhorado: realce ou diferenças, e as acções. `diff` = as linhas do diff contra o ficheiro actual. */
function improvedCard(s: DocState, ui: DocUi, hl: Hl, t: T, ext: string, diff: DiffRow[], ic: Icon, ctx: DocCtx): string {
  const imp = s.improved!;
  const add = diff.filter((r) => r[0] === "+").length, del = diff.filter((r) => r[0] === "-").length;
  const same = add === 0 && del === 0;
  const seg = `<span class="cr-seg"><button class="${ui.codeView === "code" ? "on" : ""}" data-action="cr:code-view" data-on="code">${esc(t("code"))}</button><button class="${ui.codeView === "diff" ? "on" : ""}" data-action="cr:code-view" data-on="diff">${esc(t("diff"))}</button></span>`;
  const running = s.test?.status === "running";
  const busy = running || s.inEditor;
  const acts = s.done
    ? `<span class="cr-done-tag">✓ ${esc(t("doneTitle"))}</span><button class="btn ghost" data-action="cr:revert">${ic("history")}${esc(t("revert"))}</button>`
    : s.applied
    ? `<button class="btn ghost" data-action="cr:revert"${busy ? " disabled" : ""}>${ic("history")}${esc(t("revert"))}</button>${ctx.testsHere ? `<button class="btn pri" data-action="cr:test"${busy ? " disabled" : ""}>${ic("run")}${esc(t("retest"))}</button>` : ""}`
    : ctx.canEditor
      ? `<button class="btn ghost" data-action="cr:deny"${busy ? " disabled" : ""}>${ic("close")}${esc(t("deny"))}</button><button class="btn ghost" data-action="cr:accept"${same || busy ? " disabled" : ""}>${ic("check")}${esc(t(ctx.testsHere ? "acceptTest" : "acceptAll"))}</button><button class="btn pri" data-action="cr:review-editor" title="${esc(t("reviewEditorTip"))}"${same || busy ? " disabled" : ""}>${ic("review")}${esc(t("reviewEditor"))}</button>`
      : `<button class="btn ghost" data-action="cr:deny">${ic("close")}${esc(t("deny"))}</button><button class="btn pri" data-action="cr:accept"${same ? " disabled" : ""}>${ic("check")}${esc(t(ctx.testsHere ? "acceptTest" : "accept"))}</button>`;
  const body = ui.codeView === "diff" ? diffHtml(diff, ext, hl) : codeBlock(imp.code, ext, hl, t, null);
  return `<section class="cr-imp${s.done ? " done" : ""}"><div class="cr-imp-h"><b>${esc(t("improved"))}</b><span class="cr-stat notr"><span class="add">+${add}</span> <span class="del">−${del}</span></span>${seg}<span class="sp"></span><button class="btn ghost" data-action="cr:copy-improved">${esc(t("copy"))}</button>${acts}</div>${s.inEditor ? `<div class="cr-note run"><span class="cr-spin"></span>${esc(t("inEditor"))}</div>` : s.done ? `<div class="cr-note ok">${esc(t("doneNote"))}</div>` : s.applied ? `<div class="cr-note ok">${esc(t("applied"))}</div>` : same ? `<div class="cr-note">${esc(t("noChange"))}</div>` : ""}<div class="cr-imp-b">${body}</div>${testBox(s, t, ctx)}</section>`;
}

export function docHtml(s: DocState, ui: DocUi, hl: Hl, t: T, ext: string, diff: DiffRow[] | null, ic: Icon, ctx: DocCtx): string {
  const md = ui.view === "markdown"
    ? `<pre class="cr-raw notr">${esc(s.text)}</pre>`
    : `<div class="cr-md">${markdownHtml(docBlocks(s), hl, t, ctx.canApply && (s.kind === "explain") && s.status !== "streaming", ctx.markOf)}</div>`;
  const back = s.back ? `<div class="cr-back"><button class="lnk" data-action="cr:back">${esc(t("back"))}</button></div>` : "";
  const writing = s.status === "streaming" ? `<div class="cr-writing"><span class="cr-dot"></span>${esc(t("writing"))}</div>` : "";
  const imp = s.status !== "streaming" && s.improved && diff ? improvedCard(s, ui, hl, t, ext, diff, ic, ctx) : "";
  const denied = s.denied ? `<div class="cr-note">${esc(t("denied"))}</div>` : "";
  return `${back}${statusNote(s, t)}${s.text ? md : ""}${writing}${imp}${denied}`;
}

/* ───── a revisão interactiva (achados das regras) ───── */

export interface ReviewFindingView {
  key: string;
  line: number;
  sev: string;
  /** HTML das regras (texto fixo do domínio) */
  title: string;
  why: string;
  fix: string;
  /** o excerto do código à volta da linha */
  snippet: { from: number; code: string };
}

export interface ReviewUi {
  filter: string[];
  showDismissed: boolean;
  dismissed: string[];
}

export const SEVS = ["bug", "risk", "perf", "style"] as const;

export function scoreRing(score: number, ok: boolean): string {
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  return `<div class="score cr-ring ${ok ? "ok" : "bad"}" style="--deg:${deg}deg">${score}<small>/100</small></div>`;
}

/** A barra de filtros: um botão por severidade com a contagem (activo = filtra). As acções da
 *  revisão levam `caminho|valor` no `data-on` (o painel e a tab partilham o estado por ficheiro). */
export function filterBar(path: string, fs: ReviewFindingView[], ui: ReviewUi, t: T): string {
  const P = esc(path);
  const n = (sv: string) => fs.filter((f) => f.sev === sv && !ui.dismissed.includes(f.key)).length;
  const all = `<button class="cr-chip${ui.filter.length ? "" : " on"}" data-action="cr:filter" data-on="${P}|">${esc(t("all"))} <b>${fs.filter((f) => !ui.dismissed.includes(f.key)).length}</b></button>`;
  return `<div class="cr-chips">${all}${SEVS.map((sv) => `<button class="cr-chip sev-${sv}${ui.filter.includes(sv) ? " on" : ""}" data-action="cr:filter" data-on="${P}|${sv}"${n(sv) ? "" : " disabled"}><i></i>${sv} <b>${n(sv)}</b></button>`).join("")}</div>`;
}

export function findingCards(path: string, fs: ReviewFindingView[], ui: ReviewUi, hl: Hl, t: T, ext: string, canAi: boolean, ic: Icon): string {
  const live = fs.filter((f) => !ui.dismissed.includes(f.key));
  const shown = live.filter((f) => !ui.filter.length || ui.filter.includes(f.sev));
  const gone = fs.filter((f) => ui.dismissed.includes(f.key));
  const P = esc(path);
  const card = (f: ReviewFindingView, dismissed: boolean) => `<div class="crf sev-${f.sev}${dismissed ? " gone" : ""}">
    <div class="crf-h" data-action="cr:goto" data-on="${f.line}:${esc(path)}"><span class="tag sev-${f.sev}">${f.sev}</span><b>${f.title}</b><span class="sp"></span><span class="lnk">L${f.line}</span></div>
    ${dismissed ? "" : `${codeBlock(f.snippet.code, ext, hl, t, null, f.snippet.from, f.line)}<div class="crf-b"><p>${f.why}</p><p><b>${esc(t("suggested"))}</b> ${f.fix}</p></div>`}
    <div class="crf-acts">${dismissed
      ? `<button class="btn ghost" data-action="cr:restore" data-on="${P}|${esc(f.key)}">${esc(t("restore"))}</button>`
      : `<button class="btn ghost" data-action="cr:goto" data-on="${f.line}:${esc(path)}">${esc(t("goto"))}</button>${canAi ? `<button class="btn ghost" data-action="cr:fix-ai" data-on="${P}|${esc(f.key)}">${esc(t("fixAi"))}</button>` : ""}<span class="sp"></span><button class="btn ghost" data-action="cr:dismiss" data-on="${P}|${esc(f.key)}">${esc(t("dismiss"))}</button>`}</div>
  </div>`;
  const list = !fs.length
    ? `<div class="adv agent cr-empty">${ic("check")}<div>${esc(t("noFindings"))}</div></div>`
    : shown.length ? shown.map((f) => card(f, false)).join("") : `<div class="cr-note">${esc(t("filteredOut"))}</div>`;
  const tail = gone.length
    ? `<div class="cr-gone"><span>${esc(t("dismissed", { n: gone.length }))}</span><button class="lnk" data-action="cr:show-dismissed" data-on="${P}|">${esc(t(ui.showDismissed ? "hide" : "show"))}</button></div>${ui.showDismissed ? gone.map((f) => card(f, true)).join("") : ""}`
    : "";
  return `<div class="crf-list">${list}${tail}</div>`;
}
