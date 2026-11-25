/* ═══════════ feature `debug` — ui: the r23 F2 markup (UI-DBG-07…14) ═══════════
   The floating toolbar (only the controls that work here; the others listed with the reason), the
   debug console (output + evaluations + an input that says it may run code), the exception
   settings, the call stack with Just My Code, the data breakpoints, a variable's memory, the
   breakpoint groups, and the exception helper card. Markup only: the DOM is placed by
   `toolbar.ts`/`exception-helper.ts` and the composition. Texts from the catalogue (t), the rest
   escaped (esc). Actions: data-action + data-on (`dbg-*` names, ui/actions.ts). No window. */

import { esc } from "../../../core";
import { TOOL_KEYS, type Toolbar, type ToolKey } from "../domain/caps";
import { isUserFrame, perfTip, stackRows } from "../domain/frames";
import { hexRows, type ConsoleLine } from "../domain/console";
import type { Panic } from "../domain/exception";
import type { DataBp, SessionCaps } from "../domain/dap";
import type { Session } from "../domain/session";
import { pct, type ReplayState } from "../domain/replay";
import type { DbgxKey } from "./dbgx-messages";

export type TX = (k: DbgxKey, p?: Record<string, string | number>) => string;

/* 16×16 icons, stroke = currentColor */
const P: Record<ToolKey | "grip" | "bolt" | "copy" | "spark", string> = {
  cont: '<path d="M5 3.5v9l7-4.5z" fill="currentColor" stroke="none"/>',
  over: '<path d="M3 9a5 5 0 0 1 10 0"/><path d="M13 5.5V9H9.5"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
  into: '<path d="M8 2v7M5 6.5L8 9.5 11 6.5"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
  out: '<path d="M8 10V3M5 5.5L8 2.5 11 5.5"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
  back: '<path d="M13 9a5 5 0 0 0-10 0"/><path d="M3 5.5V9h3.5"/><circle cx="8" cy="13" r="1.3" fill="currentColor"/>',
  rcont: '<path d="M11 3.5v9L4 8z" fill="currentColor" stroke="none"/><path d="M13 3.5v9"/>',
  cursor: '<path d="M2 8h8M7 5l3 3-3 3"/><path d="M13 3v10"/>',
  rframe: '<path d="M3 3v10"/><path d="M13 8a4 4 0 1 1-1.2-2.8"/><path d="M12 2.5v2.8H9.2"/>',
  restart: '<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M12 1.8v3H9"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none"/>',
  grip: '<circle cx="6" cy="4" r="1" fill="currentColor"/><circle cx="10" cy="4" r="1" fill="currentColor"/><circle cx="6" cy="8" r="1" fill="currentColor"/><circle cx="10" cy="8" r="1" fill="currentColor"/><circle cx="6" cy="12" r="1" fill="currentColor"/><circle cx="10" cy="12" r="1" fill="currentColor"/>',
  bolt: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z"/>',
  copy: '<rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5C3 3 3.4 2.5 4 2.5h6.5"/>',
  spark: '<path d="M8 1.5l1.4 4.1L13.5 7l-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z"/>',
};
export const icon = (k: keyof typeof P, s = 15): string =>
  `<svg viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;

/** The floating toolbar's inside: grip, the buttons, the LIVE badge with the stop count, and an
 *  «i» that lists what is not offered here and why. */
export function toolbarHtml(t: TX, tb: Toolbar, stops: number, why: (m: Toolbar["missing"][number]) => string, replay?: { n: number; total: number } | null): string {
  const btn = (k: ToolKey, on: boolean) => {
    const keys = TOOL_KEYS[k] ? ` (${TOOL_KEYS[k]})` : "";
    const cls = k === "cont" ? "pri" : k === "stop" ? "red" : k === "rcont" || k === "back" ? "tt" : "";
    return `<button class="${cls}" data-action="dbg-tb" data-on="${k}" title="${esc(t(`tb-${k}` as DbgxKey) + keys)}"${on ? "" : " disabled"}>${icon(k)}</button>`;
  };
  const missing = tb.missing.length
    ? `<span class="dbg-tb-miss" tabindex="0" title="${esc([t("tb-missing"), ...tb.missing.map((m) => `• ${t(`tb-${m.key}` as DbgxKey)}: ${why(m)}`)].join("\n"))}">i</span>`
    : "";
  const badge = replay
    ? `<span class="badge replay" title="${esc(t("tb-replay-title"))}">${esc(t("tb-replay"))}</span><span class="pos notr">${esc(t("tb-pos", { n: replay.n, total: replay.total }))}</span>`
    : `<span class="badge live" title="${esc(t("tb-live-title"))}">${esc(t("tb-live"))}</span>${stops ? `<span class="pos notr">${esc(t("tb-stops", { n: stops }))}</span>` : ""}`;
  return `<span class="grip" title="${esc(t("tb-grip"))}">${icon("grip", 12)}</span>${tb.buttons.map((b) => btn(b.key, b.enabled)).join("")}<span class="sep"></span>${badge}${missing}`;
}

/** The debug console: the program's output, the evaluations, and the input (it may run code). */
export function consoleBlock(t: TX, output: string[], lines: ConsoleLine[], enabled: boolean): string {
  const text = output.join("");
  const rows = lines.map((l) => `<div class="dbg-cl ${l.kind}">${l.kind === "in" ? "› " : ""}${esc(l.text)}</div>`).join("");
  return `<div class="scm-grp">${esc(t("console"))}<span class="dbg-runs" title="${esc(t("consoleRunsTitle"))}">${esc(t("consoleRuns"))}</span>${lines.length ? `<button class="dbg-mini" data-action="dbg-con-clear">${esc(t("consoleClear"))}</button>` : ""}</div>`
    + `<div class="dbg-con notr">${text ? `<pre class="dbg-out">${esc(text.slice(-6000))}</pre>` : ""}${rows}</div>`
    + `<input class="inp dbg-con-in notr" id="dbg-con-in" autocomplete="off" spellcheck="false" placeholder="${esc(t("consolePh"))}"${enabled ? "" : " disabled"}>`;
}

/** Exception settings: Rust panic (a function breakpoint on `rust_panic`) and the adapter's filters. */
export function exceptionsBlock(t: TX, stopOnPanic: boolean, filters: SessionCaps["exceptionFilters"], on: ReadonlySet<string>): string {
  const row = (f: string, label: string, checked: boolean) =>
    `<label class="dbg-exc"><input type="checkbox" data-action="dbg-exc" data-on="${esc(f)}"${checked ? " checked" : ""}> <span>${esc(label)}</span></label>`;
  return `<div class="scm-grp">${esc(t("exceptions"))}</div><div class="dbg-excs">${row("rust_panic", t("excPanic"), stopOnPanic)}${filters.map((f) => row(f.filter, f.label, on.has(f.filter))).join("")}</div>`;
}

/** The call stack with Just My Code: library frames collapsed into one row that opens. */
export function stackBlock(t: TX, s: Session, root: string, jmc: boolean, libOpen: ReadonlySet<number>): string {
  const files = s.stack.map((f) => f.file);
  const sel = s.frame ?? 0;
  const rows = stackRows(files, root, jmc, libOpen, sel).map((r) => {
    if (r.kind === "lib") return `<div class="dv dbg-lib" data-action="dbg-lib" data-on="${r.from}"><span class="k">▸ ${esc(t("libFrames", { n: r.count }))}</span></div>`;
    const f = s.stack[r.index];
    const lib = jmc && !isUserFrame(files[r.index] ?? "", root) ? " lib" : "";
    return `<div class="dv${sel === r.index ? " top" : ""}${lib}" data-action="frame" data-on="${r.index}"><span class="k notr">${esc(f.func)}${f.file ? ` · ${esc(f.file.split("/").pop() || "")}:${f.line}` : ""}</span></div>`;
  }).join("");
  return `<div class="scm-grp">Call stack<label class="dbg-jmc" title="${esc(t("jmcTitle"))}"><input type="checkbox" data-action="dbg-jmc"${jmc ? " checked" : ""}> ${esc(t("jmc"))}</label></div>${rows}`;
}

/** The data breakpoints of the session, each with ×. */
export function dataBpsBlock(t: TX, list: DataBp[]): string {
  if (!list.length) return "";
  return `<div class="scm-grp">${esc(t("dataBps"))}<span class="cnt">${list.length}</span></div>`
    + list.map((d) => `<div class="scm-row${d.verified ? "" : " bp-off"}"><span class="bpd k-data"></span><span class="nm notr">${esc(d.description)}</span><span class="pth notr">${esc(d.accessType)}</span><span class="ra" style="display:flex"><button data-action="dbg-data-del" data-on="${esc(d.dataId)}">×</button></span></div>`).join("");
}

/** A variable's bytes as hex rows. */
export function memoryBlock(t: TX, m: { name: string; address: string; bytes: number[]; unreadable: number }): string {
  const rows = hexRows(m.address, m.bytes).map((r) => `<div class="dbg-hex"><span class="a">${esc(r.address)}</span><span class="h">${esc(r.hex)}</span><span class="c">${esc(r.ascii)}</span></div>`).join("");
  return `<div class="scm-grp">${esc(t("memory", { name: m.name, address: m.address }))}<button class="dbg-mini" data-action="dbg-mem-close">${esc(t("memoryClose"))}</button></div><div class="dbg-mem notr">${rows}${m.unreadable ? `<div class="sec-empty">${esc(t("memoryUnreadable", { n: m.unreadable }))}</div>` : ""}</div>`;
}

/** The actions at the end of a variable's row (shown on hover): break on write, show memory. */
export function varActions(t: TX, caps: SessionCaps | null | undefined, v: { name: string; reference: number; path: string; memoryReference?: string | null }, replay = false): string {
  const out: string[] = [];
  if (replay) out.push(`<button class="dvw-a" title="${esc(t("origin"))}" data-action="dbg-origin" data-on="${esc(v.path)}">↶</button>`);
  if (caps?.dataBreakpoints) out.push(`<button class="dvw-a" title="${esc(t("breakOnWrite"))}" data-action="dbg-data" data-on="${esc(v.reference + "|" + v.name)}">⦿</button>`);
  if (caps?.readMemory && v.memoryReference) out.push(`<button class="dvw-a" title="${esc(t("viewMemory"))}" data-action="dbg-mem" data-on="${esc(v.path)}">▦</button>`);
  return out.join("");
}

/** The breakpoint groups, each switched on or off. */
export function groupsBlock(t: TX, groups: string[], off: ReadonlySet<string>): string {
  if (!groups.length) return "";
  return `<div class="dbg-groups"><span class="k">${esc(t("groups"))}</span>${groups.map((g) => `<button class="dbg-grp${off.has(g) ? " off" : ""}" data-action="dbg-group" data-on="${esc(g)}" title="${esc(off.has(g) ? t("groupOff") : t("groupOn"))}">${esc(g)}</button>`).join("")}</div>`;
}

/** The PerfTip shown at the end of the current line. */
export const perfTipText = (t: TX, ms: number | undefined): string | null => (ms === undefined ? null : t("perfTip", { t: perfTip(ms) }));

/** The exception helper card: the panic, left/right of an assertion, the stack's top frames
 *  (no cause chain without a recording), and its actions. */
export function exceptionCardHtml(t: TX, p: Panic, frames: Array<{ level: number; func: string; file: string; line: number }>, canAsk: boolean, rr: { canReplay: boolean; inReplay: boolean } = { canReplay: false, inReplay: false }): string {
  const lr = p.left !== undefined
    ? `<div class="lr"><span>${esc(t("panicLeft"))}</span><code>${esc(p.left)}</code><span>${esc(t("panicRight"))}</span><code>${esc(p.right ?? "")}</code></div>`
    : "";
  const stack = frames.slice(0, 4).map((f, i) => `<div data-action="frame" data-on="${f.level}"><i>${i + 1}</i><code>${esc(f.func)}</code><span>${esc((f.file.split("/").pop() || "") + (f.line ? ":" + f.line : ""))}</span></div>`).join("");
  return `<div class="h">${icon("bolt", 14)}<b>${esc(t("panic"))}</b><span class="notr">${esc(t("panicThread", { thread: p.thread }))}</span><button data-action="dbg-exc-close" title="${esc(t("close"))}">×</button></div>`
    + `<div class="msg notr">${esc(p.message)}</div>${lr}`
    + `<div class="chain"><div class="k">${esc(t("panicNoChain"))}</div>${stack}</div>`
    + `<div class="acts">${rr.inReplay ? `<button data-action="dbg-origin-ask">↶ ${esc(t("originAsk"))}</button>` : rr.canReplay ? `<button data-action="dbg-replay-run">${icon("back", 13)} ${esc(t("replayRun"))}</button>` : ""}${canAsk ? `<button class="ai" data-action="dbg-ask-panic">${icon("spark", 13)} ${esc(t("askPanicBtn"))}</button>` : ""}<button data-action="dbg-copy-panic">${icon("copy", 13)} ${esc(t("copy"))}</button></div>`;
}

/** The recording's timeline: the bar with the marks (stops, writes, the panic) and «now», the
 *  step position, «to the start», and the «every change to…» query with what it found. */
export function timelineBlock(t: TX, r: ReplayState): string {
  const p = r.position;
  if (!p) return "";
  const kinds = { stop: t("markStop"), write: t("markWrite"), panic: t("markPanic") };
  const marks = r.marks.map((m, i) => `<button class="mk ${m.kind}" style="left:${pct(p, m.event).toFixed(2)}%" data-action="dbg-travel" data-on="${i}" title="${esc(`${kinds[m.kind]} · ${m.label}${m.line ? ` (${m.file.split("/").pop()}:${m.line})` : ""}`)}"></button>`).join("");
  const q = r.query;
  const hits = q && q.hits.length
    ? `<div class="scm-grp">${esc(t("changesOf", { e: q.expression }))}<span class="cnt">${q.hits.length}</span></div>`
      + q.hits.map((h) => { const i = r.marks.findIndex((m) => m.event === h.event && m.ticks === h.ticks); return `<div class="dv"${i >= 0 ? ` data-action="dbg-travel" data-on="${i}"` : ""}><span class="k notr">${esc((h.file.split("/").pop() || "") + ":" + h.line)}</span><span class="v notr">${esc(h.values)}</span></div>`; }).join("")
    : "";
  return `<div class="scm-grp">${esc(t("timeline"))}<span class="cnt notr">${esc(t("tb-pos", { n: p.event, total: p.endEvent }))}</span><button class="dbg-mini" data-action="dbg-travel-start">⏮ ${esc(t("timelineStart"))}</button></div>`
    + `<div class="dbg-tl"><div class="bar">${marks}<span class="now" style="left:${pct(p, p.event).toFixed(2)}%"></span></div></div>`
    + `<input class="inp dbg-writes-in notr" data-action="dbg-writes" placeholder="${esc(t("writesPh"))}">` + hits;
}
