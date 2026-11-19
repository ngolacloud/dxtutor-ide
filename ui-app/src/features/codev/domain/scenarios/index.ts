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
