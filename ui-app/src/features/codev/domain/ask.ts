/* ═══════════ Co-Dev — domain: the one way to ask Co-Dev (`codev.ask`) ═══════════
   Every feature asks Co-Dev the same way: an intent, the context it has at hand (a
   selection, a file, a proposed hunk, a problem, a test…) and the scope. The context
   becomes removable chips in the composer; the intent shapes the request. `explain`
   answers in the chat (code may be shown there, RF-CODEV-STREAM §7) and changes nothing.
   Pure: no DOM, no window. */

export type AskIntent = "chat" | "explain" | "fix" | "change" | "review" | "plan";

export interface AskContext {
  kind: "selection" | "file" | "hunk" | "problem" | "test" | "lesson" | "issue" | "terminal";
  /** Short label for the chip (e.g. `lib.rs:12–18`). */
  label: string;
  /** The text the context carries (a selection, a diff, an error). */
  text?: string;
  /** Project path it refers to, when there is one. */
  path?: string;
}

export interface AskRequest {
  intent: AskIntent;
  /** What the human asks; empty → a default question for the intent. */
  text?: string;
  context: AskContext[];
  scope?: "selection" | "file" | "project";
  /** Send at once (true) or leave it in the composer for the human to complete. */
  send?: boolean;
}

/** The question when the caller gives none. */
export function defaultQuestion(intent: AskIntent): string {
  switch (intent) {
    case "explain":
      return "Explica isto.";
    case "fix":
      return "Corrige isto.";
    case "review":
      return "Revê isto.";
    case "change":
      return "";
    case "plan":
      return "Propõe um plano para isto.";
    default:
      return "";
  }
}

/** The text that goes to the composer for a request. */
export const askText = (r: AskRequest): string => (r.text && r.text.trim() ? r.text.trim() : defaultQuestion(r.intent));

/** A request to explain: the question and its context, for a direct answer in the chat. */
export function explainPrompt(r: AskRequest): string {
  const ctx = r.context
    .map((c) => `<contexto tipo="${c.kind}" nome="${c.label.replace(/"/g, "'")}">\n${c.text ?? ""}\n</contexto>`)
    .join("\n\n");
  return (
    `${askText(r)}\n\n${ctx}\n\n` +
    "Responde em português (ortografia pré-AO90), de forma curta e concreta. É um pedido de explicação: " +
    "podes mostrar código na resposta, mas não proponhas alterar ficheiros."
  ).trim();
}

/** A proposed hunk as context: where it is and what it changes, as a small diff. */
export function hunkContext(path: string, start: number, old: string, text: string): AskContext {
  const minus = old ? old.replace(/\n$/, "").split("\n").map((l) => "- " + l) : [];
  const plus = text ? text.replace(/\n$/, "").split("\n").map((l) => "+ " + l) : [];
  const end = start + Math.max(0, minus.length - 1);
  return {
    kind: "hunk",
    label: `${path}:${start}${end > start ? "–" + end : ""}`,
    text: [...minus, ...plus].join("\n"),
    path,
  };
}

/** A selection in the editor as context. */
export function selectionContext(path: string, fromLine: number, text: string): AskContext {
  const n = text.replace(/\n$/, "").split("\n").length;
  return {
    kind: "selection",
    label: `${path.split("/").pop() || path}:${fromLine}${n > 1 ? "–" + (fromLine + n - 1) : ""}`,
    text,
    path,
  };
}
