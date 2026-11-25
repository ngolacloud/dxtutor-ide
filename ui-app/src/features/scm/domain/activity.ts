/* ═══════════ feature `scm` — domain: the Commit Graph's activity minimap (r23 F3, UI-SCM-08) ═══════════
   Commits per time bucket over the span of the loaded history (oldest left), with how many match the search
   and the newest commit of each bucket (clicking a bar goes there). PURE. */

export interface ActivityBar { count: number; matched: number; newest: string | null; from: number; to: number }

export function activityBuckets(commits: Array<{ h: string; t: number; match: boolean }>, buckets = 48): ActivityBar[] {
  if (!commits.length) return [];
  const ts = commits.map((c) => c.t), lo = Math.min(...ts), hi = Math.max(...ts);
  const n = Math.max(1, Math.min(buckets, commits.length)), span = Math.max(1, hi - lo), w = span / n;
  const bars: ActivityBar[] = Array.from({ length: n }, (_, i) => ({ count: 0, matched: 0, newest: null, from: lo + i * w, to: lo + (i + 1) * w }));
  const newestT: number[] = Array(n).fill(-Infinity);
  for (const c of commits) {
    const i = Math.min(n - 1, Math.floor((c.t - lo) / w));
    bars[i].count++;
    if (c.match) bars[i].matched++;
    if (c.t >= newestT[i]) { newestT[i] = c.t; bars[i].newest = c.h; }
  }
  return bars;
}
