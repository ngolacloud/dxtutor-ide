/* O catálogo oficial de linguagens do Learning Track e a montagem do selector. PURO.
   Decisão do dono (2026-11-23): no máximo 10 linguagens oficiais, as usadas pelas grandes
   empresas de tecnologia. Os cursos de cada uma chegam como plugins de
   github.com/dxtutor-courses/<id>; Rust e Go também vêm embutidos na UI. */

import type { Course, Language, LanguageCard, PluginRow } from "./types";

/** Máximo de linguagens oficiais (o catálogo não pode crescer além disto). */
export const MAX_OFFICIAL_LANGUAGES = 10;

export const LANGUAGE_CATALOG: readonly Language[] = [
  { id: "rust", name: "Rust", icon: "🦀", extension: "rs", indent: "    " },
  { id: "go", name: "Go", icon: "💪", extension: "go", indent: "\t" },
  { id: "python", name: "Python", icon: "🐍", extension: "py", indent: "    " },
  { id: "typescript", name: "TypeScript", icon: "🔷", extension: "ts", indent: "  " },
  { id: "java", name: "Java", icon: "☕", extension: "java", indent: "    " },
  { id: "kotlin", name: "Kotlin", icon: "🟣", extension: "kt", indent: "    " },
  { id: "swift", name: "Swift", icon: "🐦", extension: "swift", indent: "    " },
  { id: "csharp", name: "C#", icon: "🎯", extension: "cs", indent: "    " },
  { id: "cpp", name: "C++", icon: "⚙️", extension: "cpp", indent: "    " },
  { id: "sql", name: "SQL", icon: "🗄️", extension: "sql", indent: "  " },
];

/** `"tab"` → tabulação; `"4"` → quatro espaços; qualquer outra coisa → quatro espaços. */
export function indentText(spec: string): string {
  if (spec === "tab") return "\t";
  const n = Number.parseInt(spec, 10);
  return " ".repeat(Number.isInteger(n) && n >= 1 && n <= 8 ? n : 4);
}

/** A linguagem conhecida por `id`: do catálogo, senão do manifesto de um plugin instalado. */
export function findLanguage(id: string, plugins: readonly PluginRow[]): Language | null {
  return LANGUAGE_CATALOG.find(l => l.id === id) ?? plugins.find(p => p.language?.id === id)?.language ?? null;
}

/**
 * Os cartões do selector: o catálogo oficial pela ordem, «available» quando há curso para a
 * linguagem e «soon» quando não; depois as linguagens que só existem por plugins da
 * comunidade (sempre «available», porque o plugin traz o curso).
 */
export function languageCards(courses: Readonly<Record<string, Course>>, plugins: readonly PluginRow[]): LanguageCard[] {
  const card = (language: Language, community: boolean): LanguageCard => {
    const c = courses[language.id];
    return { language, state: c ? "available" : "soon", summary: c ? c.summary : "", community };
  };
  const official = LANGUAGE_CATALOG.map(l => card(l, false));
  const seen = new Set(LANGUAGE_CATALOG.map(l => l.id));
  const community: LanguageCard[] = [];
  for (const p of plugins) {
    const l = p.language;
    if (!l || seen.has(l.id) || !courses[l.id]) continue;
    seen.add(l.id);
    community.push(card(l, true));
  }
  return official.concat(community);
}
