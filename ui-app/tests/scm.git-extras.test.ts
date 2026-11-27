import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { blameAt, heat, initialSteps, moveStep, planIsNoop, planProblem, rebaseCommand, worktreePath, type Blame, type RebasePlan } from "../src/features/scm/domain/git-extras";
import { makeGitExtras } from "../src/features/scm/application/git-extras";
import type { GitExtrasPort } from "../src/features/scm/application/extras-ports";

/* A4 (docs/v2/UI-AUDIT.md item 9): o git além do básico — blame (anotação da linha, barra de
 * estado, quem conhece o código), histórico de um ficheiro ou de linhas, comparar refs, stashes,
 * worktrees, amend e o rebase interactivo a partir de um plano aprovado; e os pedidos ao Co-Dev.
 * Domínio puro, caso de uso com portas falsas e a cadeia real de módulos com o IPC falso. */

const BLAME: Blame = {
  path: "src/lib.rs",
  lines: [
    { line: 1, commit: "aaaaaaaa", author: "Ana", time: 1_700_000_000, summary: "first" },
    { line: 2, commit: "bbbbbbbb", author: "Rui", time: 1_700_100_000, summary: "second" },
    { line: 3, commit: "", author: "Not Committed Yet", time: 0, summary: "" },
  ],
  authors: [{ author: "Ana", lines: 1, share: 50, last: 1_700_000_000 }, { author: "Rui", lines: 1, share: 50, last: 1_700_100_000 }],
  uncommitted: 1,
};
const PLAN: RebasePlan = {
  onto: "develop", branch: "feature/x", dirty: false, published: false,
  commits: [
    { hash: "1111111111", short: "1111111", subject: "add b", author: "Ana", time: 1, parents: 1 },
    { hash: "2222222222", short: "2222222", subject: "add c", author: "Ana", time: 2, parents: 1 },
    { hash: "3333333333", short: "3333333", subject: "fix c", author: "Ana", time: 3, parents: 1 },
  ],
};

describe("domínio", () => {
  it("o blame de uma linha e a sua idade na escala do ficheiro", () => {
    expect(blameAt(BLAME, 2)?.author).toBe("Rui");
    expect(blameAt(BLAME, 9)).toBeNull();
    expect(heat(BLAME, BLAME.lines[0])).toBe(0);
    expect(heat(BLAME, BLAME.lines[1])).toBe(1);
    expect(heat(BLAME, BLAME.lines[2])).toBe(1); // por commitar = o mais recente
  });

  it("o plano do rebase: mover, validar e o comando que o humano aprova", () => {
    let s = initialSteps(PLAN);
    expect(planIsNoop(PLAN, s)).toBe(true);
    s = moveStep(s, 2, -1);
    expect(s.map((x) => x.hash[0])).toEqual(["1", "3", "2"]);
    expect(moveStep(s, 0, -1)).toBe(s);
    expect(planProblem([{ action: "squash", hash: "1" }, { action: "pick", hash: "2" }])).toBe("first-squash");
    expect(planProblem([{ action: "drop", hash: "1" }, { action: "fixup", hash: "2" }])).toBe("first-squash");
    expect(planProblem([{ action: "drop", hash: "1" }])).toBe("drop-all");
    expect(planProblem([{ action: "reword", hash: "1", message: " " }])).toBe("reword-empty");
    const cmd = rebaseCommand("develop", [{ action: "pick", hash: "2222222222" }, { action: "fixup", hash: "3333333333" }, { action: "reword", hash: "1111111111", message: "add the b file\nbody" }]);
    expect(cmd).toBe('git rebase -i develop\n  pick 22222222\n  fixup 33333333\n  reword 11111111 "add the b file"');
    expect(worktreePath("dxtutor", "feature/a b")).toBe("../dxtutor-feature-a-b");
  });
});

