/* ═════════ feature `project` — the Project tab (PROJ-01/03/04) ═════════
   Owns the markup of the Project tab: header with the sprint (or flow) summary, the views
   nav, the board (swimlanes × the method's five columns, WIP per column, cards you drag one
   step), the backlog with the inbox, and the issue panel (criteria, DoR/DoD, development:
   branch, commits, Co-Dev change sets; activity). The other views are in `panels.ts`.
   Everything shown comes from the store; with nothing there the view says so. Buttons carry
   `data-action` (+ `data-on`); the effects live in the composition root's table. */

import { esc } from "../../../core";
import type { ProjectService, ProjectState } from "../application/project-service";
import {
  METHOD_INFO,
  VIEW_LABEL,
  backlog,
  boardIssues,
  branchName,
  daysIn,
  doneProgress,
  lanes,
  nextState,
  prevState,
  summary,
  viewsFor,
  wipOf,
  type View,
} from "../domain/board";
import { COS, KINDS, PRIORITIES, STATES, type Issue, type Project, type State } from "../domain/types";
import { renderPanel } from "./panels";

const KIND_MARK: Record<string, string> = { story: "▣", bug: "●", task: "☑", spike: "⚑" };
const PRI_MARK: Record<string, string> = { high: "⬆", medium: "＝", low: "⬇" };

export const initials = (n: string): string =>
  n
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

const avatar = (n: string): string => (n ? `<span class="pj-av" title="${esc(n)}">${esc(initials(n))}</span>` : "");

export const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

function card(i: Issue, p: Project, now: number): string {
  const dp = doneProgress(i, p);
  const commits = i.links.filter((l) => l.kind === "commit").length;
  return `<div class="pj-card k-${i.kind}${i.blocked ? " blocked" : ""}${i.cos === "expedite" ? " expedite" : ""}" draggable="true" data-action="pj-card" data-on="${esc(i.key)}">
    <div class="pj-card-top"><span class="pj-kind k-${i.kind}" title="${esc(i.kind)}">${KIND_MARK[i.kind]}</span><span class="pj-key">${esc(i.key)}</span>${
      i.blocked ? `<span class="pj-flag bad" title="${esc(i.blocked)}"><span>blocked</span></span>` : !i.ready && i.state === "todo" && p.method !== "kanban" ? `<span class="pj-flag"><span>not ready</span></span>` : ""
    }</div>
    <div class="pj-title">${esc(i.title)}</div>
    <div class="pj-card-foot"><span class="pj-pri p-${i.priority}" title="${esc(i.priority)}">${PRI_MARK[i.priority]}</span>${
      i.points !== null ? `<span class="pj-pts">${i.points}</span>` : ""
    }<span class="pj-age" title="days in this column">${daysIn(i, now)}d</span>${commits ? `<span class="pj-meta" title="commits">⎇ ${commits}</span>` : ""}${
      i.changeSets ? `<span class="pj-meta" title="Co-Dev change sets">✦ ${i.changeSets}</span>` : ""
    }${dp.total ? `<span class="pj-meta${dp.done === dp.total ? " ok" : ""}" title="acceptance criteria and DoD">✓ ${dp.done}/${dp.total}</span>` : ""}<span class="sp"></span>${avatar(i.assignee)}${avatar(i.pair)}</div>
  </div>`;
}

function header(st: ProjectState, p: Project, now: number): string {
  const s = summary(p, now);
  const m = METHOD_INFO[p.method];
  return `<div class="pj-head">
    <div class="pj-head-l"><div class="pj-h1"><span>${esc(s.title)}</span>${s.daysLeft !== null ? ` · <span class="pj-dim">${s.daysLeft} days left</span>` : ""}</div>
      ${s.goal ? `<div class="pj-goal">${esc(s.goal)}</div>` : ""}
      <div class="pj-dim"><span>${s.donePoints} of ${s.points} points done</span> · <span>${p.issues.length} issues</span></div></div>
    <span class="pj-method" title="${esc(m.desc)}">${esc(m.name)}</span>
  </div>
  <div class="pj-nav">${viewsFor(p.method)
    .map((v) => `<button class="pj-tab${st.view === v ? " on" : ""}" data-action="pj-view" data-on="${v}"><span>${VIEW_LABEL[v]}</span>${v === "backlog" && p.inbox.length ? ` <span class="pj-count">${p.inbox.length}</span>` : ""}</button>`)
    .join("")}</div>`;
}

