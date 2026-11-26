/* Portas do Learning Track: o que os casos de uso precisam do mundo exterior. Os adaptadores
   vivem em infrastructure/ (hoje sobre os comandos Tauri `plugin_*`/`get_course`/`submit_step`). */

import type { Category, Course, PluginRow, PrepareStatus } from "../domain/types";

export interface InstallResult {
  id: string;
  version: string;
  /** O nome do que o plugin ensina: a linguagem, ou o framework/ferramenta. */
  languageName: string;
  /** Versão anterior quando foi uma actualização. */
  replaced: string | null;
  warnings: string[];
}

export interface Grade {
  passed: boolean;
  summary: string;
  /** Saída crua dos testes (para mostrar quando falha). */
  raw: string;
  /** `files`: a solução de um passo de projecto (caminho → conteúdo). */
  gabarito: { solution: string; time: string; space: string; justification: string; files?: Record<string, string> } | null;
}

/** Um curso que o backend serve, resumido ao que o catálogo precisa para o carregar. */
export interface CourseSummary {
  id: string;
  language: string;
  category: Category;
  subject: string;
}

/** Plugins de curso + cursos servidos pelo backend. */
export interface CourseGateway {
  /** Falso no protótipo de browser: não há backend, só os cursos embutidos. */
  available(): boolean;
  listPlugins(): Promise<PluginRow[]>;
  install(source: string): Promise<InstallResult>;
  remove(id: string): Promise<void>;
  /** Os cursos do backend (embutidos no binário + plugins). */
  listCourses(): Promise<CourseSummary[]>;
  /** O curso da linguagem, ou, com `subject`, o desse framework/ferramenta. */
  getCourse(language: string, subject?: string): Promise<Course>;
  /** Avaliação honesta de um desafio pelos testes ocultos (backend), nos cursos de `language`
   *  (a linguagem em que o passo se avalia). `files`: os ficheiros editáveis de um projecto. */
  submitStep(stepId: string, code: string, language: string, files?: Record<string, string>): Promise<Grade>;
  /** Se o curso (pelo id) se prepara uma vez antes de avaliar, em que estado está, e os comandos
   *  exactos que a preparação corre (construídos no backend). */
  prepareStatus(courseId: string): Promise<PrepareStatus>;
  /** Prepara o curso com os comandos que o humano aprovou: a ÚNICA ida à rede do Learning Track.
   *  O backend recusa um comando que não seja o plano actual e audita antes e com o resultado. */
  prepare(courseId: string, decision: PrepareDecision): Promise<PrepareResult>;
}

/** A decisão do diálogo de aprovação partilhado. */
export interface PrepareDecision {
  command: string;
  reason: string;
  decidedAt: number;
}

export interface PrepareResult {
  ok: boolean;
  /** As últimas linhas da saída (para mostrar quando falha). */
  output: string;
  status: PrepareStatus;
}

/** O pedido ao diálogo de aprovação partilhado (a mesma forma de `app/approval.ts`). */
export interface ApprovalRequest {
  title: string;
  command: string;
  scope?: string;
}

/** O humano decide; nada corre sem ele (ligado a `requestApproval` na composição). */
export interface HumanPort {
  approve(req: ApprovalRequest): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
}

/** O registo de auditoria (`audit_record`): aqui só para a recusa — o backend audita o que corre. */
export interface AuditPort {
  record(root: string, entry: { feature: string; action: string; command: string; scope?: string; approved: boolean; reason?: string; decidedAt?: number }): Promise<void>;
}
