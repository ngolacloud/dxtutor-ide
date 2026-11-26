/* ═══════════ Co-Dev — caso de uso: as worktrees do Co-Dev (Multi Co-Dev, fase 3) ═══════════
   Com mais de uma sessão Co-Dev (ou uma issue que já tem a sua), a sessão da issue trabalha numa
   worktree git própria, no ramo da issue, fora da pasta do projecto. As regras vivem no Rust: aqui pede-se
   o plano (`codev_worktree_plan`), mostra-se o comando exacto no diálogo de aprovação partilhado, regista-se
   a recusa no registo de auditoria (a aprovação e o resultado regista-os o Rust, antes de correr) e cria-se.

   Também: a lista das worktrees (as guardadas com alterações e as deixadas por um crash, oferecidas para
   limpar — com aprovação), os ficheiros de uma worktree só de leitura, o commit no ramo dela (o secret
   scan pode pedir um motivo, `guard`) e as reservas de ficheiros por sessão. Sem DOM, sem window. */

import { ptWorktreeCopy, type WorktreeCopy } from "./worktree-messages";
import { cleanable, claimsBySession, kept, refOf, type FileClaim, type ListedWorktree, type Placement, type WorktreeFile, type WorktreeInfo, type WorktreePlan, type WorktreeRef } from "../domain/worktrees";

export interface WorktreeGateway {
  plan(root: string, key: string): Promise<WorktreePlan>;
  create(root: string, key: string, command: string, decidedAt: number): Promise<WorktreeInfo>;
  list(root: string): Promise<ListedWorktree[]>;
  remove(root: string, key: string, command: string, decidedAt: number): Promise<{ removed: boolean; dirty: string[] }>;
  file(root: string, key: string, path: string): Promise<WorktreeFile>;
  commit(root: string, key: string, message: string): Promise<string>;
  claims(root: string): Promise<FileClaim[]>;
}

/** O pedido ao diálogo partilhado (`app/approval.ts`), pela forma (sem o importar). */
export interface WorktreeApproval {
  title: string;
  command: string;
  scope?: string;
  destructive?: boolean;
}

