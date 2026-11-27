/* Caso de uso «cluster de prática» (Learn P3b): os passos ao vivo de um curso de Kubernetes
   correm num cluster kind sobre Podman sem root, só do curso. Começa sozinho quando se avalia um
   passo ao vivo; aqui estão as duas acções explícitas — «Start practice cluster» e «Delete
   cluster» —, cada uma com o comando EXACTO (construído no backend) no diálogo partilhado. O
   backend corre só esse comando e audita antes e com o resultado; uma recusa vai para o registo
   daqui. Deps injectadas; sem DOM, sem window. */

import type { ClusterState } from "../domain/types";
import type { AuditPort, CourseGateway, HumanPort } from "./ports";

export type ClusterAction = "start" | "delete";

export type ClusterOutcome =
  | { kind: "refused" }
  | { kind: "done"; state: ClusterState }
  | { kind: "unavailable"; state: ClusterState };

export interface ClusterDeps {
  gw: CourseGateway;
  human: HumanPort;
  audit: AuditPort;
  /** O título do diálogo, por acção (o texto é da composição: o caso de uso não traduz). */
  title: (action: ClusterAction) => string;
}

/** O prefixo com que o backend diz que esta máquina não corre o cluster de prática. */
export const LIVE_UNAVAILABLE = "LIVE_UNAVAILABLE";

/** A mensagem de erro de uma avaliação diz que o cluster não pode correr aqui? */
export const isLiveUnavailable = (message: string): boolean => message.includes(LIVE_UNAVAILABLE);

/** O cluster pode correr nesta máquina e o curso está preparado? */
export const canRunCluster = (st: ClusterState | null | undefined): boolean => !!st && st.live && st.prepared && st.support.ok;

/** MiB para mostrar (`612 MiB`), ou vazio. */
export const memoryMiB = (bytes: number | null | undefined): string => (bytes && bytes > 0 ? `${Math.round(bytes / (1024 * 1024))} MiB` : "");

/** Pede a acção: estado → aprovação (o comando exacto) → corre no backend. */
export async function runClusterAction(deps: ClusterDeps, courseId: string, action: ClusterAction): Promise<ClusterOutcome> {
  const { gw, human, audit, title } = deps;
  const st = await gw.clusterStatus(courseId);
  if (action === "start" && !canRunCluster(st)) return { kind: "unavailable", state: st };
  const command = action === "start" ? st.startCommand : st.deleteCommand;
  const scope = `course ${courseId} · ${st.dir}`;
  const d = await human.approve({ title: title(action), command, scope });
  if (!d.approved) {
    await audit
      .record(st.dir, { feature: "learn", action: `cluster.${action}`, command, scope, approved: false, reason: d.reason || undefined, decidedAt: d.decidedAt })
      .catch(() => undefined);
    return { kind: "refused" };
  }
  const state = await gw.clusterAction(courseId, action, { command, reason: d.reason, decidedAt: d.decidedAt });
  return { kind: "done", state };
}
