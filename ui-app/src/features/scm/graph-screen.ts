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
import { tauriGitRefs } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { GRAPH_MESSAGES } from "./ui/graph.messages";
import { GRAPH_SCREEN_MESSAGES } from "./ui/graph-screen-messages";
import { renderGraphScreen, type GraphCommitVm, type GraphVm } from "./ui/graph-view";
import type { RefLabel } from "./domain/refs";

const t = translator(GRAPH_SCREEN_MESSAGES);
const tg = translator(GRAPH_MESSAGES);

export const graphScreen = makeGraphScreen({ git: tauriGitRefs(), root: () => B.gitRoot() });

let host: HTMLElement | null = null;

function model(): GraphVm {
  const G = B.git(), L = graphLayout(), br = B.branch(), sel = graphSel(), st = graphScreen.state();
  const commits: Record<string, GraphCommitVm> = {};
  for (const r of L.rows) { const c = G.c[r.h], a = authorOf(c.a); commits[r.h] = { h: c.h, m: c.m, p: c.p, author: { n: a.n, col: a.col }, time: B.rel(c.t) }; }
  const fallbackLabels = (h: string): RefLabel[] => [
    ...Object.keys(G.refs).filter((b) => G.refs[b] === h).map((b): RefLabel => ({ kind: b === br ? "head" : "branch", name: b })).sort((a) => (a.kind === "head" ? -1 : 0)),
    ...(G.tags[h] ? [{ kind: "tag" as const, name: G.tags[h] }] : []),
  ];
  const selFiles = sel ? (G.c[sel]?.files?.length ? (G.c[sel].files as string[]) : st.files[sel]) : undefined;
  return {
    repo: L.rows.length > 0 || !!B.gitRoot(),
    layout: L, commits, lanes: LANE, branch: br,
    flow: br === "develop" ? "develop" : isFlow(br) ? "flow" : "other", goToDevelop: tg("goToDevelop"),
    selected: sel, files: selFiles, refs: st.refs, fallbackLabels,
    loading: st.loading, error: st.error, branchCount: st.refs ? st.refs.branches.length : Object.keys(G.refs).length,
  };
}

function paint(): void {
  if (!host || !host.isConnected) return;
  const body = host.querySelector(".gl-main"), top = body ? body.scrollTop : 0;
  host.innerHTML = renderGraphScreen(t, model());
  const nb = host.querySelector(".gl-main");
  if (nb) nb.scrollTop = top;
}
graphScreen.subscribe(paint);

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
  if (h) void graphScreen.filesOf(h);
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
  "graph:file": { click: (c) => { c.stop(); if (B.files()[B.rootKey() + c.on]) B.openRel(c.on); else B.toast(t("notInBranch")); } },
});
