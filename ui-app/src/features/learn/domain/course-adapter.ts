/* Conversão dos DTOs do backend para a forma que o motor do Learning Track lê. PURO.
   O backend fala camelCase (`lineComments`, `placeholderPolicy`); os JSON embutidos, que o
   motor sempre leu, usam snake_case. Converter aqui mantém o motor intocado. Os tipos de
   entrada são estruturais (não importam o cliente IPC), para o domínio não conhecer a borda. */

import type { Course, Language, PluginRow, Step, Unit } from "./types";
import { indentText } from "./catalog";

interface StepIn {
  kind: Step["kind"]; id: string; title: string; points: number; intro: string; difficulty: number;
  body: string; prompt: string; target: string; explanation: string; lineComments: string[];
  placeholderPolicy: string; instructions: string; entry: string; starter: string;
}
interface UnitIn { id: string; title: string; intro: string; concepts: string; difficulty: number; level: string; steps: StepIn[] }
export interface CourseIn { id: string; title: string; summary: string; overview: string; units: UnitIn[] }

const step = (s: StepIn): Step => ({
  kind: s.kind, id: s.id, title: s.title, points: s.points, intro: s.intro, difficulty: s.difficulty,
  body: s.body, prompt: s.prompt, target: s.target, explanation: s.explanation,
  line_comments: s.lineComments, placeholder_policy: s.placeholderPolicy,
  instructions: s.instructions, entry: s.entry, starter: s.starter,
});

const unit = (u: UnitIn): Unit => ({
  id: u.id, title: u.title, intro: u.intro, concepts: u.concepts || "", difficulty: u.difficulty,
  level: u.level, steps: u.steps.map(step),
});

export function fromCourseDto(c: CourseIn): Course {
  return { id: c.id, title: c.title, summary: c.summary, overview: c.overview || "", units: c.units.map(unit), origin: "backend" };
}

/** Um curso embutido (JSON antigo, sem `overview`/`concepts`) na forma do domínio. */
export function fromEmbedded(raw: { id: string; title: string; summary: string; overview?: string; units: Array<Omit<Unit, "concepts"> & { concepts?: string }> }): Course {
  return {
    id: raw.id, title: raw.title, summary: raw.summary, overview: raw.overview || "",
    units: raw.units.map(u => ({ ...u, concepts: u.concepts || "" })), origin: "embedded",
  };
}

interface LanguageIn { id: string; name: string; icon: string; extension: string; indent: string }
interface InstalledIn { entry: { id: string; name: string; version: string; source: string }; manifest: { language: LanguageIn } | null; error: string | null }

export function toLanguage(l: LanguageIn): Language {
  return { id: l.id, name: l.name, icon: l.icon || "📘", extension: l.extension, indent: indentText(l.indent) };
}

export function toPluginRow(p: InstalledIn): PluginRow {
  return {
    id: p.entry.id, name: p.entry.name, version: p.entry.version, source: p.entry.source,
    language: p.manifest ? toLanguage(p.manifest.language) : null, error: p.error,
  };
}
