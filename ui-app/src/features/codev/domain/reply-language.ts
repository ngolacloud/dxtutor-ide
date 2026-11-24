/* ═══════════ Co-Dev — domain: in which language the model answers ═══════════
   The interface language (`LOCALE`: `en` or `ptAO`) decides the language of the answer. The
   instructions to the model stay in Portuguese; only this rule changes. The Portuguese rule is
   the sentence the prompts always had, so nothing changes for a Portuguese interface. The
   desktop agent does the same in Rust (`tutor_agent::context::ReplyLang`). Pure. */

export type ReplyLanguage = "en" | "ptAO";

/** The rule that closes a prompt: answer in the interface language, briefly and concretely. */
export function replyRule(lang: ReplyLanguage): string {
  return lang === "en"
    ? "Answer the human in English, briefly and concretely (even though these instructions are in Portuguese)."
    : "Responde em português (ortografia pré-AO90), de forma curta e concreta.";
}
