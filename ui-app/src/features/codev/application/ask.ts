/* ═══════════ Co-Dev — use case: `codev.ask` (the one way features ask Co-Dev) ═══════════
   `explain` is answered straight away in the chat by the model (no agent turn, no file
   changes), so it also works while a turn waits for the human — e.g. «Explain» on a
   proposed hunk. Every other intent goes to the composer: the context becomes removable
   chips, the question goes into the box, and with `send` it is sent like the human's own
   message (through the agent, or queued if a turn is running). */

import type { MissionPresenter, Sampler } from "./ports";
import { askText, explainPrompt, type AskRequest } from "../domain/ask";

export interface AskDeps {
  /** The direct model call (`null` when no live provider: explain falls back to the composer). */
  sample(): Sampler | null;
  presenter: Pick<MissionPresenter, "userMessage" | "thinking" | "assistantText" | "liveError" | "scrollMsgs">;
  speaker(): string;
  /** Shows the Co-Dev panel. */
  focus(): void;
  /** Puts the request in the composer (chips + text), sending it when `send`. */
  compose(text: string, context: AskRequest["context"], send: boolean): void;
}

export function makeAsk(deps: AskDeps) {
  async function explain(r: AskRequest): Promise<boolean> {
    const sample = deps.sample();
    if (!sample) return false;
    const p = deps.presenter;
    const labels = r.context.map((c) => c.label).join(", ");
    p.userMessage(askText(r) + (labels ? ` (${labels})` : ""));
    const card = p.thinking(deps.speaker());
    try {
      const res = await sample(explainPrompt(r), { cache: false, onText: ({ text }) => p.assistantText(card, text) });
      if (typeof res.text === "string" && res.text) p.assistantText(card, res.text);
    } catch (e: unknown) {
      p.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
    } finally {
      p.scrollMsgs();
    }
    return true;
  }

  return async function ask(r: AskRequest): Promise<void> {
    deps.focus();
    if (r.intent === "explain" && r.send !== false && (await explain(r))) return;
    deps.compose(askText(r), r.context, r.send === true);
  };
}

export type CodevAsk = ReturnType<typeof makeAsk>;