function fakes(over: Partial<GitExtrasPort> = {}) {
  const calls: Array<[string, unknown]> = [];
  const toasts: string[] = [];
  const asked: Array<{ intent: string; text: string }> = [];
  const answers: Array<string | null> = [];
  let confirmAnswer = true;
  const confirms: string[] = [];
  const audited: Array<{ action: string; approved: boolean; outcome?: string }> = [];
  const git: GitExtrasPort = {
    blame: async (_r, p) => { calls.push(["blame", p]); return BLAME; },
    history: async (_r, p, s, e) => { calls.push(["history", [p, s, e]]); return PLAN.commits.slice().reverse(); },
    showPath: async (_r, h, p) => { calls.push(["showPath", [h, p]]); return `commit ${h}\n+new line`; },
    show: async (_r, h) => `commit ${h}\nfull`,
    stagedDiff: async () => "diff --git a/x b/x\n+y",
    compare: async (_r, b, t) => ({ base: b, target: t, ahead: [PLAN.commits[0]], behind: [], files: [{ path: "b.txt", status: "A", added: 2, removed: 0 }] }),
    stash: async (_r, op) => { calls.push(["stash", op]); return { stashes: [{ index: 0, message: "On main: wip", time: 1 }], output: op.op === "show" ? "+x" : "" }; },
    worktree: async (_r, op) => { calls.push(["worktree", op]); return [{ path: "/p", head: "abc", branch: "main", locked: false, prunable: false, current: true }]; },
    rebase: async (_r, op) => { calls.push(["rebase", op]); return op.op === "run" ? { ...PLAN, commits: PLAN.commits.slice(0, 2) } : PLAN; },
    amend: async (_r, m, allow) => { calls.push(["amend", [m, allow]]); if (!allow) throw new Error("published: este commit já está num ramo remoto"); return "abc1234"; },
    ...over,
  };
  const ws = {
    root: () => "/p", project: () => "proj", save: vi.fn(async () => undefined), changed: vi.fn(async () => undefined),
    branches: () => ["main", "develop", "feature/x"], current: () => "feature/x",
    cursor: () => ({ path: "src/lib.rs", line: 2, start: 2, end: 4 }), commitMessage: () => "", open: vi.fn(),
  };
  const x = makeGitExtras({
    git, ws,
    audit: { record: async (_r, e) => { audited.push(e); } },
    human: { approve: async (r) => { confirms.push(`${r.title}\n${r.command}`); return { approved: confirmAnswer, reason: r.reasonRequired ? "needed" : "", decidedAt: 1 }; }, text: async () => answers.shift() ?? null, pick: async () => answers.shift() ?? null, toast: (m) => toasts.push(m) },
    codev: { available: () => true, ask: (r) => asked.push(r) },
    tabs: { open: vi.fn(), repaint: vi.fn() },
    say: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k),
  });
  return { x, calls, toasts, asked, answers, confirms, audited, ws, setConfirm: (v: boolean) => { confirmAnswer = v; } };
}

describe("aplicação", () => {
  it("o blame chega uma vez por ficheiro e avisa; a gravação invalida-o", async () => {
    const f = fakes();
    const seen: string[] = [];
    f.x.onBlame((p) => seen.push(p));
    expect(f.x.lineBlame("src/lib.rs", 2)).toBeNull();
    await vi.waitFor(() => expect(seen).toEqual(["src/lib.rs"]));
    expect(f.x.lineBlame("src/lib.rs", 2)?.summary).toBe("second");
    f.x.lineBlame("src/lib.rs", 1);
    expect(f.calls.filter(([c]) => c === "blame")).toHaveLength(1);
    f.x.invalidate(["src/lib.rs"]);
    f.x.lineBlame("src/lib.rs", 1);
    expect(f.calls.filter(([c]) => c === "blame")).toHaveLength(2);
  });

  it("o histórico das linhas seleccionadas abre o primeiro commit; explicar vai ao Co-Dev", async () => {
    const f = fakes();
    await f.x.openHistory("src/lib.rs", [2, 4]);
    await vi.waitFor(() => expect(f.x.state().history?.diff).toContain("+new line"));
    expect(f.calls).toContainEqual(["history", ["src/lib.rs", 2, 4]]);
    expect(f.x.state().history?.blame?.authors).toHaveLength(2);
    await f.x.explainCommit("3333333333");
    expect(f.asked[0]).toMatchObject({ intent: "explain", text: "askExplainCommit" });
  });

  it("stash: pede a mensagem, guarda, recarrega; apagar pergunta com o comando exacto", async () => {
    const f = fakes();
    f.answers.push("lexer experiment");
    await f.x.stashPush(true);
    expect(f.calls).toContainEqual(["stash", { op: "push", message: "lexer experiment", untracked: true }]);
    expect(f.ws.save).toHaveBeenCalled();
    expect(f.ws.changed).toHaveBeenCalled();
    f.setConfirm(false);
    await f.x.stashDrop(0);
    expect(f.confirms.at(-1)).toContain("git stash drop stash@{0}");
    expect(f.calls.some(([c, op]) => c === "stash" && (op as { op: string }).op === "drop")).toBe(false);
    await vi.waitFor(() => expect(f.audited).toEqual([expect.objectContaining({ action: "git.stash.drop", approved: false })]));
  });

  it("amend de um commit publicado pede uma segunda confirmação", async () => {
    const f = fakes();
    f.answers.push("feat: a");
    await f.x.amend();
    expect(f.calls.filter(([c]) => c === "amend").map(([, a]) => a)).toEqual([["feat: a", false], ["feat: a", true]]);
    expect(f.confirms[0]).toContain('git commit --amend -m "feat: a"');
    // r23 F3: both approvals are audited, then the result
    expect(f.audited.map((a) => `${a.action}:${a.outcome ?? "-"}`)).toEqual(["git.amend:sent", "git.amend.published:sent", "git.amend.published:ok", "git.amend:ok"]);
    expect(f.toasts.at(-1)).toContain("abc1234");
  });

  it("rebase: só corre um plano válido e aprovado, e mostra o novo estado", async () => {
    const f = fakes();
    await f.x.planRebase("develop");
    expect(f.x.state().rebase?.steps).toHaveLength(3);
    await f.x.runRebase(); // sem mudanças
    expect(f.toasts.at(-1)).toBe("planNoop");
    f.x.setAction(2, "fixup");
    f.x.move(0, 1);
    await f.x.runRebase();
    const run = f.calls.find(([c, op]) => c === "rebase" && (op as { op: string }).op === "run");
    expect(run?.[1]).toEqual({ op: "run", onto: "develop", steps: [{ action: "pick", hash: "2222222222" }, { action: "pick", hash: "1111111111" }, { action: "fixup", hash: "3333333333" }] });
    expect(f.confirms.at(-1)).toContain("git rebase -i develop");
    expect(f.x.state().rebase?.plan?.commits).toHaveLength(2);
  });

  it("a mensagem de commit e a revisão vão ao Co-Dev com o que está staged", async () => {
    const f = fakes();
    await f.x.askCommitMessage();
    await f.x.askReviewStaged();
    expect(f.asked.map((a) => a.intent)).toEqual(["explain", "review"]);
    const empty = fakes({ stagedDiff: async () => "" });
    await empty.x.askCommitMessage();
    expect(empty.asked).toEqual([]);
    expect(empty.toasts).toEqual(["nothingStaged"]);
  });
});

