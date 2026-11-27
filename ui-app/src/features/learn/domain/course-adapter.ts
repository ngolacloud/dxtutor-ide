/* Conversão dos DTOs do backend para a forma que o motor do Learning Track lê. PURO.
   O backend fala camelCase (`lineComments`, `placeholderPolicy`); os JSON embutidos, que o
   motor sempre leu, usam snake_case. Converter aqui mantém o motor intocado. Os tipos de
   entrada são estruturais (não importam o cliente IPC), para o domínio não conhecer a borda. */

import type { Category, Course, Language, PluginRow, Step, StepProject, Subject, Unit } from "./types";
import { indentText } from "./catalog";

interface StepIn {
  kind: Step["kind"]; id: string; title: string; points: number; intro: string; difficulty: number;
  body: string; prompt: string; target: string; explanation: string; lineComments: string[];
  placeholderPolicy: string; instructions: string; entry: string; starter: string;
  project?: StepProject;
}
interface UnitIn { id: string; title: string; intro: string; concepts: string; difficulty: number; level: string; steps: StepIn[] }
export interface CourseIn {
  id: string; title: string; summary: string; overview: string; units: UnitIn[];
  /** Ausentes num backend antigo: o curso é então de linguagem. */
  language?: string; category?: Category; subject?: string;
  /** O curso compila contra dependências preparadas uma vez. */
  prepare?: boolean;
}

const step = (s: StepIn): Step => ({
  kind: s.kind, id: s.id, title: s.title, points: s.points, intro: s.intro, difficulty: s.difficulty,
  body: s.body, prompt: s.prompt, target: s.target, explanation: s.explanation,
  line_comments: s.lineComments, placeholder_policy: s.placeholderPolicy,
  instructions: s.instructions, entry: s.entry, starter: s.starter,
  ...(s.project
    ? { project: { main: s.project.main, files: { ...s.project.files }, readonly: [...s.project.readonly], ...(s.project.live ? { live: true } : {}) } }
    : {}),
});

const unit = (u: UnitIn): Unit => ({
  id: u.id, title: u.title, intro: u.intro, concepts: u.concepts || "", difficulty: u.difficulty,
  level: u.level, steps: u.steps.map(step),
});

export function fromCourseDto(c: CourseIn): Course {
  const category = c.category ?? "language";
  return {
    id: c.id, language: c.language ?? "", category, subject: category === "language" ? "" : c.subject ?? "",
    title: c.title, summary: c.summary, overview: c.overview || "", units: c.units.map(unit), origin: "backend",
    ...(c.prepare ? { prepare: true } : {}),
  };
}

/** Um curso embutido (JSON antigo, sem `overview`/`concepts`) na forma do domínio. `language`
 *  é a chave com que o protótipo o embute (o JSON não a traz). */
export function fromEmbedded(raw: { id: string; title: string; summary: string; overview?: string; units: Array<Omit<Unit, "concepts"> & { concepts?: string }> }, language: string): Course {
  return {
    id: raw.id, language, category: "language", subject: "", title: raw.title, summary: raw.summary, overview: raw.overview || "",
    units: raw.units.map(u => ({ ...u, concepts: u.concepts || "" })), origin: "embedded",
  };
}

interface LanguageIn { id: string; name: string; icon: string; extension: string; indent: string }
interface SubjectIn { id: string; name: string; icon: string; docs: string }
interface InstalledIn {
  entry: { id: string; name: string; version: string; source: string };
  manifest: { language: LanguageIn; category?: Category; subject?: SubjectIn } | null;
  error: string | null;
}

export function toLanguage(l: LanguageIn): Language {
  return { id: l.id, name: l.name, icon: l.icon || "📘", extension: l.extension, indent: indentText(l.indent) };
}

/** O subject de um manifesto de framework/ferramenta (`null` num plugin de linguagem). */
export function toSubject(category: Category | undefined, s: SubjectIn | undefined | null): Subject | null {
  if (!s || !category || category === "language") return null;
  return { id: s.id, name: s.name, icon: s.icon || "🧩", category, docs: s.docs || "", install: "", repo: "" };
}

export function toPluginRow(p: InstalledIn): PluginRow {
  return {
    id: p.entry.id, name: p.entry.name, version: p.entry.version, source: p.entry.source,
    language: p.manifest ? toLanguage(p.manifest.language) : null,
    subject: p.manifest ? toSubject(p.manifest.category, p.manifest.subject) : null,
    error: p.error,
  };
}
