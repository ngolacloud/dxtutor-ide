/* ═════════ feature `integration` — caso de uso: a autonomia delegada e os pull requests (Multi Co-Dev, fase 5) ═════════
   Lê a autonomia de uma issue (`codev_autonomy_state`: o interruptor, as delegações dela e da sprint dela, o
   registo dos passos) e o seu pull request (`codev_pr_state`), e faz o que um humano pede: delegar (o diálogo de
   aprovação partilhado mostra o que fica delegado; o Rust verifica o papel e audita), revogar, pausar (já, sem
   diálogo: é o travão), retomar (com diálogo), e abrir o pull request com o texto que o Rust deu (o Rust pergunta
   a porta outra vez; o secret scan pode pedir um motivo). Ouve os passos da autonomia: avisa, relê, e fecha a
   sessão de uma issue integrada. Aqui nada decide: o backend recusa. Sem DOM, sem window. */

import { canOpenPr, grantProblem, type Action, type Overview, type PrState } from "../domain/autonomy";
import type { AuditRow, AutonomyDeps } from "./ports";
import { AUTONOMY_MESSAGES, type AutonomyKey } from "./autonomy-messages";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const ACTION_KEY: Record<Action, AutonomyKey> = { review: "act_review", integrate: "act_integrate", pr: "act_pr" };

