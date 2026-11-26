/* ═════════ feature `project` — the sprint charts and the manager's insights (Board A) ═════════
   The burndown, the burnup and the velocity read the history the backend recorded (scope, estimates and
   commitments as they were each day); a sprint that started before that history says it is partial. The
   insights are computed in the backend (`tutor_board::project::insights`): here each code becomes its
   sentence, with the numbers behind it and the issues involved (a key opens the issue, `pj-open`). What the
   history cannot support yet is listed with what is missing, never guessed. SVG with design tokens, no library. */

import { esc } from "../../../core";
import { translator } from "../../../app/i18n";
import type { Burndown, Insight, InsightParams, Project, Severity, Velocity, Withheld } from "../domain/types";
import { PROJECT_REPORTS_MESSAGES, type ReportsMessage } from "./reports-messages";

const t = translator(PROJECT_REPORTS_MESSAGES);
const DAY = 86_400_000;
export const W = 520;
export const Hc = 160;
/** Issue keys shown per insight before «+N more». */
const KEYS_SHOWN = 8;

const fmtDay = (ms: number): string => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export function bars(values: number[], labels: string[], cls: string): string {
  const max = Math.max(1, ...values);
  const bw = W / Math.max(1, values.length);
  return `<svg class="pj-chart" viewBox="0 0 ${W} ${Hc + 18}">${values
    .map((v, k) => {
      const h = (v / max) * (Hc - 10);
      return `<rect class="${cls}" x="${k * bw + 4}" y="${Hc - h}" width="${Math.max(2, bw - 8)}" height="${h}" rx="2"><title>${esc(labels[k])}: ${v}</title></rect><text class="pj-axis" x="${k * bw + bw / 2}" y="${Hc + 14}" text-anchor="middle">${esc(labels[k])}</text>`;
    })
    .join("")}</svg>`;
}

export function line(points: number[], max: number, cls: string, step = W / Math.max(1, points.length - 1)): string {
  if (points.length < 2) return "";
  return `<polyline class="${cls}" fill="none" points="${points.map((v, k) => `${k * step},${Hc - (v / Math.max(1, max)) * (Hc - 10)}`).join(" ")}"/>`;
}

export const chartCard = (title: string, body: string, empty: string): string =>
  `<div class="pj-card-box"><div class="pj-sec"><span>${title}</span></div>${body || `<div class="pj-dim pj-pad">${empty}</div>`}</div>`;

const legend = (items: Array<[string, ReportsMessage]>): string =>
  `<div class="pj-legend">${items.map(([cls, k]) => `<span class="pj-key-dot ${cls}"></span><span>${esc(t(k))}</span>`).join(" ")}</div>`;

/** A key that opens its issue, or plain text when the issue no longer exists. */
function keyChip(p: Project, k: string): string {
  return p.issues.some((i) => i.key === k) ? `<button class="pj-ins-key" data-action="pj-open" data-on="${esc(k)}">${esc(k)}</button>` : `<span class="pj-ins-key gone">${esc(k)}</span>`;
}

function keyChips(p: Project, keys: string[]): string {
  if (!keys.length) return "";
  const more = keys.length > KEYS_SHOWN ? ` <span class="pj-dim">${esc(t("more", { n: keys.length - KEYS_SHOWN }))}</span>` : "";
  return `<div class="pj-ins-keys">${keys.slice(0, KEYS_SHOWN).map((k) => keyChip(p, k)).join("")}${more}</div>`;
}

/** The parameters as the translator takes them (`null` and booleans as text). */
function params(ps: InsightParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(ps)) out[k] = typeof v === "number" || typeof v === "string" ? v : v === null ? "–" : String(v);
  return out;
}

const KNOWN = new Set<string>(Object.keys(PROJECT_REPORTS_MESSAGES.en));
const known = (k: string): k is ReportsMessage => KNOWN.has(k);

/** The one-line sentence of an insight (with the variants that depend on its numbers). */
export function insightText(i: Insight): string {
  const ps = params(i.params);
  const n = (k: string): number => (typeof i.params[k] === "number" ? (i.params[k] as number) : 0);
  switch (i.code) {
    case "scope_creep":
      return t(i.params.pct === null ? "scope_creep_nocommit" : "scope_creep", ps);
    case "blocked": {
      const head = t(i.params.longestDays === null ? "blocked_unknown" : "blocked", ps);
      return n("sprintDays") > 0 ? `${head} ${t("blockedSprint", ps)}` : head;
    }
    case "cost_per_point":
      return [t("cost_per_point", ps), n("outliers") > 0 ? t("costOutliers", ps) : "", n("unpriced") > 0 ? t("costUnpriced", ps) : ""].filter(Boolean).join(" ");
    default:
      return known(i.code) ? t(i.code, ps) : i.code;
  }
}

export function withheldText(w: Withheld): string {
  const k = `w_${w.code}`;
  return known(k) ? t(k, params(w.params)) : w.code;
}

const SEV_LABEL: Record<Severity, ReportsMessage> = { risk: "sevRisk", warn: "sevWarn", info: "sevInfo" };

