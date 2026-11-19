/* ═══════════ Co-Dev — tool executor use case (ADR-0002, Phase 3) ═══════════
   `doTool`: run one agent tool call (read / edit / run) with the per-mode
   approval policy. Pure application logic — no DOM, no window, no HTML. The
   approval rule comes from `domain/policy`; every side-effect goes through a
   port (`workspace`, `terminal`, `providers`, `notifier`) or the presenter.

   Shared with `features/board.ts` through `window.doTool`, so its observable
   behaviour (return values, gate text, call order) is frozen. Cancellation
   honours `signal.aborted` via `presenter.beat`; the thrown value stays the
   shared STOP sentinel (see `ports.ts`). */

import { approvalFor } from "../domain/policy";
import type { Mode } from "../domain/types";
import type { RuntimeTool, ToolDeps, ToolHost } from "./ports";

/** A signal that never aborts — the default when a caller (a characterization
 *  test, or `board.ts`) invokes `doTool` without one. */
const NEVER: AbortSignal = new AbortController().signal;

export function makeDoTool(deps: ToolDeps) {
  const { workspace, terminal, providers, notifier, presenter, gate, rules, clock } = deps;

  return async function doTool(t: RuntimeTool, host: ToolHost, role?: string, signal: AbortSignal = NEVER): Promise<unknown> {
    const mode = deps.mode() as Mode;

    if (t.t === "read") {
      const d = presenter.toolLine(host, "read_file", workspace.shortPath(t.p!));
      await clock.beat(240, signal);
      presenter.toolOk(d);
      return true;
    }

    if (t.t === "edit") {
      const fs = workspace.files();
      const old = fs[t.p!] ? fs[t.p!].content : null;
      const nw = t.make ? t.make(old || "") : t.content!;
      if (nw === old) {
        presenter.toolNoChange(host, workspace.shortPath(t.p!));
        return true;
      }
      const s = workspace.diffStat(old, nw);
      const d = presenter.toolEdit(host, {
        create: old == null,
        shortPath: workspace.shortPath(t.p!),
        add: s.add,
        del: s.del,
        onDiff: () => workspace.openDiff(t.p!, old || "", nw, "proposta do Co-Dev"),
      });
      if (approvalFor(mode, { kind: "edit" }, rules) === "ask") {
        const v = await gate.ask(d, [
          { l: "Aprovar edição", v: 1, pri: 1, done: "✓ aprovada por ti" },
          { l: "Rejeitar", v: 0, done: "✗ rejeitada por ti" },
        ]);
        if (!v) {
          notifier.log("humano", "rejeitou a edição de " + workspace.shortPath(t.p!));
          return false;
        }
      }
      workspace.write(t.p!, nw);
      presenter.trackFile(t.p!);
      workspace.openTab({ id: t.p!, title: t.p!.split("/").pop(), kind: "file", path: t.p! }, false);
      providers.trackUsage(providers.provFor(role || "code"), 900 + s.add * 40);
      notifier.log(
        providers.speakerLabel(role || "code"),
        (old == null ? "criou " : "editou ") + workspace.shortPath(t.p!) + ` (+${s.add} −${s.del})`,
      );
      await clock.beat(360, signal);
      return true;
    }

    if (t.t === "run") {
      const d = presenter.toolRun(host, t.cmd!);
      const need = approvalFor(mode, { kind: "run", cmd: t.cmd }, rules) === "ask";
      if (need) {
        const v = await gate.ask(d, [
          { l: "Executar", v: 1, pri: 1, done: "✓ autorizado por ti" },
          { l: "Saltar", v: 0, done: "✗ não executado" },
        ]);
        if (!v) return null;
      }
      await clock.beat(280, signal);
      presenter.revealTerminal();
      const r = terminal.exec(t.cmd!) || { ok: true, sum: "ok" };
      presenter.toolRunResult(d, r.ok, r.sum || "");
      notifier.log("terminal", t.cmd + " → " + (r.sum || "ok"));
      await clock.beat(420, signal);
      return r;
    }
  };
}

export type DoTool = ReturnType<typeof makeDoTool>;
