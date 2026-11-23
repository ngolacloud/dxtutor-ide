/* ═══════════ Co-Dev demonstration scenarios (ADR-0002, Phase 2) ═══════════
   The ordered list of demo missions, built from the injected `ScenarioEnv`.
   `codev.ts`'s `SCN_()` builds the env from the legacy bridge and calls this;
   the order (a then b) and content are identical to the former inline array. */

import type { Scenario, ScenarioEnv } from "../types";
import { buildLexerE0382 } from "./lexer-e0382";
import { buildChatHistory } from "./chat-history";

export function buildScenarios(env: ScenarioEnv): Scenario[] {
  return [buildLexerE0382(env), buildChatHistory(env)];
}

/** The demo scenario a FREE-TEXT prompt should run, if any. Only the browser simulation
 *  routes free text to a scenario: in the desktop app every prompt is real and goes to
 *  the selected model — a real error that mentions "E0382" or "lexer" must never be
 *  answered by the canned lexer mission. (Explicit demo buttons still run scenarios.) */
export function scenarioForPrompt(prompt: string, scenarios: readonly Scenario[], simulated: boolean): Scenario | undefined {
  if (!simulated) return undefined;
  return scenarios.find((s) => s.match.test(prompt));
}
