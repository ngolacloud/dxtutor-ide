/* ═══════════ feature `debug` — ui: what a DAP session shows (A7, docs/v2/UI-AUDIT.md item 4) ═══════════
   Markup for the Run and Debug pane when the session runs on DAP: the extra controls (step out,
   pause, stop on panic, the engine), the threads, the variables as a tree with what changed
   since the last stop, the call stack with the selected frame, the watches, the program's
   output, and the Co-Dev / snapshot buttons; and the gutter's breakpoint menu. The gdb session
   keeps its markup (features/debug.ts). Texts from the catalog (t), the rest escaped (esc).
   Actions: data-action + data-on (ui/actions.ts). No window. */

import { esc } from "../../../core";
import { bpKind, type BpMeta, type VarNode, type Watch } from "../domain/dap";
import type { Session } from "../domain/session";
import type { DapKey } from "./dap-messages";
import { consoleBlock, dataBpsBlock, memoryBlock, stackBlock, varActions, type TX } from "./dbgx-view";
import type { ConsoleLine } from "../domain/console";

export type T = (k: DapKey, p?: Record<string, string | number>) => string;

export interface DapExtra { watches: Watch[]; output: string[]; stopOnPanic: boolean; expanded: Set<number> }

/** r23 F2: what the stopped view adds when the composition gives it (the older callers do not). */
export interface DapMore { tx: TX; root: string; jmc: boolean; libOpen: ReadonlySet<number>; console: ConsoleLine[] }

/** The extra buttons of a DAP session (after step into): step out and pause. */
export function dapButtons(t: T, s: Session): string {
  return `<button title="${t("stepOut")}" data-action="step-out"${s.status !== "stopped" ? " disabled" : ""}>⤴</button><button title="${t("pause")}" data-action="pause"${s.status === "running" ? "" : " disabled"}>⏸</button>`;
}

/** After the program's name: «stop on panic» and the engine. */
export function dapExtras(t: T, adapter: string, stopOnPanic: boolean): string {
  return `<label class="dbg-panic" title="${t("stopOnPanic")}"><input type="checkbox" data-action="panic"${stopOnPanic ? " checked" : ""}> <span>${t("stopOnPanic")}</span></label><span class="dbg-engine notr">${esc(t("engineDap", { adapter }))}</span>`;
}

function varRows(t: T, s: Session, nodes: VarNode[], expanded: Set<number>, depth: number, more?: DapMore): string {
  return nodes.map((v) => {
    const open = v.reference > 0 && expanded.has(v.reference);
    const kids = open ? s.children?.[v.reference] : undefined;
    const tw = v.reference > 0 ? `<span class="dvt">${open ? "▾" : "▸"}</span>` : `<span class="dvt"></span>`;
    return `<div class="dv dvx${v.changed ? " chg" : ""}" style="padding-left:${10 + depth * 14}px"${v.reference > 0 ? ` data-action="var-toggle" data-on="${v.reference}"` : ""} title="${esc(v.type)}${v.changed ? " · " + t("changed") : ""}">${tw}<span class="k notr">${esc(v.name)}</span><span class="v notr">${esc(v.value)}</span>${more ? varActions(more.tx, s.caps, v) : ""}</div>`
      + (open ? (kids ? varRows(t, s, kids, expanded, depth + 1, more) : `<div class="sec-empty" style="padding-left:${24 + depth * 14}px">…</div>`) : "");
  }).join("");
}

