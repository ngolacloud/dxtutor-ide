/* Adaptador da porta CourseGateway sobre os comandos Tauri (platform/tauri/learn.ts). É o
   ÚNICO ficheiro da subárvore features/learn/ que pode tocar no mundo exterior (A8). */

import { isDesktop } from "../../../platform/tauri/core";
import * as ipc from "../../../platform/tauri/learn";
import { auditClient } from "../../../platform/tauri/audit";
import type { AuditPort, CourseGateway } from "../application/ports";
import type { PrepareStatus } from "../domain/types";
import { fromCourseDto, toPluginRow } from "../domain/course-adapter";

export const tauriCourseGateway: CourseGateway = {
  available: () => isDesktop(),
  listPlugins: async () => (await ipc.pluginList()).map(toPluginRow),
  install: async (source) => {
    const o = await ipc.pluginInstall(source);
    return { id: o.entry.id, version: o.entry.version, languageName: o.subject ? o.subject.name : o.language.name, replaced: o.replaced, warnings: o.warnings };
  },
  remove: async (id) => { await ipc.pluginRemove(id); },
  listCourses: async () => (await ipc.listCourses()).map(c => ({ id: c.id, language: c.language, category: c.category ?? "language", subject: c.subject ?? "" })),
  getCourse: async (language, subject) => fromCourseDto(await ipc.getCourse(language, subject)),
  submitStep: async (stepId, code, language, files) => {
    const a = await ipc.submitStep(stepId, code, language, files);
    return { passed: a.correctness.passed, summary: a.correctness.summary, raw: a.correctness.raw, gabarito: a.gabarito };
  },
  prepareStatus: async (courseId) => prepareStatus(await ipc.coursePrepareStatus(courseId)),
  prepare: async (courseId, decision) => {
    const r = await ipc.coursePrepare(courseId, decision);
    return { ok: r.ok, output: r.output, status: prepareStatus(r.status) };
  },
};

const prepareStatus = (s: ipc.CoursePrepareDto): PrepareStatus => ({
  needed: s.needed, state: s.state, command: s.command, kind: s.kind ?? "", packages: s.packages ?? [], dir: s.dir, timeoutSecs: s.timeoutSecs, fetchSecs: s.fetchSecs, warmSecs: s.warmSecs,
});

/** O registo de auditoria das operações do IDE (`audit_record`). */
export const tauriLearnAudit: AuditPort = {
  record: (root, entry) => auditClient().record(root, entry),
};
