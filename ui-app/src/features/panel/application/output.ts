/* ═════════ feature `panel` — canais do Output (caso de uso) ═════════
   Como o Output do VS Code: um registo por canal ("dxtutor", "Tasks", "Problems",
   "Co-Dev", "Language Server", …), com limite de linhas e notificação a quem mostra. */

import type { OutputLevel, OutputLine } from "../domain/types";

const CAP = 5000;

export interface OutputLog {
  append(channel: string, text: string, level?: OutputLevel): void;
  lines(channel: string): readonly OutputLine[];
  channels(): string[];
  clear(channel: string): void;
  subscribe(f: (channel: string) => void): () => void;
}

export function makeOutput(now: () => number, order: readonly string[] = []): OutputLog {
  const by = new Map<string, OutputLine[]>();
  const subs = new Set<(c: string) => void>();
  const emit = (c: string) => subs.forEach((f) => f(c));
  return {
    append(channel, text, level = "info") {
      let l = by.get(channel);
      if (!l) by.set(channel, (l = []));
      for (const t of String(text).replace(/\r/g, "").split("\n")) l.push({ at: now(), text: t, level });
      if (l.length > CAP) l.splice(0, l.length - CAP);
      emit(channel);
    },
    lines: (c) => by.get(c) ?? [],
    channels() {
      const known = order.filter((c) => by.has(c));
      return known.concat([...by.keys()].filter((c) => !order.includes(c)).sort());
    },
    clear(c) {
      by.set(c, []);
      emit(c);
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
