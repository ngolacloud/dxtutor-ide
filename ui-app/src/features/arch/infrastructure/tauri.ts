/* ═════════ feature `arch` — adaptador da porta ArchGateway sobre os comandos Tauri ═════════
   `arch_validate` / `arch_scaffold_preview` / `arch_scaffold` (commands/agent.rs). Os tipos
   do domínio e os DTOs coincidem campo a campo; a conversão é explícita para que uma
   mudança de contrato parta a compilação aqui, e não em silêncio. */

import { isDesktop } from "../../../platform/tauri/core";
import * as ipc from "../../../platform/tauri/arch";
import type { ArchGateway } from "../application/ports";
import type { Architecture, ArchFinding } from "../domain/types";

const toDto = (a: Architecture): ipc.ArchitectureDto => ({
  components: a.components.map(({ id, name, kind, outbox }) => ({ id, name, kind, outbox })),
  connections: a.connections.map(({ from, to, relation, event }) => ({ from, to, relation, event })),
});

const fromFinding = (f: ipc.ArchFindingDto): ArchFinding => ({
  severity: f.severity, rule: f.rule, message: f.message, component: f.component,
});

export const tauriArchGateway: ArchGateway = {
  available: () => isDesktop(),
  validate: async (a) => (await ipc.archValidate(toDto(a))).map(fromFinding),
  preview: (a) => ipc.archScaffoldPreview(toDto(a)),
  scaffold: (root, a) => ipc.archScaffold(root, toDto(a)),
};
