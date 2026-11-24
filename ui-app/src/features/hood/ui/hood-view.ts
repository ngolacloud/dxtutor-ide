/* ═══════════ feature `hood` — ui: «Under the hood (real)» (A8, docs/v2/UI-AUDIT.md item 7) ═══════════
   The source with each line's heat (its share of the machine code or bytecode); for the selected line,
   the instructions (Rust, debug or release) or the bytecode per function (Python); the compiler's stages
   (LLVM IR, assembly, MIR, disassembly — from `compile_pipeline`); a measured run with the memory curve;
   and the growth with N with the complexity class it fits. Texts from the catalog (t), the rest escaped.
   Actions: data-action="hd-…" + data-on. No window. */

import { esc } from "../../../core";
import { fmtMs, heatByLine, sparkPoints } from "../domain/rules";
import type { HoodState, Stage } from "../application/hood-service";
import type { HoodKey } from "./messages";

export type T = (k: HoodKey, p?: Record<string, string | number>) => string;

const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;

function sourcePanel(h: HoodState): string {
  const heat = heatByLine(h.lang === "rust" ? h.lineAsm?.lines ?? [] : h.bytecode?.lines ?? []);
  return `<div class="hd-src notr">${h.text.split("\n").map((l, i) => {
    const n = i + 1, k = heat.get(n) ?? 0;
    return `<div class="hd-l${h.selected === n ? " sel" : ""}${k ? " has" : ""}" style="--hd-heat:${k.toFixed(2)}" data-action="hd-line" data-on="${n}"><span class="hd-n">${n}</span><span class="hd-c">${esc(l) || " "}</span></div>`;
  }).join("")}</div>`;
}

function machinePanel(t: T, h: HoodState, canAsk: boolean): string {
  if (h.busy.code) return `<div class="sec-empty">${t("loading")}</div>`;
  if (h.lang === "rust") {
    const a = h.lineAsm;
    if (!a) return "";
    if (!a.ok) return `<pre class="hd-err notr">${esc(a.notes)}</pre>`;
    const head = `<div class="hd-meta">${t("total", { n: a.total, p: a.profile })}</div>`;
    if (h.selected === null) return head + `<div class="sec-empty">${t("pickLine")}</div>`;
    const lc = a.lines.find((l) => l.line === h.selected);
    if (!lc) return head + `<div class="sec-empty">${t("noCode")}</div>`;
    return head + `<div class="hd-meta notr">${esc(lc.funcs.join(", "))} · ${t("instructions", { n: lc.instructions.length })}${canAsk ? " " + btn("hd-ask-line", t("askLine"), "", "btn ghost hd-ai") : ""}</div><pre class="hd-code notr">${esc(lc.instructions.join("\n"))}</pre>`;
  }
  const b = h.bytecode;
  if (!b) return "";
  if (!b.ok) return `<pre class="hd-err notr">${esc(b.notes)}</pre>`;
  const head = `<div class="hd-meta">${t("pyVersion", { v: b.version })}</div>`;
  if (h.selected === null) return head + `<div class="sec-empty">${t("pickLine")}</div>`;
  const ls = b.lines.filter((l) => l.line === h.selected);
  if (!ls.length) return head + `<div class="sec-empty">${t("noCode")}</div>`;
  return head + (canAsk ? `<div class="hd-meta">${btn("hd-ask-line", t("askLine"), "", "btn ghost hd-ai")}</div>` : "") + ls.map((l) => `<div class="hd-meta notr">${esc(l.scope)} · ${t("ops", { n: l.ops.length })}</div><pre class="hd-code notr">${esc(l.ops.join("\n"))}</pre>`).join("");
}

function stagePanel(t: T, h: HoodState): string {
  if (h.busy.pipeline || !h.pipeline) return `<div class="sec-empty">${t("loading")}</div>`;
  const p = h.pipeline, text = h.stage === "llvm" ? p.llvmIr : h.stage === "asm" ? p.asm : h.stage === "mir" ? p.mir : p.disasm;
  return (p.notes ? `<div class="hd-meta notr">${esc(p.notes)}</div>` : "") + (text ? `<pre class="hd-code hd-big notr">${esc(text)}</pre>` : "");
}

