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
  /** Verifica-se ao vivo no cluster de prática (Learn P3b); ausente nos outros passos. */
  live?: boolean;
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
  /** Compila contra dependências preparadas uma vez (`[build] prepare`): ver `course_prepare_status`. */
  prepare?: boolean;
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

/** Um pacote que a preparação de um curso descarrega: nome, versão (ou requisito/ref git) e origem. */
export interface CoursePackageDto {
  name: string;
  version: string;
  source: string;
  /** A versão é exacta (pip sempre; cargo com `=x.y.z`, tag ou commit). */
  pinned: boolean;
}

/** Estado da preparação de um curso que se avalia offline contra uma cache (`course_prepare_status`). */
export interface CoursePrepareDto {
  needed: boolean;
  state: "not-needed" | "missing" | "stale" | "ready";
  /** Os comandos exactos a aprovar (construídos no backend). */
  command: string;
  /** O que a preparação faz: `cargo`, `pip`, `images`, `cluster`, ou `container` (construir a imagem do
   *  devcontainer do curso, ADR-0008); vazio sem nada a preparar. */
  kind: "cargo" | "pip" | "images" | "cluster" | "container" | "";
  /** Os pacotes que a preparação descarrega (o diálogo de aprovação lista-os). */
  packages: CoursePackageDto[];
  /** A pasta da cache do curso. */
  dir: string;
  timeoutSecs: number;
  preparedAt: number | null;
  fetchSecs: number | null;
  warmSecs: number | null;
}

/** A decisão do diálogo de aprovação: o comando que se viu e o motivo. */
export interface PrepareDecisionDto {
  command: string;
  reason?: string;
  decidedAt?: number;
}

export interface CoursePreparedDto {
  ok: boolean;
  output: string;
  status: CoursePrepareDto;
}

/** O cluster de prática de um curso de Kubernetes (`learn_cluster_status`, Learn P3b). */
export interface ClusterDto {
  live: boolean;
  prepared: boolean;
  support: { ok: boolean; podman: string | null; reason: string | null; fix: string | null };
  status: {
    name: string;
    prepared: boolean;
    exists: boolean;
    running: boolean;
    createdAt: number | null;
    lastUsed: number | null;
    createSecs: number | null;
    memoryBytes: number | null;
    idleDeadline: number | null;
  } | null;
  startCommand: string;
  deleteCommand: string;
  dir: string;
  idleMinutes: number;
}

export const learnClusterStatus = (courseId: string): Promise<ClusterDto> => invoke<ClusterDto>("learn_cluster_status", { courseId });
/** Cria (ou reutiliza) o cluster de prática com os comandos aprovados; o backend audita antes e depois. */
export const learnClusterStart = (courseId: string, decision: PrepareDecisionDto): Promise<ClusterDto> =>
  invoke<ClusterDto>("learn_cluster_start", { courseId, decision });
/** Apaga o cluster de prática (as imagens preparadas ficam); o backend audita antes e depois. */
export const learnClusterDelete = (courseId: string, decision: PrepareDecisionDto): Promise<ClusterDto> =>
  invoke<ClusterDto>("learn_cluster_delete", { courseId, decision });

export const coursePrepareStatus = (courseId: string): Promise<CoursePrepareDto> =>
  invoke<CoursePrepareDto>("course_prepare_status", { courseId });
/** Descarrega (rede) e compila uma vez as dependências do curso; o backend audita antes e depois. */
export const coursePrepare = (courseId: string, decision: PrepareDecisionDto): Promise<CoursePreparedDto> =>
  invoke<CoursePreparedDto>("course_prepare", { courseId, decision });
