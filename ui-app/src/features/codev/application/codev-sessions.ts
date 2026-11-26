/* ═══════════ Co-Dev — caso de uso: várias sessões Co-Dev (Multi Co-Dev, fase 2) ═══════════
   Cada sessão é uma conversa própria (`makeAgentChat`, com o seu transcript e a sua barra de
   execução); a conversa à vista é a da sessão seleccionada. Começar outra issue do Project já não
   fecha a que corre: abre outra sessão para ela — mas só se o âmbito dela não se sobrepuser ao de
   nenhuma issue em curso, porque nesta fase todas correm na MESMA árvore de trabalho (as worktrees
   são a fase 3). Com sobreposição, recusa com os ficheiros e oferece esperar: a issue começa quando
   a sessão com que choca fechar. Os hunks de uma sessão em segundo plano não se pintam no editor
   até se abrir a conversa dela.

   Com uma só sessão tudo é como antes: a conversa livre e a primeira issue usam a mesma sessão (uma
   issue nova fecha a conversa livre, como sempre); repetir a issue em curso recomeça-a.
   Sem DOM, sem window, sem Tauri: tudo pelas portas. */

import type { AgentChat } from "./agent-chat";
import type { CodevCopy } from "./messages";
import { ptCopy } from "./messages";
import { clashFiles, clashLines, type ScopeClash } from "../domain/scope-overlap";
import type { BacklogProposal } from "../domain/backlog";

/** O lado visível de uma sessão (o transcript, a barra de execução): `ui/session-view.ts`. */
export interface SessionSlotView {
  show(): void;
  hide(): void;
  /** A sessão fechou: larga o transcript (e recusa a decisão que estivesse à espera). */
  dispose(): void;
  /** Há uma decisão à espera do humano nesta sessão. */
  waiting(): boolean;
  /** Um turno corre nesta sessão. */
  running(): boolean;
}

/** Uma issue que vai ao Co-Dev (`app/codev-issue`). */
export interface IssueRun {
  key: string;
  text: string;
  scope: string[];
  template: string;
}

export interface CodevSessionsDeps {
  copy?: CodevCopy;
  /** Cria uma sessão: a conversa e a vista. `selected()` diz, no acto, se é a que está à vista. */
  make(ctx: { selected(): boolean; label(): string }): { chat: AgentChat; view: SessionSlotView };
  /** A verificação de âmbito (`project_scope_overlap`); sem ela (sem backend), não há com que comparar. */
  overlap?(key: string, running: string[]): Promise<ScopeClash[]>;
  /** Os hunks no editor: quais sessões não se desenham e quando isso muda. */
  hunks: { setHidden(f: (session: string) => boolean): void; visibilityChanged(): void; forget(session: string): void };
  confirm(message: string): boolean;
  notify(message: string): void;
}

interface Slot {
  id: number;
  chat: AgentChat;
  view: SessionSlotView;
}

/** O que a faixa «Co-Devs» desenha de cada sessão. */
export interface SlotInfo {
  id: number;
  session: string | null;
  issue: string | null;
  selected: boolean;
  running: boolean;
  waiting: boolean;
}

export interface QueuedIssue {
  key: string;
  /** As issues em curso com que choca. */
  blockers: string[];
}

