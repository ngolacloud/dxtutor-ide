/* ═════════ feature `testing` — a vista do separador «Tests» do painel ═════════
   Markup puro a partir do estado da corrida (`domain/live.ts`): cabeçalho com o estado (spinner,
   ✓, ✗), o comando, o tempo, os contadores, a barra de progresso (indeterminada quando a ferramenta
   não diz quantos testes há), «o que está a acontecer agora», a lista de testes a chegar com
   PASS/FAIL/SKIP e a duração, e cada falha com o sítio clicável e o detalhe. Acções `live:*`
   (despachante da feature, `ui/actions.ts`). Sem `window`. */

import { esc } from "../../../core";
import { liveCounts, progress, type LiveRun } from "../domain/live";
import type { LiveMsgKey } from "./live-messages";

export type LT = (k: LiveMsgKey, p?: Record<string, string | number>) => string;

export interface LiveUi {
  filter: "all" | "failed";
  log: boolean;
}

export const fmtElapsed = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const fmtMs = (ms: number | null): string => (ms === null ? "" : ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`);

function title(r: LiveRun, t: LT): string {
  switch (r.phase) {
    case "starting": return t("starting");
    case "building": return t("building");
    case "running": return t("running");
    case "passed": return t("passed");
    case "failed": return t("failed");
    case "stopped": return t("stopped");
    default: return t("error");
  }
}

const ICON: Record<string, string> = { pass: "✓", fail: "✗", skip: "○" };

export function renderLive(r: LiveRun | null, ui: LiveUi, t: LT, elapsed: number): string {
  if (!r) return `<div class="tl"><div class="tl-empty">${esc(t("empty"))}</div></div>`;
  const busy = r.phase === "starting" || r.phase === "building" || r.phase === "running";
  const c = liveCounts(r);
  const p = progress(r);
  const st = `<span class="tl-st st-${r.phase}">${busy ? '<span class="tl-spin"></span>' : r.phase === "passed" ? "✓" : r.phase === "stopped" ? "■" : "✗"}</span>`;
  const counts = `<span class="tl-counts notr"><span class="c-pass" title="passed">✓ ${c.pass}</span><span class="c-fail" title="failed">✗ ${c.fail}</span><span class="c-skip" title="skipped">○ ${c.skip}</span>${r.total ? `<span class="c-total">${c.done}/${r.total}</span>` : ""}</span>`;
  const seg = `<span class="tl-seg"><button class="${ui.filter === "all" ? "on" : ""}" data-action="live:filter" data-on="all">${esc(t("all"))}</button><button class="${ui.filter === "failed" ? "on" : ""}" data-action="live:filter" data-on="failed"${c.fail ? "" : " disabled"}>${esc(t("onlyFailed"))}${c.fail ? ` ${c.fail}` : ""}</button></span>`;
  const tools = `${seg}<button class="tl-btn${ui.log ? " on" : ""}" data-action="live:log">${esc(t(ui.log ? "list" : "log"))}</button>${busy ? `<button class="tl-btn stop" data-action="live:stop">■ ${esc(t("stop"))}</button>` : `<button class="tl-btn pri" data-action="live:rerun">↻ ${esc(t("rerun"))}</button>`}`;
  const head = `<div class="tl-hd">${st}<div class="tl-ttl"><b>${esc(title(r, t))}</b>${r.command ? `<code class="notr">${esc(r.command)}</code>` : ""}${r.source ? `<small>${esc(t("from", { s: r.source }))}</small>` : ""}</div><span class="tl-time notr" data-live-time>${fmtElapsed(elapsed)}</span>${counts}<span class="sp"></span>${tools}</div>`;
  const bar = `<div class="tl-bar ${busy ? (p === null ? "ind" : "") : `done-${r.phase}`}"><i style="width:${Math.round((p ?? (busy ? 0.3 : 1)) * 100)}%"></i></div>`;
  const nowLine = busy ? `<div class="tl-now notr"><span class="tl-dot"></span>${esc(r.now || t("waiting"))}</div>` : "";

  if (r.phase === "error") {
    const msg = r.error === "no-folder" ? t("noFolder") : r.error === "no-command" ? t("noCommand") : r.error ?? "";
    return `<div class="tl">${head}${bar}<div class="tl-msg bad">${esc(msg)}</div></div>`;
  }
  if (ui.log) return `<div class="tl">${head}${bar}${nowLine}<pre class="tl-log notr" data-live-log>${esc(r.log.slice(-1500).join("\n"))}</pre></div>`;

  const rows = r.cases.map((x, i) => ({ x, i })).filter(({ x }) => ui.filter === "all" || x.status === "fail");
  const list = rows.map(({ x, i }) => {
    const row = `<div class="tl-row ${x.status}" data-action="live:open" data-on="${i}" title="${esc(t("openHint"))}"><span class="ic">${ICON[x.status]}</span><span class="nm notr">${esc(x.name)}</span>${x.suite ? `<span class="suite notr">${esc(x.suite)}</span>` : ""}<span class="sp"></span><span class="ms notr">${fmtMs(x.ms)}</span></div>`;
    if (x.status !== "fail" || (!x.spot && !x.detail.length)) return row;
    const spot = x.spot ? `<div class="tl-spot"><button class="tl-loc notr" data-action="live:open" data-on="${i}">${esc(x.spot.file)}:${x.spot.line}</button><span>${esc(x.spot.message)}</span></div>` : "";
    const detail = x.detail.length ? `<pre class="tl-detail notr">${esc(x.detail.slice(-14).join("\n"))}</pre>` : "";
    return `${row}<div class="tl-fail">${spot}${detail}</div>`;
  }).join("");
  let tail = "";
  if (!busy && r.phase !== "stopped") {
    if (!r.cases.length && r.phase === "failed") tail = `<div class="tl-msg bad">${esc(t("buildFailed"))}${r.error ? `<pre class="tl-detail notr">${esc(r.error)}</pre>` : ""}</div>`;
    else if (!r.cases.length) tail = `<div class="tl-msg">${esc(t("noTests"))}</div>`;
    else tail = `<div class="tl-sum notr">${esc(t("summary", { n: c.done, p: c.pass, f: c.fail, s: c.skip }))} · ${fmtElapsed(elapsed)}</div>`;
  }
  const waiting = busy && !r.cases.length ? `<div class="tl-msg">${esc(t("waiting"))}</div>` : "";
  return `<div class="tl">${head}${bar}${nowLine}<div class="tl-list" data-live-list>${list}${waiting}${tail}</div></div>`;
}
