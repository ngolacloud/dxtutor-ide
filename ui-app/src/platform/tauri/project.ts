/* ═════════ cliente IPC: Project (SQLite) — docs/v2/UI-AUDIT.md, item 5 (fase A5) ═════════
   Contratos de `project_load`, `project_apply`, `project_issue` e `project_reports`
   (src-tauri/src/board.rs sobre `tutor_board::project`). Os payloads chegam como `unknown`: a
   feature `project` estreita-os no seu domínio. Um erro de regra chega rejeitado com
   `{code, message, overridable}`. Ver IPC-MATRIX.md §17. */
import { invoke, listen, type Invoker } from "./core";

export const projectClient = (inv: Invoker = invoke) => ({
  load: (root: string): Promise<unknown> => inv<unknown>("project_load", { root }),
  /** Uma operação atómica (`{op: "move", key, to, reason?}`, `{op: "create_issue", …}`, …). */
  apply: (root: string, op: Record<string, unknown>): Promise<unknown> => inv<unknown>("project_apply", { root, op }),
  issue: (root: string, key: string): Promise<unknown> => inv<unknown>("project_issue", { root, key }),
  reports: (root: string): Promise<unknown> => inv<unknown>("project_reports", { root }),
  /** O prompt exacto com que a issue vai ao Co-Dev (RF-B03): template do projecto ou embutido. */
  issuePrompt: (root: string, key: string): Promise<unknown> => inv<unknown>("project_issue_prompt", { root, key }),
  /** O registo de auditoria do Co-Dev (RF-T01): de uma issue, ou da pasta com `issue: null`. */
  audit: (root: string, issue: string | null): Promise<unknown> => inv<unknown>("project_audit", { root, issue }),
  /** RF-A05: the repository against the architect's rules (`arch_conformance`; `null`: no rules file). */
  conformance: (root: string): Promise<unknown> => inv<unknown>("arch_conformance", { root }),
  /** Multi Co-Dev (phase 1): the parallel plan of a sprint (read-only) — `sprint: null` the active one, else the next
   *  planned; `codevs: null` the sprint's own count. */
  sprintPlan: (root: string, sprint: string | null, codevs: number | null): Promise<unknown> => inv<unknown>("project_sprint_plan", { root, sprint, codevs }),
  /** Multi Co-Dev (phase 2): may a Co-Dev session start `key` while the sessions of `running` work in the same
   *  tree? `{overlaps: [{a, b, paths, total, globs}], files}` — empty `overlaps`: it may (read-only). */
  scopeOverlap: (root: string, key: string, running: string[]): Promise<unknown> => inv<unknown>("project_scope_overlap", { root, key, running }),
  /** Board B: what choosing `method` changes in the settings, and what stays (the user's); writes nothing. */
  methodPreview: (root: string, method: string, lang: string): Promise<unknown> => inv<unknown>("project_method_preview", { root, method, lang }),
  /** `/project`: creates the Project from `.dxtutor/backlog.json` and the plan Co-Dev proposed, if the file is still
   *  the one the plan was made from (`hash`); `ready` approves as Ready the issues that lack nothing else (audited).
   *  `{project, created, existing, sprints, ready, notReady}`. */
  createFromBacklog: (root: string, hash: string, plan: unknown, ready: boolean, lang: string): Promise<unknown> =>
    inv<unknown>("project_create_from_backlog", { root, hash, plan, ready, lang }),
});

/** `backlog://proposal` — a backlog session's tool (`backlog_propose`/`project_propose`) proposed something:
 *  `{session, proposal: {kind, path, hash, draft, plan}}`. */
export const onBacklogProposal = (h: (payload: unknown) => void): Promise<() => void> => listen("backlog://proposal", h);

export type ProjectClient = ReturnType<typeof projectClient>;
