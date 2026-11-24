/* ═════════ feature `arch` — tipos do domínio (Studio de arquitectura) ═════════
   Espelho do modelo `tutor_eval::arch` do backend (a fonte de verdade da validação, do
   scaffold e do Mermaid) mais a geometria do canvas, que é estado de cliente. Dois tipos
   de desenho no mesmo modelo: o de eventos (os seis primeiros Kind, `relation`/`event`)
   e o de sistema (os restantes Kind, grupos aninhados, painéis, setas com protocolo e
   estilo). PURO: sem DOM, sem window, sem Tauri (A7/A8). */

export type EventKind = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";
export type SystemKind =
  | "cli" | "process" | "daemon" | "runtime" | "socket" | "state"
  | "kernel" | "external" | "client" | "worker" | "port" | "adapter";
export type ArchKind = EventKind | SystemKind;

/** Como dois componentes do desenho de eventos se ligam. */
export type ArchRelation = "writes" | "reads" | "publishes" | "consumes" | "routes-to";
/** Por onde passa uma seta do diagrama de sistema. */
export type Protocol = "grpc" | "http" | "unix-socket" | "fork-exec" | "syscall" | "fs" | "ssh" | "event";
/** Controlo (cor do painel), dados/pedidos (verde), opcional (cinzento) ou dependência. */
/** `depends` = dependência estática (`a → b`: `a` depende de `b`), não um fluxo em execução. */
export type EdgeStyle = "control" | "data" | "optional" | "depends";
export type GroupKind = "host" | "plane" | "node" | "module" | "layer" | "boundary";
export type GroupStyle = "dashed" | "solid";

export interface ArchComponent {
  id: string;
  name: string;
  kind: ArchKind;
  /** Marca uma `store` como tabela de outbox. */
  outbox: boolean;
  /** O grupo (fronteira) onde vive. */
  group?: string;
  /** Mini-bloco de código por baixo do nome. */
  code?: string;
  /** Onde foi confirmado no código. */
  source?: string;
}

export interface ArchConnection {
  from: string;
  to: string;
  /** Só no desenho de eventos. */
  relation?: ArchRelation;
  /** Nome do evento/rota (vazio quando não se aplica). */
  event: string;
  label?: string;
  protocol?: Protocol;
  style?: EdgeStyle;
  source?: string;
}

export interface ArchGroup {
  id: string;
  label: string;
  kind: GroupKind;
  parent?: string;
  style: GroupStyle;
  source?: string;
}

/** Um painel do modo comparativo. */
export interface ArchView {
  id: string;
  title: string;
  color: string;
  roots: string[];
  daemonless: boolean;
  strict: boolean;
}

/** O desenho tal como o backend o recebe (sem geometria). */
export interface Architecture {
  components: ArchComponent[];
  connections: ArchConnection[];
  groups: ArchGroup[];
  views: ArchView[];
}

export interface ArchFinding {
  severity: "error" | "warning";
  rule: string;
  message: string;
  /** O componente, grupo ou raiz a que se refere (vazio quando é global). */
  component: string;
}

/** Um componente no canvas: o componente do modelo mais a posição. */
export interface DesignNode extends ArchComponent {
  x: number;
  y: number;
}

/** Um grupo no canvas: o grupo do modelo mais o rectângulo guardado (o desenhado cresce
 *  para conter o que lá está dentro). */
export interface DesignGroup extends ArchGroup {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O desenho do cliente (o que se guarda por raiz). */
export interface Design {
  components: DesignNode[];
  connections: ArchConnection[];
  groups: DesignGroup[];
  views: ArchView[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O que está seleccionado no canvas. */
export type Selection =
  | { t: "node"; id: string }
  | { t: "group"; id: string }
  | { t: "edge"; i: number };