/** The «Insights» panel: what the history says, then what it cannot say yet. */
export function insightsPanel(p: Project, items: Insight[], withheld: Withheld[]): string {
  const rows = items
    .map(
      (i) =>
        `<div class="pj-ins sev-${i.severity}" data-code="${esc(i.code)}"><span class="pj-ins-sev">${esc(t(SEV_LABEL[i.severity]))}</span><div class="pj-ins-body"><div class="pj-ins-msg">${esc(insightText(i))}</div>${keyChips(p, i.keys)}</div></div>`,
    )
    .join("");
  const held = withheld.length
    ? `<details class="pj-ins-held"><summary class="pj-dim">${esc(t("notYet", { n: withheld.length }))}</summary>${withheld.map((w) => `<div class="pj-dim pj-ins-w">${esc(withheldText(w))}</div>`).join("")}</details>`
    : "";
  const body = rows || (held ? "" : `<div class="pj-dim pj-pad">${esc(t("insightsEmpty"))}</div>`);
  return `<div class="pj-card-box pj-insights"><div class="pj-sec"><span>${esc(t("insights"))}</span> <span class="pj-dim">— ${esc(t("insightsHint"))}</span></div>${body}${held}</div>`;
}

function partialNote(b: Burndown, since: number | null): string {
  if (!b.partial) return "";
  return `<div class="pj-dim pj-partial">${esc(since !== null ? t("partialSince", { since: fmtDay(since) }) : t("partialNoDate"))}</div>`;
}

function unestimatedNote(p: Project, b: Burndown): string {
  return b.unestimated.length ? `<div class="pj-dim pj-unest"><span>${esc(t("unestimatedNote"))}</span> ${keyChips(p, b.unestimated)}</div>` : "";
}

const span = (b: Burndown): number => Math.max(1, Math.round((b.end - b.start) / DAY));

/** Remaining points per day as they were that day, against the ideal from the commitment. */
export function burndownBody(p: Project, b: Burndown, since: number | null): string {
  if (!b.days.length) return "";
  const n = span(b);
  const ideal = Array.from({ length: n + 1 }, (_, k) => b.total * (1 - k / n));
  const real = b.days.map((d) => d.remaining);
  const max = Math.max(b.total, ...real);
  const step = W / n; // one step per day, for both lines
  const last = b.days[b.days.length - 1];
  const sub = t(b.partial ? "burndownSubPartial" : "burndownSub", { remaining: last.remaining, scope: last.scope, name: b.name, total: b.total });
  return `<div class="pj-dim"><span>${esc(sub)}</span></div>${partialNote(b, since)}<svg class="pj-chart" viewBox="0 0 ${W} ${Hc}">${line(ideal, max, "pj-ideal", step)}${line(real, max, "pj-real", step)}</svg>${legend([
    ["l-ideal", "legendIdeal"],
    ["l-real", "legendRemaining"],
  ])}${unestimatedNote(p, b)}`;
}

/** Done points against the scope line: scope added, removed or re-estimated shows as the line moving. */
export function burnupBody(b: Burndown): string {
  if (!b.days.length) return "";
  const n = span(b);
  const scope = b.days.map((d) => d.scope);
  const done = b.days.map((d) => d.done);
  const max = Math.max(1, ...scope, b.committed ?? 0);
  const step = W / n;
  const committed = b.committed !== null ? line([b.committed, b.committed], max, "pj-commit", W) : "";
  const last = b.days[b.days.length - 1];
  return `<div class="pj-dim"><span>${esc(t("burnupSub", { done: last.done, scope: last.scope }))}</span></div><svg class="pj-chart" viewBox="0 0 ${W} ${Hc}">${committed}${line(scope, max, "pj-scope", step)}${line(done, max, "pj-done", step)}</svg>${legend([
    ...(b.committed !== null ? ([["l-commit", "legendCommitted"]] as Array<[string, ReportsMessage]>) : []),
    ["l-scope", "legendScope"],
    ["l-done", "legendDone"],
  ])}`;
}

/** Committed vs done per closed sprint; a partial sprint shows only what was done. */
export function velocityBody(v: Velocity[]): string {
  if (!v.length) return "";
  const max = Math.max(1, ...v.map((x) => Math.max(x.points, x.committed ?? 0)));
  const bw = W / v.length;
  const bar = (x: number, val: number, cls: string, w: number): string => {
    const h = (val / max) * (Hc - 10);
    return `<rect class="${cls}" x="${x}" y="${Hc - h}" width="${Math.max(2, w)}" height="${h}" rx="2"/>`;
  };
  const groups = v
    .map((s, k) => {
      const x0 = k * bw + 4;
      const w = Math.max(2, (bw - 10) / 2);
      const tip = s.partial
        ? t("velocityTipPartial", { name: s.name, points: s.points })
        : t("velocityTip", { name: s.name, committed: s.committed ?? 0, points: s.points, committedDone: s.committedDone ?? 0, added: s.added ?? 0, removed: s.removed ?? 0, carried: s.carried ?? 0 });
      const label = s.partial ? `${s.name}*` : s.name;
      return `<g><title>${esc(tip)}</title>${s.committed !== null ? bar(x0, s.committed, "pj-bar commit", w) : ""}${bar(x0 + w + 2, s.points, s.partial ? "pj-bar partial" : "pj-bar", w)}<text class="pj-axis" x="${k * bw + bw / 2}" y="${Hc + 14}" text-anchor="middle">${esc(label)}</text></g>`;
    })
    .join("");
  const note = v.some((s) => s.partial) ? `<div class="pj-dim pj-partial">${esc(t("velocityPartial"))}</div>` : "";
  return `<div class="pj-dim"><span>${esc(t("velocitySub"))}</span></div><svg class="pj-chart" viewBox="0 0 ${W} ${Hc + 18}">${groups}</svg>${legend([
    ["l-commit", "legendCommitted"],
    ["l-done", "legendDone"],
  ])}${note}`;
}

export const burnupTitle = (): string => esc(t("burnup"));
export const burnupEmpty = (): string => esc(t("burnupEmpty"));
