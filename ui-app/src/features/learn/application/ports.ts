/* Portas do Learning Track: o que os casos de uso precisam do mundo exterior. Os adaptadores
   vivem em infrastructure/ (hoje sobre os comandos Tauri `plugin_*`/`get_course`/`submit_step`). */

import type { Course, PluginRow } from "../domain/types";

export interface InstallResult {
  id: string;
  version: string;
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
  gabarito: { solution: string; time: string; space: string; justification: string } | null;
}

/** Plugins de curso + cursos servidos pelo backend. */
export interface CourseGateway {
  /** Falso no protótipo de browser: não há backend, só os cursos embutidos. */
  available(): boolean;
  listPlugins(): Promise<PluginRow[]>;
  install(source: string): Promise<InstallResult>;
  remove(id: string): Promise<void>;
  /** Linguagens com curso no backend (embutidas no binário + plugins). */
  courseLanguages(): Promise<string[]>;
  getCourse(language: string): Promise<Course>;
  /** Avaliação honesta de um desafio pelos testes ocultos (backend), nos cursos de `language`. */
  submitStep(stepId: string, code: string, language: string): Promise<Grade>;
}
