/* ═════════ dxtutor IDE — desktop: o auto-teste (ADR-0004, U4h1) ═════════
   O auto-teste da app real (`DXTUTOR_SELFTEST`, Xvfb): percorre o terminal, o PTY do painel,
   os modelos, a config dos providers, a pasta aberta, autosave, commit, gitflow, checkpoint,
   grafo, changelog, scm, infra, termgit, codereview, a delegação isolada e o editor ligado
   ao servidor de linguagem (Java e Kotlin: diagnósticos, hover e F12), e grava o
   relatório. Era a função `selftest` do bridge.ts, verbatim (o passo `lsp-*` veio depois). */

import type { DesktopContext } from "./context";

export async function selftest(ctx: DesktopContext): Promise<void> {
const { R, sh, git, stream, gitc, providers, tasks, app, idle } = ctx;
const flushSave = () => ctx.flushSave();
const realTerm = (raw: string) => ctx.realTerm(raw);
const desktopSample: DesktopContext["desktopSample"] = (i, o) => ctx.desktopSample(i, o);
  const rep: { tauri: boolean; version?: string; os?: string; errors: string[]; steps: Record<string, unknown>; stepErrors: Record<string, string[]> } =
    { tauri: true, version: R.info.version, os: R.info.os, errors: R.errors, steps: {}, stepErrors: {} };
  const step = async (n: string, f: () => unknown) => {
    const e0 = R.errors.length;
    try { rep.steps[n] = await f(); } catch (e) { rep.steps[n] = "FAIL: " + ((e as Error) && (e as Error).message || e); }
    if (R.errors.length > e0) rep.stepErrors[n] = R.errors.slice(e0);
  };
  await step("ui", () => ({ files: Object.keys(FS).length, menus: MENUS.map(m => m.t), sample: typeof SAMPLE, provState: Object.keys(PROV).map(provState) }));
  await step("exec", async () => (await sh("sh", ["-c", "echo ok"], { cwd: R.info.home })).stdout.trim());
  // Painel inferior real (features/panel): tarefa num PTY com código de saída e UTF-8,
  // shell interactiva num pseudo-terminal (/dev/pts), integração de shell (cwd + comando
  // falhado) e o scan do Problems sobre a pasta aberta.
  if (R.term) await step("panel", async () => {
    const I = () => R.term!.inspect();
    const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
    const taskExit = await R.term!.runTask("printf 'pty-ok \\303\\247\\303\\251\\n'; exit 3", { label: "selftest-task" });
    const task = I().terminals.find(t => t.label === "selftest-task");
    // o xterm processa as escritas de forma assíncrona: espera que o texto chegue ao buffer
    if (task) await wait(() => I().text(task.id).includes("finished"), 5000);
    const taskText = task ? I().text(task.id) : "";
    const id = I().create(R.info.home);
    const prompt = await wait(() => /[$#%>] ?$/m.test(I().text(id)), 10000);
    I().write(id, "cd /tmp && false\r");
    const failure = await wait(() => I().failures.some(f => f.command.includes("false")), 10000);
    const cwd = await wait(() => I().terminals.find(t => t.id === id)?.cwd === "/tmp", 5000);
    I().write(id, "printf 'tty:%s\\n' \"$(tty)\"\r");
    const pts = await wait(() => /tty:\/dev\/pts\//.test(I().text(id)), 10000);
    const meta = I().terminals.find(t => t.id === id);
    I().kill(id);
    const scanned = R.root ? await wait(() => I().scanned && !I().scanning, 240000) : false;
    return { taskExit, taskUtf8: taskText.includes("pty-ok çé"), taskText: taskText.split("\n").slice(0, 4), prompt, ttyIsPts: pts, failureRecorded: failure, cwdTracked: cwd, shell: meta?.shell, scanned, problems: I().problems, diagnostics: diagnostics().map(d => `${d.sev} ${d.p}:${d.line} ${d.msg}`).slice(0, 6) };
  });
  // Caminho de streaming real (sem ferramentas): confirma entrega incremental de tokens via
  // assistant_chat_stream. Sem pasta aberta corre em mode="study" (exercita a política de tutor).
  await step("llmStream", async () => {
    const lens: number[] = [];
    let last = "";
    const r = await desktopSample("Responde apenas com: streaming ok.", { onText: ({ text }) => { lens.push(text.length); last = text; } });
    const grew = lens.length > 1 && lens[lens.length - 1] > lens[0];
    return { provider: r.provider, mode: R.root ? "project" : "study", chunks: lens.length, incremental: grew, finalLen: (r.text || last).length };
  }).then(() => { if (String(rep.steps.llmStream).startsWith("FAIL")) rep.steps.llmStream = "skipped — no model reachable: " + String(rep.steps.llmStream).slice(6, 120); });
  // Cancelamento a meio: aborta ao primeiro token e confirma que assistant_cancel interrompe.
  await step("llmCancel", async () => {
    const ac = new AbortController();
    let chunks = 0;
    try {
      await desktopSample("Escreve um parágrafo longo sobre Scrum e XP.", { signal: ac.signal, onText: () => { chunks++; if (chunks === 1) ac.abort(); } });
      return { cancelled: false, chunks };
    } catch (e) { return { cancelled: e === STOP || /abort|stop|cancel/i.test(String((e as Error) && (e as Error).message || e)), chunks }; }
  }).then(() => { if (String(rep.steps.llmCancel).startsWith("FAIL")) rep.steps.llmCancel = "skipped — no model reachable: " + String(rep.steps.llmCancel).slice(6, 120); });
  // Config real de providers: flags honestas (list_providers) + round-trip de get/save_providers_config.
  // A ESCRITA aqui grava uma chave-sonda descartável — este passo só deve correr com HOME apontado a um
  // dir temporário (DXTUTOR_SELFTEST headless), nunca no providers.json real do utilizador.
  await step("providers", async () => {
    const caps = ctx.provCaps().map(c => ({ id: c.id, available: c.available, streaming: c.streaming, cancel: c.cancel }));
    const before = await providers.getConfig();
    // As chaves vêm mascaradas (nunca atravessam o IPC). Com uma chave OpenAI real já guardada não
    // há como a repor depois da sonda — não se escreve; o passo só corre a sério com HOME temporário.
    const leak = [before.anthropicKey, before.openaiKey, before.geminiKey].some(k => k && !/^•+$/.test(k));
    if (before.openaiKey) return { caps, skipped: "openai key already saved", masked: !leak };
    await providers.saveConfig({ ...before, openaiKey: "sk-selftest-probe" });
    const after = await providers.getConfig();
    const saved = !!after.openaiKey && after.openaiKey !== "sk-selftest-probe", keptOthers = after.anthropicKey === before.anthropicKey;
    // Restaura a config original (openaiKey vazia) — o passo é net-zero: nunca deixa a sonda gravada.
    await providers.saveConfig(before);
    const restored = await providers.getConfig();
    return { caps, saved, masked: !leak, keptOthers, restored: !restored.openaiKey };
  });
  if (R.root) {
    await step("open", () => ({ root: R.root, git: R.git, branch: BRANCH, commits: GIT.order.length, files: Object.keys(R.disk).length }));
    await step("autosave", async () => { writeFile(ROOT + "notes/selftest.txt", "written by the IDE\n"); flushSave(); await idle(); return (await sh("cat", ["notes/selftest.txt"])).stdout.trim(); });
    await step("commit", async () => { const c = commit("test: commit from the desktop IDE"); await idle(); await idle(); return { virtual: !!c, head: (await git("log", "-1", "--format=%s")).stdout.trim(), graph: GIT.order.length }; });
    await step("gitflow", async () => {
      const b = gfStart("feature", "selftest-flow"); await idle();
      writeFile(ROOT + "notes/flow.txt", "x\n"); flushSave(); commit("feat: flow"); await idle();
      gfFinish(b); await idle(); await idle();
      return { branch: (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim(), branches: (await git("branch", "--format=%(refname:short)")).stdout.trim().split("\n"), flowFile: !!FS[ROOT + "notes/flow.txt"] };
    });
    // feature `checkpoint` (migrada de app.ts para features/checkpoint.ts nesta sessão):
    // checkpoint/restoreCkpt tiram e repõem uma fotografia de FS+GIT+BRANCH; gfAsk propõe
    // (ou recusa propor) fechar um ramo gitflow dependendo de haver alterações por commitar.
    // Testa os dois ramos de gfAsk via MODE="auto" (bypassa o diálogo interactivo ask()).
    await step("checkpoint", async () => {
      const errBefore = R.errors.length;
      const key = ROOT + "notes/ckpt-probe.txt";
      const filesBefore = Object.keys(FS).length, branchBefore = BRANCH;
      const id = checkpoint("probe");
      writeFile(key, "mutated after checkpoint\n"); flushSave(); await idle();
      const mutated = !!FS[key];
      restoreCkpt(id, true);
      const restored = !FS[key] && Object.keys(FS).length === filesBefore && BRANCH === branchBefore;

      gfStart("feature", "ckpt-ask-finish"); await idle();
      // `commit` (v2, real-git-aware via bridge) — não `commitGit` (v4, só simula o DAG em
      // memória): gfFinish faz merge/checkout REAIS, por isso o commit que o antecede tem
      // de ser real também, senão o ramo "finalizado" nunca existiu de facto no git.
      writeFile(ROOT + "notes/ckpt-ask-finish.txt", "y\n"); flushSave(); commit("feat: ckpt ask finish"); await idle(); await idle();
      const modeBefore = MODE; MODE = "auto";
      const hostFinish = document.createElement("div");
      await gfAsk(hostFinish, { files: new Set() });
      await idle(); await idle();
      const finishedViaAsk = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim() === "develop" && /develop/.test(hostFinish.innerHTML);
      MODE = modeBefore;

      gfStart("feature", "ckpt-ask-open"); await idle();
      writeFile(ROOT + "notes/ckpt-ask-open.txt", "z\n"); flushSave(); await idle();
      const hostOpen = document.createElement("div");
      await gfAsk(hostOpen, { files: new Set([ROOT + "notes/ckpt-ask-open.txt"]) });
      const stayedOpen = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim() === "feature/ckpt-ask-open" && /fica aberto/.test(hostOpen.innerHTML);
      checkout("develop"); await idle();

      return { id, mutated, restored, finishedViaAsk, stayedOpen, errBefore, errAfter: R.errors.length };
    });
    // feature `graph` (migrada de app.ts para features/graph.ts nesta sessão): o renderer
    // puro da tab `graph` (VIEW.graph) desenha um nó por commit do grafo real.
    await step("graph", () => {
      const host = document.createElement("div");
      renderGraphView(null, host);
      const rows = host.querySelectorAll(".gl-row").length;
      return { rows, matchesCommits: rows === GIT.order.length, dots: host.querySelectorAll(".gl-svg circle").length, hasBranchBar: /gl-bar/.test(host.innerHTML) };
    });
    // feature `changelog` (harvest ui-next): observa o caminho desktop-REAL — clLog→git_log
    // e clShow→git_show sobre o repo git do próprio selftest (acabou de ganhar commits acima).
    await step("changelog", async () => {
      const log = await window.clLog();
      const first = log[0];
      const diff = first ? await window.clShow(first.hash) : "";
      return { commits: log.length, realGitLog: log.length > 0 && typeof first?.subject === "string",
        firstSubject: first ? first.subject : "", diffLen: diff.length, diffIsGitShow: /^commit\s+[0-9a-f]/i.test(diff) };
    });
    // feature `scm` (Source Control): prova que o PANE opera sobre git REAL em desktop,
    // paralelo ao passo `changelog`. Cria uma alteração e confirma que a lista do pane
    // (changes()) E o comando dedicado git_changes a vêem; faz stage+commit pelo caminho
    // do pane (stage()/commit() = wrapper real do bridge) e verifica com `git` e git_log;
    // depois um checkout real (-b e de volta). No browser, features/scm.ts fica em simulação.
    await step("scm", async () => {
      const errBefore = R.errors.length;
      const rel = "notes/scm-probe.txt", key = ROOT + rel, msg = "test: scm pane real git";
      writeFile(key, "scm pane drives real git\n"); flushSave(); await idle();
      const listedChange = changes().includes(key);
      const seen = async () => (await gitc.changes(R.root!)).some(c => c.path === rel);
      const backendSeesNew = await seen();
      stage(key);
      const staged = STAGED.has(key);
      commit(msg); await idle(); await idle();
      const head = (await git("log", "-1", "--format=%s")).stdout.trim();
      const logTop = (await gitc.log(R.root!, 1))[0];
      const cleanAfter = !changes().includes(key), backendClean = !(await seen());
      const before = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      checkout("feature/scm-probe", true); await idle();
      const onNew = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      checkout(before); await idle();
      const back = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      return { listedChange, backendSeesNew, staged, committed: head === msg,
        backendLog: !!logTop && logTop.subject === msg, cleanAfter, backendClean,
        checkoutCreated: onNew === "feature/scm-probe", checkedBack: back === before,
        errBefore, errAfter: R.errors.length };
    });
    // feature `infra` (migrada de v5.ts nesta sessão para features/infra.ts): prova que
    // o motor de runtime/K8s/dev-container ficou correctamente ligado depois da
    // migração — rtConnect/k8sConnect (reais aqui, pela via REAL deste ficheiro) não
    // rebentam sem docker/kubectl instalados, dcAttach/dcDetach escrevem e limpam o
    // devcontainer simulado, dxDeploy respeita as guardas (sem runtime, sem cluster) e
    // drawRemote liga o indicador na status bar. Estado é sempre restaurado (net-zero).
    await step("infra", async () => {
      const errBefore = R.errors.length;
      const rtBefore = ENVS.rtOn, k8sBefore = ENVS.k8sOn;
      await rtConnect();
      const rtNoThrow = typeof ENVS.rtOn === "boolean";
      if (ENVS.rtOn !== rtBefore) await rtConnect();
      await k8sConnect();
      const k8sNoThrow = typeof ENVS.k8sOn === "boolean";
      if (ENVS.k8sOn !== k8sBefore) await k8sConnect();
      ENVS.rtOn = true;
      dcAttach();
      const attached = !!FS[window.P_DC] && !!DEVC;
      dcDetach();
      const detached = DEVC === null;
      ENVS.rtOn = false; ENVS.k8sOn = false;
      const deployNoRt = dxDeploy();
      ENVS.rtOn = true;
      const deployNoK8s = dxDeploy();
      ENVS.rtOn = rtBefore; ENVS.k8sOn = k8sBefore;
      drawRemote();
      const remoteBadgeWired = !!document.querySelector(".si.remote .rl");
      return { rtNoThrow, k8sNoThrow, attached, detached, deployNoRt, deployNoK8s, remoteBadgeWired, errBefore, errAfter: R.errors.length };
    });
    await step("terminal", async () => { const lines: string[] = []; const code = await stream("echo hello-from-term; echo $DX_SELF", { env: { DX_SELF: "env-ok" }, line: l => lines.push(l) }); return { code, lines }; });
    await step("terminalUI", async () => { await realTerm("echo ui-line"); await new Promise(r => setTimeout(r, 300)); return [...document.querySelectorAll("#term .line")].some(d => d.textContent === "ui-line"); });
    // feature `termgit` (migrada de app.ts para features/termgit.ts nesta sessão): handler
    // `git` do terminal (XC.git). Só os sub-comandos de leitura — status/log/branch/diff/push
    // não mutam estado, por isso o passo fica net-zero sem checkpoint/restore.
    await step("termgit", () => {
      const before = document.querySelectorAll("#term .line").length;
      gitCmd(["status"], "git status");
      gitCmd(["log"], "git log");
      gitCmd(["branch"], "git branch");
      gitCmd(["diff"], "git diff");
      const push = gitCmd(["push"], "git push");
      const added = document.querySelectorAll("#term .line").length - before;
      const lastLines = [...document.querySelectorAll("#term .line")].slice(-added).map(d => d.textContent || "");
      return { linesAdded: added, branchShown: lastLines.some(t => t.includes(BRANCH)), pushOk: push && push.ok === true };
    });
    // feature `codereview` (migrada de app.ts para features/codereview.ts nesta sessão):
    // Explain/Code review/Under the hood. explainCmd corre com o provider Claude desligado
    // (restaurado no fim) para exercitar o caminho determinístico sem chamada real ao LLM.
    await step("codereview", () => {
      const errBefore = R.errors.length;
      // P_LX (o lexer-protótipo) só existe no projecto SIMULADO; num projecto desktop real
      // qualquer ficheiro aberto do disco serve — por isso escolhe-se um que esteja mesmo em FS.
      const p = Object.keys(FS).find(k => k.startsWith(ROOT)) || P_LX;
      const findings = reviewFindings(p);
      const claudeBefore = PROV.claude.on; PROV.claude.on = false;
      explainCmd();
      PROV.claude.on = claudeBefore;
      const hostR = document.createElement("div");
      renderCreviewView({ path: p }, hostR);
      const hostH = document.createElement("div");
      renderHoodView({ path: p }, hostH);
      return {
        file: p, findingsIsArray: Array.isArray(findings), findingsCount: findings.length,
        hasScore: /class="score/.test(hostR.innerHTML),
        hasHood: /Under the hood/.test(hostH.innerHTML),
        errBefore, errAfter: R.errors.length,
      };
    });
    await step("llmLoop", async () => {
      const seen: string[] = [];
      const r = await desktopSample([{ role: "user", content: "list the files" }], { tools: [{ name: "list_files", description: "Lists files", inputSchema: { type: "object", properties: {} }, execute: async () => { seen.push("list_files"); return Object.keys(R.disk); } }] });
      return { text: r.text, provider: r.provider, toolsRun: seen };
    }).then(() => { if (String(rep.steps.llmLoop).startsWith("FAIL")) rep.steps.llmLoop = "skipped — no model reachable: " + String(rep.steps.llmLoop).slice(6, 90); });
    // Done-when A: streaming + ferramentas na MESMA resposta. Arma uma ferramenta, pede ao
    // modelo prosa seguida de UM bloco dxaction, e confirma que `onText` cresceu de forma
    // incremental (tokens ao vivo) E que a ferramenta correu (toolsRun) na mesma volta.
    await step("llmStreamTools", async () => {
      const seen: string[] = [];
      const lens: number[] = [];
      const r = await desktopSample(
        [{ role: "user", content: "Primeiro escreve uma frase curta a dizer que vais listar os ficheiros. Depois, numa linha nova, emite EXACTAMENTE este bloco e mais nada a seguir:\n```dxaction\n{\"tool\":\"list_files\",\"input\":{}}\n```" }],
        { tools: [{ name: "list_files", description: "Lista os caminhos dos ficheiros do workspace.", inputSchema: { type: "object", properties: {} }, execute: async () => { seen.push("list_files"); return Object.keys(R.disk); } }], onText: ({ text }) => lens.push(text.length) },
      );
      const incremental = lens.length > 1 && lens[lens.length - 1] >= lens[0];
      return { provider: r.provider, chunks: lens.length, incremental, toolsRun: seen, textLen: (r.text || "").length };
    }).then(() => { if (String(rep.steps.llmStreamTools).startsWith("FAIL")) rep.steps.llmStreamTools = "skipped — no model reachable: " + String(rep.steps.llmStreamTools).slice(6, 110); });
    // Done-when B: a superfície de delegação isolada (agent_task_*). submit → status(done,
    // patch não-vazio) num worktree de HEAD sem tocar na árvore de trabalho; depois
    // submit → cancel para provar o cancelamento. Corre sem modelo — é puro backend git.
    await step("agentTask", async () => {
      const res = await R.delegate!([["notes/delegated.txt", "escrito num worktree isolado pelo executor delegado\n"]]);
      const patchHasFile = res.status === "done" && /delegated\.txt/.test(res.patch);
      const untouched = !FS[ROOT + "notes/delegated.txt"]; // a delegação não toca na árvore real
      const id = await tasks.submit(R.root!, [["notes/cancel.txt", "x\n"]]);
      const cancelled = await R.cancelTask!(id);
      return { status: res.status, patchHasFile, patchLen: res.patch.length, untouched, cancelled };
    });
    await step("llmNoKey", async () => { try { await desktopSample("hi"); return "unexpected"; } catch (e) { return String((e as Error) && (e as Error).message || e).slice(0, 120); } });
    // feature `lsp`: o editor ligado ao servidor de linguagem, conduzido como um utilizador —
    // abrir o ficheiro (editor:tab → lsp_start + didOpen), esperar os diagnósticos no gutter,
    // rato parado sobre um símbolo (mousemove → cartão de hover) e F12 numa chamada (salta
    // para a definição). Só corre para as linguagens cujo servidor está instalado.
    for (const lang of ["java", "kotlin"] as const) await step("lsp-" + lang, () => lspProbe(lang));
  }
  rep.errors = R.errors;
  await app.selftestReport(rep);

  /* Uma linguagem no editor real: ficheiros com um erro de tipo, um símbolo para o hover e
     uma chamada cuja definição está noutro ficheiro (Java) ou mais acima (Kotlin). */
  async function lspProbe(lang: "java" | "kotlin"): Promise<unknown> {
    const W = window as unknown as {
      cur: string | null; openPath: (k: string, line?: number) => void;
      diagnostics: () => { p: string; line: number; sev: string; msg: string }[];
    };
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const until = async <T>(f: () => T | null | undefined | false, ms: number, every = 250): Promise<T | null> => {
      const t0 = Date.now();
      for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(every); }
    };
    const files: Record<string, string> = lang === "java"
      ? {
          "lsp-java/Util.java": "public class Util {\n    /** Adds two numbers. */\n    public static int add(int a, int b) {\n        return a + b;\n    }\n}\n",
          "lsp-java/Main.java": "public class Main {\n    public static void main(String[] args) {\n        int total = Util.add(1, 2);\n        String broken = 42;\n        System.out.println(total + broken);\n    }\n}\n",
        }
      : {
          "lsp-kotlin/App.kt": "fun greet(name: String): String = \"Hello, $name\"\n\nfun main() {\n    val message = greet(\"dxtutor\")\n    val broken: Int = \"not a number\"\n    println(message + broken)\n}\n",
        };
    const main = ROOT + (lang === "java" ? "lsp-java/Main.java" : "lsp-kotlin/App.kt");
    const callLine = lang === "java" ? 2 : 3, callWord = lang === "java" ? "add" : "greet";
    const defKey = ROOT + (lang === "java" ? "lsp-java/Util.java" : "lsp-kotlin/App.kt"), defLine = lang === "java" ? 3 : 1;
    for (const [rel, text] of Object.entries(files)) writeFile(ROOT + rel, text);
    flushSave(); await idle();

    const t0 = Date.now();
    W.openPath(main);
    const ta = () => document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    // 1) diagnósticos: o servidor publica o erro de tipo, o painel junta-o, o editor pinta o gutter
    const diag = await until(() => W.diagnostics().find(d => d.p === main && d.sev === "e"), 180_000, 500);
    const gutterErr = !!document.querySelector("#ed-gut .g-e");
    const diagMs = Date.now() - t0;
    // 2) hover: rato parado sobre a chamada (coordenadas reais da textarea)
    const offsetOf = (line: number, word: string) => { const ls = ta()!.value.split("\n"); let o = 0; for (let i = 0; i < line; i++) o += ls[i].length + 1; return o + ls[line].indexOf(word) + 1; };
    const pointOf = (line: number, word: string) => {
      const el = ta()!, r = el.getBoundingClientRect(), probe = document.createElement("span");
      const cs = getComputedStyle(el);
      probe.textContent = "0".repeat(100); probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${cs.fontFamily};font-size:${cs.fontSize}`;
      document.body.appendChild(probe); const cw = probe.getBoundingClientRect().width / 100; probe.remove();
      const col = el.value.split("\n")[line].indexOf(word) + 1;
      return { x: r.left + cw * (col + 0.5), y: r.top + 22 * line + 11 };
    };
    const hoverText = await until(() => {
      const card = document.getElementById("lsp-hover");
      if (card && !card.classList.contains("hidden") && card.textContent) return card.textContent;
      const p = pointOf(callLine, callWord);
      ta()!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: p.x, clientY: p.y }));
      return null;
    }, 90_000, 2500);
    // 3) F12 na chamada → o editor salta para a definição
    const caretLineNow = () => (ta() ? ta()!.value.slice(0, ta()!.selectionStart).split("\n").length : null);
    // Java: abre o Util.java; Kotlin (mesmo ficheiro): o cursor vai para a linha da função
    const arrived = () => (lang === "java" ? W.cur === defKey : W.cur === defKey && caretLineNow() === defLine);
    const jumped = await until(() => {
      if (arrived()) return true;
      if (W.cur !== main) W.openPath(main);
      const el = ta()!; const o = offsetOf(callLine, callWord); el.focus(); el.setSelectionRange(o, o);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", bubbles: true }));
      return null;
    }, 90_000, 3000);
    const caretLine = caretLineNow();
    return {
      diagnostic: diag ? `${diag.line}: ${diag.msg.slice(0, 90)}` : null, gutterErr, diagMs,
      hover: hoverText ? hoverText.replace(/\s+/g, " ").slice(0, 120) : null,
      definition: { jumped: !!jumped, file: W.cur, caretLine, expectedLine: defLine },
    };
  }
}
