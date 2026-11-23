/* ═════════ estado do workspace (ADR-0004, U3c) ═════════
   Dono dos ficheiros abertos na IDE (`FS`: caminho → conteúdo/original), da raiz lógica
   (`ROOT`) e das pastas expandidas na árvore (`OPEN`). O app.ts continua a criar estes
   objectos e publica-os no arranque (um Object.assign sobre o window com FS/ROOT/OPEN): o
   acessor adopta-os — é o mesmo objecto, sem cópia. Mudanças: o `refresh()` do app.ts
   emite `workspace:changed` no bus. */
import { ownedGlobal } from "./owned";

export interface FsEntry {
  content: string;
  orig: string | null;
}

const files = ownedGlobal<Record<string, FsEntry>>("FS", {});
const root = ownedGlobal<string>("ROOT", "dxtutor/");
const open = ownedGlobal<Set<string>>("OPEN", new Set());

export const workspaceStore = {
  /** Os ficheiros da IDE (mutável no lugar; quem muda chama `refresh()`). */
  get files(): Record<string, FsEntry> {
    return files.get();
  },
  get root(): string {
    return root.get();
  },
  /** Pastas expandidas na árvore do explorador. */
  get openDirs(): Set<string> {
    return open.get();
  },
};