/* a cadeia real: o pane com as secções novas, e o separador do histórico */
let w: any;
let ipc: Array<[string, Record<string, unknown>]>;
beforeEach(async () => {
  w = await bootApp();
  ipc = [];
  w.DXR = { root: "/proj", git: true, flush: () => undefined, idle: async () => undefined, reloadDisk: async () => undefined, syncGit: async () => undefined };
  w.REPO = true;
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    git_stash: () => ({ stashes: [{ index: 0, message: "On develop: lexer experiment", time: Math.floor(Date.now() / 1000) - 120 }], output: "" }),
    git_worktree: () => [{ path: "/proj", head: "abc12345", branch: "develop", locked: false, prunable: false, current: true }, { path: "/proj-feature", head: "def", branch: "feature/x", locked: false, prunable: false, current: false }],
    git_history: () => PLAN.commits,
    git_blame: () => BLAME,
    git_show_path: () => "commit 1111111111\n+new line",
    git_changes: () => [],
    project_change_sets: () => [],
  };
  w.__TAURI__ = { core: { invoke: async (cmd: string, args: Record<string, unknown>) => { ipc.push([cmd, args]); if (!handlers[cmd]) throw new Error("comando inesperado: " + cmd); return handlers[cmd](args); } } };
});
afterEach(() => { delete w.__TAURI__; delete w.DXR; delete w.REPO; });

describe("ligação", () => {
  it("no desktop com repositório, o pane mostra os stashes, as worktrees e mais git", async () => {
    if (!document.getElementById("pane-scm")) document.querySelector(".side")!.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-scm"></div>');
    w.RP.scm();
    await vi.waitFor(() => expect(document.getElementById("pane-scm")!.textContent).toContain("lexer experiment"));
    const pane = document.getElementById("pane-scm")!;
    expect(pane.textContent).toContain("feature/x");
    expect(pane.querySelector('[data-action="gx-wt-remove"][data-on="/proj-feature"]')).not.toBeNull();
    expect(pane.querySelector('[data-action="gx-wt-remove"][data-on="/proj"]')).toBeNull(); // a pasta aberta não se remove
    expect(pane.querySelector('[data-action="gx-rebase"]')).not.toBeNull();
    // RF-E08: and the Co-Dev change sets of the working tree (none here: no section)
    await vi.waitFor(() => expect(ipc.map(([c]) => c).sort()).toEqual(["git_changes", "git_stash", "git_undo_list", "git_worktree", "project_change_sets"]));
    expect(pane.textContent).not.toContain("Co-Dev change sets");
  });

  it("o separador do histórico: commits, diff, quem conhece e o blame por idade", async () => {
    const { gitExtras } = await import("../src/features/scm/extras");
    const host = document.createElement("div");
    document.body.appendChild(host);
    w.openTab = (t: { kind: string }) => { w.VIEW[t.kind]({}, host); };
    await gitExtras.openHistory("src/lib.rs", null);
    await vi.waitFor(() => expect(host.textContent).toContain("+new line"));
    expect(host.querySelectorAll(".gx-commit")).toHaveLength(3);
    expect(host.textContent).toContain("Who knows this code");
    expect(host.querySelectorAll(".gx-blk")).toHaveLength(3);
    host.remove();
  });
});
