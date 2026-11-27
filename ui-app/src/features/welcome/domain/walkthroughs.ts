/* ═════════ feature `welcome` — domain: the walkthroughs (r23 F6) ═════════
   Each walkthrough is a list of steps; each step names an ACTION by id (the composition maps the id to the
   feature entry point it opens — no strings evaluated as code, unlike the prototype's `WEL.run`). The texts
   live in the catalogue under `<walk>.<step>` (title), `<walk>.<step>.d` (what it is) and
   `<walk>.<step>.a` (the button). Cloud is out (decided 2026-11-25); the old Welcome cards became «Build».
   PURE: no DOM, no window. */

export type StepAction =
  | "themes" | "settings" | "openFolder" | "explorer" | "palette"
  | "studio" | "team" | "board" | "run" | "deploy" | "infra"
  | "codev" | "manager" | "codevRun"
  | "project" | "projectBacklog"
  | "pairHost" | "pairJoin"
  | "tests" | "debug" | "hood" | "scm"
  | "learn" | "tutor";

export interface Step { id: string; action: StepAction; /** the action needs the desktop app */ desktop?: boolean; /** what to do in the browser instead */ browser?: StepAction }
export interface Walkthrough { id: string; icon: string; steps: Step[] }

export const WALKTHROUGHS: Walkthrough[] = [
  { id: "start", icon: "bulb", steps: [
    { id: "theme", action: "themes" },
    { id: "lang", action: "settings" },
    { id: "folder", action: "openFolder", desktop: true, browser: "explorer" },
    { id: "model", action: "settings" },
    { id: "palette", action: "palette" },
  ] },
  { id: "build", icon: "cube", steps: [
    { id: "design", action: "studio" },
    { id: "harness", action: "team" },
    { id: "deliver", action: "board" },
    { id: "run", action: "run" },
    { id: "deploy", action: "deploy" },
    { id: "infra", action: "infra" },
  ] },
  { id: "codev", icon: "sparkle", steps: [
    { id: "ask", action: "codev" },
    { id: "mode", action: "settings" },
    { id: "run", action: "codevRun" },
    { id: "manager", action: "manager" },
  ] },
  { id: "project", icon: "kanban", steps: [
    { id: "board", action: "project" },
    { id: "backlog", action: "projectBacklog" },
  ] },
  { id: "pair", icon: "broadcast", steps: [
    { id: "host", action: "pairHost" },
    { id: "join", action: "pairJoin" },
  ] },
  { id: "quality", icon: "test", steps: [
    { id: "tests", action: "tests" },
    { id: "debug", action: "debug" },
    { id: "hood", action: "hood" },
    { id: "history", action: "scm" },
  ] },
  { id: "learn", icon: "book", steps: [
    { id: "track", action: "learn" },
    { id: "tutor", action: "tutor" },
  ] },
];

export const walkthrough = (id: string): Walkthrough | undefined => WALKTHROUGHS.find((w) => w.id === id);

/** The action a step runs here: in the browser a desktop-only step falls back (or has none). */
export function stepAction(s: Step, desktop: boolean): StepAction | null {
  if (!s.desktop || desktop) return s.action;
  return s.browser ?? null;
}

/** Every catalogue key the walkthroughs use (the tests check that both locales have them). */
export function walkthroughKeys(): string[] {
  return WALKTHROUGHS.flatMap((w) => [`${w.id}.title`, `${w.id}.desc`, ...w.steps.flatMap((s) => [`${w.id}.${s.id}`, `${w.id}.${s.id}.d`, `${w.id}.${s.id}.a`])]);
}