function board(st: ProjectState, p: Project, now: number): string {
  const issues = boardIssues(p, st.filters);
  const ls = lanes(issues, st.swim);
  const labels = METHOD_INFO[p.method].labels;
  const chip = (action: string, on: string, label: string, active: boolean) =>
    `<button class="pj-chip${active ? " on" : ""}" data-action="${action}" data-on="${on}"><span>${label}</span></button>`;
  const tools = `<div class="pj-tools">
    <input class="pj-search" placeholder="Search issues" value="${esc(st.filters.q)}" data-action="pj-search">
    ${chip("pj-quick", "mine", "Only my issues", st.filters.quick.includes("mine"))}${chip("pj-quick", "bugs", "Bugs", st.filters.quick.includes("bugs"))}${chip("pj-quick", "blocked", "Blocked", st.filters.quick.includes("blocked"))}
    <span class="sp"></span><span class="pj-dim">Swimlanes</span>${chip("pj-swim", "epic", "epic", st.swim === "epic")}${chip("pj-swim", "assignee", "assignee", st.swim === "assignee")}${chip("pj-swim", "none", "none", st.swim === "none")}
    <button class="pj-btn" data-action="pj-sync" title="Link the commits that cite issue keys"><span>Sync commits</span></button>
  </div>`;
  if (!p.issues.length) {
    return tools + `<div class="pj-empty"><b>No issues yet.</b><p>Create the first one below, or accept proposals from the Studio in the Backlog.</p>${newIssue(null)}</div>`;
  }
  const cols = STATES.map((s) => {
    const w = wipOf(p, issues, s);
    return `<div class="pj-colhead${w.over ? " over" : ""}"><span>${esc(labels[s])}</span><span class="pj-wip">${w.count}${w.limit !== null ? " / " + w.limit : ""}</span></div>`;
  }).join("");
  const body = ls
    .map(
      (l) => `${st.swim !== "none" ? `<div class="pj-lane"><span class="pj-dot"></span><b>${esc(l.name || (st.swim === "epic" ? "No epic" : "Unassigned"))}</b> <span class="pj-dim">${l.count}</span></div>` : ""}
      <div class="pj-cols">${STATES.map((s) => `<div class="pj-col" data-action="pj-col" data-on="${s}">${l.columns[s].map((i) => card(i, p, now)).join("")}</div>`).join("")}</div>`,
    )
    .join("");
  return tools + `<div class="pj-board"><div class="pj-cols pj-heads">${cols}</div>${body}</div>${newIssue(null)}`;
}

const newIssue = (sprint: string | null): string =>
  `<div class="pj-new"><input class="pj-input" placeholder="New issue — type a title and press Enter" data-action="pj-new" data-on="${esc(sprint ?? "")}"></div>`;

