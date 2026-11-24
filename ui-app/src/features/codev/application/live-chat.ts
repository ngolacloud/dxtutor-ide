/* ═══════════ Co-Dev — live chat use case (ADR-0002, Phase 3) ═══════════
   `liveChat`: a free-form conversation with Claude, with tools over the
   workspace. Pure application logic — the system prompt is text (not HTML), the
   tool definitions are data, and every side-effect goes through a port or the
   presenter. The live sampler already takes an `AbortSignal`; here it comes
   from `presenter.startAbort()` (wired to `RUN.abort`). */

import type { LiveDeps, RuntimeTool, ToolHost } from "./ports";

export function makeLiveChat(deps: LiveDeps) {
  const { workspace, providers, presenter, harness, chat, tool } = deps;

  /** `echoed`: a mensagem já está desenhada na conversa (o agente v2 recuou para aqui
   *  porque o modelo não tem tool calling) — não se desenha outra vez. */
  return async function liveChat(q: string, opts: { echoed?: boolean } = {}): Promise<void> {
    if (!opts.echoed) presenter.userMessage(q);
    const PROV = providers.providers();
    const P = PROV[providers.activeProvider()];
    if (!P.on) {
      presenter.providerOff(P.name);
      return;
    }
    if (providers.activeProvider() !== "claude" && !providers.isDesktop()) {
      presenter.providerNeedsDesktop(P.name, P.ep);
      return;
    }
    const sampleFn = providers.sample();
    if (!sampleFn) {
      presenter.liveUnavailable();
      return;
    }
    const fs = workspace.files();
    const af = chat.activeTabPath();
    /* pasta real (desktop): run_tests/design_lint correm os comandos DETECTADOS do projecto
       (domain/project-commands). Sem pasta (browser) não há onde correr testes nem lint: as duas
       ferramentas não se oferecem (eram o `cargo test -p lexer|store` e o `dx lint` do workspace
       de demonstração, que o terminal emulado já não conhece — ADR-0005, R2d). */
    const REAL = !!deps.verify?.real();
    const TESTC = REAL ? deps.verify!.command("test") : null;
    const LINTC = REAL ? deps.verify!.command("lint") : null;
    const sys = `És o Co-Dev do dxtutor IDE: um co-programador sénior que entende requisitos, arquitectura, design system, padrões de projecto e base de dados. Trabalhas orientado por um programador humano.
Modo de autonomia actual: ${deps.modeLabel()}. Em modo Manual as tuas edições e comandos podem ser rejeitados pelo humano.
${REAL ? "Tens ferramentas para listar, ler e escrever ficheiros do workspace e para correr os testes e o lint do projecto. Lê antes de editar. write_file recebe o conteúdo COMPLETO do ficheiro. Depois de editar, corre run_tests e design_lint, avalia o teu próprio resultado e corrige se falhar (no máximo 2 tentativas)." : "Tens ferramentas para listar, ler e escrever ficheiros do workspace. Lê antes de editar. write_file recebe o conteúdo COMPLETO do ficheiro. Nesta vista não há onde correr testes nem lint (só na app desktop com uma pasta aberta): não digas que os correste."}
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
    type RunResult = { ok: boolean; sum?: string; out?: string } | null;
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
      ...(REAL ? [{
        name: "run_tests",
        description: TESTC
          ? `Corre os testes do projecto (${TESTC.cmd}) e devolve o código de saída e a saída real.`
          : "Não foi detectado comando de testes neste projecto; usa run_command.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          if (!TESTC) return 'nenhum comando de testes detectado (define "test" em .dxtutor/commands.json ou usa run_command)';
          harness.cmd(TESTC.cmd);
          const r = (await tool({ t: "run", cmd: TESTC.cmd } as RuntimeTool, h, undefined, signal)) as RunResult;
          return r ? r.out || r.sum : "o humano não autorizou o comando";
        },
      },
      {
        name: "design_lint",
        description: LINTC
          ? `Corre o lint do projecto (${LINTC.cmd}) e devolve o código de saída e a saída real.`
          : "Não foi detectado comando de lint neste projecto; usa run_command.",
        inputSchema: { type: "object", properties: {} },
        execute: async () => {
          if (!LINTC) return 'nenhum comando de lint detectado (define "lint" em .dxtutor/commands.json ou usa run_command)';
          harness.cmd(LINTC.cmd);
          const r = (await tool({ t: "run", cmd: LINTC.cmd } as RuntimeTool, h, undefined, signal)) as RunResult;
          return r ? r.out || r.sum : "o humano não autorizou o comando";
        },
      }] : []),
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
