/* ═════════ feature `newproject` — portas do caso de uso ═════════ */

/** Os comandos `project_templates`/`project_new_plan`/`project_new` (payloads estreitados pelo domínio). */
export interface ScaffoldPort {
  /** a app desktop (pastas no disco, git) */
  available(): boolean;
  templates(): Promise<unknown>;
  plan(parent: string, name: string, template: string, version: string | null): Promise<unknown>;
  create(parent: string, name: string, template: string, version: string | null): Promise<unknown>;
}

export interface WorkspacePort {
  /** onde sugerir o projecto novo: ao lado da pasta aberta, ou a pasta pessoal */
  defaultParent(): string | null;
  /** o diálogo do sistema para escolher uma pasta */
  pickFolder(): Promise<string | null>;
  /** abre a pasta como workspace */
  open(dir: string): Promise<void>;
}

/** O diálogo de aprovação partilhado (`app/approval.ts`), pela forma. */
export interface HumanPort {
  approve(r: { title: string; command: string; scope?: string }): Promise<{ approved: boolean }>;
}

export type NewProjectCopy = (key: "approveTitle" | "badResponse" | "needsDesktop", params?: Record<string, string | number>) => string;
