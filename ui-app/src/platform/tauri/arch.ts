/* ═════════ dxtutor IDE — cliente IPC do Studio de arquitectura ═════════
   Contratos de `commands/agent.rs` (arch_validate / arch_scaffold_preview / arch_scaffold)
   sobre o modelo `tutor_eval::arch`. A validação e o scaffold são SEMPRE do backend: o
   cliente só desenha. `arch_scaffold` ESCREVE no disco (nunca sobrepõe) e só é chamado
   depois de confirmação explícita do humano.

   O modelo tem dois tipos de desenho: o de eventos (os seis primeiros Kind, `relation` e
   `event`) e o de sistema (os restantes Kind, `groups`, `views`, `protocol`/`style`/
   `label` nas setas). Os campos do de sistema são opcionais: um desenho antigo continua
   válido tal como estava. */

import { invoke } from "./core";

export type ArchEventKindDto = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";
export type ArchSystemKindDto =
  | "cli" | "process" | "daemon" | "runtime" | "socket" | "state"
  | "kernel" | "external" | "client" | "worker" | "port" | "adapter";
export type ArchKindDto = ArchEventKindDto | ArchSystemKindDto;
export type ArchRelationDto = "writes" | "reads" | "publishes" | "consumes" | "routes-to";
export type ArchProtocolDto = "grpc" | "http" | "unix-socket" | "fork-exec" | "syscall" | "fs" | "ssh" | "event";
export type ArchEdgeStyleDto = "control" | "data" | "optional";
export type ArchGroupKindDto = "host" | "plane" | "node" | "module" | "layer" | "boundary";

export interface ArchComponentDto {
  id: string;
  name: string;
  kind: ArchKindDto;
  outbox: boolean;
  group?: string;
  /** Mini-bloco de código por baixo do nome. */
  code?: string;
  /** Onde o elemento foi confirmado no código. */
  source?: string;
}

export interface ArchConnectionDto {
  from: string;
  to: string;
  /** Só no desenho de eventos. */
  relation?: ArchRelationDto;
  event: string;
  label?: string;
  protocol?: ArchProtocolDto;
  style?: ArchEdgeStyleDto;
  source?: string;
}

export interface ArchGroupDto {
  id: string;
  label: string;
  kind: ArchGroupKindDto;
  parent?: string;
  style?: "dashed" | "solid";
  source?: string;
}

export interface ArchViewDto {
  id: string;
  title: string;
  color?: string;
  roots?: string[];
  daemonless?: boolean;
  strict?: boolean;
}

export interface ArchitectureDto {
  components: ArchComponentDto[];
  connections: ArchConnectionDto[];
  groups?: ArchGroupDto[];
  views?: ArchViewDto[];
}

export interface ArchFindingDto {
  severity: "error" | "warning";
  rule: string;
  message: string;
  /** O componente, grupo ou raiz a que o achado se refere (vazio quando é global). */
  component: string;
}

export const archValidate = (arch: ArchitectureDto): Promise<ArchFindingDto[]> =>
  invoke<ArchFindingDto[]>("arch_validate", { arch });

export const archScaffoldPreview = (arch: ArchitectureDto): Promise<[string, string][]> =>
  invoke<[string, string][]>("arch_scaffold_preview", { arch });

export const archScaffold = (root: string, arch: ArchitectureDto): Promise<string[]> =>
  invoke<string[]>("arch_scaffold", { root, arch });
