/* ═════════ cliente IPC: New Project (os templates do Delonix) ═════════
   `project_templates`, `project_new_plan` e `project_new` (src-tauri/src/commands/scaffold.rs sobre o crate
   `tutor-scaffold`). Os payloads chegam como `unknown`: a feature `newproject` estreita-os no seu domínio. */
import { invoke, type Invoker } from "./core";

export const scaffoldClient = (inv: Invoker = invoke) => ({
  templates: (): Promise<unknown> => inv<unknown>("project_templates"),
  /** Onde fica e o que acontece; não escreve nada. */
  plan: (parent: string, name: string, template: string, version: string | null): Promise<unknown> =>
    inv<unknown>("project_new_plan", { parent, name, template, version }),
  /** Cria o projecto (depois da aprovação), com `git init` e o commit `chore: scaffold`; auditado. */
  create: (parent: string, name: string, template: string, version: string | null): Promise<unknown> =>
    inv<unknown>("project_new", { parent, name, template, version }),
});
