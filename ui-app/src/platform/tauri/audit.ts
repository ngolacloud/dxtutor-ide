/* ═════════ cliente IPC: o registo de auditoria das operações do IDE (r23 F1, RF-BK-L01) ═════════
   Contrato de `audit_record` (src-tauri/src/board.rs): a mesma tabela do registo do Co-Dev
   (`project_audit`), com origem `ide`. Quem e quando decide-os o backend; os segredos são mascarados
   lá (a regra vive no Rust, não na UI). Ver IPC-MATRIX.md §17. */
import { invoke, type Invoker } from "./core";

export interface IdeAudit {
  /** a feature que pediu (`ops`, `scm`, …) */
  feature: string;
  /** o que fez (`kube.undo`, `iac.apply`, …): `[a-z0-9._-]` */
  action: string;
  /** o comando exacto mostrado no diálogo de aprovação */
  command: string;
  /** onde correu (`context kind-dev · namespace shop`) */
  scope?: string;
  approved: boolean;
  reason?: string;
  /** `sent` (para um terminal), `ok` ou `failed`; ignorado quando recusado */
  outcome?: "sent" | "ok" | "failed";
  decidedAt?: number;
}

export const auditClient = (inv: Invoker = invoke) => ({
  record: (root: string, entry: IdeAudit): Promise<void> => inv<void>("audit_record", { root, entry }),
});

export type AuditClient = ReturnType<typeof auditClient>;
