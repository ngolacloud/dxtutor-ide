/* ═════════ feature `panel` — vista do Output ═════════
   Um canal de cada vez (o selector vive na barra do painel), com hora em cada linha e
   scroll automático enquanto o utilizador estiver no fundo. */

import type { OutputLog } from "../application/output";

const esc = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
const hms = (t: number): string => new Date(t).toTimeString().slice(0, 8);

export function renderOutput(el: HTMLElement, log: OutputLog, channel: string | null): void {
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  if (!channel) {
    el.innerHTML = `<div class="sec-empty">Nothing has been logged yet.</div>`;
    return;
  }
  const lines = log.lines(channel);
  el.innerHTML = `<div class="op">${lines.map((l) => `<div class="op-l ${l.level}"><span class="op-t">${hms(l.at)}</span>${esc(l.text) || "&nbsp;"}</div>`).join("") || `<div class="sec-empty">This channel is empty.</div>`}</div>`;
  if (atBottom) el.scrollTop = el.scrollHeight;
}