export function makeAutonomyService(deps: AutonomyDeps) {
  const overviews = new Map<string, Overview>();
  const prs = new Map<string, PrState>();
  const errors = new Map<string, string>();
  const busy = new Set<string>();
  const audits = new Map<number, AuditRow>();
  const shown = new Set<number>();
  const listeners = new Set<() => void>();
  let listening: Promise<unknown> | null = null;
  const changed = (): void => listeners.forEach((f) => f());

  /** Relê a autonomia e o pull request da issue (um erro fica à vista; o estado antigo não finge que vale). */
  async function refresh(key: string): Promise<void> {
    const root = deps.root();
    if (!root) return;
    const [o, p] = await Promise.allSettled([deps.gateway.overview(root, key), deps.gateway.prState(root, key)]);
    if (o.status === "fulfilled") overviews.set(key, o.value);
    else overviews.delete(key);
    if (p.status === "fulfilled") prs.set(key, p.value);
    else prs.delete(key);
    const err = [o, p].filter((x): x is PromiseRejectedResult => x.status === "rejected").map((x) => msg(x.reason));
    if (err.length) errors.set(key, err.join(" · "));
    else errors.delete(key);
    changed();
  }

  function eventText(code: string): string {
    const k = `ev_${code}`;
    // an unknown code (a newer backend) is said as it is
    return Object.prototype.hasOwnProperty.call(AUTONOMY_MESSAGES.en, k) ? deps.copy(k as AutonomyKey) : deps.copy("ev_unknown", { code });
  }

  function listen(): void {
    if (listening) return;
    listening = deps.gateway
      .onNotice((n) => {
        if (n.root !== deps.root()) return;
        deps.notify(deps.copy("notice", { key: n.event.key, text: eventText(n.event.code) }));
        if (n.integrated) {
          if (n.session) deps.closeSession(n.session);
          deps.projectChanged();
        }
        deps.reviewChanged(n.event.key);
        if (overviews.has(n.event.key)) void refresh(n.event.key);
      })
      .catch(() => (listening = null));
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

  /** Delega `actions` na issue (ou na sprint dela) por `hours` horas: o diálogo mostra o que fica delegado; o Rust
   *  verifica o papel de quem delega e audita. Uma recusa no diálogo fica no registo de auditoria. */
  function grant(key: string, scope: "issue" | "sprint", actions: Action[], hours: number): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      if (!root) return;
      const problem = grantProblem(actions);
      if (problem) {
        deps.notify(deps.copy(problem === "none" ? "pickOne" : "pickNotBoth"));
        return;
      }
      const target = scope === "issue" ? key : (overviews.get(key)?.sprint ?? "");
      if (!target) {
        deps.notify(deps.copy("noSprint"));
        return;
      }
      const where = deps.copy(scope === "issue" ? "scope_issue" : "scope_sprint", { target });
      const command = `delegate ${actions.join(", ")} on ${scope} ${target} for ${hours} h`;
      const d = await deps.approve({
        title: deps.copy("grantApprovalTitle", { scope: where }),
        command,
        scope: `autonomy · ${scope} ${target}`,
        list: { heading: deps.copy("grantHeading"), items: actions.map((a) => deps.copy(ACTION_KEY[a])), note: deps.copy("grantNote") },
      });
      if (!d.approved) {
        await deps.audit(root, { feature: "codev", action: "autonomy.grant", command, scope: `autonomy · ${scope} ${target}`, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
        deps.notify(deps.copy("refused"));
        return;
      }
      try {
        const r = deps.reviewer();
        await deps.gateway.grant(root, { scope, target, actions, hours, provider: r.provider, model: r.model, language: r.language });
        deps.notify(deps.copy("granted", { scope: where, actions: actions.map((a) => deps.copy(ACTION_KEY[a])).join("; ") }));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  /** Revoga uma delegação (só tira poder: sem diálogo; o Rust audita). */
  function revoke(key: string, id: number): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      if (!root) return;
      try {
        await deps.gateway.revoke(root, id);
        deps.notify(deps.copy("revoked", { id }));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  /** «Pausar a autonomia»: já, sem diálogo (é o travão de toda a app; o Rust audita e pára as revisões autónomas). */
  async function pause(key: string): Promise<void> {
    const root = deps.root();
    if (!root) return;
    try {
      await deps.gateway.pause(root, true, "");
      deps.notify(deps.copy("pausedNow"));
    } catch (e: unknown) {
      deps.notify(deps.copy("failed", { error: msg(e) }));
    }
    await refresh(key);
  }

  /** «Retomar a autonomia»: volta a deixar agir o que está delegado — por isso com o diálogo de aprovação. */
  function resume(key: string): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      if (!root) return;
      const command = "resume autonomy";
      const d = await deps.approve({ title: deps.copy("resumeApprovalTitle"), command, scope: "autonomy · every project" });
      if (!d.approved) {
        await deps.audit(root, { feature: "codev", action: "autonomy.resume", command, scope: "autonomy · every project", approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
        deps.notify(deps.copy("refused"));
        return;
      }
      try {
        await deps.gateway.pause(root, false, d.reason);
        deps.notify(deps.copy("resumedNow"));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      await refresh(key);
    });
  }

  /** «Abrir um pull request»: relê o estado; só com o texto do Rust pede a aprovação; o secret scan pode pedir um
   *  motivo (`guard`). O merge fica com o GitHub. */
  function openPr(key: string): Promise<void> {
    return once(key, async () => {
      const root = deps.root();
      if (!root) return;
      await refresh(key);
      const p = prs.get(key) ?? null;
      if (!p || !canOpenPr(p) || !p.plan) return;
      const command = p.plan;
      // the push line names the branch, the target, the remote and the commit — the dialog says them
      const m = /push --porcelain -- (\S+) ([0-9a-f]{40}):refs\/heads\/(\S+)/.exec(command);
      const target = /--base '([^']*)'/.exec(command)?.[1] ?? "?";
      const [remote, head, branch] = m ? [m[1], m[2], m[3]] : ["?", "?", "?"];
      const req = {
        title: deps.copy("prApprovalTitle", { branch, target }),
        command,
        scope: deps.copy("prApprovalScope", { remote, head: head.slice(0, 8) }),
      };
      const d = await deps.approve(req);
      if (!d.approved) {
        await deps.audit(root, { feature: "codev", action: "review.pr", command, scope: req.scope, approved: false, decidedAt: d.decidedAt }).catch(() => undefined);
        deps.notify(deps.copy("refused"));
        return;
      }
      try {
        const o = await deps.guard(() => deps.gateway.prOpen(root, key, command, d.decidedAt));
        deps.notify(deps.copy("prOpened", { n: o.number, url: o.url }));
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
      }
      deps.reviewChanged(key);
      await refresh(key);
    });
  }

  /** Mostra (ou esconde) uma linha do registo de auditoria que um passo escreveu. */
  async function toggleAudit(key: string, id: number): Promise<void> {
    if (shown.has(id)) {
      shown.delete(id);
      changed();
      return;
    }
    const root = deps.root();
    if (!root) return;
    if (!audits.has(id)) {
      try {
        for (const r of await deps.gateway.auditRows(root, key)) audits.set(r.id, r);
      } catch (e: unknown) {
        deps.notify(deps.copy("failed", { error: msg(e) }));
        return;
      }
    }
    if (audits.has(id)) shown.add(id);
    changed();
  }

  return {
    refresh,
    grant,
    revoke,
    pause,
    resume,
    openPr,
    toggleAudit,
    listen,
    eventText,
    overview: (key: string): Overview | null => overviews.get(key) ?? null,
    pr: (key: string): PrState | null => prs.get(key) ?? null,
    error: (key: string): string | null => errors.get(key) ?? null,
    busy: (key: string): boolean => busy.has(key),
    /** As linhas de auditoria à vista, por id. */
    audit: (id: number): AuditRow | null => (shown.has(id) ? (audits.get(id) ?? null) : null),
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
  };
}

export type AutonomyService = ReturnType<typeof makeAutonomyService>;
