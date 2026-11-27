/* ═════════ dxtutor IDE — adaptador tipado: a autonomia delegada e os pull requests (Multi Co-Dev, fase 5) ═════════
   Cliente dos comandos de `src-tauri/src/commands/codev_autonomy.rs`. As respostas chegam como `unknown` e a
   feature `integration` estreita-as no domínio (`features/integration/domain/autonomy.ts`). As regras (quem delega,
   a validade, o interruptor, a porta, o push) vivem no Rust; aqui só se pede. Ver IPC-MATRIX.md §10b'''. */

import { invoke, listen } from "./core";

/** O que um humano pede para delegar (o Rust valida e verifica o papel). */
export interface GrantRequest {
  scope: "issue" | "sprint";
  target: string;
  actions: string[];
  hours: number;
  provider?: string;
  model?: string;
  language?: string;
  note?: string;
}

/** A autonomia de uma issue (ou da pasta, sem `key`): o interruptor, as delegações e o registo (só leitura). */
export const autonomyState = (root: string, key: string | null): Promise<unknown> => invoke<unknown>("codev_autonomy_state", { root, key });

export const autonomyGrant = (root: string, grant: GrantRequest): Promise<unknown> => invoke<unknown>("codev_autonomy_grant", { root, grant });

export const autonomyRevoke = (root: string, id: number, reason: string | null): Promise<unknown> => invoke<unknown>("codev_autonomy_revoke", { root, id, reason });

/** O interruptor de toda a app («Pause autonomy» / «Resume autonomy»). */
export const autonomyPause = (root: string, paused: boolean, reason: string | null): Promise<unknown> => invoke<unknown>("codev_autonomy_pause", { root, paused, reason });

/** O pull request de uma issue: o plano (ou porque não), o `gh` e o pull request aberto (só leitura). */
export const prState = (root: string, key: string): Promise<unknown> => invoke<unknown>("codev_pr_state", { root, key });

/** «Open a pull request» com o texto aprovado (o Rust pergunta a porta outra vez). */
export const prOpen = (root: string, key: string, command: string, decidedAt: number): Promise<unknown> => invoke<unknown>("codev_pr_open", { root, key, command, decidedAt });

/** Os passos da autonomia (`codev-autonomy://event`). */
export const onAutonomyEvent = (f: (payload: unknown) => void): Promise<() => void> => listen("codev-autonomy://event", f);
