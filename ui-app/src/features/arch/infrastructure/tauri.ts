/* ═════════ feature `arch` — adaptador da porta ArchGateway sobre os comandos Tauri ═════════
   `arch_validate` / `arch_scaffold_preview` / `arch_scaffold` / `arch_export_mermaid` /
   `arch_import_mermaid` / `arch_save_export` (commands/agent.rs) e `read_text_file`. Os tipos
   do domínio e os DTOs coincidem campo a campo; a conversão é explícita para que uma
   mudança de contrato parta a compilação aqui, e não em silêncio. */

import { isDesktop } from "../../../platform/tauri/core";
import * as ipc from "../../../platform/tauri/arch";
import type { ArchGateway, ProposalSource, RulesGateway } from "../application/ports";
import { parseAdr, parseAdrs, parseRulesDoc, rulesToWire } from "../domain/rules";
import { fromArchitecture } from "../domain/design";
import type { Architecture, ArchFinding } from "../domain/types";

/* O domínio e os DTOs coincidem campo a campo (toArchitecture já tira os campos vazios);
   a cópia explícita faz uma mudança de contrato partir a compilação aqui. */
const toDto = (a: Architecture): ipc.ArchitectureDto => ({
  components: a.components.map((c) => ({ ...c })),
  connections: a.connections.map((c) => ({ ...c })),
  groups: a.groups.map((g) => ({ ...g })),
  views: a.views.map((v) => ({ ...v, roots: [...v.roots] })),
});

const fromFinding = (f: ipc.ArchFindingDto): ArchFinding => ({
  severity: f.severity, rule: f.rule, message: f.message, component: f.component,
});

/* O que vem do Rust: os campos opcionais podem faltar (o serde não os serializa quando
   não têm valor); o `fromArchitecture` do domínio lê-os com tolerância. */
const fromDto = (a: ipc.ArchitectureDto): Architecture => ({
  components: a.components.map((c) => ({ ...c })),
  connections: a.connections.map((c) => ({ ...c })),
  groups: (a.groups ?? []).map((g) => ({ ...g, style: g.style ?? "dashed" })),
  views: (a.views ?? []).map((v) => ({
    id: v.id, title: v.title, color: v.color ?? "", roots: [...(v.roots ?? [])], daemonless: !!v.daemonless, strict: !!v.strict,
  })),
});

const join = (root: string, rel: string): string => `${root.replace(/[\\/]+$/, "")}/${rel}`;

export const tauriArchGateway: ArchGateway = {
  available: () => isDesktop(),
  validate: async (a) => (await ipc.archValidate(toDto(a))).map(fromFinding),
  preview: (a) => ipc.archScaffoldPreview(toDto(a)),
  scaffold: (root, a) => ipc.archScaffold(root, toDto(a)),
  exportMermaid: (a) => ipc.archExportMermaid(toDto(a)),
  importMermaid: async (source) => {
    const r = await ipc.archImportMermaid(source);
    return { design: fromArchitecture(fromDto(r.arch)), warnings: r.warnings };
  },
  saveExport: (root, rel, bytes) => ipc.archSaveExport(root, rel, bytes),
  readFile: (root, rel) => ipc.readTextFile(join(root, rel)),
};

/** As regras do arquitecto e os ADR (F5.2/F5.5) sobre `arch_rules_*` / `adr_*`. */
export const tauriRulesGateway: RulesGateway = {
  available: () => isDesktop(),
  load: async (root) => parseRulesDoc(await ipc.archRulesLoad(root)),
  save: async (root, rules) => parseRulesDoc(await ipc.archRulesSave(root, rulesToWire(rules))),
  adrs: async (root) => parseAdrs(await ipc.adrList(root)),
  acceptAdr: async (root, path) => parseAdr(await ipc.adrAccept(root, path)),
  commit: (root, paths, message) => ipc.archRulesCommit(root, paths, message),
};

/** As propostas do agente chegam pelo evento `arch://proposal` (só no desktop). */
export const tauriProposals: ProposalSource = {
  subscribe(onProposal) {
    if (!isDesktop()) return;
    void ipc.onArchProposal((p) => {
      onProposal({ title: p.title, design: fromArchitecture(fromDto(p.arch)), findings: p.findings.map(fromFinding) });
    });
  },
};
