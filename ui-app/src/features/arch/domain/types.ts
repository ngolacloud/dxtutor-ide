/* ═════════ feature `arch` — tipos do domínio (Studio de arquitectura) ═════════
   Espelho do modelo `tutor_eval::arch` do backend (a fonte de verdade da validação e do
   scaffold) mais a geometria do canvas, que é estado de cliente. PURO: sem DOM, sem
   window, sem Tauri (A7/A8). */

/** Tipos de componente do desenho orientado a eventos. */
export type ArchKind = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";

/** Como dois componentes se ligam. */
export type ArchRelation = "writes" | "reads" | "publishes" | "consumes" | "routes-to";

export interface ArchComponent {
  id: string;
  name: string;
  kind: ArchKind;
  /** Marca uma `store` como tabela de outbox. */
  outbox: boolean;
}

export interface ArchConnection {
  from: string;
  to: string;
  relation: ArchRelation;
  /** Nome do evento/rota (vazio quando não se aplica). */
  event: string;
}

/** O desenho tal como o backend o recebe (sem geometria). */
export interface Architecture {
  components: ArchComponent[];
  connections: ArchConnection[];
}

export interface ArchFinding {
  severity: "error" | "warning";
  rule: string;
  message: string;
  component: string;
}

/** Um componente no canvas: o componente do modelo mais a posição. */
export interface DesignNode extends ArchComponent {
  x: number;
  y: number;
}

/** O desenho do cliente (o que se guarda por raiz). */
export interface Design {
  components: DesignNode[];
  connections: ArchConnection[];
}
