/* ═════════ cliente IPC: dev-container — ADR-0006, R5b ═════════
   Contratos de `devcontainer_*` (src-tauri/src/commands/devcontainer.rs): a sessão do
   dev-container do projecto (o `.devcontainer/devcontainer.json`), sobre o motor de contentores
   do backend. */
import { invoke, type Invoker } from "./core";

/** `DevcontainerUp`: correu?, a imagem, se foi construída, o comando e as saídas. */
export interface DevcontainerUp { ok: boolean; image: string; built: boolean; ran: string; stdout: string; stderr: string }
/** `SessionStatus`. */
export interface DevcontainerStatus { running: boolean; name: string }

export const devcontainerClient = (inv: Invoker = invoke) => ({
  sessionUp: (root: string): Promise<DevcontainerUp> => inv<DevcontainerUp>("devcontainer_session_up", { root }),
  sessionStatus: (root: string): Promise<DevcontainerStatus> => inv<DevcontainerStatus>("devcontainer_session_status", { root }),
  sessionDown: (root: string): Promise<void> => inv<void>("devcontainer_session_down", { root }),
  /** O motor em que as sessões correm (`get_sandbox_engine`: delonix/docker/podman/host). */
  engine: (): Promise<string> => inv<string>("get_sandbox_engine"),
});
