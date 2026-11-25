/* ═════════ feature `scm` — ui: the Commit Graph screen (r23 F3, UI-SCM-08) ═════════
   Markup only (the composition gives the data): a sidebar with branches (upstream, ahead/behind), remotes,
   tags, stashes, worktrees and contributors; the bar (branch picker, gitflow, counts); and the DAG with lanes,
   merges and ref labels — the SVG geometry is the old `features/graph.ts`'s, unchanged. Actions go through the
   shared dispatcher (`data-action`/`data-on`). */

import type { GraphLayout } from "../domain/types";
import { refLabelsAt, remoteGroups, trackOf, type RefLabel, type RefsSnapshot } from "../domain/refs";
import { tokenFor, type SearchMode } from "../domain/search";
import type { GraphScreenKey } from "./graph-screen-messages";

export type T = (k: GraphScreenKey, p?: Record<string, string | number>) => string;

const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export interface GraphCommitVm { h: string; m: string; p: string[]; author: { n: string; col: string }; time: string; type: string | null; issue: string | null; match: boolean }
export interface GraphVm {
  repo: boolean;
  layout: GraphLayout;
  commits: Record<string, GraphCommitVm>;
  lanes: string[];
  branch: string;
  /** the gitflow buttons: on develop, on a flow branch, or elsewhere */
  flow: "develop" | "flow" | "other";
  goToDevelop: string;
  selected: string | null;
  /** files of the selected commit: undefined = not asked, null = reading */
  files: string[] | null | undefined;
  refs: RefsSnapshot | null;
  /** labels when the refs are not read yet (the residue's `GIT.refs`/`GIT.tags`) */
  fallbackLabels: (h: string) => RefLabel[];
  loading: boolean;
  error: string | null;
  branchCount: number;
  query: string;
  mode: SearchMode;
  /** commits matching the query (all of them without one) and the commits loaded */
  matchCount: number;
  total: number;
}

function sidebar(t: T, vm: GraphVm): string {
  const r = vm.refs;
  if (!r) return `<aside class="gl-side"><p class="gl-dim">${esc(vm.error ? t("refsError", { e: vm.error }) : vm.loading ? t("loading") : "")}</p></aside>`;
  const sec = (title: string, n: number, body: string): string =>
    `<details class="gl-sec" open><summary>${esc(title)}<span class="gl-n">${n}</span></summary>${n ? body : `<div class="gl-dim gl-item">${esc(t("none"))}</div>`}</details>`;
  const go = (sha: string, inner: string, title = ""): string =>
    `<button class="gl-item" data-action="graph:goto" data-on="${esc(sha)}"${title ? ` title="${esc(title)}"` : ""}>${inner}</button>`;
  const branches = r.branches.map((b) => {
    const tr = trackOf(b);
    const track = tr ? (tr.gone ? `<span class="gl-gone">${esc(t("gone"))}</span>` : `${tr.ahead ? `<span class="gl-ab" title="${esc(t("ahead", { n: tr.ahead }))}">↑${tr.ahead}</span>` : ""}${tr.behind ? `<span class="gl-ab" title="${esc(t("behind", { n: tr.behind }))}">↓${tr.behind}</span>` : ""}`) : "";
    return go(b.sha, `<span class="gl-nm${b.current ? " cur" : ""}">${b.current ? "● " : ""}${esc(b.name)}</span>${track}`, b.upstream ?? "");
  }).join("");
  const remotes = remoteGroups(r).map((g) => `<div class="gl-grp">${esc(g.remote)}</div>${g.branches.map((b) => go(b.sha, `<span class="gl-nm">${esc(b.name)}</span>`)).join("")}`).join("");
  const tags = r.tags.map((x) => go(x.sha, `<span class="gl-nm">${esc(x.name)}</span>`)).join("");
  const stashes = r.stashes.map((s) => `<div class="gl-item" title="${esc(s.message)}"><span class="gl-nm">stash@{${s.index}}</span><span class="gl-dim">${esc(s.message)}</span></div>`).join("");
  const wts = r.worktrees.map((w) => `<div class="gl-item" title="${esc(w.path)}"><span class="gl-nm${w.current ? " cur" : ""}">${esc(w.branch ?? w.head.slice(0, 7))}</span><span class="gl-dim">${esc(w.path)}</span></div>`).join("");
  const people = r.contributors.map((c) => `<button class="gl-item" data-action="graph:token" data-on="${esc(tokenFor("author", c.name))}" title="${esc(c.email)}"><span class="gl-nm">${esc(c.name)}</span><span class="gl-dim">${esc(t("commitsBy", { n: c.commits }))}</span></button>`).join("");
  return `<aside class="gl-side">${sec(t("branches"), r.branches.length, branches)}${sec(t("remotes"), r.remoteBranches.length, remotes)}${sec(t("tags"), r.tags.length, tags)}${sec(t("stashes"), r.stashes.length, stashes)}${sec(t("worktrees"), r.worktrees.length, wts)}${sec(t("contributors"), r.contributors.length, people)}</aside>`;
}

