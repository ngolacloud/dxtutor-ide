/* ═════════ feature `arch` — portas (ADR-0002) ═════════
   O que o caso de uso precisa do mundo, injectado por argumento. Os adaptadores vivem em
   `infrastructure/` (o gateway sobre os comandos Tauri; o resto sobre o `window`). */

import type { Architecture, ArchFinding, Design } from "../domain/types";
import type { Adr, ArchRules, RulesDoc } from "../domain/rules";

/** A validação e o scaffold do backend (`tutor_eval::arch`). */
export interface ArchGateway {
  /** `false` fora da app desktop: não há backend para validar. */
  available(): boolean;
  validate(arch: Architecture): Promise<ArchFinding[]>;
  /** O que o scaffold ESCREVERIA (caminho relativo, conteúdo), sem tocar no disco. */
  preview(arch: Architecture): Promise<[string, string][]>;
  /** Escreve o scaffold em `root` (nunca sobrepõe). Devolve os caminhos escritos. */
  scaffold(root: string, arch: Architecture): Promise<string[]>;
  /** Mermaid `graph TB` do desenho (parse e geração no Rust). */
  exportMermaid(arch: Architecture): Promise<string>;
  /** Um `graph`/`flowchart` Mermaid → desenho (sem posições) + avisos. */
  importMermaid(source: string): Promise<{ design: Design; warnings: string[] }>;
  /** Escreve uma exportação DENTRO de `root`. Devolve o caminho relativo escrito. */
  saveExport(root: string, rel: string, bytes: Uint8Array): Promise<string>;
  /** Lê um ficheiro de texto de dentro de `root`. */
  readFile(root: string, rel: string): Promise<string>;
}

/** As regras do arquitecto e os ADR (F5.2/F5.5): ler, gravar, aceitar, commitar — tudo no Rust,
 *  que valida e verifica o papel de quem está ao teclado. */
export interface RulesGateway {
  available(): boolean;
  load(root: string): Promise<RulesDoc>;
  save(root: string, rules: ArchRules): Promise<RulesDoc>;
  adrs(root: string): Promise<Adr[]>;
  acceptAdr(root: string, path: string): Promise<Adr>;
  /** O commit do arquitecto só destes ficheiros; devolve o hash curto. */
  commit(root: string, paths: string[], message: string): Promise<string>;
}

/** Uma proposta do agente do Co-Dev (ferramenta `arch_propose`): o desenho, ainda sem
 *  posições, e os achados da validação que o backend fez ao recebê-la. */
export interface Proposal {
  title: string;
  design: Design;
  findings: ArchFinding[];
}

/** De onde chegam as propostas (no desktop, o evento `arch://proposal`). */
export interface ProposalSource {
  subscribe(onProposal: (p: Proposal) => void): void;
}

/** Desenha o desenho como imagem (precisa do DOM: vive na vista). */
export interface Renderer {
  /** SVG autónomo, fiel ao canvas (cores do tema resolvidas). */
  svg(design: Design): string;
  /** PNG do mesmo SVG (2×). */
  png(design: Design): Promise<Uint8Array>;
}

/** Ficheiros fora do desktop: o browser descarrega. */
export interface Files {
  download(name: string, bytes: Uint8Array, mime: string): void;
}

/** Persistência do desenho (estado de cliente), por chave. */
export interface DesignStore {
  load(key: string): unknown;
  save(key: string, design: unknown): void;
}

/** O workspace e os diálogos do humano. */
export interface Workspace {
  /** A pasta aberta, ou `null` sem pasta. */
  root(): string | null;
  confirm(message: string): boolean;
  prompt(message: string, initial: string): string | null;
}

/** Quem desenha. `all` = tudo; `canvas` = só o SVG; `drag` = só o SVG, a meio de um arrasto
 *  (setas rectas, sem encaminhar: barato a cada movimento do rato); `inspector` = só o painel. */
export type Repaint = "all" | "canvas" | "drag" | "inspector";

export interface ArchStudioDeps {
  gateway: ArchGateway;
  store: DesignStore;
  workspace: Workspace;
  renderer: Renderer;
  files: Files;
  repaint(scope: Repaint): void;
}
