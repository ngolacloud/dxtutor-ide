/* O catálogo oficial de linguagens do Learning Track e a montagem do selector. PURO.
   Decisão do dono (2026-11-23): no máximo 10 linguagens oficiais, as usadas pelas grandes
   empresas de tecnologia. Os cursos de cada uma chegam como plugins de
   github.com/ngolacloud/dxtutor-course-<id>; Rust e Go também vêm embutidos na UI. */

import type { Category, Course, Language, LanguageCard, PluginRow, Subject, SubjectCard } from "./types";

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

/** Linguagens em que um curso se ESCREVE e se avalia sem serem linguagens do catálogo (não contam
 *  para o tecto de 10 nem aparecem como cartões): o YAML dos cursos de ferramentas (Kubernetes,
 *  Delonix), avaliado por verificações no backend. Dão a extensão e a indentação do editor. */
export const EVALUATION_LANGUAGES: readonly Language[] = [
  { id: "yaml", name: "YAML", icon: "📄", extension: "yaml", indent: "  " },
];

/** `"tab"` → tabulação; `"4"` → quatro espaços; qualquer outra coisa → quatro espaços. */
export function indentText(spec: string): string {
  if (spec === "tab") return "\t";
  const n = Number.parseInt(spec, 10);
  return " ".repeat(Number.isInteger(n) && n >= 1 && n <= 8 ? n : 4);
}

/** A linguagem conhecida por `id`: do catálogo, senão do manifesto de um plugin instalado. */
export function findLanguage(id: string, plugins: readonly PluginRow[]): Language | null {
  return LANGUAGE_CATALOG.find(l => l.id === id) ?? EVALUATION_LANGUAGES.find(l => l.id === id) ?? plugins.find(p => p.language?.id === id)?.language ?? null;
}

/**
 * Os cartões do selector: o catálogo oficial pela ordem, «available» quando há curso para a
 * linguagem e «soon» quando não; depois as linguagens que só existem por plugins da
 * comunidade (sempre «available», porque o plugin traz o curso).
 */
export function languageCards(courses: Readonly<Record<string, Course>>, plugins: readonly PluginRow[]): LanguageCard[] {
  const card = (language: Language, community: boolean): LanguageCard => {
    const c = courses[language.id];
    const ok = !!c && c.category === "language";
    return { language, state: ok ? "available" : "soon", summary: ok ? c.summary : "", community };
  };
  const official = LANGUAGE_CATALOG.map(l => card(l, false));
  const seen = new Set(LANGUAGE_CATALOG.map(l => l.id));
  const community: LanguageCard[] = [];
  for (const p of plugins) {
    const l = p.language;
    if (!l || p.subject || seen.has(l.id) || !courses[l.id] || courses[l.id].category !== "language") continue;
    seen.add(l.id);
    community.push(card(l, true));
  }
  return official.concat(community);
}

/* ───── Frameworks e ferramentas (ADR-0005, emenda de 2026-11-26) ─────
   Categoria SEPARADA das linguagens, com o seu catálogo oficial: o tecto de 10 acima é só das
   linguagens. Os cursos chegam como plugins (`ngolacloud/dxtutor-course-<id>`, `category`
   `framework`/`tool` no manifesto) e avaliam-se na linguagem/runtime que o manifesto declara.
   Antes de um curso existir, o cartão mostra-se como uma linguagem oficial sem plugin:
   «Coming soon», desactivado, sem progresso nem conteúdo de demonstração (ADR-0006). */

const official = (id: string): string => `ngolacloud/dxtutor-course-${id}`;

export const FRAMEWORK_CATALOG: readonly Subject[] = [
  { id: "dxjs", name: "Dxjs", icon: "⚡", category: "framework", docs: "https://ngolacloud.github.io/dxjs/", install: "Node.js 22.18 or newer. dxjs 1.2.0 itself comes with the course (it is not on npm).", repo: official("dxjs") },
  { id: "seiva", name: "Seiva", icon: "🌿", category: "framework", docs: "https://ngolacloud.github.io/seiva/", install: "The Rust toolchain (rustup, cargo).", repo: official("seiva") },
  { id: "django", name: "Django", icon: "🎸", category: "framework", docs: "https://docs.djangoproject.com/en/5.2/", install: "Python 3.10 or newer with its venv module. «Prepare course» installs Django 5.2 LTS for the course only, not into your Python.", repo: official("django") },
  { id: "delonix", name: "Delonix Engine", icon: "🌺", category: "tool", docs: "https://ngolacloud.github.io/delonix/", install: "The delonix 0.2.0 binary from its official releases. Grading runs only delonix manifest render and delonix compose config, which read your files and never touch the engine.", repo: official("delonix") },
  { id: "docker", name: "Docker", icon: "🐳", category: "tool", docs: "https://docs.docker.com/", install: "Docker Engine.", repo: official("docker") },
  { id: "podman", name: "Podman", icon: "🦭", category: "tool", docs: "https://docs.podman.io/", install: "Podman, rootless.", repo: official("podman") },
  { id: "kubernetes", name: "Kubernetes", icon: "☸️", category: "tool", docs: "https://kubernetes.io/docs/", install: "kubectl (https://kubernetes.io/docs/tasks/tools/), for the Kustomize units. No cluster: grading is offline and never reads your kubeconfig. Running the manifests on kind with rootless Podman is a later part.", repo: official("kubernetes") },
  { id: "odoo", name: "Odoo", icon: "🟪", category: "framework", docs: "https://www.odoo.com/documentation/", install: "Odoo 18 to 20, Community edition, with PostgreSQL. Enterprise only with an Odoo licence.", repo: official("odoo") },
];

/** O framework/ferramenta conhecido por `id`: do catálogo, senão do manifesto de um plugin. */
export function findSubject(id: string, plugins: readonly PluginRow[]): Subject | null {
  return FRAMEWORK_CATALOG.find(f => f.id === id) ?? plugins.find(p => p.subject?.id === id)?.subject ?? null;
}

/**
 * Os cartões da secção «Frameworks & tools»: o catálogo oficial pela ordem, «available» quando
 * há curso para o subject e «soon» quando não; depois os que só existem por plugins da
 * comunidade com curso. `courses` está indexado pela chave do percurso (`trackKey`).
 */
export function subjectCards(courses: Readonly<Record<string, Course>>, plugins: readonly PluginRow[]): SubjectCard[] {
  const card = (subject: Subject, community: boolean): SubjectCard => {
    const c = courses[subject.id];
    const ok = !!c && c.category !== "language";
    return { subject, state: ok ? "available" : "soon", summary: ok ? c.summary : "", community };
  };
  const out = FRAMEWORK_CATALOG.map(f => card(f, false));
  const seen = new Set(FRAMEWORK_CATALOG.map(f => f.id));
  for (const p of plugins) {
    const sub = p.subject;
    if (!sub || seen.has(sub.id) || !courses[sub.id] || courses[sub.id].category === "language") continue;
    seen.add(sub.id);
    out.push(card(sub, true));
  }
  return out;
}

/** A chave do percurso de um curso: o subject de um framework/ferramenta, senão a linguagem. */
export function trackKey(c: { category: Category; subject: string; language: string }): string {
  return c.category === "language" ? c.language : c.subject;
}
