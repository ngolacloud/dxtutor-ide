/* Adaptador da porta CourseGateway sobre os comandos Tauri (platform/tauri/learn.ts). É o
   ÚNICO ficheiro da subárvore features/learn/ que pode tocar no mundo exterior (A8). */

import { isDesktop } from "../../../platform/tauri/core";
import * as ipc from "../../../platform/tauri/learn";
import type { CourseGateway } from "../application/ports";
import { fromCourseDto, toPluginRow } from "../domain/course-adapter";

export const tauriCourseGateway: CourseGateway = {
  available: () => isDesktop(),
  listPlugins: async () => (await ipc.pluginList()).map(toPluginRow),
  install: async (source) => {
    const o = await ipc.pluginInstall(source);
    return { id: o.entry.id, version: o.entry.version, languageName: o.language.name, replaced: o.replaced, warnings: o.warnings };
  },
  remove: async (id) => { await ipc.pluginRemove(id); },
  courseLanguages: async () => [...new Set((await ipc.listCourses()).map(c => c.language))],
  getCourse: async (language) => fromCourseDto(await ipc.getCourse(language)),
  submitStep: async (stepId, code, language) => {
    const a = await ipc.submitStep(stepId, code, language);
    return { passed: a.correctness.passed, summary: a.correctness.summary, raw: a.correctness.raw, gabarito: a.gabarito };
  },
};
