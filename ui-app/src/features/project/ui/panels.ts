/* ═════════ feature `project` — Planning, Releases, Reports, Retro and Settings (PROJ-02/05) ═════════
   Reports are drawn only from the store's history (`project_reports`): with too little of
   it, each chart says what it needs instead of showing invented numbers. */

import { esc } from "../../../core";
import type { ProjectState } from "../application/project-service";
import { METHOD_INFO } from "../domain/board";
import { METHODS, STATES, type Project, type Reports } from "../domain/types";

const DAY = 86_400_000;
const fmt = (ms: number): string => new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function planning(p: Project, now: number): string {
  const box = METHOD_INFO[p.method].box ?? "Sprint";
  const ready = p.issues.filter((i) => !i.sprint && i.state !== "done");
  const sprints = p.sprints.filter((s) => s.state !== "closed");
  const nextStart = Math.max(now, ...p.sprints.map((s) => s.end));
  const form = `<div class="pj-card-box"><div class="pj-sec"><span>New ${esc(box.toLowerCase())}</span></div>
    <div class="pj-form" data-action="pj-form" data-on="sprint">
      <input class="pj-input" name="name" placeholder="${esc(box)} ${p.sprints.length + 1}" value="${esc(box)} ${p.sprints.length + 1}">
      <input class="pj-input" name="goal" placeholder="Goal (one sentence)">
      <input class="pj-input" type="date" name="start" value="${iso(nextStart)}"><input class="pj-input" type="date" name="end" value="${iso(nextStart + p.iterDays * DAY)}">
      <input class="pj-input" type="number" min="0" name="capacity" placeholder="Capacity (points)">
      <button class="pj-btn pri" data-action="pj-submit" data-on="sprint"><span>Create</span></button></div></div>`;
  const list = sprints
    .map((s) => {
      const items = p.issues.filter((i) => i.sprint === s.id);
      const pts = items.reduce((n, i) => n + (i.points ?? 0), 0);
      const over = s.capacity !== null && pts > s.capacity;
      return `<div class="pj-card-box"><div class="pj-sec"><span>${esc(s.name)}</span> <span class="pj-dim">${fmt(s.start)} – ${fmt(s.end)} · ${s.state}</span><span class="sp"></span>${
        s.state === "planned" ? `<button class="pj-btn pri" data-action="pj-sprint-start" data-on="${esc(s.id)}"><span>Start</span></button>` : `<button class="pj-btn" data-action="pj-sprint-close" data-on="${esc(s.id)}"><span>Close</span></button>`
      }</div>${s.goal ? `<div class="pj-goal">${esc(s.goal)}</div>` : ""}
      <div class="pj-dim${over ? " bad" : ""}"><span>${pts} points planned${s.capacity !== null ? ` of ${s.capacity} capacity` : ""}</span></div>
      ${items.map((i) => `<div class="pj-row" data-action="pj-open" data-on="${esc(i.key)}"><span class="pj-key">${esc(i.key)}</span><span class="pj-row-t">${esc(i.title)}</span><span class="pj-pts">${i.points ?? "–"}</span><button class="pj-icon" title="Back to the backlog" data-action="pj-unplan" data-on="${esc(i.key)}">✕</button></div>`).join("")}</div>`;
    })
    .join("");
  const target = sprints.find((s) => s.state === "planned") ?? sprints[0];
  const cands = target
    ? `<div class="pj-sec"><span>Candidates</span> <span class="pj-dim">— ranked backlog; only ready issues should go in</span></div>${ready
        .map(
          (i) => `<div class="pj-row"><span class="pj-key">${esc(i.key)}</span><span class="pj-row-t">${esc(i.title)}</span>${i.ready ? `<span class="pj-flag ok"><span>ready</span></span>` : `<span class="pj-flag"><span>not ready</span></span>`}<span class="pj-pts">${i.points ?? "–"}</span>
          <button class="pj-btn" data-action="pj-plan-to" data-on="${esc(i.key)}|${esc(target.id)}"><span>Add to ${esc(target.name)}</span></button></div>`,
        )
        .join("") || `<div class="pj-dim pj-pad">The backlog has no open issues.</div>`}`
    : "";
  return form + list + cands;
}

