/* ═════════ dxtutor IDE — cliente IPC do Learning Track e dos plugins de curso ═════════
   Contratos de `commands/plugins.rs` (plugin_list/plugin_install/plugin_remove) e dos
   comandos de curso de `commands/study.rs` (list_courses/get_course/submit_step). Os DTOs
   são camelCase (serde `rename_all`); os testes ocultos e o gabarito NÃO vêm para o
   webview — a avaliação é do backend. */

import { invoke } from "./core";

export interface PluginLanguage {
  id: string;
  name: string;
  icon: string;
  extension: string;
  /** `"tab"` ou um número de espaços (`"4"`). */
  indent: string;
  testCommand: string;
}

export interface PluginManifest {
  schema: number;
  id: string;
  name: string;
  version: string;
  description: string;
  authors: string[];
  license: string;
  repository: string;
  engine: string;
  kind: string;
  language: PluginLanguage;
  courses: string[];
}

export interface PluginEntry {
  id: string;
  name: string;
  version: string;
  source: string;
  sha256: string | null;
  installedAt: number;
}

export interface InstalledPlugin {
  entry: PluginEntry;
  manifest: PluginManifest | null;
  error: string | null;
}

export interface InstallOutcome {
  entry: PluginEntry;
  language: PluginLanguage;
  courseIds: string[];
  replaced: string | null;
  warnings: string[];
  /** Informação, não defeitos (ex.: o plugin substitui o curso embutido com o mesmo id). */
  notes: string[];
}

export interface CourseSummaryDto {
  id: string;
  language: string;
  title: string;
  level: string;
  summary: string;
}

export interface StepDto {
  kind: "concept" | "drill" | "challenge";
  id: string;
  title: string;
  points: number;
  intro: string;
  difficulty: number;
  body: string;
  prompt: string;
  target: string;
  explanation: string;
  lineComments: string[];
  placeholderPolicy: string;
  installCommands: string[];
  runCommand: string;
  dependencies: string[];
  instructions: string;
  entry: string;
  starter: string;
}

export interface UnitDto {
  id: string;
  title: string;
  intro: string;
  concepts: string;
  difficulty: number;
  level: string;
  steps: StepDto[];
}

export interface CourseDto {
  id: string;
  language: string;
  title: string;
  level: string;
  summary: string;
  overview: string;
  units: UnitDto[];
}

/** Resultado de `submit_step` (`AssessmentDto`; só os campos que o Learning Track mostra).
 *  O gabarito só vem quando os testes passam. */
export interface StepAssessment {
  correctness: { passed: boolean; summary: string; raw: string };
  gabarito: { solution: string; time: string; space: string; justification: string } | null;
}

export const pluginList = (): Promise<InstalledPlugin[]> => invoke<InstalledPlugin[]>("plugin_list");
export const pluginInstall = (source: string): Promise<InstallOutcome> => invoke<InstallOutcome>("plugin_install", { source });
export const pluginRemove = (id: string): Promise<string> => invoke<string>("plugin_remove", { id });
export const listCourses = (): Promise<CourseSummaryDto[]> => invoke<CourseSummaryDto[]>("list_courses");
export const getCourse = (language: string): Promise<CourseDto> => invoke<CourseDto>("get_course", { language });
export const submitStep = (stepId: string, code: string, language: string): Promise<StepAssessment> => invoke<StepAssessment>("submit_step", { stepId, code, language });
