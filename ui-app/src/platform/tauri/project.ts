/* ═════════ cliente IPC: Project (SQLite) — docs/v2/UI-AUDIT.md, item 5 (fase A5) ═════════
   Contratos de `project_load`, `project_apply`, `project_issue` e `project_reports`
   (src-tauri/src/board.rs sobre `tutor_board::project`). Os payloads chegam como `unknown`: a
   feature `project` estreita-os no seu domínio. Um erro de regra chega rejeitado com
   `{code, message, overridable}`. Ver IPC-MATRIX.md §17. */
import { invoke, type Invoker } from "./core";

export const projectClient = (inv: Invoker = invoke) => ({
  load: (root: string): Promise<unknown> => inv<unknown>("project_load", { root }),
  /** Uma operação atómica (`{op: "move", key, to, reason?}`, `{op: "create_issue", …}`, …). */
  apply: (root: string, op: Record<string, unknown>): Promise<unknown> => inv<unknown>("project_apply", { root, op }),
  issue: (root: string, key: string): Promise<unknown> => inv<unknown>("project_issue", { root, key }),
  reports: (root: string): Promise<unknown> => inv<unknown>("project_reports", { root }),
  /** O registo de auditoria do Co-Dev (RF-T01): de uma issue, ou da pasta com `issue: null`. */
  audit: (root: string, issue: string | null): Promise<unknown> => inv<unknown>("project_audit", { root, issue }),
});

export type ProjectClient = ReturnType<typeof projectClient>;