export function makeCodevSessions(deps: CodevSessionsDeps) {
  const copy = deps.copy ?? ptCopy;
  const slots: Slot[] = [];
  let selected!: Slot;
  let nextId = 1;
  const queue: Array<{ run: IssueRun; blockers: string[] }> = [];
  const listeners = new Set<() => void>();
  /** Os começos de issues correm um de cada vez (a verificação é assíncrona: dois cliques seguidos
   *  não podem passar os dois por uma sessão que ainda não existe). */
  let lock: Promise<unknown> = Promise.resolve();

  const changed = (): void => listeners.forEach((f) => f());

  function newSlot(): Slot {
    const id = nextId++;
    const slot = {} as Slot;
    const made = deps.make({ selected: () => selected === slot, label: () => labelOf(slot) });
    Object.assign(slot, { id, chat: made.chat, view: made.view });
    slots.push(slot);
    return slot;
  }
  const labelOf = (s: Slot): string => (s.chat.issueKey() ? `Co-Dev · ${s.chat.issueKey()}` : "Co-Dev");

  selected = newSlot();
  // os hunks das sessões que não estão à vista não se pintam no editor
  deps.hunks.setHidden((session) => slots.some((s) => s !== selected && s.chat.sessionId() === session));

  function select(slot: Slot): void {
    if (slot === selected) return;
    selected.view.hide();
    selected = slot;
    slot.view.show();
    deps.hunks.visibilityChanged();
    changed();
  }

  /** As sessões que trabalham uma issue (seguram o âmbito dela), tirando `except`. */
  const holding = (except?: string): Slot[] => slots.filter((s) => s.chat.issueKey() && s.chat.issueKey() !== except);

  /** Pode `key` começar agora? `[]` sim; os choques, se não; lança se a verificação falhar. */
  async function clashes(key: string): Promise<ScopeClash[]> {
    const running = holding(key).map((s) => s.chat.issueKey()!);
    if (!running.length || !deps.overlap) return [];
    return deps.overlap(key, running);
  }

  /** Onde a issue vai: a sessão que já a trabalha, a à vista se não segura outra issue, ou uma nova. */
  function target(key: string, background: boolean): Slot {
    const own = slots.find((s) => s.chat.issueKey() === key);
    if (own) return own;
    if (!background && !selected.chat.issueKey()) return selected;
    // em segundo plano: uma conversa parada e vazia que não está à vista serve; senão, uma nova
    return (background && slots.find((s) => s !== selected && !s.chat.sessionId() && !s.chat.issueKey())) || newSlot();
  }

  function issue(run: IssueRun): Promise<boolean> {
    const step = lock.then(async (): Promise<Slot | null> => {
      let found: ScopeClash[];
      try {
        found = await clashes(run.key);
      } catch (e: unknown) {
        deps.notify(copy("overlapCheckFailed", { key: run.key, error: e instanceof Error ? e.message : String(e) }));
        return null;
      }
      if (found.length) {
        const others = [...new Set(found.map((c) => c.other))];
        const ask = copy("overlapAsk", { key: run.key, list: clashLines(found), others: others.join(", ") });
        if (deps.confirm(ask)) {
          if (!queue.some((q) => q.run.key === run.key)) queue.push({ run, blockers: others });
          deps.notify(copy("overlapQueued", { key: run.key, others: others.join(", ") }));
          changed();
        } else {
          deps.notify(copy("overlapRefused", { key: run.key, others: others.join(", "), files: clashFiles(found, 3, (n) => copy("moreFiles", { n })) }));
        }
        return null;
      }
      const slot = target(run.key, false);
      select(slot);
      return slot;
    });
    lock = step.catch(() => undefined);
    return step.then((slot) => {
      if (!slot) return false;
      const done = slot.chat.issue(run);
      changed();
      return done;
    });
  }

  /** Depois de uma sessão fechar: as issues à espera que já não chocam começam, em segundo plano. */
  function drain(): void {
    if (!queue.length) return changed();
    lock = lock
      .then(async () => {
        for (const q of [...queue]) {
          let found: ScopeClash[];
          try {
            found = await clashes(q.run.key);
          } catch {
            continue;
          }
          if (found.length) {
            q.blockers = [...new Set(found.map((c) => c.other))];
            continue;
          }
          queue.splice(queue.indexOf(q), 1);
          const slot = target(q.run.key, true);
          deps.notify(copy("queuedStarted", { key: q.run.key }));
          void slot.chat.issue(q.run);
        }
      })
      .catch(() => undefined)
      .finally(changed);
  }

  /** Fecha uma sessão: a conversa acaba no backend; havendo outras, a sessão sai da faixa. */
  function close(id: number): void {
    const slot = slots.find((s) => s.id === id);
    if (!slot) return;
    const session = slot.chat.sessionId();
    slot.chat.reset();
    if (session) deps.hunks.forget(session);
    if (slots.length > 1) {
      if (slot === selected) select(slots.filter((s) => s !== slot).slice(-1)[0]);
      slots.splice(slots.indexOf(slot), 1);
      slot.view.dispose();
    }
    drain();
  }

  /** `/backlog`/`/project`: na conversa à vista, se não trabalha uma issue (nunca se perde uma issue em curso);
   *  senão numa nova, que passa a estar à vista. */
  function backlog(q: string): Promise<boolean> {
    const slot = selected.chat.issueKey() ? newSlot() : selected;
    select(slot);
    const done = slot.chat.backlog(q);
    changed();
    return done;
  }

  return {
    backlog,
    /** Uma proposta do `/backlog`/`/project` vai para a conversa da sessão que a fez (`false`: nenhuma destas). */
    showProposal(p: BacklogProposal): boolean {
      const s = slots.find((x) => x.chat.sessionId() === p.session);
      if (!s) return false;
      s.chat.showProposal(p);
      return true;
    },
    /** A conversa à vista (o compositor, os comandos `/plano`, `/retomar`… falam com ela). */
    current: (): AgentChat => selected.chat,
    /** Todas as conversas abertas (o modo da modebar vale para todas). */
    chats: (): AgentChat[] => slots.map((s) => s.chat),
    /** A sessão da conversa à vista (o mapa de agentes, o separador «Co-Dev run»). */
    sessionId: (): string | null => selected.chat.sessionId(),
    issue,
    /** «Nova conversa»: recomeça a conversa à vista (as outras sessões continuam). */
    resetCurrent(): void {
      selected.chat.reset();
      drain();
    },
    select(id: number): void {
      const s = slots.find((x) => x.id === id);
      if (s) select(s);
    },
    /** Mostra a conversa de uma sessão do backend (do mapa de agentes); `false` se não é uma destas. */
    selectSession(session: string): boolean {
      const s = slots.find((x) => x.chat.sessionId() === session);
      if (s) select(s);
      return !!s;
    },
    has: (session: string): boolean => slots.some((x) => x.chat.sessionId() === session),
    close,
    /** Deixa de esperar: a issue não começa sozinha. */
    unqueue(key: string): void {
      const i = queue.findIndex((q) => q.run.key === key);
      if (i >= 0) queue.splice(i, 1);
      changed();
    },
    slots: (): SlotInfo[] =>
      slots.map((s) => ({ id: s.id, session: s.chat.sessionId(), issue: s.chat.issueKey(), selected: s === selected, running: s.view.running(), waiting: s.view.waiting() })),
    queued: (): QueuedIssue[] => queue.map((q) => ({ key: q.run.key, blockers: [...q.blockers] })),
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    /** Algo mudou numa sessão (um turno começou ou acabou, uma decisão espera): redesenha a faixa. */
    touch: changed,
  };
}

export type CodevSessions = ReturnType<typeof makeCodevSessions>;