function backlogView(p: Project): string {
  const b = backlog(p);
  const sprintOpts = (i: Issue) =>
    p.method === "kanban"
      ? ""
      : `<select class="pj-select" data-action="pj-plan" data-on="${esc(i.key)}"><option value="">Backlog</option>${p.sprints
          .filter((s) => s.state !== "closed")
          .map((s) => `<option value="${esc(s.id)}"${i.sprint === s.id ? " selected" : ""}>${esc(s.name)}</option>`)
          .join("")}</select>`;
  const row = (i: Issue, k: number, list: Issue[]) => `<div class="pj-row" data-action="pj-open" data-on="${esc(i.key)}">
      <span class="pj-kind k-${i.kind}">${KIND_MARK[i.kind]}</span><span class="pj-key">${esc(i.key)}</span><span class="pj-row-t">${esc(i.title)}</span>
      ${i.ready ? `<span class="pj-flag ok"><span>ready</span></span>` : ""}<span class="pj-pts">${i.points ?? "–"}</span>
      <span class="pj-state">${esc(METHOD_INFO[p.method].labels[i.state])}</span>${sprintOpts(i)}
      <button class="pj-icon" title="Move up" data-action="pj-up" data-on="${esc(i.key)}|${esc(list[k - 1]?.key ?? "")}"${k === 0 ? " disabled" : ""}>↑</button>
      <button class="pj-icon" title="Move down" data-action="pj-down" data-on="${esc(i.key)}|${esc(list[k + 2]?.key ?? "")}"${k === list.length - 1 ? " disabled" : ""}>↓</button>
    </div>`;
  const inbox = p.inbox.length
    ? `<div class="pj-card-box accent"><div class="pj-sec"><span>Inbox</span> <span class="pj-dim">— proposals wait here until you accept or dismiss them</span></div>${p.inbox
        .map(
          (x) => `<div class="pj-row"><span class="pj-kind k-${x.kind}">${KIND_MARK[x.kind]}</span><span class="pj-row-t">${esc(x.title)}</span><span class="pj-dim">${esc(x.source)}</span><span class="pj-pts">${x.points ?? "–"}</span>
          <button class="pj-btn pri" data-action="pj-accept" data-on="${x.id}"><span>Accept</span></button><button class="pj-btn" data-action="pj-dismiss" data-on="${x.id}"><span>Dismiss</span></button></div>`,
        )
        .join("")}</div>`
    : "";
  const sections = b.bySprint
    .map(
      ({ sprint, issues }) => `<div class="pj-sec"><span>${esc(sprint.name)}</span> <span class="pj-dim">${sprint.state} · ${issues.reduce((n, i) => n + (i.points ?? 0), 0)} pts${
        sprint.capacity ? " of " + sprint.capacity : ""
      }</span></div>${issues.map((i, k) => row(i, k, issues)).join("") || `<div class="pj-dim pj-pad">Nothing planned yet.</div>`}`,
    )
    .join("");
  return `${inbox}${sections}<div class="pj-sec"><span>Backlog</span> <span class="pj-dim">${b.unplanned.length} issues · ranked</span></div>${
    b.unplanned.map((i, k) => row(i, k, b.unplanned)).join("") || `<div class="pj-dim pj-pad">The backlog is empty.</div>`
  }${newIssue(null)}`;
}

