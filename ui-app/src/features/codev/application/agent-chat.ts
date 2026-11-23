/* ═══════════ Co-Dev — caso de uso: conversa com o agente v2 (ADR-0003, F4) ═══════════
   O loop vive no backend (`tutor-agent`, comandos `codev_agent_*`); aqui só se abre a
   sessão, se envia a mensagem e se traduz cada evento do turno para o presenter:
   texto em streaming, raciocínio resumido, linhas de ferramenta com o resultado real,
   pedidos de aprovação (com razão e «permitir sempre» quando a política o oferece) e o
   custo. Sem DOM, sem window, sem Tauri — tudo pelas portas (`AgentChatDeps`). */

import type { AgentChatDeps, CardRef, ToolRef } from "./ports";
import type { AgentEvent, ApprovalRequest } from "../domain/agent-events";
import { describeCall, describeSession, outcomeNotice, summarizeResult } from "../domain/agent-events";
import { formatUsage } from "../domain/pricing";

/** O turno em curso: cartão, segmentos de texto (um por pedido ao modelo), ferramentas. */
interface Turn {
  card: CardRef;
  segments: string[];
  reasoning: string;
  tools: Map<string, ToolRef>;
  finish: () => void;
}

export function makeAgentChat(deps: AgentChatDeps) {
  const { gateway, presenter, gate } = deps;
  let session: string | null = null;
  let turn: Turn | null = null;
  let unsubscribe: (() => void) | null = null;

  const text = (t: Turn): string => t.segments.filter((s) => s !== "").join("\n\n");

  const toolRef = (t: Turn, id: string, name: string, label: string): ToolRef => {
    let r = t.tools.get(id);
    if (!r) {
      r = presenter.toolLine(t.card.tools, name, label);
      t.tools.set(id, r);
    }
    return r;
  };

  function onEvent(s: string, e: AgentEvent): void {
    const t = turn;
    if (!t || s !== session) return;
    switch (e.kind) {
      case "stream": {
        const ev = e.event;
        if (ev.type === "message_start") t.segments.push("");
        else if (ev.type === "text_delta") {
          if (!t.segments.length) t.segments.push("");
          t.segments[t.segments.length - 1] += ev.text;
          presenter.assistantText(t.card, text(t));
        } else if (ev.type === "thinking_delta") {
          t.reasoning += ev.text;
          presenter.agentReasoning?.(t.card, t.reasoning);
        }
        break;
      }
      case "retrying":
        // o pedido vai ser repetido: o parcial deste pedido é descartado
        if (t.segments.length) t.segments[t.segments.length - 1] = "";
        presenter.assistantText(t.card, text(t) || "…");
        presenter.agentNote?.(t.card, "retry", `A repetir o pedido (${e.reason})…`);
        break;
      case "tool_start":
        toolRef(t, e.id, e.name, describeCall(e.name, e.input));
        break;
      case "tool_result":
        presenter.toolRunResult(toolRef(t, e.id, e.name, ""), !e.is_error, summarizeResult(e.content));
        break;
      case "usage":
        presenter.agentNote?.(t.card, "usage", formatUsage(deps.model(), e.turn));
        break;
      case "served_by":
        presenter.agentNote?.(t.card, "fallback", `Respondido por ${e.model} (fallback do servidor).`);
        break;
      case "done": {
        if (!text(t)) presenter.assistantText(t.card, e.outcome.type === "done" ? "(sem texto)" : "");
        const n = outcomeNotice(e.outcome);
        if (n) presenter.agentNote?.(t.card, "outcome", n);
        t.finish();
        break;
      }
    }
  }

  async function onApproval(s: string, r: ApprovalRequest): Promise<void> {
    const t = turn;
    if (!t || s !== session) return;
    const ref = toolRef(t, r.call.id, r.call.name, describeCall(r.call.name, r.call.input, r.call.command));
    presenter.toolReason?.(ref, r.reason, r.dangerous);
    type Choice = "allow" | "always" | "deny";
    const btns: Array<{ l: string; v: Choice; pri?: boolean; done: string }> = [
      { l: "Permitir", v: "allow", pri: true, done: "✓ autorizado por ti" },
    ];
    if (r.suggestedRule && !r.dangerous) {
      btns.push({ l: "Permitir sempre", v: "always", done: `✓ sempre permitido (${r.suggestedRule})` });
    }
    btns.push({ l: "Recusar", v: "deny", done: "✗ recusado por ti" });
    // parado enquanto esperava (o gate rejeita) → recusa
    const v: Choice = await gate.ask<Choice>(ref, btns).catch((): Choice => "deny");
    await gateway.approve(s, r.call.id, v !== "deny", v === "deny" ? "o humano recusou" : undefined, v === "always");
  }

  function onError(s: string, message: string): void {
    const t = turn;
    if (!t || s !== session) return;
    presenter.liveError(t.card, false, undefined, message);
    t.finish();
  }

  async function ensureSubscribed(): Promise<void> {
    if (!unsubscribe) {
      unsubscribe = await gateway.subscribe({
        event: onEvent,
        approval: (s, r) => void onApproval(s, r),
        error: onError,
      });
    }
  }

  async function ensureSession(): Promise<string> {
    await ensureSubscribed();
    if (!session) {
      session = await gateway.start({
        root: deps.workspace.root(),
        model: deps.model(),
        effort: "high",
        testCmd: deps.verify.command("test")?.cmd ?? null,
        lintCmd: deps.verify.command("lint")?.cmd ?? null,
        mode: deps.mode(),
      });
    }
    return session;
  }

  /** Envia uma mensagem do utilizador e espera pelo fim do turno. */
  async function send(q: string): Promise<void> {
    presenter.userMessage(q);
    const card = presenter.thinking(deps.speaker());
    presenter.beginRun("Agente Co-Dev");
    const signal = presenter.startAbort();
    try {
      const id = await ensureSession();
      await new Promise<void>((resolve) => {
        turn = { card, segments: [], reasoning: "", tools: new Map(), finish: resolve };
        signal.addEventListener("abort", () => void gateway.cancel(id), { once: true });
        gateway.send(id, q).catch((e: unknown) => {
          presenter.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
          resolve();
        });
      });
    } catch (e: unknown) {
      presenter.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
    } finally {
      turn = null;
      presenter.endRun();
      await deps.reloadFromDisk().catch(() => undefined);
      presenter.refreshCtx();
      presenter.scrollMsgs();
    }
  }

  /** `/retomar`: lista as conversas anteriores do projecto e retoma a escolhida — o
   *  backend reabre-a com o prefixo gravado; aqui redesenha-se a conversa. */
  async function resumeMenu(): Promise<void> {
    const card = presenter.thinking(deps.speaker());
    try {
      const list = await gateway.sessions(deps.workspace.root());
      if (!list.length) {
        presenter.assistantText(card, "Ainda não há conversas anteriores neste projecto.");
        return;
      }
      presenter.assistantText(card, "Conversas anteriores deste projecto — escolhe uma para continuar:");
      const now = deps.nowSecs();
      const btns = list.slice(0, 6).map((s, i) => ({ l: describeSession(s, now), v: s.id, pri: i === 0 }));
      const pick = await gate.ask<string>(card.tools, [...btns, { l: "Cancelar", v: "" }]).catch(() => "");
      if (!pick) return;
      if (session && session !== pick) void gateway.close(session);
      await ensureSubscribed();
      session = await gateway.start({
        root: deps.workspace.root(),
        model: deps.model(),
        effort: "high",
        testCmd: null,
        lintCmd: null,
        mode: deps.mode(),
        resume: pick,
      });
      for (const h of await gateway.history(session)) {
        if (h.role === "user") presenter.userMessage(h.text);
        else {
          const c = presenter.thinking(deps.speaker());
          presenter.assistantText(c, h.text || "(só chamadas de ferramentas)");
          if (h.tools.length) presenter.agentNote?.(c, "tools", `${h.tools.length} chamada(s): ${h.tools.join(", ")}`);
        }
      }
      const end = presenter.thinking(deps.speaker());
      presenter.assistantText(end, "Conversa retomada. Continua a escrever — o agente tem o histórico completo.");
    } catch (e: unknown) {
      presenter.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
    } finally {
      presenter.scrollMsgs();
    }
  }

  return {
    available: (): boolean => gateway.available(),
    send,
    resumeMenu,
    /** A modebar mudou: vale a partir da próxima decisão da sessão em curso. */
    modeChanged(mode: string): void {
      if (session) void gateway.setMode(session, mode);
    },
    /** Nova conversa: fecha a sessão (o histórico vive no backend). */
    reset(): void {
      if (session) void gateway.close(session);
      session = null;
    },
  };
}

export type AgentChat = ReturnType<typeof makeAgentChat>;
