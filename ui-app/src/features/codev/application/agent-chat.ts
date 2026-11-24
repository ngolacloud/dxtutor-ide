/* ═══════════ Co-Dev — caso de uso: conversa com o agente v2 (ADR-0003, F4) ═══════════
   O loop vive no backend (`tutor-agent`, comandos `codev_agent_*`); aqui só se abre a
   sessão, se envia a mensagem e se traduz cada evento do turno para o presenter:
   texto em streaming, raciocínio resumido, linhas de ferramenta com o resultado real,
   pedidos de aprovação (com razão e «permitir sempre» quando a política o oferece) e o
   custo. Sem DOM, sem window, sem Tauri — tudo pelas portas (`AgentChatDeps`). */

import type { AgentChatDeps, CardRef, ToolRef } from "./ports";
import type { AgentEvent, ApprovalRequest } from "../domain/agent-events";
import { ago, callDiff, describeCall, describeSession, isNoToolsError, outcomeNotice, parseTodos, storyPrompt, summarizeResult } from "../domain/agent-events";
import type { BoardStory } from "../domain/agent-events";
import { formatUsage } from "../domain/pricing";
import { proseOnly } from "../domain/prose";

/** O turno em curso: cartão, segmentos de texto (um por pedido ao modelo), ferramentas. */
interface Turn {
  card: CardRef;
  segments: string[];
  reasoning: string;
  tools: Map<string, ToolRef>;
  finish: () => void;
  /** O modelo não tem tool calling nativo: a mensagem vai pelo protocolo de texto. */
  noTools?: boolean;
  /** Live hunks: the file of each call that streams hunks. */
  hunkPaths: Map<string, string>;
}

/** One line for the validation of Auto's provisional changes. */
function validationNote(e: Extract<AgentEvent, { kind: "validation" }>): string {
  const cmds = (e.checks.length ? e.checks : e.baseline).map((c) => "`" + c.command + "`").join(", ");
  switch (e.status) {
    case "running":
      return e.baseline.length ? `A validar as alterações provisórias (${cmds})…` : "A medir a base antes das alterações (testes/lint)…";
    case "passed":
      return `Validação passou (${cmds}): as alterações provisórias ficam.`;
    case "failed":
      return "Validação falhou: " + e.checks.filter((c) => !c.ok).map((c) => "`" + c.command + "` — " + c.summary).join("; ");
    case "skipped":
      return "Validação não correu.";
  }
}

