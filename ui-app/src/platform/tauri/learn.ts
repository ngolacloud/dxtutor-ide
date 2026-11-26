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

/** `language` (o omisso), `framework` ou `tool` (ADR-0005, emenda de 2026-11-26). */
export type CourseCategory = "language" | "framework" | "tool";

/** O framework/ferramenta que um plugin de `framework`/`tool` ensina. */
export interface PluginSubject {
  id: string;
  name: string;
  icon: string;
  /** URL https:// da documentação oficial (pode ser vazio). */
  docs: string;
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
  /** Ausente num plugin de linguagem (o backend omite-o). */
  category?: CourseCategory;
  subject?: PluginSubject;
  /** Num plugin de framework/ferramenta, a linguagem em que os exercícios se escrevem e avaliam. */
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
  category: CourseCategory;
  subject: PluginSubject | null;
  courseIds: string[];
  replaced: string | null;
  warnings: string[];
  /** Informação, não defeitos (ex.: o plugin substitui o curso embutido com o mesmo id). */
  notes: string[];
}

export interface CourseSummaryDto {
  id: string;
  language: string;
  category: CourseCategory;
  /** O framework/ferramenta ensinado; vazio num curso de linguagem. */
  subject: string;
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
  /** Passo de projecto (vários ficheiros): os iniciais, o principal e os só de leitura. Os testes
   *  ocultos e a solução nunca vêm. Ausente nos outros passos. */
  project?: StepProjectDto;
}

export interface StepProjectDto {
  main: string;
  /** caminho relativo → conteúdo inicial */
  files: Record<string, string>;
  readonly: string[];
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
  category: CourseCategory;
  subject: string;
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
  /** `files`: a solução de um passo de projecto (só depois de passar). */
  gabarito: { solution: string; time: string; space: string; justification: string; files?: Record<string, string> } | null;
}

export const pluginList = (): Promise<InstalledPlugin[]> => invoke<InstalledPlugin[]>("plugin_list");
export const pluginInstall = (source: string): Promise<InstallOutcome> => invoke<InstallOutcome>("plugin_install", { source });
export const pluginRemove = (id: string): Promise<string> => invoke<string>("plugin_remove", { id });
export const listCourses = (): Promise<CourseSummaryDto[]> => invoke<CourseSummaryDto[]>("list_courses");
/** `subject`: o curso desse framework/ferramenta em vez do curso da linguagem. */
export const getCourse = (language: string, subject?: string): Promise<CourseDto> =>
  invoke<CourseDto>("get_course", subject ? { language, subject } : { language });
/** `files`: os ficheiros editáveis de um passo de projecto (caminho → conteúdo). */
export const submitStep = (stepId: string, code: string, language: string, files?: Record<string, string>): Promise<StepAssessment> =>
  invoke<StepAssessment>("submit_step", files ? { stepId, code, language, files } : { stepId, code, language });