function dag(vm: GraphVm): { paths: string; dots: string; gw: number; H: number } {
  const L = vm.layout, W = 18, H = 32, X = (c: number) => 14 + c * W, Y = (i: number) => H / 2 + i * H, gw = 28 + L.max * W, LANE = vm.lanes;
  let paths = "", dots = "";
  L.rows.forEach((r, i) => {
    const c = vm.commits[r.h];
    c.p.forEach((ph, k) => {
      const j = L.idx[ph];
      if (j == null) return;
      const pr = L.rows[j], x0 = X(r.col), y0 = Y(i), xl = X(r.pl[k]), xp = X(pr.col), y1 = Y(j), col = LANE[(k === 0 ? r.col : r.pl[k]) % LANE.length];
      let d = `M${x0} ${y0}`;
      if (j === i + 1) d += x0 === xp ? `L${xp} ${y1}` : `C${x0} ${y0 + H * 0.6} ${xp} ${y1 - H * 0.6} ${xp} ${y1}`;
      else {
        d += xl === x0 ? `L${xl} ${y0 + H}` : `C${x0} ${y0 + H * 0.6} ${xl} ${y0 + H * 0.4} ${xl} ${y0 + H}`;
        d += `L${xl} ${y1 - H}`;
        d += xp === xl ? `L${xp} ${y1}` : `C${xl} ${y1 - H * 0.4} ${xp} ${y1 - H * 0.6} ${xp} ${y1}`;
      }
      paths += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
    });
    const col = LANE[r.col % LANE.length], mg = c.p.length > 1;
    dots += `<circle cx="${X(r.col)}" cy="${Y(i)}" r="${mg ? 4 : 5}" fill="${mg ? "var(--bg-editor)" : col}" stroke="${col}" stroke-width="2"/>`;
  });
  return { paths, dots, gw, H };
}

export function renderGraphScreen(t: T, vm: GraphVm): string {
  if (!vm.repo) return `<div class="gl"><div class="gl-empty">${esc(t("noRepo"))}</div></div>`;
  const { paths, dots, gw, H } = dag(vm), L = vm.layout;
  const bar = `<div class="gl-bar"><button class="mini" data-action="graph:pickBranch">⎇ ${esc(vm.branch)} ▾</button>${
    vm.flow === "develop" ? `<button class="mini" data-action="graph:gfPrompt" data-on="feature">+ feature</button><button class="mini" data-action="graph:gfPrompt" data-on="fix">+ fix</button><button class="mini" data-action="graph:gfPrompt" data-on="release">+ release</button>`
    : vm.flow === "flow" ? `<button class="mini pri" data-action="graph:gfFinish">${esc(t("finish", { b: vm.branch }))}</button>`
    : `<button class="mini" data-action="graph:toDevelop">${esc(vm.goToDevelop)}</button>`
  }<span class="sp"></span><input class="gl-search inp" type="search" data-action="graph:search" value="${esc(vm.query)}" placeholder="${esc(t("searchPh"))}" spellcheck="false">`
    + `<button class="mini${vm.mode === "filter" ? " on" : ""}" data-action="graph:mode" title="${esc(t(vm.mode === "filter" ? "modeFilterTip" : "modeHighlightTip"))}">${esc(t(vm.mode === "filter" ? "modeFilter" : "modeHighlight"))}</button>`
    + `<span class="gl-dim">${esc(vm.query.trim() ? t("matchCount", { n: vm.matchCount, total: vm.total }) : t("count", { c: vm.total, b: vm.branchCount }))}</span></div>`;
  const rows = L.rows.map((r) => {
    const c = vm.commits[r.h], col = vm.lanes[r.col % vm.lanes.length], sel = vm.selected === r.h;
    const labels = vm.refs ? refLabelsAt(vm.refs, r.h) : vm.fallbackLabels(r.h);
    const refsHtml = labels.map((l) => l.kind === "tag" ? `<span class="gl-ref tagr">${esc(l.name)}</span>`
      : `<span class="gl-ref${l.kind === "head" ? " head" : l.kind === "remote" ? " remote" : ""}" style="--c:${col}">${l.kind === "head" ? "● " : ""}${esc(l.name)}</span>`).join("");
    const det = !sel ? "" : `<div class="gl-det">${vm.files === null || vm.files === undefined ? `<span class="gl-dim">${esc(t("readingFiles"))}</span>`
      : vm.files.length ? vm.files.map((p) => `<button class="mini" data-action="graph:file" data-on="${esc(p)}">${esc(p)}</button>`).join("") : `<span class="gl-dim">${esc(t("noFiles"))}</span>`}${c.p.length > 1 ? `<span class="tag">${esc(t("mergeOf", { n: c.p.length }))}</span>` : ""}</div>`;
    const chips = `${c.type ? `<button class="gl-chip t-${esc(c.type)}" data-action="graph:token" data-on="${esc(tokenFor("type", c.type))}">${esc(c.type)}</button>` : ""}${c.issue ? `<button class="gl-chip gl-issue" data-action="graph:token" data-on="${esc(tokenFor("issue", c.issue))}">${esc(c.issue)}</button>` : ""}`;
    return `<div class="gl-row${sel ? " sel" : ""}${c.match ? "" : " dim"}" data-action="graph:select" data-on="${esc(r.h)}"><span class="gl-refs">${refsHtml}</span><span class="gl-msg">${chips}${esc(c.m)}</span><span class="gl-au"><i style="background:${c.author.col}">${esc(c.author.n.charAt(0))}</i>${esc(c.author.n)}</span><span class="gl-h">${esc(r.h)}</span><span class="gl-t">${esc(c.time)}</span></div>${det}`;
  }).join("");
  return `<div class="gl gl-screen">${sidebar(t, vm)}<div class="gl-main">${bar}<div class="gl-body" style="--gw:${gw}px"><svg class="gl-svg" width="${gw}" height="${L.rows.length * H}">${paths}${dots}</svg>${rows}</div></div></div>`;
}