export interface WorktreesDeps {
  gateway: WorktreeGateway;
  /** A pasta aberta (no disco); `null` sem pasta. */
  root(): string | null;
  approve(req: WorktreeApproval): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
  /** O registo de auditoria (`audit_record`): só as recusas passam por aqui; o resto regista-o o Rust. */
  audit(root: string, entry: { feature: string; action: string; command: string; scope?: string; approved: boolean; reason?: string; decidedAt?: number }): Promise<void>;
  /** Um commit que o secret scan bloqueou pede um motivo ao humano (`services.protect.guard`). */
  guard<T>(f: () => Promise<T>): Promise<T>;
  /** Abre um texto só de leitura, ao lado de outro (a tab de diferenças do editor). */
  openReadOnly(abs: string, before: string, after: string, label: string): void;
  /** Pede um texto ao humano (a mensagem do commit); `null`: cancelou. */
  ask(question: string, initial: string): Promise<string | null>;
  notify(message: string): void;
  copy?: WorktreeCopy;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeWorktrees(deps: WorktreesDeps) {
  const copy = deps.copy ?? ptWorktreeCopy;
  let listed: ListedWorktree[] = [];
  let claims: FileClaim[] = [];
  const listeners = new Set<() => void>();
  const changed = (): void => listeners.forEach((f) => f());

  /** Onde vai a sessão da issue `key`: a worktree que já existe; uma nova, aprovada, quando `needed`; ou a
   *  árvore principal. Nunca lança. */
  async function prepare(key: string, needed: boolean): Promise<Placement> {
    const root = deps.root();
    if (!root) return needed ? { kind: "unavailable", reason: "no folder" } : { kind: "main" };
    let plan: WorktreePlan;
    try {
      plan = await deps.gateway.plan(root, key);
    } catch (e: unknown) {
      // alone, the session works in the main tree as always; next to another, it does not start
      if (!needed) return { kind: "main" };
      deps.notify(copy("wtFailed", { key, error: msg(e) }));
      return { kind: "refused" };
    }
    if (!plan.available) return needed ? { kind: "unavailable", reason: plan.reason ?? "" } : { kind: "main" };
    if (plan.exists) return { kind: "worktree", created: false, ref: { key, branch: plan.branch || null, path: plan.path, dir: listed.find((w) => w.key === key)?.dir ?? plan.path } };
    if (!needed) return { kind: "main" };
    const req: WorktreeApproval = { title: copy("wtTitle", { key }), command: plan.command, scope: copy("wtScope", { branch: plan.branch, path: plan.path }) };
    const d = await deps.approve(req);
    if (!d.approved) {
      await deps.audit(root, { feature: "codev", action: "worktree.create", command: plan.command, scope: req.scope, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
      deps.notify(copy("wtRefused", { key }));
      return { kind: "refused" };
    }
    try {
      const w = await deps.gateway.create(root, key, plan.command, d.decidedAt);
      void refresh();
      return { kind: "worktree", created: true, ref: refOf(w) };
    } catch (e: unknown) {
      deps.notify(copy("wtFailed", { key, error: msg(e) }));
      return { kind: "refused" };
    }
  }

  /** Relê as worktrees e as reservas (erros: fica o que havia). */
  async function refresh(): Promise<void> {
    const root = deps.root();
    if (!root) {
      listed = [];
      claims = [];
      return changed();
    }
    const [l, c] = await Promise.all([deps.gateway.list(root).catch(() => null), deps.gateway.claims(root).catch(() => null)]);
    if (l) listed = l;
    if (c) claims = c;
    changed();
  }

  /** Ao abrir uma pasta: as worktrees de uma execução anterior (sem sessão) são ditas ao humano. */
  async function workspaceOpened(): Promise<void> {
    await refresh();
    const left = kept(listed);
    if (left.length) deps.notify(copy("wtLeftovers", { n: left.length, keys: left.map((w) => w.key).join(", ") }));
  }

  /** Depois de uma sessão com worktree fechar: diz se ficou (alterações por commitar) ou saiu. */
  async function sessionClosed(ref: WorktreeRef): Promise<void> {
    await refresh();
    const w = listed.find((x) => x.key === ref.key);
    if (w && !w.session && w.dirty.length) deps.notify(copy("wtKept", { key: ref.key, files: w.dirty.slice(0, 4).join(", ") + (w.dirty.length > 4 ? " …" : "") }));
    else if (!w) deps.notify(copy("wtRemoved", { key: ref.key, branch: ref.branch ?? "?" }));
  }

  /** Um ficheiro da worktree de `key`, só de leitura: como estava onde o ramo saiu, e como está. */
  async function openFile(key: string, path: string): Promise<void> {
    const root = deps.root();
    if (!root) return;
    try {
      const f = await deps.gateway.file(root, key, path);
      deps.openReadOnly(f.abs, f.before ?? "", f.now ?? "", copy("wtReadOnly", { key, branch: f.branch ?? "?" }));
    } catch (e: unknown) {
      deps.notify(copy("wtNoFile", { key, path, error: msg(e) }));
    }
  }

  /** A proposta de uma revisão de hunks de uma sessão numa worktree, só de leitura: o ficheiro de lá e o
   *  texto com os blocos aplicados (`proposed`, a partir do actual). */
  async function openProposal(ref: WorktreeRef, path: string, proposed: (now: string) => string): Promise<void> {
    const root = deps.root();
    if (!root) return;
    try {
      const f = await deps.gateway.file(root, ref.key, path);
      const now = f.now ?? "";
      deps.openReadOnly(f.abs, now, proposed(now), copy("wtProposal", { key: ref.key, branch: ref.branch ?? f.branch ?? "?" }));
    } catch (e: unknown) {
      deps.notify(copy("wtNoFile", { key: ref.key, path, error: msg(e) }));
    }
  }

  /** «Commit» da faixa: tudo o que a worktree tem, no ramo dela (nada é integrado). */
  async function commit(key: string): Promise<void> {
    const root = deps.root();
    const w = listed.find((x) => x.key === key);
    if (!root) return;
    const branch = w?.branch ?? "?";
    const m = await deps.ask(copy("wtCommitAsk", { key, branch }), `${key}: `);
    if (!m || !m.trim() || m.trim() === `${key}:`) return;
    try {
      const sha = await deps.guard(() => deps.gateway.commit(root, key, m.trim()));
      deps.notify(copy("wtCommitted", { key, sha, branch }));
    } catch (e: unknown) {
      deps.notify(msg(e));
    }
    await refresh();
  }

  /** Limpa uma worktree sem sessão (aprovado; o Rust audita antes e com o resultado). Com alterações por
   *  commitar, fica — o Rust nunca força. */
  async function cleanup(key: string): Promise<void> {
    const root = deps.root();
    const w = listed.find((x) => x.key === key && !x.session);
    if (!root || !w || !w.remove) return;
    const req: WorktreeApproval = { title: copy("wtRemoveTitle", { key }), command: w.remove, scope: copy("wtRemoveScope", { path: w.path, branch: w.branch ?? "?" }) };
    const d = await deps.approve(req);
    if (!d.approved) {
      await deps.audit(root, { feature: "codev", action: "worktree.remove", command: w.remove, scope: req.scope, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
      return;
    }
    try {
      const r = await deps.gateway.remove(root, key, w.remove, d.decidedAt);
      deps.notify(r.removed ? copy("wtRemoved", { key, branch: w.branch ?? "?" }) : copy("wtKept", { key, files: r.dirty.slice(0, 4).join(", ") }));
    } catch (e: unknown) {
      deps.notify(msg(e));
    }
    await refresh();
  }

  return {
    prepare,
    refresh,
    workspaceOpened,
    sessionClosed,
    openFile,
    openProposal,
    commit,
    cleanup,
    /** Todas as worktrees do Co-Dev listadas. */
    listed: (): ListedWorktree[] => listed,
    /** As que não têm sessão aberta (guardadas, ou deixadas por um crash). */
    kept: (): ListedWorktree[] => kept(listed),
    /** A worktree de uma issue (a que a lista conhece). */
    of: (key: string): ListedWorktree | undefined => listed.find((w) => w.key === key),
    cleanable,
    /** Os ficheiros reservados por uma sessão. */
    claimsOf: (session: string): string[] => claimsBySession(claims).get(session) ?? [],
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

export type Worktrees = ReturnType<typeof makeWorktrees>;