export function makeAgentChat(deps: AgentChatDeps) {
  const { gateway, presenter, gate } = deps;
  let session: string | null = null;
  /** `provedor|modelo` com que a sessão abriu: se o seletor mudar, abre-se outra. */
  let sessionKey: string | null = null;
  /** Provedor+modelo sem tool calling nativo (descoberto no 1.º pedido) → harness antigo. */
  const noTools = new Set<string>();
  const key = (): string => `${deps.provider()}|${deps.model()}`;
  let turn: Turn | null = null;
  /** The Project issue the session works on (set when the conversation starts from one). */
  let issueKey: string | null = null;
  let unsubscribe: (() => void) | null = null;

  // the chat keeps prose: long code blocks go to the editor, not the reply (RF-CODEV-STREAM §7)
  const text = (t: Turn): string => proseOnly(t.segments.filter((s) => s !== "").join("\n\n"));

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
    if (e.kind.startsWith("hunk_") || e.kind === "validation") deps.hunks?.event(s, e);
    deps.run?.event(s, e);
    switch (e.kind) {
      case "hunk_start":
        t.hunkPaths.set(e.call, e.path);
        break;
      case "hunk_review": {
        const path = t.hunkPaths.get(e.call) ?? "";
        const ref = toolRef(t, e.call, "edit", path);
        presenter.toolReason?.(ref, e.reason, false);
        const sink = deps.hunks;
        if (sink && presenter.hunkReview) {
          const bar = presenter.hunkReview(ref, { path, count: e.hunks.length, reason: e.reason }, {
            acceptAll: () => sink.decideAll(e.call, true),
            rejectAll: () => sink.decideAll(e.call, false),
            open: () => sink.open(path),
          });
          sink.onSettled(e.call, (label) => bar.settle(label));
        }
        break;
      }
      case "validation":
        presenter.agentNote?.(t.card, "validation", validationNote(e));
        break;
      case "report":
        presenter.agentReport?.(t.card, e.title, e.markdown);
        break;
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
        if (e.name === "todo_write") presenter.agentTodos?.(t.card, parseTodos(e.input));
        else toolRef(t, e.id, e.name, describeCall(e.name, e.input));
        if (e.name === "task") presenter.subagent?.(e.id, typeof e.input.description === "string" ? e.input.description : "", "running");
        break;
      case "checkpoint":
        presenter.agentNote?.(t.card, "checkpoint", `Checkpoint ${e.id} guardado antes das alterações — /reverter para voltar atrás.`);
        break;
      case "notice":
        presenter.agentNote?.(t.card, "notice", e.text);
        break;
      case "tool_result":
        if (e.name === "task") presenter.subagent?.(e.id, "", e.is_error ? "error" : "done");
        if (e.name !== "todo_write") presenter.toolRunResult(toolRef(t, e.id, e.name, ""), !e.is_error, summarizeResult(e.content));
        break;
      case "usage":
        presenter.agentNote?.(t.card, "usage", formatUsage(deps.model(), e.turn));
        deps.onUsage?.(e.request.input_tokens + e.request.cache_read_input_tokens + e.request.cache_creation_input_tokens, e.request.output_tokens);
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
    const isPlan = r.call.name === "exit_plan";
    const label = isPlan ? "plano proposto" : describeCall(r.call.name, r.call.input, r.call.command);
    const ref = toolRef(t, r.call.id, r.call.name, label);
    if (isPlan) {
      presenter.agentPlan?.(ref, typeof r.call.input.plan === "string" ? r.call.input.plan : "");
      const ok = await gate
        .ask<boolean>(ref, [
          { l: "Aprovar plano", v: true, pri: true, done: "✓ plano aprovado — a executar" },
          { l: "Continuar a planear", v: false, done: "↺ continuar a planear" },
        ])
        .catch(() => false);
      await gateway.approve(s, r.call.id, ok, ok ? undefined : "o humano quer continuar a planear: ajusta o plano");
      return;
    }
    presenter.toolReason?.(ref, r.reason, r.dangerous);
    const diff = callDiff(r.call.name, r.call.input);
    if (diff && diff.path) {
      presenter.toolDiffLink?.(ref, () => deps.openDiff(diff.path, diff.before, diff.after, "proposta do agente"));
    }
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
    if (isNoToolsError(message)) {
      noTools.add(sessionKey ?? key());
      t.noTools = true;
      presenter.assistantText(
        t.card,
        `O modelo ${deps.model()} não suporta ferramentas nativas — esta conversa segue pelo modo de texto (blocos).`,
      );
    } else presenter.liveError(t.card, false, undefined, message);
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
    if (session && sessionKey !== key()) reset(); // o seletor de modelo mudou
    if (!session) {
      sessionKey = key();
      session = await gateway.start({
        root: deps.workspace.root(),
        provider: deps.provider(),
        model: deps.model(),
        effort: deps.effort?.() ?? "high",
        testCmd: deps.verify.command("test")?.cmd ?? null,
        lintCmd: deps.verify.command("lint")?.cmd ?? null,
        mode: deps.mode(),
        reviewEdits: !!deps.hunks,
        issue: issueKey,
      });
    }
    return session;
  }

  /** Envia uma mensagem do utilizador e espera pelo fim do turno. `false` se o modelo não
   *  tem tool calling nativo — quem chama reenvia pelo harness antigo. */
  async function send(q: string): Promise<boolean> {
    let fallback = false;
    presenter.userMessage(q);
    const card = presenter.thinking(deps.speaker());
    presenter.beginRun("Agente Co-Dev");
    deps.run?.turnStarted();
    const signal = presenter.startAbort();
    try {
      const id = await ensureSession();
      await new Promise<void>((resolve) => {
        const tt: Turn = {
          card,
          segments: [],
          reasoning: "",
          tools: new Map(),
          hunkPaths: new Map(),
          finish: () => {
            fallback = !!tt.noTools;
            resolve();
          },
        };
        turn = tt;
        signal.addEventListener("abort", () => void gateway.cancel(id), { once: true });
        // the backend reads the disk: save what the editor shows first
        (deps.flush ? deps.flush() : Promise.resolve())
          .catch(() => undefined)
          .then(() => gateway.send(id, q))
          .catch((e: unknown) => {
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
    if (fallback) reset();
    return !fallback;
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
      sessionKey = key();
      session = await gateway.start({
        root: deps.workspace.root(),
        provider: deps.provider(),
        model: deps.model(),
        effort: deps.effort?.() ?? "high",
        testCmd: null,
        lintCmd: null,
        mode: deps.mode(),
        resume: pick,
        reviewEdits: !!deps.hunks,
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

  /** `/plano <pedido>`: liga o modo plano (só leitura até o plano ser aprovado) e envia. */
  async function plan(q: string): Promise<void> {
    try {
      const id = await ensureSession();
      await gateway.setPlan(id, true);
    } catch (e: unknown) {
      const c = presenter.thinking(deps.speaker());
      presenter.liveError(c, false, undefined, e instanceof Error ? e.message : String(e));
      return;
    }
    await send(q);
  }

  /** `/reverter`: lista os checkpoints da sessão e repõe os ficheiros do escolhido. */
  async function rewindMenu(): Promise<void> {
    const card = presenter.thinking(deps.speaker());
    try {
      const list = session ? await gateway.checkpoints(session) : [];
      if (!list.length) {
        presenter.assistantText(card, "Ainda não há checkpoints nesta conversa (só existem em repositórios git, a partir do primeiro turno que altera ficheiros).");
        return;
      }
      presenter.assistantText(card, "Voltar os ficheiros para antes de qual pedido? (a conversa fica; o agente é avisado)");
      const now = deps.nowSecs();
      const btns = [...list].reverse().slice(0, 8).map((c) => ({ l: `#${c.id} · ${c.label} · ${ago(c.created, now)}`, v: c.id }));
      const pick = await gate.ask<number>(card.tools, [...btns, { l: "Cancelar", v: 0 }]).catch(() => 0);
      if (!pick || !session) return;
      const msg = await gateway.rewind(session, pick);
      await deps.reloadFromDisk().catch(() => undefined);
      presenter.agentNote?.(card, "rewind", msg.charAt(0).toUpperCase() + msg.slice(1) + ".");
    } catch (e: unknown) {
      presenter.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
    } finally {
      presenter.scrollMsgs();
    }
  }

  /** `/comandos`: o que o projecto define para o agente, e confiança nos hooks/MCP. */
  async function commandsMenu(): Promise<void> {
    const card = presenter.thinking(deps.speaker());
    try {
      const root = deps.workspace.root();
      const x = await gateway.extensions(root);
      const lines: string[] = [];
      lines.push(
        x.commands.length
          ? "**Comandos do projecto** (`.dxtutor/commands/`):\n" + x.commands.map((c) => `- \`/${c.name}\` — ${c.description}`).join("\n")
          : "Sem comandos do projecto — cria `.dxtutor/commands/<nome>.md` (o texto é o pedido; `$ARGUMENTS` recebe o resto da linha).",
      );
      if (x.skills.length) lines.push("**Skills** (`.dxtutor/skills/`):\n" + x.skills.map((k) => `- ${k.name} — ${k.description}`).join("\n"));
      const state = (f: { present: boolean; trusted: boolean }) => (!f.present ? "não definidos" : f.trusted ? "confiados ✓" : "**por confiar**");
      lines.push(`**Hooks** (\`.dxtutor/hooks.json\`): ${state(x.hooks)}`);
      lines.push(`**Servidores MCP**: ${x.mcpServers.length ? x.mcpServers.join(", ") : "nenhum"} — os do projecto (\`.dxtutor/mcp.json\`) ${state(x.mcp)}`);
      lines.push("`/plano <pedido>` · `/reverter` · `/retomar` · `/comandos`");
      presenter.assistantText(card, lines.join("\n\n"));
      const pending: Array<{ l: string; v: "hooks" | "mcp" | "" }> = [];
      if (x.hooks.present && !x.hooks.trusted) pending.push({ l: "Confiar nos hooks do projecto", v: "hooks" });
      if (x.mcp.present && !x.mcp.trusted) pending.push({ l: "Confiar nos servidores MCP do projecto", v: "mcp" });
      if (!pending.length) return;
      presenter.agentNote?.(card, "trust", "Hooks e servidores MCP correm comandos definidos pelo repositório: confia só se conheces o projecto. A confiança deixa de valer se o ficheiro mudar.");
      const pick = await gate.ask<"hooks" | "mcp" | "">(card.tools, [...pending, { l: "Agora não", v: "" }]).catch(() => "" as const);
      if (!pick) return;
      await gateway.trust(root, pick);
      reset(); // a próxima mensagem abre uma sessão nova, já com eles ligados
      presenter.agentNote?.(card, "trusted", `${pick === "hooks" ? "Hooks" : "Servidores MCP"} confiados. Valem a partir da próxima mensagem (sessão nova).`);
    } catch (e: unknown) {
      presenter.liveError(card, false, undefined, e instanceof Error ? e.message : String(e));
    } finally {
      presenter.scrollMsgs();
    }
  }

  /** Opção 2 do Board: abrir uma issue lança o agente, em modo plano, com o pedido dela. */
  function story(s: BoardStory): Promise<void> {
    // a new session that knows the issue: its accepted changes count for it (A5)
    reset();
    issueKey = s.id;
    return plan(storyPrompt(s));
  }

  function reset(): void {
    if (session) void gateway.close(session);
    session = null;
    sessionKey = null;
    issueKey = null;
  }

  return {
    available: (): boolean => gateway.available() && !noTools.has(key()),
    send,
    resumeMenu,
    plan,
    rewindMenu,
    commandsMenu,
    story,
    /** A modebar mudou: vale a partir da próxima decisão da sessão em curso. */
    modeChanged(mode: string): void {
      if (session) void gateway.setMode(session, mode);
    },
    /** Nova conversa: fecha a sessão (o histórico vive no backend). */
    reset,
    /** The open session, if any (the harness view acts on it). */
    sessionId: (): string | null => session,
    /** Stops the turn in progress (Esc in the editor overlay). */
    cancel(): void {
      if (session) void gateway.cancel(session);
    },
  };
}

export type AgentChat = ReturnType<typeof makeAgentChat>;
