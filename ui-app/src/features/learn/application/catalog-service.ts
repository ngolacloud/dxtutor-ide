/* Casos de uso do catálogo de cursos: carregar os cursos (embutidos + backend), instalar e
   remover plugins, avaliar um desafio. Deps injectadas por argumento; sem DOM, sem window. */

import type { Course, PluginRow } from "../domain/types";
import type { CourseGateway, CourseSummary, Grade, InstallResult } from "./ports";
import { trackKey } from "../domain/catalog";

export interface CatalogState {
  plugins: PluginRow[];
  /** Indexado pela chave do percurso: a linguagem, ou o subject de um framework/ferramenta. */
  courses: Record<string, Course>;
  /** Erros não fatais ao carregar (um curso que não abriu, por exemplo). */
  problems: string[];
}

/**
 * Junta os cursos embutidos aos do backend. Para uma linguagem com os dois, o embutido ganha
 * (o comportamento de sempre de Rust/Go: o protótipo traz os testes e simula a avaliação),
 * EXCEPTO quando um plugin instalado traz essa linguagem: aí o plugin é conteúdo mais recente
 * (ex. `ngolacloud/dxtutor-course-rust` substitui o curso Rust embutido) e o backend serve-o.
 * Os cursos de framework/ferramenta indexam-se pelo `subject` (nunca há embutido); um subject
 * que coincida com uma linguagem é recusado (seria o mesmo cartão) e fica nos problemas.
 */
export async function loadCatalog(gw: CourseGateway, embedded: Readonly<Record<string, Course>>): Promise<CatalogState> {
  const courses: Record<string, Course> = { ...embedded };
  if (!gw.available()) return { plugins: [], courses, problems: [] };
  const problems: string[] = [];
  const [plugins, list] = await Promise.all([
    gw.listPlugins().catch((e: unknown) => { problems.push(`plugins: ${msg(e)}`); return [] as PluginRow[]; }),
    gw.listCourses().catch((e: unknown) => { problems.push(`courses: ${msg(e)}`); return [] as CourseSummary[]; }),
  ]);
  const fromPlugin = new Set(plugins.flatMap(p => (p.language && !p.subject && !p.error ? [p.language.id] : [])));
  /* Uma entrada por percurso (o backend pode ter mais de um curso por chave: vale o 1.º, o
     mesmo que o `get_course` devolve). As linguagens primeiro, para um subject que choque
     com uma linguagem perder. */
  const tracks = new Map<string, CourseSummary>();
  for (const c of [...list.filter(c => c.category === "language"), ...list.filter(c => c.category !== "language")]) {
    const key = trackKey(c);
    if (!key) continue;
    const prev = tracks.get(key);
    if (prev && prev.category !== c.category) problems.push(`${c.id}: \`${key}\` is already a language track`);
    if (!prev) tracks.set(key, c);
  }
  for (const [key, c] of tracks) {
    const isLang = c.category === "language";
    if (isLang && courses[key] && !fromPlugin.has(key)) continue;
    if (!isLang && courses[key]) { problems.push(`${c.id}: \`${key}\` is already a language track`); continue; }
    try {
      courses[key] = isLang ? await gw.getCourse(c.language) : await gw.getCourse(c.language, c.subject);
    } catch (e) {
      problems.push(`${key}: ${msg(e)}`);
    }
  }
  for (const p of plugins) if (p.error) problems.push(`${p.id}: ${p.error}`);
  return { plugins, courses, problems };
}

export async function installPlugin(gw: CourseGateway, source: string): Promise<InstallResult> {
  const s = source.trim();
  if (!s) throw new Error("Type a plugin source: a language, owner/repo, or a GitHub URL.");
  if (!gw.available()) throw new Error("Plugins install in the desktop app.");
  return gw.install(s);
}

export async function removePlugin(gw: CourseGateway, id: string): Promise<void> {
  if (!gw.available()) throw new Error("Plugins are managed in the desktop app.");
  await gw.remove(id);
}

export async function gradeStep(gw: CourseGateway, stepId: string, code: string, language: string, files?: Record<string, string>): Promise<Grade> {
  if (!gw.available()) throw new Error("Grading runs in the desktop app.");
  return gw.submitStep(stepId, code, language, files);
}

export function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
