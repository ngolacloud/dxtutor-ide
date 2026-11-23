/* ═════════ cliente IPC: ficheiros e caminhos — ADR-0004, U2 ═════════
   Contratos de `expand_path`, `pick_folder`, `write_file`, `delete_file` (src-tauri/src/fsops). */
import { invoke, type Invoker } from "./core";

export const fsClient = (inv: Invoker = invoke) => ({
  /** `~` e variáveis de ambiente → caminho absoluto. */
  expandPath: (path: string): Promise<string> => inv<string>("expand_path", { path }),
  /** Diálogo nativo de escolher pasta (`null` se cancelado). */
  pickFolder: (): Promise<string | null> => inv<string | null>("pick_folder"),
  writeFile: (root: string, rel: string, content: string): Promise<void> => inv<void>("write_file", { root, rel, content }),
  deleteFile: (root: string, rel: string): Promise<void> => inv<void>("delete_file", { root, rel }),
});

export type FsClient = ReturnType<typeof fsClient>;
