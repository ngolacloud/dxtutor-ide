/* ═════════ feature `integration` — portas do caso de uso (Multi Co-Dev, fase 4) ═════════
   O que o painel de revisão precisa do mundo, injectado pela composição (`index.ts`): o backend da revisão
   e da porta, o diálogo de aprovação partilhado (pela forma, sem importar `app/`), o registo de auditoria
   das recusas, o secret scan que pede um motivo, o Co-Dev (o provedor/modelo do revisor e fechar a sessão
   da issue), o Project (gravar as verificações obrigatórias e reler) e os avisos. */

import type { Check, Integrated, ReviewEvent, ReviewState } from "../domain/types";
import type { IntegrationKey } from "./messages";
import type { Action, AutonomyNotice, Delegation, Opened, Overview, PrState, Switch } from "../domain/autonomy";
import type { AutonomyKey } from "./autonomy-messages";

export interface ReviewGateway {
  state(root: string, key: string): Promise<ReviewState>;
  request(root: string, key: string, command: string, decidedAt: number, reviewer: { provider?: string; model?: string; language?: string }): Promise<number>;
  cancel(root: string, key: string): Promise<boolean>;
  integrate(root: string, key: string, command: string, decidedAt: number): Promise<Integrated>;
  /** Os passos das revisões a correr; devolve como deixar de ouvir. */
  onEvent(f: (e: ReviewEvent) => void): Promise<() => void>;
}

/** O pedido ao diálogo partilhado (`app/approval.ts`), pela forma. */
export interface ReviewApproval {
  title: string;
  command: string;
  scope?: string;
  destructive?: boolean;
}

export interface ReviewDeps {
  gateway: ReviewGateway;
  /** A pasta aberta (no disco); `null` sem pasta. */
  root(): string | null;
  approve(req: ReviewApproval): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
  /** O registo de auditoria (`audit_record`): só as recusas passam por aqui; o resto regista-o o Rust. */
  audit(root: string, entry: { feature: string; action: string; command: string; scope?: string; approved: boolean; reason?: string; decidedAt?: number }): Promise<void>;
  /** Uma integração que o secret scan bloqueou pede um motivo ao humano (`services.protect.guard`). */
  guard<T>(f: () => Promise<T>): Promise<T>;
  /** O provedor e o modelo do Co-Dev, e a língua da interface (o revisor responde nela). */
  reviewer(): { provider?: string; model?: string; language?: string };
  /** O comando de testes detectado nesta pasta (`null`: nenhum). */
  detectedTest(): string | null;
  /** Grava as verificações obrigatórias do projecto (a op `settings` do Project). */
  setChecks(checks: Check[]): Promise<void>;
  /** Fecha a sessão Co-Dev aberta da issue (as reservas e a worktree saem pelas regras da fase 3). */
  closeSession(session: string): boolean;
  /** O Project relê-se (a issue mudou de estado). */
  projectChanged(): void;
  notify(message: string): void;
  copy(key: IntegrationKey, params?: Record<string, string | number>): string;
}

/* ───── Multi Co-Dev, fase 5: a autonomia delegada e os pull requests ───── */

/** O que um humano pede para delegar (o Rust valida, verifica o papel e audita). */
export interface GrantInput {
  scope: "issue" | "sprint";
  target: string;
  actions: Action[];
  hours: number;
  provider?: string;
  model?: string;
  language?: string;
}

export interface AutonomyGateway {
  overview(root: string, key: string | null): Promise<Overview>;
  grant(root: string, g: GrantInput): Promise<Delegation>;
  revoke(root: string, id: number): Promise<Delegation>;
  pause(root: string, paused: boolean, reason: string): Promise<Switch>;
  prState(root: string, key: string): Promise<PrState>;
  prOpen(root: string, key: string, command: string, decidedAt: number): Promise<Opened>;
  /** As linhas do registo de auditoria de uma issue (para mostrar as que um passo escreveu). */
  auditRows(root: string, key: string): Promise<AuditRow[]>;
  /** Os passos da autonomia; devolve como deixar de ouvir. */
  onNotice(f: (n: AutonomyNotice) => void): Promise<() => void>;
}

/** Uma linha do registo de auditoria, como o painel a mostra. */
export interface AuditRow {
  id: number;
  at: number;
  call: string;
  outcome: string;
  decidedBy: string;
  command: string;
  reason: string;
}

export interface AutonomyDeps {
  gateway: AutonomyGateway;
  root(): string | null;
  approve(req: ReviewApproval & { list?: { heading: string; items: string[]; note?: string } }): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
  audit: ReviewDeps["audit"];
  /** Um pull request que o secret scan bloqueou pede um motivo ao humano (`services.protect.guard`). */
  guard<T>(f: () => Promise<T>): Promise<T>;
  /** O provedor e o modelo do Co-Dev e a língua: o revisor de uma revisão autónoma. */
  reviewer(): { provider?: string; model?: string; language?: string };
  /** O painel de revisão relê a porta da issue (a autonomia mexeu nela). */
  reviewChanged(key: string): void;
  /** Fecha a sessão Co-Dev aberta da issue integrada (fase 3). */
  closeSession(session: string): boolean;
  projectChanged(): void;
  notify(message: string): void;
  copy(key: AutonomyKey, params?: Record<string, string | number>): string;
}
