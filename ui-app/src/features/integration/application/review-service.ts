/* ═════════ feature `integration` — caso de uso: o painel de revisão e integração de uma issue (Multi Co-Dev, fase 4) ═════════
   Lê a porta da issue ao backend (`codev_review_state`: as três condições com o porquê, a revisão mais recente,
   e o comando exacto de cada botão), pede a revisão e integra — sempre pelo diálogo de aprovação partilhado
   com o comando que o Rust deu, e o Rust corre só esse, audita antes e com o resultado, e pergunta a porta
   outra vez no clique. Aqui nada decide se se pode integrar: o botão só acende quando o backend devolveu o
   comando de integração, e mesmo assim é o Rust quem recusa. As recusas do humano vão ao registo de
   auditoria por aqui (o Rust não chega a saber delas). Sem DOM, sem window. */

import { canIntegrate, short, type Check, type ReviewEvent, type ReviewState } from "../domain/types";
import type { ReviewDeps } from "./ports";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeReviewService(deps: ReviewDeps) {
  const states = new Map<string, ReviewState>();
  const errors = new Map<string, string>();
  const stages = new Map<string, string>();
  const busy = new Set<string>();
  const listeners = new Set<() => void>();
  let opened: string | null = null;
  let listening: Promise<unknown> | null = null;
  const changed = (): void => listeners.forEach((f) => f());

  /** Relê a porta da issue (um erro fica à vista no painel; o estado antigo não finge que vale). */
  async function refresh(key: string): Promise<ReviewState | null> {
    const root = deps.root();
    if (!root) return null;
    try {
      const s = await deps.gateway.state(root, key);
      states.set(key, s);
      errors.delete(key);
      if (!s.running) stages.delete(key);
      return s;
    } catch (e: unknown) {
      states.delete(key);
      errors.set(key, msg(e));
      return null;
    } finally {
      changed();
    }
  }

  function stageText(e: ReviewEvent): string | null {
    switch (e.stage) {
      case "check":
        return deps.copy("stage_check", { name: e.name ?? "?" });
      case "rules":
        return deps.copy("stage_rules");
      case "reviewer":
        return deps.copy("stage_reviewer");
      case "reviewer-tool":
        return deps.copy("stage_tool", { tool: e.tool ?? "?" });
      default:
        return null;
    }
  }

  function onEvent(e: ReviewEvent): void {
    if (e.root !== deps.root()) return;
    if (e.stage === "done") {
      stages.delete(e.key);
      deps.notify(deps.copy("reviewDone", { key: e.key, state: e.state ?? "?" }));
      void refresh(e.key);
      return;
    }
    const t = stageText(e);
    if (t) stages.set(e.key, t);
    // a check that ended changes the panel (its row); the rest only the stage line
    if (e.stage === "checked" && states.has(e.key)) void refresh(e.key);
    else changed();
  }

  function listen(): void {
    if (!listening) listening = deps.gateway.onEvent(onEvent).catch(() => (listening = null));
  }

  /** Abre o painel da issue (um de cada vez). */
  async function open(key: string): Promise<void> {
    opened = key;
    listen();
    changed();
    await refresh(key);
  }

  function close(): void {
    opened = null;
    changed();
  }

  async function once(key: string, f: () => Promise<void>): Promise<void> {
    if (busy.has(key)) return;
    busy.add(key);
    changed();
    try {
      await f();
    } finally {
      busy.delete(key);
      changed();
    }
  }

  /** «Pedir revisão»: o comando que o Rust deu, aprovado; recusado, fica no registo de auditoria. */
  function request(key: string): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      const s = await refresh(key);
      if (!root || !s || !s.request) return;
      const target = s.tips?.target ?? "?";
      const req = {
        title: deps.copy("reqApprovalTitle", { key, target }),
        command: s.request,
        scope: deps.copy("reqApprovalScope", { branch: s.tips?.branch ?? "?", target }),
      };
      const d = await deps.approve(req);
      if (!d.approved) {
        await deps.audit(root, { feature: "codev", action: "review.request", command: s.request, scope: req.scope, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
        deps.notify(deps.copy("refused"));
        return;
      }
      try {
        await deps.gateway.request(root, key, s.request, d.decidedAt, deps.reviewer());
        deps.notify(deps.copy("requested", { key }));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  async function cancel(key: string): Promise<void> {
    const root = deps.root();
    if (root) await deps.gateway.cancel(root, key).catch(() => false);
    await refresh(key);
  }

  /** «Integrar»: relê a porta; só com ela aberta e o comando do Rust pede a aprovação; o secret scan pode
   *  pedir um motivo (`guard`); no fim fecha a sessão Co-Dev da issue (fase 3) e o Project relê-se. */
  function integrate(key: string): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      const s = await refresh(key);
      if (!root || !s || !canIntegrate(s) || !s.integrate || !s.review) return;
      const command = s.integrate;
      const target = s.review.tips.target;
      const req = {
        title: deps.copy("intApprovalTitle", { key, target }),
        command,
        scope: deps.copy("intApprovalScope", { target, from: short(s.review.tips.base), to: short(s.review.candidate) }),
      };
      const d = await deps.approve(req);
      if (!d.approved) {
        await deps.audit(root, { feature: "codev", action: "review.integrate", command, scope: req.scope, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
        deps.notify(deps.copy("refused"));
        return;
      }
      try {
        const r = await deps.guard(() => deps.gateway.integrate(root, key, command, d.decidedAt));
        deps.notify(deps.copy("integrated", { key, target: r.target, commit: short(r.commit), state: r.state, snapshot: r.snapshot }));
        if (r.worktreeKept.length) deps.notify(deps.copy("worktreeKept", { key, files: r.worktreeKept.slice(0, 4).join(", ") }));
        if (r.session) deps.closeSession(r.session);
        deps.projectChanged();
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  /** Sem verificações obrigatórias: grava o comando de testes detectado como a verificação do projecto
   *  (um clique num botão que diz o comando; a op `settings` do Project). */
  function useDetected(key: string): Promise<void> {
    return once(key, async () => {
      const cmd = deps.detectedTest();
      if (!cmd) return;
      const checks: Check[] = [{ name: "tests", command: cmd }];
      try {
        await deps.setChecks(checks);
        deps.notify(deps.copy("checksSaved", { cmd }));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  return {
    open,
    close,
    refresh,
    request,
    cancel,
    integrate,
    useDetected,
    /** A issue cujo painel está aberto. */
    opened: (): string | null => opened,
    state: (key: string): ReviewState | null => states.get(key) ?? null,
    error: (key: string): string | null => errors.get(key) ?? null,
    stage: (key: string): string | null => stages.get(key) ?? null,
    busy: (key: string): boolean => busy.has(key),
    detected: (): string | null => deps.detectedTest(),
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

export type ReviewService = ReturnType<typeof makeReviewService>;
