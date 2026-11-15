// Real git DAG: lays out git_log commits into lanes and renders an SVG graph (nodes +
// parent edges). Pure layout so it can be unit-tested; nothing is fabricated — the shape
// comes straight from the commits' parent links.

import type { GitCommit } from "./tauri";

export interface GraphNode {
  commit: GitCommit;
  row: number;
  lane: number;
}
export interface GraphEdge {
  fromRow: number; fromLane: number;
  toRow: number; toLane: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  lanes: number;
}

/** Assign each commit (already in topo/date order, newest first) to a lane. Pure. */
export function layout(commits: GitCommit[]): Graph {
  // Keyed by FULL hash: git_log's `parents` are full hashes (%P), `hash` is %H.
  const rowOf = new Map<string, number>();
  commits.forEach((c, i) => rowOf.set(c.hash, i));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // `active` holds, per lane, the commit-hash that lane is currently waiting to place.
  const active: (string | null)[] = [];
  let maxLane = 0;

  commits.forEach((c, row) => {
    // The lane for this commit: a lane already reserved for it, else a free/new lane.
    let lane = active.indexOf(c.hash);
    if (lane === -1) {
      lane = active.indexOf(null);
      if (lane === -1) { lane = active.length; active.push(null); }
    }
    active[lane] = null; // consumed
    nodes.push({ commit: c, row, lane });
    maxLane = Math.max(maxLane, lane);

    // Route this commit's parents: first parent keeps the lane, extra parents take new lanes.
    const parents = c.parents.filter((p) => rowOf.has(p));
    parents.forEach((p, k) => {
      let plane: number;
      const existing = active.indexOf(p);
      if (existing !== -1) {
        plane = existing;
      } else if (k === 0 && active[lane] === null) {
        plane = lane; active[lane] = p;
      } else {
        plane = active.indexOf(null);
        if (plane === -1) { plane = active.length; active.push(p); } else active[plane] = p;
      }
      maxLane = Math.max(maxLane, plane);
      edges.push({ fromRow: row, fromLane: lane, toRow: rowOf.get(p)!, toLane: plane });
    });
  });

  return { nodes, edges, lanes: maxLane + 1 };
}

const LANE_COLORS = ["#e06c3b", "#73c991", "#d7a860", "#5f9ed6", "#c678dd", "#5fcad6"];
const ROW_H = 24;
const LANE_W = 16;
const PAD = 12;

/** Render the graph to an SVG string. Pure (no DOM). */
export function renderGraph(g: Graph): string {
  const h = Math.max(1, g.nodes.length) * ROW_H;
  const w = PAD * 2 + g.lanes * LANE_W;
  const x = (lane: number) => PAD + lane * LANE_W;
  const y = (row: number) => row * ROW_H + ROW_H / 2;
  const col = (lane: number) => LANE_COLORS[lane % LANE_COLORS.length];

  const paths = g.edges
    .map((e) => {
      const x1 = x(e.fromLane), y1 = y(e.fromRow), x2 = x(e.toLane), y2 = y(e.toRow);
      const d = e.fromLane === e.toLane
        ? `M${x1} ${y1} L${x2} ${y2}`
        : `M${x1} ${y1} C${x1} ${y1 + ROW_H * 0.6} ${x2} ${y2 - ROW_H * 0.6} ${x2} ${y2}`;
      return `<path d="${d}" stroke="${col(e.toLane)}" stroke-width="1.4" fill="none"/>`;
    })
    .join("");
  const dots = g.nodes
    .map((n) => `<circle cx="${x(n.lane)}" cy="${y(n.row)}" r="3.4" fill="${col(n.lane)}" stroke="var(--bg-side)" stroke-width="1.5"/>`)
    .join("");
  return `<svg class="git-graph" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${paths}${dots}</svg>`;
}

export const graphMetrics = { ROW_H, laneWidth: (lanes: number) => PAD * 2 + lanes * LANE_W };
