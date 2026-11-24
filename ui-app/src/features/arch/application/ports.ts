/* ═════════ feature `arch` — portas (ADR-0002) ═════════
   O que o caso de uso precisa do mundo, injectado por argumento. Os adaptadores vivem em
   `infrastructure/` (o gateway sobre os comandos Tauri; o resto sobre o `window`). */

import type { Architecture, ArchFinding } from "../domain/types";

/** A validação e o scaffold do backend (`tutor_eval::arch`). */
export interface ArchGateway {
  /** `false` fora da app desktop: não há backend para validar. */
  available(): boolean;
  validate(arch: Architecture): Promise<ArchFinding[]>;
  /** O que o scaffold ESCREVERIA (caminho relativo, conteúdo), sem tocar no disco. */
  preview(arch: Architecture): Promise<[string, string][]>;
  /** Escreve o scaffold em `root` (nunca sobrepõe). Devolve os caminhos escritos. */
  scaffold(root: string, arch: Architecture): Promise<string[]>;
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
  repaint(scope: Repaint): void;
}