/** The DAP view of a stopped session: threads, variables (tree, diff), stack, watch, output, Co-Dev. */
export function dapStopped(t: T, s: Session, x: DapExtra, canAsk: boolean, canSnapshot: boolean, more?: DapMore): string {
  const threads = s.threads && s.threads.length > 1
    ? `<div class="scm-grp">${t("threads")}<span class="cnt">${s.threads.length}</span></div>${s.threads.map((th) => `<div class="dv${th.current ? " top" : ""}" data-action="thread" data-on="${th.id}"><span class="k notr">#${th.id} ${esc(th.name)}</span></div>`).join("")}`
    : "";
  const scopes = s.scopes ?? [];
  const vars = scopes.length
    ? scopes.map((sc) => {
        const open = sc.reference > 0 && x.expanded.has(sc.reference);
        const kids = open ? s.children?.[sc.reference] ?? [] : [];
        return `<div class="dv dvs" data-action="var-toggle" data-on="${sc.reference}"><span class="dvt">${open ? "▾" : "▸"}</span><span class="k notr">${esc(sc.name)}</span></div>${open ? varRows(t, s, kids, x.expanded, 1, more) : ""}`;
      }).join("")
    : `<div class="sec-empty">—</div>`;
  const stack = s.stack.map((f, i) => `<div class="dv${(s.frame ?? 0) === i ? " top" : ""}" data-action="frame" data-on="${i}"><span class="k notr">${esc(f.func)}${f.file ? ` · ${esc(f.file.split("/").pop() || "")}:${f.line}` : ""}</span></div>`).join("");
  const watch = `<div class="scm-grp">${t("watch")}<span class="cnt">${x.watches.length}</span></div>`
    + x.watches.map((w, i) => `<div class="dv dvx${w.changed ? " chg" : ""}"><span class="k notr">${esc(w.expr)}</span><span class="v notr">${w.error ? `<i>${esc(w.error)}</i>` : esc(w.value ?? "")}</span><button class="dvw-x" title="×" data-action="watch-del" data-on="${i}">×</button></div>`).join("")
    + `<input class="inp dbg-watch-in" data-action="watch-add" placeholder="${t("addWatch")}">`;
  const st = s.stop;
  const why = st && st.description ? `<div class="sec-empty notr dbg-why">${esc(st.description)}</div>` : "";
  const asks = `<div class="dbg-acts">${canAsk ? `<button class="btn ghost dbg-ai" data-action="ask-explain">${t("askExplain")}</button><button class="btn ghost dbg-ai" data-action="ask-test">${t("askTest")}</button>` : ""}${canSnapshot ? `<button class="btn ghost" data-action="snapshot">${t("snapshot")}</button>` : ""}</div>`;
  if (more) {
    return why + asks + threads + `<div class="scm-grp">${t("variables")}</div>${vars}` + (s.memory ? memoryBlock(more.tx, s.memory) : "")
      + stackBlock(more.tx, s, more.root, more.jmc, more.libOpen) + watch + dataBpsBlock(more.tx, s.dataBps ?? []) + consoleBlock(more.tx, x.output, more.console, true);
  }
  return why + asks + threads + `<div class="scm-grp">${t("variables")}</div>${vars}` + `<div class="scm-grp">Call stack</div>${stack}` + watch + outputBlock(t, x.output);
}

export function outputBlock(t: T, out: string[]): string {
  const text = out.join("");
  return `<div class="scm-grp">${t("output")}</div>${text ? `<pre class="dbg-out notr">${esc(text.slice(-6000))}</pre>` : `<div class="sec-empty">${t("noOutput")}</div>`}`;
}

/** How a breakpoint with meta reads in the list (empty for a plain one). */
export function bpLabel(t: T, m?: BpMeta, tx?: TX): string {
  if (!m) return "";
  const parts = [m.enabled ? "" : t("disabled")];
  const k = bpKind(m);
  if (m.condition?.trim()) parts.push(t("when", { c: m.condition.trim() }));
  if (m.hitCondition?.trim()) parts.push(t("hit", { n: m.hitCondition.trim() }));
  if (k === "log") parts.push(t("log", { m: (m.logMessage ?? "").trim() }));
  if (tx && m.trigger?.trim()) parts.push(tx("after", { where: `${m.trigger.split("/").pop()}` }));
  if (tx && m.group?.trim()) parts.push(tx("inGroup", { g: m.group.trim() }));
  const txt = parts.filter(Boolean).join(" · ");
  return txt ? `<span class="bpm notr">${esc(txt)}</span>` : "";
}

/** The gutter's breakpoint menu for `key` (`path:line`). */
export function bpMenu(t: T, key: string, exists: boolean, m?: BpMeta, tx?: TX): string {
  const it = (cmd: string, label: string) => `<div class="mi" data-action="bp-menu" data-on="${esc(cmd + "|" + key)}">${label}</div>`;
  /* r23 F2: wait for another breakpoint, and the group (only when the composition gives the catalogue) */
  const more = tx ? it("trigger", esc(tx("bpTrigger"))) + it("group", esc(tx("bpGroup"))) : "";
  return `<div class="bp-menu-in">${exists || m ? "" : it("add", t("bpAdd"))}${it("condition", t("bpCondition"))}${it("hit", t("bpHit"))}${it("log", t("bpLog"))}${more}${exists || m ? (m && !m.enabled ? it("enable", t("bpEnable")) : it("disable", t("bpDisable"))) + it("remove", t("bpRemove")) : ""}</div>`;
}
