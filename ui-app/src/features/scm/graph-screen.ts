/* ═════════ feature `scm` — composition of the Commit Graph screen (r23 F3, UI-SCM-08) ═════════
   Was `features/graph.ts` (outside the subtree, Portuguese literals in the markup; moved here by the owner's
   decision of 2026-11-25). Composes the use case (application/graph-screen.ts) with the backend
   (`git_refs`/`git_show`), the residue's commit DAG (`GIT`, layout, lanes, authors, gitflow) and the view
   (ui/graph-view.ts); registers `VIEW.graph` and the `graph:*` actions. No window here: the world comes
   through the scm bridge, read at call time. */

import { bus } from "../../app/bus";
import { VIEW } from "../../app/store/registry";
import { registerActions, globalCalls, callGlobal } from "../../app/actions";
import { services } from "../../app/services";
import { translator } from "../../app/i18n";
import { LANE, authorOf, isFlow, graphLayout, graphSel, setGraphSel, gfPrompt, pickBranch } from "../scm";
import { makeGraphScreen } from "./application/graph-screen";
import { tauriGitRefs, tauriLifecycle, openExternal } from "./infrastructure/tauri";
import { lifecycleOf } from "./domain/lifecycle";
import * as B from "./infrastructure/legacy-bridge";
import { sync, setRemoteSource } from "./extras";
import { GRAPH_MESSAGES } from "./ui/graph.messages";
import { GRAPH_SCREEN_MESSAGES } from "./ui/graph-screen-messages";
import { renderGraphScreen, type GraphCommitVm, type GraphVm } from "./ui/graph-view";
import { refLabelsAt, type RefLabel } from "./domain/refs";
import { computeGraphLayout } from "./domain/graph";
import { isEmptyQuery, matches, parseQuery } from "./domain/search";
import { conventionalOf } from "./domain/conventional";
import { issueKeyIn } from "./domain/trailers";
import { activityBuckets } from "./domain/activity";
import { listChanges } from "./domain/status";

const t = translator(GRAPH_SCREEN_MESSAGES);
const tg = translator(GRAPH_MESSAGES);

export const graphScreen = makeGraphScreen({ git: tauriGitRefs(), root: () => B.gitRoot(), life: tauriLifecycle() });
/* the Launchpad fetches pull requests from the current branch's remote (else origin) */
setRemoteSource(() => { const r = graphScreen.state().refs, up = r?.branches.find((b) => b.current)?.upstream; return (up && r?.remotes.find((x) => up.startsWith(x + "/"))) || r?.remotes.find((x) => x === "origin") || r?.remotes[0] || null; });

let host: HTMLElement | null = null;

/** the working tree's uncommitted files (desktop repository only) */
function wipOf(): { files: number; staged: number } | null {
  if (!B.gitRoot()) return null;
  const changed = listChanges(B.files());
  if (!changed.length) return null;
  const staged = B.staged();
  return { files: changed.length, staged: changed.filter((p) => staged.has(p)).length };
}

function model(): GraphVm {
  const G = B.git(), br = B.branch(), sel = graphSel(), st = graphScreen.state();
  const fallbackLabels = (h: string): RefLabel[] => [
    ...Object.keys(G.refs).filter((b) => G.refs[b] === h).map((b): RefLabel => ({ kind: b === br ? "head" : "branch", name: b })).sort((a) => (a.kind === "head" ? -1 : 0)),
    ...(G.tags[h] ? [{ kind: "tag" as const, name: G.tags[h] }] : []),
  ];
  const labels = (h: string): RefLabel[] => (st.refs ? refLabelsAt(st.refs, h) : fallbackLabels(h));
  const q = parseQuery(st.query), searching = !isEmptyQuery(q);
  const filesOf = (h: string): string[] => (G.c[h]?.files?.length ? (G.c[h].files as string[]) : st.files[h] ?? []);
  const hit = new Set(G.order.filter((h) => !searching || matches(q, { m: G.c[h].m, a: G.c[h].a, files: filesOf(h), branches: labels(h).map((l) => l.name) })));
  /* filter: the DAG of the matches only (a parent outside them is dropped, so its line goes) */
  const L = searching && st.mode === "filter"
    ? computeGraphLayout({ order: G.order.filter((h) => hit.has(h)), c: Object.fromEntries([...hit].map((h) => [h, { ...G.c[h], p: G.c[h].p.filter((p) => hit.has(p)) }])) })
    : graphLayout();
  const commits: Record<string, GraphCommitVm> = {};
  for (const r of L.rows) {
    const c = G.c[r.h], a = authorOf(c.a);
    commits[r.h] = { h: c.h, m: c.m, p: searching && st.mode === "filter" ? c.p.filter((p) => hit.has(p)) : c.p, author: { n: a.n, col: a.col }, time: B.rel(c.t),
      type: conventionalOf(c.m)?.type ?? null, issue: issueKeyIn(c.m), match: hit.has(r.h) };
  }
  const selFiles = sel ? (G.c[sel]?.files?.length ? (G.c[sel].files as string[]) : st.files[sel]) : undefined;
  return {
    repo: G.order.length > 0 || !!B.gitRoot(),
    layout: L, commits, lanes: LANE, branch: br,
    flow: br === "develop" ? "develop" : isFlow(br) ? "flow" : "other", goToDevelop: tg("goToDevelop"),
    selected: sel, files: selFiles, refs: st.refs, fallbackLabels,
    loading: st.loading, error: st.error, branchCount: st.refs ? st.refs.branches.length : Object.keys(G.refs).length,
    query: st.query, mode: st.mode, matchCount: hit.size, total: G.order.length,
    wip: wipOf(), activity: activityBuckets(G.order.map((h) => ({ h, t: G.c[h].t, match: hit.has(h) }))),
    when: (t) => new Date(t).toISOString().slice(0, 10),
    predictions: st.predictions,
    syncing: sync.busy(),
    lifecycle: sel && B.gitRoot() && G.c[sel] ? lifecycleOf({ message: G.c[sel].m, ...(st.lifecycle[sel.slice(0, 7)] ?? { tests: undefined, runs: undefined, prs: undefined, ghMissing: null }) }) : null,
  };
}

