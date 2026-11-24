/* Casos de uso do catálogo de cursos: carregar os cursos (embutidos + backend), instalar e
   remover plugins, avaliar um desafio. Deps injectadas por argumento; sem DOM, sem window. */

import type { Course, PluginRow } from "../domain/types";
import type { CourseGateway, Grade, InstallResult } from "./ports";

export interface CatalogState {
  plugins: PluginRow[];
  courses: Record<string, Course>;
  /** Erros não fatais ao carregar (um curso que não abriu, por exemplo). */
  problems: string[];
}

/**
 * Junta os cursos embutidos aos do backend. Para uma linguagem com os dois, o embutido ganha
 * (o comportamento de sempre de Rust/Go: o protótipo traz os testes e simula a avaliação),
 * EXCEPTO quando um plugin instalado traz essa linguagem: aí o plugin é conteúdo mais recente
 * (ex. `dxtutor-courses/rust` substitui o curso Rust embutido) e o backend serve-o.
 */
export async function loadCatalog(gw: CourseGateway, embedded: Readonly<Record<string, Course>>): Promise<CatalogState> {
  const courses: Record<string, Course> = { ...embedded };
  if (!gw.available()) return { plugins: [], courses, problems: [] };
  const problems: string[] = [];
  const [plugins, langs] = await Promise.all([
    gw.listPlugins().catch((e: unknown) => { problems.push(`plugins: ${msg(e)}`); return [] as PluginRow[]; }),
    gw.courseLanguages().catch((e: unknown) => { problems.push(`courses: ${msg(e)}`); return [] as string[]; }),
  ]);
  const fromPlugin = new Set(plugins.flatMap(p => (p.language && !p.error ? [p.language.id] : [])));
  for (const lang of langs) {
    if (courses[lang] && !fromPlugin.has(lang)) continue;
    try {
      courses[lang] = await gw.getCourse(lang);
    } catch (e) {
      problems.push(`${lang}: ${msg(e)}`);
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

export async function gradeStep(gw: CourseGateway, stepId: string, code: string, language: string): Promise<Grade> {
  if (!gw.available()) throw new Error("Grading runs in the desktop app.");
  return gw.submitStep(stepId, code, language);
}

export function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