function releases(p: Project): string {
  const rows = p.releases
    .map((r) => {
      const items = r.epic ? p.issues.filter((i) => i.epic === r.epic) : [];
      const done = items.filter((i) => i.state === "done").length;
      const pct = items.length ? Math.round((done / items.length) * 100) : 0;
      return `<div class="pj-rel"><div><b>v${esc(r.version.replace(/^v/, ""))}</b><div class="pj-dim">${fmt(r.date)}</div></div>
        <div class="pj-relbar"><div class="pj-relfill" style="width:${pct}%"></div></div>
        <div><span>${esc(r.goal)}</span><div class="pj-dim">${r.epic ? `${esc(r.epic)} · ${done}/${items.length} done` : "no epic linked"}</div></div>
        <button class="pj-icon" title="Delete" data-action="pj-rel-del" data-on="${esc(r.version)}">✕</button></div>`;
    })
    .join("");
  return `<div class="pj-card-box"><div class="pj-sec"><span>New release</span></div><div class="pj-form" data-action="pj-form" data-on="release">
    <input class="pj-input" name="version" placeholder="Version (e.g. 0.9.0)"><input class="pj-input" type="date" name="date">
    <input class="pj-input" name="goal" placeholder="Goal"><input class="pj-input" name="epic" placeholder="Epic it delivers (optional)">
    <button class="pj-btn pri" data-action="pj-submit" data-on="release"><span>Create</span></button></div></div>${
    rows || `<div class="pj-empty pj-dim">No releases planned yet.</div>`
  }`;
}

/* ───── charts (SVG, design tokens, no library) ───── */
const W = 520;
const Hc = 160;

function bars(values: number[], labels: string[], cls: string): string {
  const max = Math.max(1, ...values);
  const bw = W / Math.max(1, values.length);
  return `<svg class="pj-chart" viewBox="0 0 ${W} ${Hc + 18}">${values
    .map((v, k) => {
      const h = (v / max) * (Hc - 10);
      return `<rect class="${cls}" x="${k * bw + 4}" y="${Hc - h}" width="${Math.max(2, bw - 8)}" height="${h}" rx="2"><title>${esc(labels[k])}: ${v}</title></rect><text class="pj-axis" x="${k * bw + bw / 2}" y="${Hc + 14}" text-anchor="middle">${esc(labels[k])}</text>`;
    })
    .join("")}</svg>`;
}

function line(points: number[], max: number, cls: string, step = W / Math.max(1, points.length - 1)): string {
  if (points.length < 2) return "";
  return `<polyline class="${cls}" fill="none" points="${points.map((v, k) => `${k * step},${Hc - (v / Math.max(1, max)) * (Hc - 10)}`).join(" ")}"/>`;
}

const chartCard = (title: string, body: string, empty: string): string =>
  `<div class="pj-card-box"><div class="pj-sec"><span>${title}</span></div>${body || `<div class="pj-dim pj-pad">${empty}</div>`}</div>`;

function reports(p: Project, r: Reports | null): string {
  if (!r) return `<div class="pj-dim pj-pad">Computing the reports from the history…</div>`;
  const cycle = chartCard(
    "Cycle time",
    r.cycle.length
      ? `<div class="pj-dim"><span>median ${r.cycleMedian ?? "–"} days · 85% within ${r.cycleP85 ?? "–"} days</span></div>${bars(r.cycle.slice(-20).map((c) => c.days), r.cycle.slice(-20).map((c) => c.key), "pj-bar")}`
      : "",
    "Appears once issues reach Done (from entering In Progress to Done).",
  );
  const thr = chartCard(
    "Throughput",
    r.throughput.length ? bars(r.throughput.map((w) => w.done), r.throughput.map((w) => fmt(w.start)), "pj-bar alt") : "",
    "Issues finished per week, once the first one is done.",
  );
  const cfd = chartCard(
    "Cumulative flow",
    r.cfd.length >= 2
      ? (() => {
          const totals = r.cfd.map((d) => d.counts.reduce((a, b) => a + b, 0));
          const max = Math.max(1, ...totals);
          // stacked from Done (bottom) to To Do (top)
          let acc = r.cfd.map(() => 0);
          const layers = [4, 3, 2, 1, 0].map((s) => {
            acc = acc.map((a, k) => a + (r.cfd[k].counts[s] ?? 0));
            return line(acc, max, `pj-cfd s-${STATES[s]}`);
          });
          return `<svg class="pj-chart" viewBox="0 0 ${W} ${Hc}">${layers.join("")}</svg><div class="pj-legend">${STATES.map((s) => `<span class="pj-key-dot s-${s}"></span><span>${esc(METHOD_INFO[p.method].labels[s])}</span>`).join(" ")}</div>`;
        })()
      : "",
    "Needs at least two days of history.",
  );
  const bd = chartCard(
    "Burndown",
    r.burndown && r.burndown.days.length
      ? (() => {
          const b = r.burndown!;
          const span = Math.max(1, Math.round((b.end - b.start) / DAY));
          const ideal = Array.from({ length: span + 1 }, (_, k) => b.total * (1 - k / span));
          const real = b.days.map((d) => d.remaining);
          const step = W / span; // one step per day, for both lines
          return `<div class="pj-dim"><span>${b.total} points in ${esc(b.sprint)}</span></div><svg class="pj-chart" viewBox="0 0 ${W} ${Hc}">${line(ideal, b.total, "pj-ideal", step)}${line(real, b.total, "pj-real", step)}</svg>`;
        })()
      : "",
    METHOD_INFO[p.method].box ? `Start a ${METHOD_INFO[p.method].box!.toLowerCase()} to see its burndown.` : "",
  );
  const vel = chartCard(
    "Velocity",
    r.velocity.length ? bars(r.velocity.map((v) => v.points), r.velocity.map((v) => v.name), "pj-bar") : "",
    "Points finished per closed sprint, once one is closed.",
  );
  const order = p.method === "kanban" ? [cfd, cycle, thr] : [bd, vel, cfd, cycle, thr];
  return `<div class="pj-reports">${order.join("")}</div>`;
}