function paint(): void {
  if (!host || !host.isConnected) return;
  const body = host.querySelector(".gl-main"), top = body ? body.scrollTop : 0;
  const box = host.querySelector<HTMLInputElement>(".gl-search"), typing = !!box && document.activeElement === box, caret = box?.selectionStart ?? null;
  host.innerHTML = renderGraphScreen(t, model());
  const nb = host.querySelector(".gl-main");
  if (nb) nb.scrollTop = top;
  if (typing) { const nbox = host.querySelector<HTMLInputElement>(".gl-search"); if (nbox) { nbox.focus(); if (caret !== null) nbox.setSelectionRange(caret, caret); } }
}
graphScreen.subscribe(paint);
sync.subscribe(() => { paint(); if (!sync.busy()) graphScreen.invalidate(); });

/** The graph tab's renderer (was `renderGraphView`; the desktop self-test and the tests call it). */
export function renderGraphView(_t: unknown, h: HTMLElement): void {
  host = h;
  paint();
  if (B.gitRoot() && !graphScreen.state().refs && !graphScreen.state().loading) void graphScreen.load();
}
VIEW.graph = renderGraphView;

/* the repository changed outside the editor (a commit, checkout, the desktop's syncGit): read the refs again */
bus.on("workspace:changed", ({ fromEditor }) => { if (!fromEditor && host && host.isConnected) { graphScreen.invalidate(); paint(); } });

const select = (h: string | null): void => {
  setGraphSel(h);
  if (h) { void graphScreen.filesOf(h); void graphScreen.lifecycleOf(h); }
  services.tabs!.rerender("graph");
};

registerActions({
  ...globalCalls("graph", ["gfFinish"]),
  "graph:pickBranch": { click: () => pickBranch() },
  "graph:gfPrompt": { click: (c) => gfPrompt(c.on as Parameters<typeof gfPrompt>[0]) },
  "graph:toDevelop": { click: () => { callGlobal("checkout", "develop"); services.tabs!.rerender("graph"); } },
  "graph:select": { click: (c) => select(graphSel() === c.on ? null : c.on) },
  "graph:goto": { click: (c) => {
    const h = c.on.slice(0, 7);
    if (!B.git().c[h]) return;
    select(h);
    host?.querySelector(`.gl-row[data-on="${h}"]`)?.scrollIntoView?.({ block: "center" });
  } },
  "graph:search": { input: (c) => graphScreen.setQuery((c.el as HTMLInputElement).value) },
  "graph:mode": { click: () => graphScreen.setMode(graphScreen.state().mode === "filter" ? "highlight" : "filter") },
  "graph:token": { click: (c) => { c.stop(); graphScreen.addToken(c.on); } },
  "graph:sync": { click: (c) => { void sync.run(c.on as "fetch" | "pull" | "push"); } },
  "graph:open-url": { click: (c) => { c.stop(); openExternal(c.on, B.desktopOs()); } },
  "graph:wip": { click: () => B.goPane("scm") },
  "graph:file": { click: (c) => { c.stop(); if (B.files()[B.rootKey() + c.on]) B.openRel(c.on); else B.toast(t("notInBranch")); } },
});
