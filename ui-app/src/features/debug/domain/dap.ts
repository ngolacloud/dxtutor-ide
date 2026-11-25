/* ═══════════ feature `debug` — domain: what a DAP session adds (A7, docs/v2/UI-AUDIT.md item 4) ═══════════
   The shapes of `tutor_eval::dapc` (variables with what changed, threads, breakpoints with a
   condition / hit count / log message) and the pure rules around them: the specs a file sends
   to the adapter, how a breakpoint reads in the list, the values shown inline next to the lines
   above the stop, and the session as markdown (the snapshot kept with an issue, and the
   context Co-Dev gets). PURE: no DOM, no window, no Tauri. */

import type { Frame, Stop } from "./session";

export type Engine = "dap" | "gdb";

/** What the adapter answered to `initialize` (`dapc::SessionCaps`, r23 F2). */
export interface SessionCaps {
  stepBack: boolean;
  dataBreakpoints: boolean;
  readMemory: boolean;
  restartFrame: boolean;
  exceptionFilters: Array<{ filter: string; label: string; default: boolean }>;
}

export interface LaunchInfo { engine: Engine; adapter: string; caps?: SessionCaps | null }

/** A data breakpoint (`dapc::DataBreakpoint`): stop when a variable's bytes are written. */
export interface DataBp { dataId: string; description: string; accessType: string; verified: boolean; message: string | null }

export interface VarNode {
  name: string;
  value: string;
  type: string;
  /** > 0: has children (expand with `debug_variables`) */
  reference: number;
  /** differs from the previous stop */
  changed: boolean;
  path: string;
  /** where its bytes are (`debug_read_memory`), when the adapter gives it */
  memoryReference?: string | null;
}

export interface DapThread { id: number; name: string; current: boolean }

/** What a breakpoint carries besides its line. */
export interface BpMeta {
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
  enabled: boolean;
  /** r23 F2: armed only after the program stops at this other breakpoint (`path:line`) */
  trigger?: string;
  /** r23 F2: a scenario the breakpoint belongs to (switched on or off as a whole) */
  group?: string;
}

export interface BreakpointSpec { line: number; condition?: string; hitCondition?: string; logMessage?: string }

export interface Watch { expr: string; value?: string; error?: string; changed?: boolean }

const clean = (s?: string): string | undefined => (s && s.trim() ? s.trim() : undefined);

/** The specs of one file: its enabled breakpoints with their condition, hit count, log message. */
export function specsFor(lines: number[], meta: (line: number) => BpMeta | undefined): BreakpointSpec[] {
  return [...new Set(lines)].sort((a, b) => a - b).flatMap((line) => {
    const m = meta(line);
    if (m && !m.enabled) return [];
    const spec: BreakpointSpec = { line };
    if (clean(m?.condition)) spec.condition = clean(m?.condition);
    if (clean(m?.hitCondition)) spec.hitCondition = clean(m?.hitCondition);
    if (clean(m?.logMessage)) spec.logMessage = clean(m?.logMessage);
    return [spec];
  });
}

/** The breakpoint's kind for the list and the gutter: plain, conditional, hit count, logpoint. */
export function bpKind(m?: BpMeta): "plain" | "condition" | "hit" | "log" {
  if (clean(m?.logMessage)) return "log";
  if (clean(m?.condition)) return "condition";
  if (clean(m?.hitCondition)) return "hit";
  return "plain";
}

/** A breakpoint without anything special and enabled needs no stored meta. */
export const isPlain = (m?: BpMeta): boolean => !m || (m.enabled && bpKind(m) === "plain" && !clean(m.trigger) && !clean(m.group));

/** Is a breakpoint sent to the adapter now? On, its group on, and — when it waits for another
 *  breakpoint — that one already hit in this session (the adapter has no triggered breakpoints:
 *  the client keeps it back until then). */
export function bpActive(m: BpMeta | undefined, groupsOff: ReadonlySet<string>, armed: ReadonlySet<string>): boolean {
  if (!m) return true;
  if (!m.enabled) return false;
  if (clean(m.group) && groupsOff.has(clean(m.group)!)) return false;
  if (clean(m.trigger) && !armed.has(clean(m.trigger)!)) return false;
  return true;
}

/** The groups the breakpoints use, sorted. */
export function bpGroups(metas: Iterable<BpMeta>): string[] {
  const g = new Set<string>();
  for (const m of metas) if (clean(m.group)) g.add(clean(m.group)!);
  return [...g].sort();
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

/** The values shown at the end of the lines above (and at) the stop: for each line, the locals
 *  it mentions, as `name = value`. `lines` is the file's text, `stop` the 1-based stop line. */
export function inlineValues(lines: string[], stop: number, vars: Array<{ name: string; value: string }>, reach = 40, maxLen = 60): Record<number, string> {
  const byName = new Map(vars.filter((v) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)).map((v) => [v.name, v.value]));
  const out: Record<number, string> = {};
  if (!byName.size || stop < 1) return out;
  for (let n = Math.max(1, stop - reach); n <= Math.min(stop, lines.length); n++) {
    const code = lines[n - 1].replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const seen: string[] = [];
    for (const m of code.matchAll(IDENT)) if (byName.has(m[0]) && !seen.includes(m[0])) seen.push(m[0]);
    if (seen.length) {
      const txt = seen.map((k) => `${k} = ${byName.get(k)}`).join(", ");
      out[n] = txt.length > maxLen ? txt.slice(0, maxLen - 1) + "…" : txt;
    }
  }
  return out;
}

/** The session at a stop, as markdown: where, the stack, the variables (what changed marked), the watches and the output's tail. */
export function sessionMarkdown(o: { program: string; stop: Stop; stack: Frame[]; vars: VarNode[]; watches: Watch[]; output: string[] }): string {
  const s = o.stop;
  const lines = [
    `**Program:** \`${o.program}\``,
    `**Stopped:** ${s.reason}${s.description ? ` — ${s.description}` : ""} in \`${s.func}\` at \`${s.file.split("/").slice(-2).join("/")}:${s.line}\``,
    "",
    "**Call stack:**",
    ...o.stack.slice(0, 15).map((f) => `${f.level}. \`${f.func}\` — ${f.file ? `${f.file.split("/").slice(-2).join("/")}:${f.line}` : "(no source)"}`),
    "",
    "**Variables:**",
    ...(o.vars.length ? o.vars.map((v) => `- \`${v.name}\`${v.type ? ` (${v.type})` : ""} = \`${v.value}\`${v.changed ? " ← changed" : ""}`) : ["- (none)"]),
  ];
  if (o.watches.length) lines.push("", "**Watch:**", ...o.watches.map((w) => `- \`${w.expr}\` = ${w.error ? `(${w.error})` : `\`${w.value ?? ""}\``}`));
  const tail = o.output.join("").split("\n").slice(-20).join("\n").trim();
  if (tail) lines.push("", "**Output (tail):**", "```", tail, "```");
  return lines.join("\n");
}
