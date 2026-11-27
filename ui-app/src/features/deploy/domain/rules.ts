/* ═══════════ feature `deploy` — domain: the wizard's pure rules (r23 F4c2) ═══════════
   The rule that blocks lives in Rust (`tutor_platform::deploy::blockers`, checked again at the rollout);
   this mirrors it only to enable the button and word the state. PURE. */
import type { DeployPlan, Gate } from "./types";

export const STEPS = ["target", "identity", "secrets", "preflight", "strategy", "approve", "rollout", "record"] as const;
export type Step = (typeof STEPS)[number];

/** The checks of the Secrets step; the rest are the Preflight's. */
export const SECRET_GATES = new Set(["secrets", "secret-check"]);
export const preflightGates = (p: DeployPlan): Gate[] => p.gates.filter((g) => !SECRET_GATES.has(g.id) && g.id !== "version");
export const secretGates = (p: DeployPlan): Gate[] => p.gates.filter((g) => SECRET_GATES.has(g.id));

/** What still blocks, with the waivers given (the backend decides; this only enables the button). */
export const stillBlocking = (p: DeployPlan, waived: Record<string, string>): string[] =>
  p.blockers.filter((b) => !(p.waivable.includes(b) && (waived[b] ?? "").trim().length >= 3));

/** A gate's state in a step: ok, warn (not verified, not blocking), blocked, waived. */
export function gateTone(p: DeployPlan, g: Gate, waived: Record<string, string>): "ok" | "warn" | "blocked" | "waived" | "skip" {
  if (g.status === "ok") return "ok";
  if (g.status === "skipped") return "skip";
  if (p.blockers.includes(g.id)) return (waived[g.id] ?? "").trim().length >= 3 && p.waivable.includes(g.id) ? "waived" : "blocked";
  return "warn";
}

/** A step's tone: blocked if any of its gates blocks. */
export function stepTone(p: DeployPlan | null, step: Step, waived: Record<string, string>): "ok" | "warn" | "blocked" | "todo" {
  if (!p) return "todo";
  const gates = step === "target" ? p.gates.filter((g) => g.id === "version") : step === "secrets" ? secretGates(p) : step === "preflight" ? preflightGates(p) : [];
  const tones = gates.map((g) => gateTone(p, g, waived));
  return tones.includes("blocked") ? "blocked" : tones.includes("warn") ? "warn" : "ok";
}

export const short = (sha: string): string => sha.slice(0, 10);
