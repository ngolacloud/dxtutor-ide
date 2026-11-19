/* ═══════════ Co-Dev — live chat use case (ADR-0002, Phase 3) ═══════════
   `liveChat`: a free-form conversation with Claude, with tools over the
   workspace. Pure application logic — the system prompt is text (not HTML), the
   tool definitions are data, and every side-effect goes through a port or the
   presenter. The live sampler already takes an `AbortSignal`; here it comes
   from `presenter.startAbort()` (wired to `RUN.abort`). */

import type { LiveDeps, RuntimeTool, ToolHost } from "./ports";

export function makeLiveChat(deps: LiveDeps) {
  const { workspace, providers, presenter, harness, chat, tool } = deps;

  return async function liveChat(q: string): Promise<void> {
    presenter.userMessage(q);
    const PROV = providers.providers();
    const P = PROV[providers.activeProvider()];
    if (!P.on) {
      presenter.providerOff(P.name);
      return;
    }
    if (providers.activeProvider() !== "claude" && !providers.isDesktop()) {
      presenter.providerSimulated(P.name, P.ep);
      return;
    }
    const sampleFn = providers.sample();
    if (!sampleFn) {
      presenter.liveUnavailable();
      return;
    }
    const fs = workspace.files();
    const af = chat.activeTabPath();
    const sys = `És o Co-Dev do dxtutor IDE: um co-programador sénior que entende requisitos, arquitectura, design system, padrões de projecto e base de dados. Trabalhas orientado por um programador humano.
Modo de autonomia actual: ${deps.modeLabel()}. Em modo Manual as tuas edições e comandos podem ser rejeitados pelo humano.
Tens ferramentas para listar, ler e escrever ficheiros do workspace, correr os testes e o lint do Design System. Lê antes de editar. write_file recebe o conteúdo COMPLETO do ficheiro. Depois de editar, corre run_tests e design_lint, avalia o teu próprio resultado e corrige se falhar (no máximo 2 tentativas).
Responde em português (ortografia pré-AO90), de forma curta e concreta. Usa markdown simples.

Regras do projecto:
${deps.projectRules()}
Ficheiros do workspace:
${Object.keys(fs).map(workspace.shortPath).join("\n")}
${af ? `\nFicheiro activo (${workspace.shortPath(af)}):\n${fs[af].content.slice(0, 6000)}` : ""}`;
    const messages = chat.messages();
    messages.push({ role: "user", content: q });
    const sysA = sys + providers.agentSys();
    const msgs = messages.slice(-9).map((m) => ({ ...m }));
    while (msgs.length && msgs[0].role !== "user") msgs.shift();
    msgs[0].content = sysA + "\n\n———\n\n" + msgs[0].content;
    const c = presenter.thinking(providers.activeAgentName().toLowerCase() + " · claude ao vivo");
    presenter.beginRun("Claude ao vivo");
    const signal = presenter.startAbort();
    const h: ToolHost = c.tools;
    const tools = [
      {
        name: "list_files",
        description: "Lista os caminhos de todos os ficheiros do workspace.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          presenter.toolLine(h, "list_files", "");
          return Object.keys(workspace.files()).map(workspace.shortPath);
        },
      },
      {
        name: "read_file",
        description: "Lê o conteúdo de um ficheiro do workspace.",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        execute: async ({ path }: { path: string }) => {
          const p = workspace.normalizePath(path);
          const f = workspace.files();
          if (!f[p]) throw new Error("ficheiro não existe: " + path);
          presenter.toolOk(presenter.toolLine(h, "read_file", workspace.shortPath(p)));
          return f[p].content;
        },
      },
      {
        name: "write_file",
        description: "Cria ou substitui um ficheiro com o conteúdo completo indicado. Pode exigir aprovação humana.",
        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
        execute: async ({ path, content }: { path: string; content: string }) => {
          harness.check(workspace.normalizePath(path));
          const ok = await tool({ t: "edit", p: workspace.normalizePath(path), content: String(content) } as RuntimeTool, h, "plan", signal);
          if (!ok) throw new Error("edição rejeitada pelo humano");
          return "ok";
        },
      },
      {
        name: "run_tests",
        description: 'Corre cargo test. Parâmetro opcional package: "lexer" ou "store".',
        inputSchema: { type: "object", properties: { package: { type: "string" } } },
        execute: async (i: { package?: string }) => {
          harness.cmd("cargo test");
          const r = (await tool({ t: "run", cmd: "cargo test" + (i && i.package ? " -p " + i.package : "") } as RuntimeTool, h, undefined, signal)) as
            | { ok: boolean; sum?: string }
            | null;
          return r ? r.sum : "o humano não autorizou o comando";
        },
      },
      {
        name: "design_lint",
        description: "Corre o lint do Design System (cores fixas fora dos tokens).",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          harness.cmd("dx lint");
          const r = (await tool({ t: "run", cmd: "dx lint" } as RuntimeTool, h, undefined, signal)) as { ok: boolean; sum?: string } | null;
          return r ? r.sum : "o humano não autorizou o comando";
        },
      },
      {
        name: "delegate_task",
        description:
          "Delega um conjunto de alterações de ficheiros a um executor isolado (git worktree de HEAD) e devolve o diff para revisão, SEM tocar na árvore de trabalho. Usa quando queres propor várias edições de uma vez para o humano rever como patch. input: writes = lista de [caminho, conteúdo].",
        inputSchema: { type: "object", properties: { writes: { type: "array" } }, required: ["writes"] },
        execute: async ({ writes }: { writes: any[] }) => {
          const delegate = harness.delegate();
          if (!delegate) return "delegação isolada indisponível nesta vista (precisa do app desktop com pasta aberta)";
          const w: [string, string][] = (writes || []).map((x: any) => (Array.isArray(x) ? [String(x[0]), String(x[1])] : [String(x.path), String(x.content)]));
          const st = await delegate(w);
          presenter.toolLine(h, "delegate_task", st.status);
          return st.status === "done" ? "patch isolado (worktree de HEAD):\n" + st.patch : "falhou: " + (st.error || st.status);
        },
      },
    ];
    try {
      const r = await sampleFn(msgs, {
        tools,
        signal,
        cache: false,
        onText: ({ text }) => presenter.assistantText(c, text),
      });
      presenter.assistantText(c, r.text || "(sem texto)");
      messages.push({ role: "assistant", content: r.text || "" });
      deps.setLiveOk();
      providers.trackUsage("claude", Math.round((sys.length + q.length + (r.text || "").length) / 4));
    } catch (e: any) {
      messages.pop();
      const code = e && e.code;
      presenter.liveError(c, e === presenter.stopValue() || signal.aborted, code, (e && e.message) || code || "erro");
    } finally {
      presenter.endRun();
      deps.refresh();
      presenter.refreshCtx();
      presenter.scrollMsgs();
    }
  };
}

export type LiveChat = ReturnType<typeof makeLiveChat>;
