/* ═════════ dxtutor IDE — adaptador tipado: worktrees e reservas do Co-Dev (Multi Co-Dev, fase 3) ═════════
   Cliente dos comandos de `src-tauri/src/commands/codev_worktree.rs`. As respostas chegam como
   `unknown` e a feature Co-Dev estreita-as no domínio (`features/codev/domain/worktrees.ts`). Ver
   IPC-MATRIX.md §10c. */

import { invoke } from "./core";

/** O que começar uma sessão na issue faz ao repositório (só leitura). */
export const worktreePlan = (root: string, key: string): Promise<unknown> => invoke<unknown>("codev_worktree_plan", { root, key });

/** Cria a worktree com o comando aprovado (auditado no Rust antes e com o resultado). */
export const worktreeCreate = (root: string, key: string, command: string, decidedAt: number): Promise<unknown> =>
  invoke<unknown>("codev_worktree_create", { root, key, command, decidedAt });

/** As worktrees do Co-Dev do repositório, com a sessão aberta de cada uma (só leitura). */
export const worktreeList = (root: string): Promise<unknown> => invoke<unknown>("codev_worktrees", { root });

/** Limpa uma worktree sem sessão com o comando aprovado (auditado no Rust). */
export const worktreeRemove = (root: string, key: string, command: string, decidedAt: number): Promise<unknown> =>
  invoke<unknown>("codev_worktree_remove", { root, key, command, decidedAt });

/** Um ficheiro de uma worktree, só de leitura. */
export const worktreeFile = (root: string, key: string, path: string): Promise<unknown> => invoke<unknown>("codev_worktree_file", { root, key, path });

/** Commita tudo o que a worktree tem, no ramo dela (secret scan e auditoria no Rust). */
export const worktreeCommit = (root: string, key: string, message: string): Promise<string> =>
  invoke<string>("codev_worktree_commit", { root, key, message });

/** As reservas de ficheiros do projecto (só leitura). */
export const fileClaims = (root: string): Promise<unknown> => invoke<unknown>("codev_claims", { root });
