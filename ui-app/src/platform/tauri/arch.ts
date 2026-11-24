/* ═════════ dxtutor IDE — cliente IPC do Studio de arquitectura ═════════
   Contratos de `commands/agent.rs` (arch_validate / arch_scaffold_preview / arch_scaffold)
   sobre o modelo `tutor_eval::arch`. A validação e o scaffold são SEMPRE do backend: o
   cliente só desenha. `arch_scaffold` ESCREVE no disco (nunca sobrepõe) e só é chamado
   depois de confirmação explícita do humano.

   O modelo tem dois tipos de desenho: o de eventos (os seis primeiros Kind, `relation` e
   `event`) e o de sistema (os restantes Kind, `groups`, `views`, `protocol`/`style`/
   `label` nas setas). Os campos do de sistema são opcionais: um desenho antigo continua
   válido tal como estava. */

import { invoke, listen } from "./core";

export type ArchEventKindDto = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";
export type ArchSystemKindDto =
  | "cli" | "process" | "daemon" | "runtime" | "socket" | "state"
  | "kernel" | "external" | "client" | "worker" | "port" | "adapter";
export type ArchKindDto = ArchEventKindDto | ArchSystemKindDto;
export type ArchRelationDto = "writes" | "reads" | "publishes" | "consumes" | "routes-to";
export type ArchProtocolDto = "grpc" | "http" | "unix-socket" | "fork-exec" | "syscall" | "fs" | "ssh" | "event";
export type ArchEdgeStyleDto = "control" | "data" | "optional" | "depends";
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

/** O resultado de importar Mermaid: o modelo e o que não veio tal e qual. */
export interface MermaidImportDto {
  arch: ArchitectureDto;
  warnings: string[];
}

/** Mermaid `graph TB` do desenho (com as linhas `%% dxt:` que tornam a ida e volta exacta). */
export const archExportMermaid = (arch: ArchitectureDto): Promise<string> =>
  invoke<string>("arch_export_mermaid", { arch });

/** Parse no Rust de um `graph`/`flowchart`; erro só quando não é um flowchart. */
export const archImportMermaid = (source: string): Promise<MermaidImportDto> =>
  invoke<MermaidImportDto>("arch_import_mermaid", { source });

/** Escreve uma exportação (bytes) DENTRO da pasta do projecto. Devolve o caminho relativo. */
export const archSaveExport = (root: string, rel: string, bytes: Uint8Array): Promise<string> =>
  invoke<string>("arch_save_export", { root, rel, bytes: Array.from(bytes) });

/** Lê um ficheiro de texto (o Studio só pede caminhos dentro da pasta do projecto). */
export const readTextFile = (path: string): Promise<string> => invoke<string>("read_text_file", { path });

/** `arch://proposal` — o agente do Co-Dev propôs um desenho (ferramenta `arch_propose`). */
export interface ArchProposalDto {
  title: string;
  arch: ArchitectureDto;
  findings: ArchFindingDto[];
}

export const onArchProposal = (h: (p: ArchProposalDto) => void): Promise<() => void> =>
  listen("arch://proposal", (payload) => h(payload as ArchProposalDto));
