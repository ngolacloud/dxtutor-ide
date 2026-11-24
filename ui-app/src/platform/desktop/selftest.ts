/* ═════════ dxtutor IDE — desktop: o auto-teste (ADR-0004, U4h1) ═════════
   O auto-teste da app real (`DXTUTOR_SELFTEST`, Xvfb): percorre o terminal, o PTY do painel,
   os modelos, a config dos providers, a pasta aberta, autosave, commit, gitflow, checkpoint,
   grafo, changelog, scm, infra, termgit, codereview e a delegação isolada, e grava o
   relatório. Era a função `selftest` do bridge.ts, verbatim. */

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
    // não mutam estado, por isso o passo fica net-zero sem checkpoint/restore. O `push` do
    // terminal emulado já não finge um push (ADR-0005, R1d): `pushOk` tem de ser false.
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
      // qualquer ficheiro aberto do disco serve — escolhe-se um que esteja mesmo em FS.
      const p = Object.keys(FS).find(k => k.startsWith(ROOT)) || "";
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
    // feature `testing` (ADR-0005, R2a): o pane Testing sobre os comandos reais. Escreve um
    // teste Python (unittest: sem projecto cargo, corre depressa) com um caso verde e um
    // vermelho, abre o pane (list_tests), carrega em «Run all» (run_all_tests) e lê o estado
    // de cada teste e a barra de estado; depois corre um só (run_test) pelo ▶ da linha.
    await step("testing", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      writeFile(ROOT + "test_dx_selftest.py", "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_soma(self):\n        self.assertEqual(1 + 1, 2)\n\n    def test_falha(self):\n        self.assertEqual(1 + 1, 3)\n");
      flushSave(); await idle();
      PANE = "test";
      window.renderTestPane();
      const el = () => document.getElementById("pane-test");
      const listed = await wait(() => /test_falha/.test(el()?.textContent || ""), 20000);
      const runAll = el()?.querySelector<HTMLElement>('[data-action="run-all"]');
      runAll?.click();
      const st = () => document.getElementById("st-tests")?.textContent || "";
      const suiteDone = await wait(() => st() === "✓ 1 ✗ 1", 60000);
      const statusAfterSuite = st();
      const one = el()?.querySelector<HTMLElement>('[data-action="run-test"][data-on="test_dx_selftest.py::test_soma"]');
      one?.click();
      await wait(() => st() !== "⟳ testes…" && !el()?.querySelector('[data-action="run-test"][disabled]'), 30000);
      return { listed, suiteDone, statusAfterSuite, statusAfterOne: st(), suiteShown: /Última corrida da suíte/.test(el()?.textContent || "") };
    });
    // pesquisa (ADR-0005, R2b): o pane Search procura em toda a pasta pelo backend
    // (search_project) — encontra o teste que o passo `testing` gravou no disco (o
    // notes/selftest.txt do `autosave` ficou em main; o gitflow deixa o repo em develop).
    await step("search", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      window.renderSearchPane();
      const q = document.getElementById("s-q") as HTMLInputElement | null, res = () => document.getElementById("s-res");
      if (q) { q.value = "ASSERTEQUAL(1 + 1, 3)"; q.dispatchEvent(new Event("input")); } // sem distinguir maiúsculas
      const found = await wait(() => !!res()?.querySelector('[data-p$="test_dx_selftest.py"][data-l="9"]'), 10000);
      return { found, summary: (res()?.querySelector(".sec-empty")?.textContent || "").trim() };
    });
    // outline (ADR-0005, R2c): o Outline do Explorer pelo backend (file_outline — servidor de
    // língua se houver, senão o scanner sintáctico) para o teste Python gravado acima.
    await step("outline", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      openPath(ROOT + "test_dx_selftest.py");
      const names = () => [...document.querySelectorAll("#outline .s-hit span:last-child")].map(e => e.textContent || "");
      const got = await wait(() => names().includes("test_falha"), 20000);
      return { got, symbols: names() };
    });
    // run (ADR-0005, R2d): o pane Run lista os projectos da pasta pelo backend
    // (detect_projects) e os comandos de cada um — um package.json com um script real.
    await step("run", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      writeFile(ROOT + "package.json", JSON.stringify({ name: "selftest", scripts: { hello: "echo hello-from-run" } }, null, 2) + "\n");
      flushSave(); await idle();
      PANE = "run";
      window.renderRunPane();
      const el = () => document.getElementById("pane-run");
      const listed = await wait(() => !!el()?.querySelector('[data-run-cmd="npm run hello"]'), 10000);
      return { listed, kinds: [...(el()?.querySelectorAll(".scm-grp .cnt") || [])].map(e => e.textContent) };
    });
    // conta (ADR-0005, R2e1): o pane Conta mostra o utilizador e a máquina reais (whoami/
    // hostname) e a identidade git, em vez de uma identidade fixa.
    await step("account", () => {
      window.renderAccountPane();
      const t = document.getElementById("pane-account")?.textContent || "";
      return { user: R.user, host: R.host, git: R.gitName || null, shown: !!R.user && t.includes(R.user), noFake: !/walter|Team SYS/.test(t) || R.user === "walter" };
    });
    // code review (ADR-0005, R2e2): a tab junta às regras locais os analisadores reais do
    // projecto (review_code, âmbito file) para o teste Python gravado acima.
    await step("review", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const host = document.createElement("div");
      document.body.appendChild(host);
      renderCreviewView({ path: ROOT + "test_dx_selftest.py" }, host);
      const sec = () => host.querySelector(".cr-analyzers");
      const done = await wait(() => !!sec() && !/A correr os analisadores/.test(sec()!.textContent || ""), 120000);
      const r = { done, analyzers: [...(sec()?.querySelectorAll(".tag") || [])].map(t => t.textContent).filter(t => t && t.includes("·")), findings: sec()?.querySelectorAll(".rv").length || 0, failed: /A revisão falhou/.test(sec()?.textContent || "") };
      host.remove();
      return r;
    });
    await step("llmNoKey", async () => { try { await desktopSample("hi"); return "unexpected"; } catch (e) { return String((e as Error) && (e as Error).message || e).slice(0, 120); } });
  }
  rep.errors = R.errors;
  await app.selftestReport(rep);
}