function issuePanel(st: ProjectState, p: Project, now: number): string {
  const i = p.issues.find((x) => x.key === st.selected);
  if (!i) return "";
  const labels = METHOD_INFO[p.method].labels;
  const prev = prevState(i.state);
  const next = nextState(i.state);
  const sel = (field: string, opts: readonly string[], v: string) =>
    `<select class="pj-select" data-action="pj-field" data-on="${field}">${opts.map((o) => `<option value="${o}"${o === v ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  const txt = (field: string, v: string, ph: string) => `<input class="pj-input" data-action="pj-field" data-on="${field}" value="${esc(v)}" placeholder="${esc(ph)}">`;
  const d = st.detail;
  const commits = i.links.filter((l) => l.kind === "commit");
  return `<aside class="pj-issue">
    <div class="pj-issue-head"><span class="pj-kind k-${i.kind}">${KIND_MARK[i.kind]}</span><b>${esc(i.key)}</b><span class="sp"></span>
      <button class="pj-btn" data-action="pj-delete" data-on="${esc(i.key)}"><span>Delete</span></button><button class="pj-icon" title="Close" data-action="pj-close">✕</button></div>
    <input class="pj-input pj-issue-title" data-action="pj-field" data-on="title" value="${esc(i.title)}">
    <div class="pj-move">${prev ? `<button class="pj-btn" data-action="pj-move" data-on="${prev}"><span>← ${esc(labels[prev])}</span></button>` : ""}<span class="pj-state on">${esc(labels[i.state])}</span><span class="pj-dim">${daysIn(i, now)}d</span>${
      next ? `<button class="pj-btn pri" data-action="pj-move" data-on="${next}"><span>${esc(labels[next])} →</span></button>` : ""
    }</div>
    <div class="pj-grid2">
      <label><span>Type</span>${sel("kind", KINDS, i.kind)}</label><label><span>Priority</span>${sel("priority", PRIORITIES, i.priority)}</label>
      <label><span>Points</span><input class="pj-input" type="number" min="0" data-action="pj-field" data-on="points" value="${i.points ?? ""}"></label>
      <label><span>Class of service</span>${sel("cos", COS, i.cos)}</label>
      <label><span>Assignee</span>${txt("assignee", i.assignee, "name")}</label><label><span>Pair</span>${txt("pair", i.pair, "name")}</label>
      <label><span>Epic</span>${txt("epic", i.epic, "epic")}</label>
      <label><span>Blocked</span><input class="pj-input" data-action="pj-field" data-on="blocked" value="${esc(i.blocked ?? "")}" placeholder="reason (empty = not blocked)"></label>
    </div>
    <div class="pj-sec"><span>Description</span></div>
    <textarea class="pj-input pj-desc" data-action="pj-field" data-on="description" placeholder="What and why">${esc(i.description)}</textarea>
    <div class="pj-sec"><span>Acceptance criteria</span></div>
    ${i.acceptance
      .map(
        (c, k) => `<div class="pj-check"><input type="checkbox"${c.done ? " checked" : ""} data-action="pj-crit" data-on="${k}"><span>${esc(c.text)}</span><button class="pj-icon" title="Remove" data-action="pj-crit-del" data-on="${k}">✕</button></div>`,
      )
      .join("")}
    <input class="pj-input" placeholder="Add a criterion and press Enter" data-action="pj-crit-add">
    ${
      p.method !== "kanban" || p.dor.length
        ? `<div class="pj-sec"><span>Definition of Ready</span></div><div class="pj-check"><input type="checkbox"${i.ready ? " checked" : ""} data-action="pj-ready"><span>Ready to start</span></div>${p.dor
            .map((t) => `<div class="pj-dim pj-li">· ${esc(t)}</div>`)
            .join("")}`
        : ""
    }
    ${
      p.dod.length
        ? `<div class="pj-sec"><span>Definition of Done</span></div>${p.dod
            .map((t, k) => `<div class="pj-check"><input type="checkbox"${i.dodDone[k] ? " checked" : ""} data-action="pj-dod" data-on="${k}"><span>${esc(t)}</span></div>`)
            .join("")}`
        : ""
    }
    <div class="pj-sec"><span>Development</span></div>
    <div class="pj-dev">${
      i.branch
        ? `<div><span class="pj-dim">Branch</span> <code>${esc(i.branch)}</code></div>`
        : `<button class="pj-btn" data-action="pj-branch" title="git checkout -b ${esc(branchName(i))}"><span>Create branch</span></button> <code class="pj-dim">git checkout -b ${esc(branchName(i))}</code>`
    }
      <div class="pj-dim">${commits.length ? "" : "No commits cite this issue yet."}</div>
      ${commits.map((c) => `<div class="pj-li"><code>${esc(c.ref.slice(0, 7))}</code> ${esc(c.title)}</div>`).join("")}
      ${
        d && d.changeSets.length
          ? `<div class="pj-dim">Co-Dev change sets</div>${d.changeSets
              .map((c) => `<div class="pj-li"><code>${esc(c.path)}:${c.start}</code> <span class="ok">+${c.added}</span> <span class="bad">−${c.removed}</span> <span class="pj-dim">${esc(c.decidedBy)}</span></div>`)
              .join("")}`
          : ""
      }
      <button class="pj-btn pri" data-action="pj-work"><span>Work on it with Co-Dev</span></button></div>
    <div class="pj-sec"><span>Activity</span></div>
    <input class="pj-input" placeholder="Comment and press Enter" data-action="pj-comment">
    ${
      d
        ? d.activity
            .map(
              (a) => `<div class="pj-act"><span class="pj-dim">${fmtDate(a.at)}</span> <b>${esc(a.actor)}</b> <span>${esc(a.kind)}</span>${
                a.to ? ` <span class="pj-dim">${esc(a.from ? labels[a.from] + " → " : "")}${esc(labels[a.to])}</span>` : ""
              }${a.note ? ` — ${esc(a.note)}` : ""}</div>`,
            )
            .join("")
        : `<div class="pj-dim">…</div>`
    }
  </aside>`;
}

/** The whole tab for the current state. */
export function renderProject(st: ProjectState, now: number): string {
  if (st.status === "unavailable") {
    return `<div class="pj"><div class="pj-empty"><b>Project</b><p>The project (issues, sprints, releases and reports) is stored in the desktop app's SQLite database. Open a folder in the desktop app to plan and track its work here.</p></div></div>`;
  }
  if (st.status === "error") return `<div class="pj"><div class="pj-empty"><b>Could not open the project</b><p>${esc(st.error ?? "")}</p><button class="pj-btn" data-action="pj-reload"><span>Try again</span></button></div></div>`;
  const p = st.project;
  if (!p) return `<div class="pj"><div class="pj-empty pj-dim">Opening the project…</div></div>`;
  const body: Record<View, () => string> = {
    board: () => board(st, p, now),
    backlog: () => backlogView(p),
    planning: () => renderPanel("planning", st, p, now),
    releases: () => renderPanel("releases", st, p, now),
    reports: () => renderPanel("reports", st, p, now),
    retro: () => renderPanel("retro", st, p, now),
    settings: () => renderPanel("settings", st, p, now),
  };
  return `<div class="pj${st.selected ? " with-issue" : ""}"><div class="pj-main">${header(st, p, now)}<div class="pj-body">${body[st.view]()}</div></div>${issuePanel(st, p, now)}</div>`;
}

/** Mounts the tab and repaints it whenever the service changes (while it is on screen). */
export function makeProjectView(service: ProjectService, now: () => number) {
  let host: HTMLElement | null = null;
  const paint = (): void => {
    if (!host || !host.isConnected) return;
    // keep the focus and caret of a field being typed in (repaints follow each operation)
    const a = document.activeElement as HTMLInputElement | null;
    const keep = a && host.contains(a) && a.dataset.action ? { action: a.dataset.action, on: a.dataset.on ?? "", pos: a.selectionStart } : null;
    const scroll = host.querySelector(".pj-body")?.scrollTop ?? 0;
    host.innerHTML = renderProject(service.state(), now());
    const body = host.querySelector(".pj-body");
    if (body) body.scrollTop = scroll;
    if (keep) {
      const el = host.querySelector<HTMLInputElement>(`[data-action="${keep.action}"][data-on="${keep.on.replace(/["\\]/g, "\\$&")}"]`) ?? host.querySelector<HTMLInputElement>(`[data-action="${keep.action}"]`);
      if (el) {
        el.focus();
        if (keep.pos !== null && "setSelectionRange" in el && el.type !== "number") el.setSelectionRange(keep.pos, keep.pos);
      }
    }
  };
  service.onChange(paint);
  return {
    mount(h: HTMLElement): void {
      host = h;
      paint();
      if (service.state().status === "idle") void service.open();
    },
    paint,
  };
}

export type { State };
