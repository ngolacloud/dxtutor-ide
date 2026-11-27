/* ═══════════ Co-Dev — UI: the «Co-Dev run» tab (docs/v2/UI-AUDIT.md item 11, phase A3) ═══════════
   The harness in one tab: the run (context used, plan with the files and lines of each
   step, tasks, sub-agents and their roles, the last turn's report), the session's
   checkpoints with «Rewind to here», the project's permission rules and its MCP servers,
   hooks, commands and skills. Everything comes from the agent's events and the backend;
   with nothing there, each section says why. Buttons carry `data-action` (+ `data-on`). */

import { esc } from "../../../core";
import type { HarnessState } from "../application/harness";
import { contextPct, contextWindow } from "../domain/run-state";
import { md } from "./chat-view";

const ago = (ms: number, now: number): string => {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

const sec = (title: string, body: string, extra = ""): string =>
  `<section class="hx-sec"><div class="hx-h"><span>${title}</span>${extra}</div>${body}</section>`;

const empty = (t: string): string => `<div class="hx-empty">${t}</div>`;

function runSection(st: HarnessState, model: string): string {
  const r = st.run;
  const pct = contextPct(r, model);
  const win = contextWindow(model);
  const meter = r.context
    ? `<div class="hx-meter" title="Tokens the model read in the last request (prompt, history and cache)"><div class="hx-gauge"><div class="hx-gauge-fill${pct !== null && pct > 80 ? " hot" : ""}" style="width:${pct ?? 0}%"></div></div>
       <span>${r.context.input.toLocaleString("en-GB")} tokens in context${win ? ` of ${win.toLocaleString("en-GB")} (${pct}%)` : ""}</span></div>`
    : empty("The context meter fills in with the first turn.");
  const plan = r.plan
    ? `<div class="hx-md">${md(r.plan.markdown)}</div>${
        r.plan.steps.length
          ? `<ol class="hx-steps">${r.plan.steps
              .map(
                (s) => `<li><span>${esc(s.text)}</span>${s.files
                  .map((f) => `<button class="hx-file" data-action="hx-open" data-on="${esc(f.path)}|${f.start ?? ""}"><code>${esc(f.path)}${f.start ? `:${f.start}${f.end && f.end !== f.start ? "–" + f.end : ""}` : ""}</code></button>`)
                  .join("")}</li>`,
              )
              .join("")}</ol>`
          : ""
      }`
    : empty("No plan yet. Start with <code>/plano &lt;request&gt;</code>: Co-Dev investigates read-only and proposes a plan for you to approve.");
  const todos = r.todos.length
    ? `<ul class="hx-todos">${r.todos.map((t) => `<li class="t-${t.status}"><span class="hx-tick">${t.status === "completed" ? "✓" : t.status === "in_progress" ? "◐" : "○"}</span><span>${esc(t.content)}</span></li>`).join("")}</ul>`
    : empty("Co-Dev lists its steps here when the work has several.");
  const subs = r.subagents.length
    ? r.subagents
        .map((a) => `<div class="hx-sub"><span class="hx-role r-${esc(a.role)}">${esc(a.role)}</span><span>${esc(a.description)}</span><span class="hx-state s-${a.state}">${a.state}</span></div>`)
        .join("")
    : empty("Sub-agents (explorer, reviewer, tester, architect) appear here when Co-Dev delegates to them.");
  const report = r.report
    ? `<div class="hx-report"><div class="hx-dim">${esc(r.report.title)}</div><div class="hx-md">${md(r.report.markdown)}</div></div>`
    : empty("After a turn that changes files or runs commands, its report (built from what really happened) shows here.");
  return (
    sec("Context", meter) +
    sec("Plan", plan) +
    sec("Tasks", todos, r.todos.length ? `<span class="hx-dim">${r.todos.filter((t) => t.status === "completed").length}/${r.todos.length}</span>` : "") +
    sec("Sub-agents", subs) +
    sec("Last turn", report)
  );
}

function checkpointsSection(st: HarnessState, now: number): string {
  const list = st.checkpoints.length
    ? [...st.checkpoints]
        .reverse()
        .map(
          (c) => `<div class="hx-cp"><span class="hx-cpid">#${c.id}</span><span class="hx-cpl">${esc(c.label)}</span><span class="hx-dim">${ago(c.created * 1000, now)}</span>
          <button class="hx-btn" data-action="hx-rewind" data-on="${c.id}|0" title="The files go back to how they were before this request"><span>Rewind files</span></button>${
            c.conversation
              ? `<button class="hx-btn pri" data-action="hx-rewind" data-on="${c.id}|1" title="The files and the conversation go back to before this request"><span>Rewind to here</span></button>`
              : ""
          }</div>`,
        )
        .join("")
    : empty("No checkpoints in this conversation yet. They exist in git repositories, one per turn that changes files.");
  return sec("Checkpoints", list);
}

function permissionsSection(st: HarnessState): string {
  const p = st.permissions;
  if (!p) return sec("Permissions", empty("Loading…"));
  const ta = (name: string, v: string[]) => `<textarea class="hx-ta" name="${name}" rows="5" spellcheck="false">${esc(v.join("\n"))}</textarea>`;
  const user = p.user.allow.length || p.user.deny.length
    ? `<div class="hx-dim">Your rules for every project (${esc(p.userFile ?? "")}): allow ${p.user.allow.map((r) => `<code>${esc(r)}</code>`).join(" ") || "—"} · deny ${p.user.deny.map((r) => `<code>${esc(r)}</code>`).join(" ") || "—"}</div>`
    : "";
  return sec(
    "Permissions",
    `<div class="hx-dim">This project's rules, in <code>${esc(p.projectFile)}</code> — the same file «Allow always» writes to. One rule per line: a tool name (<code>edit</code>, <code>run_tests</code>) or <code>bash:</code> and the start of a command (<code>bash:cargo test</code>). Deny wins over allow; protected files and dangerous commands always ask.</div>
     <div class="hx-form" data-action="hx-perm-form"><label><span>Allow</span>${ta("allow", p.project.allow)}</label><label><span>Deny</span>${ta("deny", p.project.deny)}</label></div>
     <button class="hx-btn pri" data-action="hx-perm-save"><span>Save rules</span></button>${user}`,
  );
}

function extensionsSection(st: HarnessState): string {
  const x = st.extensions;
  if (!x) return sec("MCP and hooks", empty("Loading…"));
  const trust = (f: { present: boolean; trusted: boolean }, kind: "hooks" | "mcp" | "sandbox" | "llm") =>
    !f.present ? `<span class="hx-dim">not defined</span>` : f.trusted ? `<span class="hx-ok">trusted ✓</span>` : `<button class="hx-btn" data-action="hx-trust" data-on="${kind}"><span>Trust</span></button>`;
  return sec(
    "MCP and hooks",
    `<div class="hx-row"><b>Hooks</b> <code>.dxtutor/hooks.json</code> ${trust(x.hooks, "hooks")}</div>
     <div class="hx-row"><b>MCP servers</b> ${x.mcpServers.length ? x.mcpServers.map((s) => `<code>${esc(s)}</code>`).join(" ") : `<span class="hx-dim">none</span>`} · project <code>.dxtutor/mcp.json</code> ${trust(x.mcp, "mcp")}</div>
     ${x.sandbox?.present ? `<div class="hx-row"><b>Sandbox</b> <code>.dxtutor/sandbox.json</code> ${trust(x.sandbox, "sandbox")}</div>` : ""}
     ${x.llm?.present ? `<div class="hx-row"><b>AI gateway</b> <code>.dxtutor/llm.json</code> ${trust(x.llm, "llm")}</div>` : ""}
     <div class="hx-row"><b>Commands</b> ${x.commands.length ? x.commands.map((c) => `<code title="${esc(c.description)}">/${esc(c.name)}</code>`).join(" ") : `<span class="hx-dim">none — add <code>.dxtutor/commands/&lt;name&gt;.md</code></span>`}</div>
     <div class="hx-row"><b>Skills</b> ${x.skills.length ? x.skills.map((k) => `<code title="${esc(k.description)}">${esc(k.name)}</code>`).join(" ") : `<span class="hx-dim">none</span>`}</div>
     <div class="hx-dim">Hooks and MCP servers run commands defined by the repository: trust them only if you know the project. Trust stops counting if the file changes.</div>`,
  );
}

export function renderHarness(st: HarnessState, model: string, now: number): string {
  if (!st.available) {
    return `<div class="hx-run"><div class="hx-empty"><b>Co-Dev run</b><p>The agent's plan, tasks, checkpoints, permissions and extensions live in the desktop app, with a folder open and a provider with an agent (Claude, Codex, Gemini or Ollama).</p></div></div>`;
  }
  return `<div class="hx-run"><div class="hx-top"><b>Co-Dev run</b>${st.run.running ? `<span class="hx-live">running</span>` : ""}<span class="hx-sp"></span><button class="hx-btn" data-action="hx-refresh"><span>Refresh</span></button></div>
    <div class="hx-cols"><div class="hx-col">${runSection(st, model)}</div><div class="hx-col">${checkpointsSection(st, now)}${permissionsSection(st)}${extensionsSection(st)}</div></div></div>`;
}

/** Mounts the tab and repaints it on every change while it is on screen. */
export function makeHarnessView(state: () => HarnessState, onChange: (f: () => void) => void, model: () => string, now: () => number) {
  let host: HTMLElement | null = null;
  const paint = (): void => {
    if (!host || !host.isConnected) return;
    // never repaint under a rule being typed (the textarea would lose its text)
    const a = document.activeElement;
    if (a && host.contains(a) && a.tagName === "TEXTAREA") return;
    host.innerHTML = renderHarness(state(), model(), now());
  };
  onChange(paint);
  return {
    mount(h: HTMLElement): void {
      host = h;
      paint();
    },
    paint,
  };
}