function retro(p: Project): string {
  const col = (kind: "good" | "improve" | "action", title: string) => `<div class="pj-card-box"><div class="pj-sec r-${kind}"><span>${title}</span></div>${p.retro
    .filter((n) => n.kind === kind)
    .map((n) => `<div class="pj-check"><span>${esc(n.text)}</span><button class="pj-icon" title="Remove" data-action="pj-retro-del" data-on="${n.id}">✕</button></div>`)
    .join("")}<input class="pj-input" placeholder="Add and press Enter" data-action="pj-retro-add" data-on="${kind}"></div>`;
  const actions = p.retro.filter((n) => n.kind === "action").length;
  return `<div class="pj-retro">${col("good", "What went well")}${col("improve", "What to improve")}${col("action", "Actions")}</div>${
    actions ? `<button class="pj-btn" data-action="pj-retro-backlog"><span>Send the actions to the inbox</span></button>` : ""
  }`;
}

function settings(p: Project): string {
  return `<div class="pj-card-box"><div class="pj-sec"><span>Method</span></div><div class="pj-methods">${METHODS.map(
    (m) => `<button class="pj-methodcard${p.method === m ? " on" : ""}" data-action="pj-method" data-on="${m}"><b>${esc(METHOD_INFO[m].name)}</b><span class="pj-dim">${esc(METHOD_INFO[m].desc)}</span></button>`,
  ).join("")}</div></div>
  <div class="pj-card-box"><div class="pj-form" data-action="pj-form" data-on="settings">
    <label><span>Issue key prefix</span><input class="pj-input" name="key_prefix" value="${esc(p.keyPrefix)}"></label>
    <label><span>Iteration length (days)</span><input class="pj-input" type="number" min="1" max="60" name="iter_days" value="${p.iterDays}"></label>
    ${STATES.filter((s) => s !== "todo" && s !== "done")
      .map((s) => `<label><span>WIP limit · ${esc(METHOD_INFO[p.method].labels[s])}</span><input class="pj-input" type="number" min="0" name="wip_${s}" value="${p.wip[s] ?? ""}" placeholder="no limit"></label>`)
      .join("")}
    <label class="wide"><span>Definition of Ready (one item per line)</span><textarea class="pj-input" name="dor" rows="4">${esc(p.dor.join("\n"))}</textarea></label>
    <label class="wide"><span>Definition of Done (one item per line)</span><textarea class="pj-input" name="dod" rows="4">${esc(p.dod.join("\n"))}</textarea></label>
    <button class="pj-btn pri" data-action="pj-submit" data-on="settings"><span>Save</span></button></div></div>`;
}

export function renderPanel(v: "planning" | "releases" | "reports" | "retro" | "settings", st: ProjectState, p: Project, now: number): string {
  switch (v) {
    case "planning":
      return planning(p, now);
    case "releases":
      return releases(p);
    case "reports":
      return reports(p, st.reports);
    case "retro":
      return retro(p);
    case "settings":
      return settings(p);
  }
}
