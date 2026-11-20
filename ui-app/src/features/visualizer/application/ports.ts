/* ═══════════ feature `visualizer` — portas da aplicação (ADR-0002, Fase 3) ═══════════
   As capacidades que o caso de uso recebe INJECTADAS por argumento (deps), para ficar
   puro e testável: correr o programa (`run` = interpretador do domínio), narrar um
   evento (`narrate` = narração do domínio) e reiniciar o dedup de insights por corrida
   (`resetSeen` = VZSEEN.clear). Sem DOM/window — o domínio satisfaz todas (não há porta
   de infraestrutura: o motor é puro). */

import type { VzEvent, VzNote, VzRunResult } from "../domain/types";

export interface VisualizePorts {
  run(src: string): VzRunResult;
  narrate(e: VzEvent, depth: string): VzNote | null;
  resetSeen(): void;
}
