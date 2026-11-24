import { describe, expect, it, vi } from "vitest";
import { contextPct, contextWindow, initialRun, parseSteps, reduceRun, turnStarted } from "../src/features/codev/domain/run-state";
import { makeHarness } from "../src/features/codev/application/harness";
import { renderHarness } from "../src/features/codev/ui/harness-view";
import { parseAgentEvent, parseCheckpoints, parsePermissions, type AgentEvent } from "../src/features/codev/domain/agent-events";

/* A3 — the harness (docs/v2/UI-AUDIT.md item 11): the «Co-Dev run» tab folds the turn's real
   events (plan with steps and files, tasks, sub-agents and roles, context used, the turn's
   report), lists the checkpoints with «Rewind to here», and edits the project's permission
   rules — through the backend, never locally. */

const usage = (input: number): AgentEvent => ({
  kind: "usage",
  request: { input_tokens: input, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
  turn: { input_tokens: input, output_tokens: 40, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
});

describe("the run, folded from the events", () => {
  it("keeps the plan with its steps, the tasks, the sub-agents, the context and the report", () => {
    let s = initialRun();
    s = turnStarted(s);
    s = reduceRun(s, {
      kind: "tool_start",
      id: "p",
      name: "exit_plan",
      input: { plan: "# Fix E0382", steps: [{ text: "Borrow the iterator", files: [{ path: "src/lib.rs", start: 5, end: 7 }, { nope: 1 }] }, { bad: true }] },
    });
    s = reduceRun(s, { kind: "tool_start", id: "t", name: "todo_write", input: { todos: [{ content: "fix", status: "in_progress" }, { content: "test", status: "weird" }] } });
    s = reduceRun(s, { kind: "tool_start", id: "a", name: "task", input: { description: "review the diff", role: "reviewer", prompt: "x" } });
    s = reduceRun(s, { kind: "tool_result", id: "a", name: "task", is_error: false, content: "ok" });
    s = reduceRun(s, usage(39_000));
    s = reduceRun(s, { kind: "report", title: "corrige", markdown: "**Files changed:** none" });
    expect(s.plan).toEqual({ markdown: "# Fix E0382", steps: [{ text: "Borrow the iterator", files: [{ path: "src/lib.rs", start: 5, end: 7 }] }] });
    expect(s.todos).toEqual([{ content: "fix", status: "in_progress" }, { content: "test", status: "pending" }]);
    expect(s.subagents).toEqual([{ id: "a", role: "reviewer", description: "review the diff", state: "done" }]);
    expect(s.context).toEqual({ input: 40_000, output: 40 });
    expect(contextPct(s, "claude-opus-5-5")).toBe(20);
    expect(contextPct(s, "qwen2.5-coder:14b")).toBeNull();
    expect(contextWindow("gemini-2.5-flash")).toBe(1_048_576);
    expect(s.report?.title).toBe("corrige");
    expect(reduceRun(s, { kind: "done", outcome: { type: "done", truncated: false } }).running).toBe(false);
    expect(parseSteps("nope")).toEqual([]);
  });

  it("parses the report event, checkpoints that can rewind the conversation and the rules", () => {
    expect(parseAgentEvent({ session: "s", event: { kind: "report", title: "t", markdown: "m" } })?.event.kind).toBe("report");
    expect(parseCheckpoints([{ id: 1, label: "a", created: 5, conversation: true }, { id: 2, label: "b", created: 6 }])).toEqual([
      { id: 1, label: "a", created: 5, conversation: true },
      { id: 2, label: "b", created: 6, conversation: false },
    ]);
    expect(parsePermissions({ project: { allow: ["edit", 3] }, projectFile: "/p/.dxtutor/permissions.json" })).toEqual({
      project: { allow: ["edit"], deny: [] },
      user: { allow: [], deny: [] },
      projectFile: "/p/.dxtutor/permissions.json",
      userFile: null,
    });
  });
});

function deps() {
  const gateway = {
    available: () => true,
    checkpoints: vi.fn(async () => [{ id: 1, label: "corrige o lexer", created: 1_700_000_000, conversation: true }]),
    rewind: vi.fn(async () => "ficheiros repostos para o checkpoint 1; a conversa voltou a antes desse pedido"),
    permissions: vi.fn(async () => ({ project: { allow: ["edit"], deny: [] }, user: { allow: [], deny: [] }, projectFile: "/p/.dxtutor/permissions.json", userFile: null })),
    savePermissions: vi.fn(async () => undefined),
    extensions: vi.fn(async () => ({ commands: [{ name: "rever", description: "" }], skills: [], hooks: { present: true, trusted: false }, mcp: { present: false, trusted: false }, mcpServers: ["github"] })),
    trust: vi.fn(async () => undefined),
  };
  const notes: string[] = [];
  const d = {
    gateway,
    session: () => "S1",
    root: () => "/p",
    reloadFromDisk: vi.fn(async () => undefined),
    open: vi.fn(),
    confirm: vi.fn(() => true),
    notify: (m: string) => notes.push(m),
  };
  return { d, gateway, notes };
}

describe("the harness use case", () => {
  it("rewinds files and conversation through the backend, then reloads the editor", async () => {
    const { d, gateway, notes } = deps();
    const h = makeHarness(d);
    await h.refresh();
    expect(h.state().checkpoints[0].conversation).toBe(true);
    await h.rewind(1, true);
    expect(gateway.rewind).toHaveBeenCalledWith("S1", 1, true);
    expect(d.reloadFromDisk).toHaveBeenCalled();
    expect(notes[0]).toMatch(/^Ficheiros repostos/);
  });

  it("asks before rewinding or trusting, and saves only clean rules", async () => {
    const { d, gateway } = deps();
    d.confirm.mockReturnValueOnce(false);
    const h = makeHarness(d);
    await h.refresh();
    await h.rewind(1, false);
    expect(gateway.rewind).not.toHaveBeenCalled();
    await h.savePermissions(["edit", "  bash:cargo test ", ""], ["bash:git push"]);
    expect(gateway.savePermissions).toHaveBeenCalledWith("/p", { allow: ["edit", "bash:cargo test"], deny: ["bash:git push"] });
    await h.trust("hooks");
    expect(gateway.trust).toHaveBeenCalledWith("/p", "hooks");
  });

  it("a checkpoint event refreshes the list", async () => {
    const { d, gateway } = deps();
    const h = makeHarness(d);
    h.event("S1", { kind: "checkpoint", id: 2, label: "x" });
    await vi.waitFor(() => expect(gateway.checkpoints).toHaveBeenCalled());
  });
});

describe("the «Co-Dev run» tab", () => {
  it("draws the run, the checkpoints with rewind, the rules and the extensions", async () => {
    const { d } = deps();
    const h = makeHarness(d);
    await h.refresh();
    h.event("S1", { kind: "tool_start", id: "p", name: "exit_plan", input: { plan: "Plan", steps: [{ text: "Step", files: [{ path: "src/lib.rs", start: 5 }] }] } });
    h.event("S1", usage(9_000));
    const host = document.createElement("div");
    host.innerHTML = renderHarness(h.state(), "claude-opus-5-5", 1_700_000_600_000);
    expect(host.querySelector('[data-action="hx-open"]')?.getAttribute("data-on")).toBe("src/lib.rs|5");
    expect(host.textContent).toContain("10,000 tokens in context of 200,000 (5%)");
    expect(host.querySelector('[data-action="hx-rewind"][data-on="1|1"]')?.textContent).toBe("Rewind to here");
    expect((host.querySelector('textarea[name="allow"]') as HTMLTextAreaElement).value).toBe("edit");
    expect(host.querySelector('[data-action="hx-trust"][data-on="hooks"]')).not.toBeNull();
    expect(host.textContent).toContain("/rever");
  });

  it("outside the desktop app it says where the harness lives", () => {
    const { d } = deps();
    const h = makeHarness({ ...d, gateway: { ...d.gateway, available: () => false } });
    expect(renderHarness(h.state(), "m", 0)).toContain("live in the desktop app");
  });
});
