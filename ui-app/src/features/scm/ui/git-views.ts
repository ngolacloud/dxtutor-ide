/* ═══════════ feature scm — ui: the A4 git views (docs/v2/UI-AUDIT.md item 9) ═══════════
   Markup from the state of application/git-extras.ts: the Source Control pane's extra sections
   (stashes, worktrees, more git and Co-Dev), the «File history» tab (commits of a file or a
   line range, each one's diff, who knows the code, the blame in blocks coloured by age),
   «Compare» (ahead/behind and the files), «Interactive rebase» (the plan the human edits, and
   the exact command) and a plain text tab (a stash's diff). Texts from the catalog (t), the
   rest escaped (esc). Actions: data-action="gx-…" + data-on. No window. */

import { esc } from "../../../core";
import { heat, planIsNoop, planProblem, rebaseCommand, REBASE_ACTIONS } from "../domain/git-extras";
import type { Blame, BlameLine, HistCommit } from "../domain/git-extras";
import type { CompareState, ExtrasState, HistoryState, RebaseState, ReviewState } from "../application/git-extras";
import type { GitKey } from "./git-messages";

export type T = (k: GitKey, p?: Record<string, string | number>) => string;

export function ago(t: T, sec: number, now: number): string {
  const m = Math.max(0, Math.round((now - sec * 1000) / 60000));
  if (m < 1) return t("justNow");
  if (m < 60) return t("minAgo", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("hAgo", { n: h });
  const d = Math.round(h / 24);
  if (d < 31) return t("dAgo", { n: d });
  const mo = Math.round(d / 30);
  return mo < 12 ? t("moAgo", { n: mo }) : t("yAgo", { n: Math.round(mo / 12) });
}

/** What the blame says about one line (status bar and the editor's line annotation). */
export const blameText = (t: T, l: BlameLine, now: number): string =>
  l.commit ? `${l.author}, ${ago(t, l.time, now)} · ${l.summary}` : t("notCommitted");

const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;

/** The pane's extra sections (desktop with a git repository only). */
export function renderSide(t: T, st: ExtrasState, canAsk: boolean, now: number): string {
  const dis = st.busy !== null;
  const stashes = st.stashes.length
    ? st.stashes.map((s) => `<div class="scm-row gx-row" title="${esc(s.message)}"><span class="nm notr" style="max-width:none">${esc(s.message)}</span><span class="pth">${esc(ago(t, s.time, now))}</span><span class="ra"><button title="${t("show")}" data-action="gx-stash-show" data-on="${s.index}">⧉</button><button title="${t("apply")}" data-action="gx-stash-apply" data-on="${s.index}"${dis ? " disabled" : ""}>↧</button><button title="${t("pop")}" data-action="gx-stash-pop" data-on="${s.index}"${dis ? " disabled" : ""}>⇣</button><button title="${t("drop")}" data-action="gx-stash-drop" data-on="${s.index}"${dis ? " disabled" : ""}>✕</button></span></div>`).join("")
    : `<div class="sec-empty">${t("noStashes")}</div>`;
  const wts = st.worktrees.map((w) => `<div class="scm-row gx-row" title="${esc(w.path)}"><span class="nm notr" style="max-width:none${w.current ? ";font-weight:600" : ""}">${esc(w.branch ?? t("detached", { h: w.head }))}</span><span class="pth notr">${esc(w.path)}</span>${w.current ? `<span class="tag acc" style="margin-left:auto">${t("thisFolder")}</span>` : `<span class="ra"><button title="${t("removeWorktree")}" data-action="gx-wt-remove" data-on="${esc(w.path)}"${dis ? " disabled" : ""}>✕</button></span>`}</div>`).join("");
  return `<div class="scm-grp">${t("stashes")}<span class="cnt">${st.stashes.length}</span></div>${stashes}<div class="gx-bar">${btn("gx-stash-push", t("stashChanges"), "", "btn ghost", dis)}${btn("gx-stash-push-all", t("stashAll"), "", "btn ghost", dis)}</div>`
    + `<div class="scm-grp">${t("worktrees")}<span class="cnt">${st.worktrees.length}</span></div>${wts}<div class="gx-bar">${btn("gx-wt-add", t("newWorktree"), "", "btn ghost", dis)}</div>`
    + `<div class="scm-grp">${t("moreGit")}</div><div class="gx-bar">${btn("gx-history", t("fileHistory"))}${btn("gx-compare", t("compareBranches"))}${btn("gx-rebase", t("interactiveRebase"), "", "btn ghost", dis)}${btn("gx-amend", t("amendLast"), "", "btn ghost", dis)}${btn("gx-review", t("reviewChanges"))}</div>`
    + (canAsk ? `<div class="gx-bar">${btn("gx-ask-message", t("askMessage"), "", "btn ghost gx-ai")}${btn("gx-ask-review", t("askReview"), "", "btn ghost gx-ai")}</div>` : "")
    + (st.sideError ? `<div class="sec-empty notr" style="color:var(--red)">${esc(st.sideError)}</div>` : "")
    + (st.busy ? `<div class="sec-empty">${t("running", { op: st.busy })}</div>` : "");
}

export function diffHtml(text: string): string {
  return text
    .split("\n")
    .map((l) => {
      const c = l.startsWith("+++") || l.startsWith("---") ? "gx-dh" : l.startsWith("+") ? "gx-da" : l.startsWith("-") ? "gx-dd" : l.startsWith("@@") ? "gx-dk" : l.startsWith("commit ") || l.startsWith("diff --git") ? "gx-dh" : "";
      return `<div${c ? ` class="${c}"` : ""}>${esc(l) || " "}</div>`;
    })
    .join("");
}

function commitRow(t: T, c: HistCommit, sel: boolean, now: number): string {
  return `<div class="gx-commit${sel ? " cur" : ""}" data-action="gx-select-commit" data-on="${esc(c.hash)}"><span class="gx-hash notr">${esc(c.short)}</span><span class="gx-subj notr">${esc(c.subject)}</span><span class="gx-meta"><span class="notr">${esc(c.author)}</span> · ${esc(ago(t, c.time, now))}</span></div>`;
}

/** Contiguous lines from the same commit, as one block (the blame heatmap). */
function blameBlocks(t: T, b: Blame, now: number): string {
  const out: string[] = [];
  let i = 0;
  const L = b.lines.slice(0, 4000);
  while (i < L.length) {
    let j = i;
    while (j + 1 < L.length && L[j + 1].commit === L[i].commit) j++;
    const l = L[i], h = heat(b, l), n = j - i + 1;
    out.push(`<div class="gx-blk" style="--gx-heat:${h.toFixed(2)}" title="${esc(l.commit ? `${l.commit} · ${l.summary}` : t("notCommitted"))}"${l.commit ? ` data-action="gx-select-commit-short" data-on="${esc(l.commit)}"` : ""}><span class="gx-lines">${l.line}${n > 1 ? "–" + L[j].line : ""}</span><span class="notr gx-who">${esc(l.commit ? l.author : t("you"))}</span><span class="gx-meta">${l.commit ? esc(ago(t, l.time, now)) : ""}</span><span class="notr gx-subj">${esc(l.commit ? l.summary : t("notCommitted"))}</span></div>`);
    i = j + 1;
  }
  return out.join("");
}

export function renderHistory(t: T, h: HistoryState | null, canAsk: boolean, now: number): string {
  if (!h) return `<div class="gx"><div class="sec-empty">${t("noFile")}</div></div>`;
  const range = h.range ? `<span class="gx-chip">${t("lines", { a: h.range[0], b: h.range[1] })}</span>` : "";
  const list = h.loading ? `<div class="sec-empty">${t("loading")}</div>` : h.error ? `<div class="sec-empty notr" style="color:var(--red)">${esc(h.error)}</div>` : h.commits.length ? h.commits.map((c) => commitRow(t, c, h.selected === c.hash, now)).join("") : `<div class="sec-empty">${t("noCommits")}</div>`;
  const sel = h.commits.find((c) => c.hash === h.selected);
  const detail = sel
    ? `<div class="gx-dhd"><span class="gx-hash notr">${esc(sel.short)}</span><span class="notr">${esc(sel.subject)}</span><span class="gx-sp"></span>${canAsk ? btn("gx-explain-commit", t("explainCommit"), sel.hash, "btn ghost gx-ai") : ""}</div><div class="gx-diff notr">${h.diffLoading ? `<div>${t("loading")}</div>` : diffHtml(h.diff)}</div>`
    : `<div class="sec-empty">${t("pickCommit")}</div>`;
  const who = h.blame && h.blame.authors.length
    ? h.blame.authors.slice(0, 6).map((a) => `<div class="gx-who-row"><span class="notr gx-who">${esc(a.author)}</span><div class="gx-meter"><div style="width:${a.share}%"></div></div><span class="gx-meta">${a.share}% · ${esc(ago(t, a.last, now))}</span></div>`).join("") + (h.blame.uncommitted ? `<div class="gx-meta">${t("uncommittedLines", { n: h.blame.uncommitted })}</div>` : "")
    : `<div class="gx-meta">${t("noBlame")}</div>`;
  return `<div class="gx"><div class="gx-top"><b>${t("fileHistory")}</b><span class="gx-chip notr">${esc(h.path)}</span>${range}<span class="gx-sp"></span>${h.range ? btn("gx-history-file", t("wholeFile"), h.path) : ""}${btn("gx-history-refresh", t("refresh"))}</div>
    <div class="gx-cols"><div class="gx-col gx-list">${list}</div><div class="gx-col gx-detail">${detail}</div>
    <div class="gx-col gx-side"><div class="gx-card"><div class="gx-ct">${t("whoKnows")}</div>${who}</div>${h.blame ? `<div class="gx-card"><div class="gx-ct">${t("blameByAge")}</div><div class="gx-legend"><span>${t("older")}</span><i class="gx-ramp"></i><span>${t("newer")}</span></div><div class="gx-blame">${blameBlocks(t, h.blame, now)}</div></div>` : ""}</div></div></div>`;
}

export function renderCompare(t: T, c: CompareState | null, now: number): string {
  if (!c) return `<div class="gx"><div class="sec-empty">${t("compareBranches")}</div></div>`;
  const head = `<div class="gx-top"><b>${t("compareTab")}</b><span class="gx-chip notr">${esc(c.base)}</span><span>↔</span><span class="gx-chip notr">${esc(c.target)}</span><span class="gx-sp"></span>${btn("gx-compare-swap", t("swap"))}${btn("gx-compare", t("otherRefs"))}</div>`;
  if (c.loading) return `<div class="gx">${head}<div class="sec-empty">${t("loading")}</div></div>`;
  if (c.error || !c.result) return `<div class="gx">${head}<div class="sec-empty notr" style="color:var(--red)">${esc(c.error)}</div></div>`;
  const r = c.result;
  const commits = (list: HistCommit[]) => (list.length ? list.map((x) => commitRow(t, x, false, now)).join("") : `<div class="sec-empty">${t("none")}</div>`);
  const files = r.files.length
    ? r.files.map((f) => `<div class="gx-file" data-action="gx-open-file" data-on="${esc(f.path)}"><span class="gx-st s-${esc(f.status)}">${esc(f.status)}</span><span class="notr">${esc(f.path)}</span><span class="gx-sp"></span>${f.added === null ? `<span class="gx-meta">${t("binary")}</span>` : `<span class="gx-add">+${f.added}</span> <span class="gx-del">−${f.removed}</span>`}</div>`).join("")
    : `<div class="sec-empty">${t("noFileChanges")}</div>`;
  return `<div class="gx">${head}<div class="gx-cols"><div class="gx-col"><div class="gx-ct">${t("ahead", { n: r.ahead.length, t: r.target, b: r.base })}</div>${commits(r.ahead)}<div class="gx-ct">${t("behind", { n: r.behind.length, t: r.target, b: r.base })}</div>${commits(r.behind)}</div><div class="gx-col"><div class="gx-ct">${t("filesChanged", { n: r.files.length, t: r.target })}</div>${files}</div></div></div>`;
}

export function renderRebase(t: T, r: RebaseState | null): string {
  if (!r) return `<div class="gx"><div class="sec-empty">${t("interactiveRebase")}</div></div>`;
  const head = `<div class="gx-top"><b>${t("rebaseTab")}</b>${r.plan ? `<span class="notr gx-chip">${esc(r.plan.branch)}</span><span>${t("onto")}</span>` : ""}<span class="gx-chip notr">${esc(r.onto)}</span><span class="gx-sp"></span>${btn("gx-rebase", t("otherBase"), "", "btn ghost", r.running)}</div>`;
  if (r.loading) return `<div class="gx">${head}<div class="sec-empty">${t("loading")}</div></div>`;
  if (!r.plan) return `<div class="gx">${head}<div class="sec-empty notr" style="color:var(--red)">${esc(r.error)}</div></div>`;
  const p = r.plan;
  if (!p.commits.length) return `<div class="gx">${head}<div class="sec-empty">${t("rebaseNothing", { b: p.branch, o: r.onto })}</div></div>`;
  const byHash = new Map(p.commits.map((c) => [c.hash, c]));
  const dis = r.running ? " disabled" : "";
  const rows = r.steps.map((s, i) => {
    const c = byHash.get(s.hash);
    const opts = REBASE_ACTIONS.map((a) => `<option value="${a}"${a === s.action ? " selected" : ""}>${a}</option>`).join("");
    return `<div class="gx-step a-${s.action}"><span class="gx-n">${i + 1}</span><span class="gx-mv"><button title="${t("moveUp")}" data-action="gx-rb-up" data-on="${i}"${i === 0 ? " disabled" : dis}>↑</button><button title="${t("moveDown")}" data-action="gx-rb-down" data-on="${i}"${i === r.steps.length - 1 ? " disabled" : dis}>↓</button></span><select class="gx-act notr" data-action="gx-rb-action" data-on="${i}"${dis}>${opts}</select><span class="gx-hash notr">${esc(c?.short ?? s.hash.slice(0, 8))}</span><span class="gx-subj notr">${esc(c?.subject ?? "")}</span>${s.action === "reword" ? `<input class="inp gx-msg notr" data-action="gx-rb-msg" data-on="${i}" placeholder="${t("newMessage")}" value="${esc(s.message ?? c?.subject ?? "")}"${dis}>` : ""}</div>`;
  }).join("");
  const prob = planProblem(r.steps), noop = planIsNoop(p, r.steps);
  const warn = [p.dirty ? `<div class="gx-warn">${t("rebaseDirty")}</div>` : "", p.published ? `<div class="gx-warn">${t("rebasePublished")}</div>` : "", prob ? `<div class="gx-warn">${t(("plan-" + prob) as GitKey)}</div>` : ""].join("");
  return `<div class="gx">${head}<div class="gx-meta" style="margin-bottom:8px">${t("rebaseHelp")}</div>${warn}<div class="gx-steps">${rows}</div>
    <div class="gx-ct">${t("command")}</div><pre class="gx-cmd notr">${esc(rebaseCommand(r.onto, r.steps))}</pre>
    <div class="gx-bar">${btn("gx-rb-reset", t("reset"), "", "btn ghost", r.running)}${btn("gx-rb-run", r.running ? t("rebasing") : t("startRebase"), "", "btn", r.running || !!prob || noop || p.dirty)}</div>${r.error ? `<div class="sec-empty notr" style="color:var(--red)">${esc(r.error)}</div>` : ""}</div>`;
}

export function renderText(text: { title: string; body: string } | null): string {
  if (!text) return `<div class="gx"></div>`;
  return `<div class="gx"><div class="gx-top"><b class="notr">${esc(text.title)}</b></div><div class="gx-diff notr">${diffHtml(text.body)}</div></div>`;
}

const groupName = (t: T, key: string): string => (key.startsWith("src:") ? key.slice(4) : t(("g_" + key) as GitKey));

/** «Review changes» (A10): the change grouped by theme, each file's diff on demand, «reviewed» marks, Co-Dev per group. */
export function renderReview(t: T, r: ReviewState | null, canAsk: boolean): string {
  if (!r) return `<div class="gx"><div class="sec-empty">${t("noChanges")}</div></div>`;
  const total = r.files.length, done = r.reviewed.length;
  const head = `<div class="gx-top"><b>${t("reviewTitle")}</b>${btn("gx-review-mode", t("worktree"), "worktree", r.mode === "worktree" ? "btn" : "btn ghost")}${btn("gx-review-mode", t("branchVs"), "branch", r.mode === "branch" ? "btn" : "btn ghost")}${r.mode === "branch" ? `<span class="gx-chip notr">${esc(r.base)}...${esc(r.target)}</span>` : ""}<span class="gx-sp"></span>${total ? `<span class="gx-meta">${t("reviewedN", { r: done, n: total })}</span>` : ""}${canAsk && total ? btn("gx-review-summary", t("summarize"), "", "btn ghost gx-ai") : ""}</div>`;
  if (r.loading) return `<div class="gx">${head}<div class="sec-empty">${t("loading")}</div></div>`;
  if (r.error) return `<div class="gx">${head}<pre class="sec-empty notr" style="color:var(--red)">${esc(r.error)}</pre></div>`;
  if (!total) return `<div class="gx">${head}<div class="sec-empty">${t("noChanges")}</div></div>`;
  const groups = r.groups.map((g) => {
    const gd = g.files.filter((f) => r.reviewed.includes(f.path)).length;
    return `<div class="gx-rg"><div class="gx-rgh"><b class="notr">${esc(groupName(t, g.key))}</b><span class="gx-meta">${g.files.length} · <span class="gx-add">+${g.added}</span> <span class="gx-del">−${g.removed}</span> · ${gd}/${g.files.length}</span><span class="gx-sp"></span>${canAsk ? btn("gx-review-group", t("reviewGroup"), g.key, "btn ghost gx-ai") : ""}</div>`
      + g.files.map((f) => `<div class="gx-rf${r.reviewed.includes(f.path) ? " done" : ""}"><input type="checkbox" title="${t("reviewed")}" data-action="gx-review-mark" data-on="${esc(f.path)}"${r.reviewed.includes(f.path) ? " checked" : ""}><span class="gx-st s-${esc(f.status.slice(0, 1))}">${esc(f.status.slice(0, 1))}</span><a class="notr gx-rp" data-action="gx-review-file" data-on="${esc(f.path)}">${esc(f.path)}</a><span class="gx-sp"></span><span class="gx-add">+${f.added}</span> <span class="gx-del">−${f.removed}</span></div>`
        + (r.open === f.path ? `<div class="gx-diff notr">${r.diffs[f.path] === undefined ? `<div>${t("loading")}</div>` : diffHtml(r.diffs[f.path])}</div>` : "")).join("") + `</div>`;
  }).join("");
  return `<div class="gx">${head}${groups}</div>`;
}
