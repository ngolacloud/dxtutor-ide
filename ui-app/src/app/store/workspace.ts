/* ═════════ estado do workspace (ADR-0004, U3c) ═════════
   Dono dos ficheiros abertos na IDE (`FS`: caminho → conteúdo/original), da raiz lógica
   (`ROOT`) e das pastas expandidas na árvore (`OPEN`). Desde a U4j3 do ADR-0004 o store cria
   os valores iniciais (antes era o app.ts, que os publicava e o acessor adoptava). Mudanças: o `refresh()` do app.ts
   emite `workspace:changed` no bus. */
import { ownedGlobal } from "./owned";

export interface FsEntry {
  content: string;
  orig: string | null;
}

const files = ownedGlobal<Record<string, FsEntry>>("FS", {});
const root = ownedGlobal<string>("ROOT", "dxtutor/");
/* as pastas que a árvore abre no arranque (ADR-0004, U4j3 — eram criadas no app.ts) */
/* as pastas abertas nascem só com a raiz (eram as do projecto de demonstração — ADR-0006, R3c) */
const open = ownedGlobal<Set<string>>("OPEN", new Set(['dxtutor']));

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
