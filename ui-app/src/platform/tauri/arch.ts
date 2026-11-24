/* ═════════ dxtutor IDE — cliente IPC do Studio de arquitectura ═════════
   Contratos de `commands/agent.rs` (arch_validate / arch_scaffold_preview / arch_scaffold)
   sobre o modelo `tutor_eval::arch`. A validação e o scaffold são SEMPRE do backend: o
   cliente só desenha. `arch_scaffold` ESCREVE no disco (nunca sobrepõe) e só é chamado
   depois de confirmação explícita do humano. */

import { invoke } from "./core";

export type ArchKindDto = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";
export type ArchRelationDto = "writes" | "reads" | "publishes" | "consumes" | "routes-to";

export interface ArchComponentDto {
  id: string;
  name: string;
  kind: ArchKindDto;
  outbox: boolean;
}

export interface ArchConnectionDto {
  from: string;
  to: string;
  relation: ArchRelationDto;
  event: string;
}

export interface ArchitectureDto {
  components: ArchComponentDto[];
  connections: ArchConnectionDto[];
}

export interface ArchFindingDto {
  severity: "error" | "warning";
  rule: string;
  message: string;
  component: string;
}

export const archValidate = (arch: ArchitectureDto): Promise<ArchFindingDto[]> =>
  invoke<ArchFindingDto[]>("arch_validate", { arch });

export const archScaffoldPreview = (arch: ArchitectureDto): Promise<[string, string][]> =>
  invoke<[string, string][]>("arch_scaffold_preview", { arch });

export const archScaffold = (root: string, arch: ArchitectureDto): Promise<string[]> =>
  invoke<string[]>("arch_scaffold", { root, arch });