function measuredCard(t: T, h: HoodState): string {
  const m = h.measured;
  /* no sandbox de contentor o CLI não dá CPU nem memória: o backend devolve-os a zero e a vista não os mostra como medidos */
  const fine = !!m && (m.telemetry.peakRssKb > 0 || m.telemetry.cpuUserMs + m.telemetry.cpuSysMs > 0 || m.telemetry.samples.length > 0);
  const body = m
    ? `<div class="hd-kv"><span>${t("wall")}</span><b>${fmtMs(m.telemetry.wallMs)}</b>${fine ? `<span>${t("cpu")}</span><b>${fmtMs(m.telemetry.cpuUserMs + m.telemetry.cpuSysMs)}</b><span>${t("rss")}</span><b>${(m.telemetry.peakRssKb / 1024).toFixed(1)} MB</b>` : ""}<span>${t("exit")}</span><b>${m.telemetry.exitCode}</b></div>${fine ? "" : `<div class="hd-meta">${t("inContainer")}</div>`}`
      + (m.telemetry.samples.length > 1 ? `<div class="hd-meta">${t("memCurve")}</div><svg class="hd-spark" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPoints(m.telemetry.samples, 240, 40)}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>` : "")
      + (m.run.stdout || m.run.stderr ? `<pre class="hd-code notr">${esc((m.run.stdout + (m.run.stderr ? "\n" + m.run.stderr : "")).slice(-3000))}</pre>` : "")
    : `<div class="sec-empty">${t("notMeasured")}</div>`;
  return `<div class="hd-card"><div class="hd-ct">${t("measure")}<span class="hd-sp"></span>${btn("hd-run", t("run"), "", "btn ghost", h.busy.measured)}</div>${h.busy.measured ? `<div class="sec-empty">${t("loading")}</div>` : body}</div>`;
}

function growthCard(t: T, h: HoodState, canAsk: boolean): string {
  const g = h.growth;
  let body = `<div class="sec-empty">${t("notMeasured")}</div>`;
  if (h.busy.growth) body = `<div class="sec-empty">${t("loading")}</div>`;
  else if (g) {
    const mx = Math.max(...g.samples.map((s) => s.ms), 0.001);
    body = (g.ok ? `<div class="hd-fit"><b>${esc(t("fit", { o: g.bigO ?? "?" }))}</b> · ${t("r2", { r: (g.rSquared ?? 0).toFixed(3) })} · ${esc(t("confidence", { c: g.confidence ?? "" }))}${canAsk ? " " + btn("hd-ask-growth", t("askGrowthBtn"), "", "btn ghost hd-ai") : ""}</div>` : "")
      + (g.samples.length ? `<div class="hd-bars">${g.samples.map((s) => `<div class="hd-bar"><span class="notr">${s.n}</span><i style="width:${Math.max(2, (s.ms / mx) * 100).toFixed(1)}%"></i><b>${fmtMs(s.ms)}</b></div>`).join("")}</div>` : "")
      + (g.notes ? `<pre class="hd-err notr">${esc(g.notes)}</pre>` : "");
  }
  return `<div class="hd-card"><div class="hd-ct">${t("growth")}</div><div class="hd-meta">${t("growthHelp")}</div><div class="hd-row"><input class="inp notr" data-action="hd-sizes" value="${esc(h.sizes)}">${btn("hd-growth", t("measureGrowth"), "", "btn ghost", h.busy.growth)}</div>${body}</div>`;
}

export function renderHood(t: T, h: HoodState | null, canAsk: boolean): string {
  if (!h) return `<div class="hd"><div class="sec-empty">${t("needFile")}</div></div>`;
  const stages: Stage[] = h.lang === "rust" ? ["machine", "llvm", "asm", "mir", "disasm"] : ["machine"];
  const tabs = stages.map((s) => `<button class="hd-tab${h.stage === s ? " on" : ""}" data-action="hd-stage" data-on="${s}">${s === "machine" ? (h.lang === "rust" ? t("machine") : t("bytecode")) : t(s)}</button>`).join("");
  const prof = h.lang === "rust" ? `<span class="hd-seg">${btn("hd-profile", t("debug"), "debug", h.release ? "hd-tab" : "hd-tab on")}${btn("hd-profile", t("release"), "release", h.release ? "hd-tab on" : "hd-tab")}</span>` : "";
  return `<div class="hd"><div class="hd-top"><b>${t("title")}</b><span class="hd-chip notr">${esc(h.path.split("/").slice(-2).join("/"))}</span>${prof}<span class="hd-sp"></span></div>
    ${h.error ? `<pre class="hd-err notr">${esc(h.error)}</pre>` : ""}
    <div class="hd-cols"><div class="hd-col">${sourcePanel(h)}</div><div class="hd-col"><div class="hd-tabs">${tabs}</div>${h.stage === "machine" ? machinePanel(t, h, canAsk) : stagePanel(t, h)}</div></div>
    ${h.lang === "rust" ? `<div class="hd-cards">${measuredCard(t, h)}${growthCard(t, h, canAsk)}</div>` : ""}</div>`;
}
