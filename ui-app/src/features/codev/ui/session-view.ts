/* ═══════════ Co-Dev — ui: o lado visível de uma sessão (Multi Co-Dev, fase 2) ═══════════
   Cada sessão Co-Dev tem o seu transcript e a sua barra de execução. A sessão à vista escreve no
   `#ag-msgs` e no `RUN` partilhado exactamente como antes (o presenter e o gate de `chat-view`); uma
   sessão em segundo plano escreve num transcript fora do documento e guarda a sua execução (a
   etiqueta, o tempo, o «parar» e a decisão pendente) num registo próprio. Trocar de sessão move os
   nós do transcript e põe à vista a execução da outra. Não toca no `window` (regra A8). */

import type { ApprovalGate, ChatPresenter, ToolHost } from "../application/ports";
import type { SessionSlotView } from "../application/codev-sessions";
import { applyRun, ask, card, gate as baseGate, idleRun, presenter as base, runLabel, scrollMsgs, snapshotRun, user, type RunRecord } from "./chat-view";
import * as bridge from "../infrastructure/legacy-bridge";
import { swapQueue } from "./composer";

export interface SessionViewOptions {
  /** «Co-Dev · DX-12»: para o aviso de uma decisão em segundo plano. */
  label(): string;
  /** A decisão de uma sessão em segundo plano (um aviso que diz qual). */
  notify(label: string): void;
  /** Algo mudou na execução da sessão (a faixa redesenha-se). */
  changed(): void;
}

const WAITING = "à espera da tua decisão";

export function makeSessionView(opts: SessionViewOptions, startVisible: boolean): SessionSlotView & { presenter: ChatPresenter; gate: ApprovalGate } {
  let visible = startVisible;
  /** O transcript enquanto a sessão não está à vista. */
  const stash = document.createElement("div");
  /** A execução enquanto a sessão não está à vista (mutado no sítio: a barra de decisão guarda-o). */
  const rec: RunRecord = idleRun();
  const into = (): HTMLElement | undefined => (visible ? undefined : stash);
  /** Revisões de hunks à espera de decisão nesta sessão (a faixa mostra «precisa da tua decisão»). */
  let reviews = 0;
  /** As mensagens que o humano pôs na fila desta conversa enquanto ela trabalhava (vão quando ela parar, à vista). */
  let queued: string[] = [];
  const msgs = (): HTMLElement | null => document.getElementById("ag-msgs");

  /** Uma barra de decisão numa sessão em segundo plano: a etiqueta fica nela, não na sessão à vista. */
  const quietly = <T>(f: () => T): T => {
    if (visible) return f();
    const R = bridge.run();
    const label = R.label;
    const r = f();
    R.label = label;
    runLabel();
    rec.label = WAITING;
    opts.notify(opts.label());
    opts.changed();
    return r;
  };

  const presenter: ChatPresenter = {
    ...base,
    userMessage: (t) => user(t, into()),
    thinking: (speaker) => card(speaker, '<span class="spin"></span> a pensar…', into()),
    beginRun(label) {
      if (visible) base.beginRun(label);
      else Object.assign(rec, { active: true, paused: false, stop: false, pend: null, label, t0: Date.now() });
      opts.changed();
    },
    endRun() {
      if (visible) base.endRun();
      else Object.assign(rec, { active: false, paused: false, stop: false, pend: null, abort: null });
      opts.changed();
    },
    startAbort() {
      if (visible) return base.startAbort();
      const ctl = new AbortController();
      rec.abort = ctl;
      return ctl.signal;
    },
    liveError: (ref, aborted, code, msg) => base.liveError(ref, aborted || (!visible && rec.stop), code, msg),
    hunkReview: (ref, info, on) => {
      const bar = quietly(() => base.hunkReview!(ref, info, on));
      reviews++;
      opts.changed();
      return {
        ...bar,
        settle(label: string) {
          reviews = Math.max(0, reviews - 1);
          bar.settle(label);
          opts.changed();
        },
      };
    },
  };

  const gate: ApprovalGate = {
    ask<T>(host: ToolHost, btns: Array<{ l: string; v: T; pri?: unknown; done?: string }>): Promise<T> {
      if (visible) {
        const p = baseGate.ask(host, btns);
        opts.changed();
        return p;
      }
      return ask(host, btns, rec, () => {
        rec.label = WAITING;
        opts.notify(opts.label());
        opts.changed();
      });
    },
  };

  return {
    presenter,
    gate,
    show(): void {
      if (visible) return;
      visible = true;
      const m = msgs();
      if (m) m.replaceChildren(...Array.from(stash.childNodes));
      swapQueue(queued);
      queued = [];
      applyRun(rec);
      scrollMsgs();
    },
    hide(): void {
      if (!visible) return;
      Object.assign(rec, snapshotRun());
      queued = swapQueue([]);
      const m = msgs();
      if (m) stash.replaceChildren(...Array.from(m.childNodes));
      visible = false;
    },
    dispose(): void {
      // a sessão já fechou no backend: a decisão que esperava morre com ela
      rec.pend = null;
      stash.replaceChildren();
    },
    waiting: () => reviews > 0 || !!(visible ? bridge.run().pend : rec.pend),
    running: () => (visible ? !!bridge.run().active : rec.active),
  };
}
