/* ═══════════ feature `hood` — ui: «Execution trace» (A8, docs/v2/UI-AUDIT.md item 7, VIZ-01) ═══════════
   The real execution step by step: the source with the line about to run, the stack, the locals (what
   changed since the previous step of the same frame), and the output printed so far. Actions:
   data-action="tr-…" + data-on. No window. */

import { esc } from "../../../core";
import { changedAt, stackAt, stdoutAt } from "../domain/rules";
import type { TraceState } from "../application/hood-service";
import type { T } from "./hood-view";

export function renderTrace(t: T, s: TraceState | null, canAsk: boolean): string {
  if (!s) return `<div class="hd"><div class="sec-empty">${t("needFile")}</div></div>`;
  const head = `<div class="hd-top"><b>${t("traceTitle")}</b><span class="hd-chip notr">${esc(s.path.split("/").slice(-2).join("/"))}</span><span class="hd-sp"></span></div>`;
  if (s.loading) return `<div class="hd">${head}<div class="sec-empty">${t("loading")}</div></div>`;
  if (s.error) return `<div class="hd">${head}<pre class="hd-err notr">${esc(s.error)}</pre></div>`;
  const tr = s.trace;
  if (!tr || !tr.supported) return `<div class="hd">${head}<div class="sec-empty">${esc(t("unsupported", { why: tr?.notes ?? "" }))}</div></div>`;
  const n = tr.steps.length, st = tr.steps[s.i];
  const changed = changedAt(tr.steps, s.i), stack = stackAt(tr.steps, s.i);
  const src = s.text.split("\n").map((l, i) => `<div class="hd-l${st && st.line === i + 1 ? " sel" : ""}" data-action="tr-open" data-on="${i + 1}"><span class="hd-n">${i + 1}</span><span class="hd-c">${esc(l) || " "}</span></div>`).join("");
  const ctl = `<div class="hd-row tr-ctl">${`<button class="btn ghost" data-action="tr-step" data-on="${s.i - 1}" title="${t("prev")}"${s.i <= 0 ? " disabled" : ""}>◀</button>`}<button class="btn ghost" data-action="tr-play">${s.playing ? t("pause") : t("play")}</button><button class="btn ghost" data-action="tr-step" data-on="${s.i + 1}" title="${t("next")}"${s.i >= n - 1 ? " disabled" : ""}>▶</button><input type="range" min="0" max="${Math.max(0, n - 1)}" value="${s.i}" data-action="tr-seek"><span class="hd-meta">${t("step", { i: n ? s.i + 1 : 0, n })}</span>${canAsk && st ? `<button class="btn ghost hd-ai" data-action="tr-ask">${t("askStepBtn")}</button>` : ""}</div>`;
  const side = st
    ? `<div class="hd-card"><div class="hd-ct">${t("stack")}</div>${stack.map((f, i) => `<div class="hd-meta notr"${i === stack.length - 1 ? ' style="color:var(--fg)"' : ""}>${"  ".repeat(i)}${esc(f)}</div>`).join("")}<div class="hd-meta notr">${esc(st.event)} · ${esc(st.func)}:${st.line}</div></div>`
      + `<div class="hd-card"><div class="hd-ct">${t("locals")}</div>${st.locals.length ? st.locals.map((v) => `<div class="hd-var${changed.has(v.name) ? " chg" : ""}"><span class="notr">${esc(v.name)}</span><i class="notr">${esc(v.ty)}</i><b class="notr">${esc(v.value)}</b></div>`).join("") : `<div class="sec-empty">${t("noLocals")}</div>`}</div>`
      + `<div class="hd-card"><div class="hd-ct">${t("output")}</div><pre class="hd-code notr">${esc(stdoutAt(tr.stdout, tr.steps, s.i)) || " "}</pre></div>`
    : "";
  return `<div class="hd">${head}<div class="hd-meta">${t("realNote")}${tr.notes ? ` <span class="notr">${esc(tr.notes)}</span>` : ""}</div>${ctl}<div class="hd-cols"><div class="hd-col"><div class="hd-src notr">${src}</div></div><div class="hd-col">${side}</div></div></div>`;
}
