/* Caso de uso «preparar um curso» (Learn P1): um curso que compila contra dependências de fora
   (Seiva) avalia-se SEMPRE offline, contra uma cache do curso. A única ida à rede é esta acção
   explícita: o backend constrói os comandos, o humano aprova-os no diálogo partilhado, e o backend
   corre exactamente esses e audita antes e com o resultado. Uma recusa vai para o registo daqui.
   Deps injectadas; sem DOM, sem window. */

import type { CoursePackage, PrepareStatus } from "../domain/types";
import type { AuditPort, CourseGateway, HumanPort } from "./ports";

/** O que aconteceu ao pedir a preparação. */
export type PrepareOutcome =
  | { kind: "ready"; status: PrepareStatus }
  | { kind: "refused" }
  | { kind: "prepared"; status: PrepareStatus }
  | { kind: "failed"; output: string; status: PrepareStatus };

export interface PrepareDeps {
  gw: CourseGateway;
  human: HumanPort;
  audit: AuditPort;
  /** O título do diálogo (o texto é da composição: o caso de uso não traduz). */
  title: string;
  /** O título e a nota da lista de pacotes no diálogo, pelo gestor de pacotes (textos da composição). */
  packagesText?: (kind: PrepareStatus["kind"]) => { heading: string; note: string };
}

/** Uma linha por pacote para o diálogo: `Django 5.2.19 · PyPI`, `tokio 1 · crates.io`. */
export const packageLines = (packages: readonly CoursePackage[]): string[] =>
  packages.map(p => [p.name, p.version].filter(Boolean).join(" ") + (p.source ? ` · ${p.source}` : ""));

/** O prefixo com que o backend recusa avaliar um curso por preparar. */
export const NOT_PREPARED = "COURSE_NOT_PREPARED";

/** A mensagem de erro de uma avaliação diz que o curso não está preparado? */
export const isNotPrepared = (message: string): boolean => message.includes(NOT_PREPARED);

/** O curso precisa de ser preparado antes de se poder avaliar? */
export const needsPreparing = (st: PrepareStatus | null | undefined): boolean => !!st && st.needed && st.state !== "ready";

/** Pede a preparação do curso `courseId`: estado → aprovação (com o comando exacto) → corre. */
export async function prepareCourse(deps: PrepareDeps, courseId: string): Promise<PrepareOutcome> {
  const { gw, human, audit, title, packagesText } = deps;
  const st = await gw.prepareStatus(courseId);
  if (!needsPreparing(st)) return { kind: "ready", status: st };
  const scope = `course ${courseId} · ${st.dir}`;
  const text = packagesText?.(st.kind);
  const list = text && st.packages.length ? { heading: text.heading, items: packageLines(st.packages), note: text.note } : undefined;
  const d = await human.approve(list ? { title, command: st.command, scope, list } : { title, command: st.command, scope });
  if (!d.approved) {
    await audit
      .record(st.dir, { feature: "learn", action: "course.prepare", command: st.command, scope, approved: false, reason: d.reason || undefined, decidedAt: d.decidedAt })
      .catch(() => undefined);
    return { kind: "refused" };
  }
  const r = await gw.prepare(courseId, { command: st.command, reason: d.reason, decidedAt: d.decidedAt });
  return r.ok ? { kind: "prepared", status: r.status } : { kind: "failed", output: r.output, status: r.status };
}
