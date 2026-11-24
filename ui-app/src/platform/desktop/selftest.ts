/* ═════════ dxtutor IDE — desktop: o auto-teste (ADR-0004, U4h1) ═════════
   O auto-teste da app real (`DXTUTOR_SELFTEST`, Xvfb): percorre o terminal, o PTY do painel,
   os modelos, a config dos providers, a pasta aberta, autosave, commit, gitflow, checkpoint,
   grafo, changelog, scm, infra (contentores, dev container, ambientes), termgit, codereview, a
   delegação isolada e o editor ligado ao servidor de linguagem (Java e Kotlin: diagnósticos,
   hover e F12), e grava o relatório. Era a função `selftest` do bridge.ts, verbatim (os passos
   `lsp-*` e os do ADR-0006 vieram depois). */

import type { DesktopContext } from "./context";
import { desktopPorts } from "../../app/desktop";
import { RP } from "../../app/store/registry";
import { projectClient } from "../tauri/project";
import { gitExtras } from "../../features/scm/extras";
import { tauriGitExtras } from "../../features/scm/infrastructure/tauri";
import { tauriHood } from "../../features/hood/infrastructure/tauri";
import { tauriOps } from "../../features/ops/infrastructure/tauri";
import { gfAsk } from "../../features/checkpoint";
import { sdAdd } from "../../features/studio";
import { saveTeam } from "../../features/team";

export async function selftest(ctx: DesktopContext): Promise<void> {
const { R, sh, git, stream, gitc, providers, tasks, app, idle } = ctx;
const flushSave = () => ctx.flushSave();
const realTerm = (raw: string) => ctx.realTerm(raw);
const desktopSample: DesktopContext["desktopSample"] = (i, o) => ctx.desktopSample(i, o);
  const rep: { tauri: boolean; version?: string; os?: string; errors: string[]; steps: Record<string, unknown>; stepErrors: Record<string, string[]> } =
    { tauri: true, version: R.info.version, os: R.info.os, errors: R.errors, steps: {}, stepErrors: {} };
  /* U5e do ADR-0004: o script-src já não tem 'unsafe-inline' — regista qualquer violação do CSP durante o
     auto-teste (um handler inline que tenha escapado à migração seria bloqueado aqui). */
  const cspViolations: string[] = [];
  document.addEventListener("securitypolicyviolation", (e) => cspViolations.push(`${e.violatedDirective} ${e.blockedURI || ""} ${(e.sample || "").slice(0, 80)}`.trim()));
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
    // A0.5 (docs/v2/UI-AUDIT.md): the pane's OWN buttons must reach real git (before, only the
    // published globals did). Clicks the real Commit button and a branch row, and starts a
    // gitflow branch through the published gfStart, then checks git itself.
    await step("scmPaneButtons", async () => {
      const errBefore = R.errors.length, click = (el: Element | null) => { if (!el) throw new Error("button not found"); el.dispatchEvent(new MouseEvent("click", { bubbles: true })); };
      const rel = "notes/pane-button.txt", msg = "test: commit from the Source Control button";
      writeFile(ROOT + rel, "pane button\n"); flushSave(); await idle();
      RP.scm();
      const input = document.getElementById("scm-msg") as HTMLInputElement; input.value = msg; input.dispatchEvent(new Event("input"));
      click(document.querySelector('#pane-scm [data-action="commit"]')); await idle(); await idle();
      const committed = (await git("log", "-1", "--format=%s")).stdout.trim() === msg;
      const start = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim();
      const flow = gfStart("fix", "pane-probe"); await idle(); await idle();
      const flowInGit = (await git("branch", "--list", flow)).stdout.trim() !== "";
      RP.scm();
      click([...document.querySelectorAll('#pane-scm [data-action="checkout"]')].find(e => e.getAttribute("data-on") === start) || null); await idle(); await idle();
      const backViaRow = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim() === start;
      await git("branch", "-D", flow); await ctx.syncGit();
      return { committed, flowInGit, backViaRow, errBefore, errAfter: R.errors.length };
    });
    // A4: git beyond the basics against the real repository (features/scm/extras): the blame of a
    // committed line (author, summary), that file's history and one commit's diff, a stash pushed,
    // listed and popped back, the worktree list, an interactive-rebase plan, and the pane's sections.
    await step("gitExtras", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const gx = tauriGitExtras(), root = R.root as string, file = "notes/flow.txt"; // tracked on develop (the gitflow step merged it)
      gitExtras.invalidate();
      gitExtras.lineBlame(file, 1);
      const blamed = await wait(() => !!gitExtras.lineBlame(file, 1), 10000);
      const b = gitExtras.lineBlame(file, 1);
      await gitExtras.openHistory(file, null);
      const histOk = await wait(() => /^\+x$/m.test(gitExtras.state().history?.diff || ""), 10000);
      writeFile(ROOT + file, "x\nstash me\n"); flushSave(); await idle();
      const pushed = await gx.stash(root, { op: "push", message: "selftest stash", untracked: false });
      const cleanAfterPush = (await git("status", "--porcelain", "--", file)).stdout.trim() === "";
      const popped = await gx.stash(root, { op: "apply", index: 0, pop: true });
      const back = (await sh("cat", [file])).stdout.includes("stash me");
      await git("checkout", "--", file); await ctx.reloadDisk();
      const wts = await gx.worktree(root, { op: "list" });
      const plan = await gx.rebase(root, { op: "plan", onto: "HEAD~1" });
      RP.scm();
      const paneOk = await wait(() => /Stashes/.test(document.getElementById("pane-scm")?.textContent || ""), 5000);
      return { blamed, author: b?.author, summary: b?.summary, histOk, pushed: pushed.stashes.length === 1, cleanAfterPush, popped: popped.stashes.length === 0, back, worktrees: wts.length, current: wts.some(w => w.current), planCommits: plan.commits.length, dirty: plan.dirty, paneOk };
    });
    // A0.5: the Testing pane lists the project's REAL tests (list_tests) on the desktop — a Rust
    // probe (descoberta pelo syn), redescoberta pelo «Refresh» do pane (features/testing, ADR-0006 R2a).
    await step("testsPane", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const key = ROOT + "probe_tests.rs";
      writeFile(key, "#[cfg(test)]\nmod tests {\n    #[test]\n    fn probe_passes() {}\n}\n"); flushSave(); await idle();
      PANE = "test"; window.renderTestPane();
      document.querySelector<HTMLElement>('#pane-test [data-action="refresh"]')?.click();
      const inPane = await wait(() => (document.getElementById("pane-test")?.textContent || "").includes("probe_passes"), 20000);
      delete FS[key]; flushSave(); await idle();
      return { inPane };
    });
    // A6: the Testing pane's real runners (features/testing): a cargo crate in a sub-folder is
    // detected (test_runners), «Run all» of that runner gives per-test results (one pass, one
    // fail — test_run), «Run this test» re-runs one, and the history card shows the kept runs
    // (test_history, SQLite). The probe files are removed at the end.
    await step("testRuns", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const toml = ROOT + "probe_crate/Cargo.toml", lib = ROOT + "probe_crate/src/lib.rs";
      writeFile(toml, "[package]\nname = \"probe_crate\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n");
      writeFile(lib, "#[cfg(test)]\nmod tests {\n    #[test]\n    fn probe_ok() {}\n    #[test]\n    fn probe_bad() { assert_eq!(1, 2, \"probe\"); }\n}\n");
      flushSave(); await idle();
      const el = () => document.getElementById("pane-test");
      const q = <T extends Element>(sel: string) => el()?.querySelector<T>(sel) ?? null;
      try {
        PANE = "test"; window.renderTestPane();
        q<HTMLElement>('[data-action="refresh"]')?.click();
        const detected = await wait(() => !!q('[data-action="runner-all"][data-on="cargo:probe_crate"]'), 20000);
        q<HTMLElement>('[data-action="runner-all"][data-on="cargo:probe_crate"]')?.click();
        const ran = await wait(() => (el()?.querySelectorAll(".tr-case").length || 0) >= 2, 120000);
        const row = (n: string) => [...(el()?.querySelectorAll(".tr-case") || [])].find(r => (r.textContent || "").includes(n))?.textContent || "";
        const ok = row("tests::probe_ok").startsWith("✓"), bad = row("tests::probe_bad").startsWith("✖");
        const idOk = 'cargo:probe_crate|cargo:' ;
        const one = [...(el()?.querySelectorAll<HTMLElement>('[data-action="case-run"]') || [])].find(b => (b.dataset.on || "").startsWith(idOk) && (b.dataset.on || "").endsWith("::tests::probe_ok"));
        one?.click();
        const single = await wait(() => !q('[data-action="case-run"][disabled]') && !q('[data-action="runner-all"][disabled]'), 60000);
        const kept = await wait(() => /Pass rate/.test(q(".tr-cards")?.textContent || "") || /Taxa de sucesso/.test(q(".tr-cards")?.textContent || ""), 10000);
        return { detected, ran, ok, bad, single: single && !!one, kept };
      } finally {
        delete FS[toml]; delete FS[lib]; flushSave(); await idle();
      }
    });
    // A5: the Project store through the real Tauri commands and SQLite — create, move one
    // step, a skipped step refused by the Rust rules (code `step`, overridable), and the
    // issue's activity. The issue is deleted at the end (the temp folder's project stays empty).
    await step("project", async () => {
      const pc = projectClient();
      const root = R.root as string;
      const p0 = (await pc.load(root)) as { issues: unknown[] };
      const p1 = (await pc.apply(root, { op: "create_issue", title: "selftest issue" })) as { issues: Array<{ key: string; title: string }> };
      const key = p1.issues.find((i) => i.title === "selftest issue")!.key;
      const p2 = (await pc.apply(root, { op: "move", key, to: "progress" })) as { issues: Array<{ key: string; state: string }> };
      let refused: { code?: string; overridable?: boolean } = {};
      try { await pc.apply(root, { op: "move", key, to: "done" }); } catch (e) { refused = e as typeof refused; }
      const detail = (await pc.issue(root, key)) as { activity: Array<{ kind: string }> };
      await pc.apply(root, { op: "delete_issue", key });
      const out = { empty: p0.issues.length === 0, moved: p2.issues.find((i) => i.key === key)?.state, refused: refused.code, overridable: refused.overridable, activity: detail.activity.map((a) => a.kind) };
      if (out.moved !== "progress" || out.refused !== "step" || out.overridable !== true || !out.activity.includes("moved")) throw new Error("project store: " + JSON.stringify(out));
      return out;
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
      /* o dev-container passou a ser real e assíncrono (R5b): tem o passo `devcontainer` próprio */
      ENVS.rtOn = false; ENVS.k8sOn = false;
      const deployNoRt = dxDeploy();
      ENVS.rtOn = true;
      const deployNoK8s = dxDeploy();
      ENVS.rtOn = rtBefore; ENVS.k8sOn = k8sBefore;
      drawRemote();
      const remoteBadgeWired = !!document.querySelector(".si.remote .rl");
      return { rtNoThrow, k8sNoThrow, deployNoRt, deployNoK8s, remoteBadgeWired, errBefore, errAfter: R.errors.length };
    });
    await step("terminal", async () => { const lines: string[] = []; const code = await stream("echo hello-from-term; echo $DX_SELF", { env: { DX_SELF: "env-ok" }, line: l => lines.push(l) }); return { code, lines }; });
    await step("terminalUI", async () => { await realTerm("echo ui-line"); await new Promise(r => setTimeout(r, 300)); return [...document.querySelectorAll("#term .line")].some(d => d.textContent === "ui-line"); });
    // feature `termgit` (migrada de app.ts para features/termgit.ts nesta sessão): handler
    // `git` do terminal (XC.git). Só os sub-comandos de leitura — status/log/branch/diff/push
    // não mutam estado, por isso o passo fica net-zero sem checkpoint/restore. O `push` do
    // terminal emulado já não finge um push (ADR-0006, R1d): `pushOk` tem de ser false.
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
    // feature `testing` (ADR-0006, R2a): o pane Testing sobre os comandos reais. Escreve um
    // teste Python (unittest: sem projecto cargo, corre depressa) com um caso verde e um
    // vermelho, abre o pane (list_tests), carrega em «Run all» (run_all_tests) e lê o estado
    // de cada teste e a barra de estado; depois corre um só (run_test) pelo ▶ da linha.
    await step("testing", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      writeFile(ROOT + "test_dx_selftest.py", "import unittest\n\n\nclass T(unittest.TestCase):\n    def test_soma(self):\n        self.assertEqual(1 + 1, 2)\n\n    def test_falha(self):\n        self.assertEqual(1 + 1, 3)\n");
      flushSave(); await idle();
      PANE = "test";
      window.renderTestPane();
      document.querySelector<HTMLElement>('#pane-test [data-action="refresh"]')?.click(); // um ficheiro de testes novo: voltar a descobrir
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
    // pesquisa (ADR-0006, R2b): o pane Search procura em toda a pasta pelo backend
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
    // outline (ADR-0006, R2c): o Outline do Explorer pelo backend (file_outline — servidor de
    // língua se houver, senão o scanner sintáctico) para o teste Python gravado acima.
    await step("outline", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      openPath(ROOT + "test_dx_selftest.py");
      const names = () => [...document.querySelectorAll("#outline .s-hit span:last-child")].map(e => e.textContent || "");
      const got = await wait(() => names().includes("test_falha"), 20000);
      return { got, symbols: names() };
    });
    // run (ADR-0006, R2d): o pane Run lista os projectos da pasta pelo backend
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
    // conta (ADR-0006, R2e1): o pane Conta mostra o utilizador e a máquina reais (whoami/
    // hostname) e a identidade git, em vez de uma identidade fixa.
    await step("account", () => {
      window.renderAccountPane();
      const t = document.getElementById("pane-account")?.textContent || "";
      return { user: R.user, host: R.host, git: R.gitName || null, shown: !!R.user && t.includes(R.user), noFake: !/walter|Team SYS/.test(t) || R.user === "walter" };
    });
    // code review (ADR-0006, R2e2): a tab junta às regras locais os analisadores reais do
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
    // board (ADR-0006, R3a): «Delegar» corre a issue com o agente — aqui um agente FALSO (o
    // selftest não tem modelo) que escreve um ficheiro; o resto é real: ramo gitflow, commit
    // pela porta do git, os testes do projecto (.dxtutor/commands.json → unittest) e a issue
    // em «Validação funcional»; no fim o repositório volta a develop.
    await step("board", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      writeFile(ROOT + ".dxtutor/commands.json", JSON.stringify({ test: "python3 -m unittest -k test_soma test_dx_selftest" }) + "\n");
      commit("chore: comandos do projecto para o selftest"); await idle(); await idle();
      const G = window as unknown as { mkIssue: (o: Record<string, unknown>) => { id: string; stage: string; branch: string | null; note: string }; delegate: (id: string) => Promise<void>; codevAgentAvailable?: unknown; codevAgentStory?: unknown };
      const prevA = G.codevAgentAvailable, prevS = G.codevAgentStory;
      G.codevAgentAvailable = () => true;
      G.codevAgentStory = async () => { writeFile(ROOT + "src/board_selftest.py", "def ok():\n    return True\n"); flushSave(); await idle(); };
      try {
        const it = G.mkIssue({ title: "Selftest do board", agent: "be", sprint: 0, stage: "todo" });
        await G.delegate(it.id);
        await wait(() => it.stage === "func" || it.stage === "dev", 60000);
        await idle(); await idle();
        const log = (await git("log", "--all", "--format=%s")).stdout;
        // R3b: o quadro grava-se no backend (board_save) e volta ao reabrir a pasta (board_load)
        await new Promise(r => setTimeout(r, 900));
        const inv = window.__TAURI__!.core.invoke as (c: string, a: Record<string, unknown>) => Promise<{ stories: Array<{ id: string; stage: string; meta?: { agent?: string } }> } | null>;
        const saved = await inv("board_load", { root: R.root });
        const st = saved?.stories.find(x => x.id === it.id);
        const BLw = (window as unknown as { BL: { issues: Array<{ id: string; stage: string }> } }).BL;
        BLw.issues.length = 0;
        document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: R.root } }));
        await wait(() => BLw.issues.some(x => x.id === it.id), 5000);
        return { stage: it.stage, note: it.note, branch: it.branch, committed: log.includes(`feat: Selftest do board (${it.id})`), head: (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim(),
          persisted: st ? { stage: st.stage, agent: st.meta?.agent } : null, reloaded: BLw.issues.find(x => x.id === it.id)?.stage ?? null };
      } finally { G.codevAgentAvailable = prevA; G.codevAgentStory = prevS; }
    });
    // equipa (ADR-0006, R3c): os escopos vêm da estrutura da pasta (o package.json do passo
    // `run` dá um frontend na raiz) e o .dxtutor/team.json do projecto manda; gravar a equipa
    // escreve-o no disco.
    await step("team", async () => {
      const G = window as unknown as { AGENTS: Record<string, { paths: string[]; cmds: string[] }>; saveTeam: () => void };
      writeFile(ROOT + ".dxtutor/team.json", JSON.stringify({ agents: { qa: { paths: ["e2e/**"], cmds: ["npm run e2e"] } } }) + "\n");
      flushSave(); await idle();
      document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: R.root } }));
      await new Promise(r => setTimeout(r, 300));
      const fe = G.AGENTS.fe.paths.slice(), qa = G.AGENTS.qa.paths.slice();
      G.AGENTS.db.paths = ["sql/**"]; saveTeam(); flushSave(); await idle();
      const onDisk = (await sh("cat", [".dxtutor/team.json"])).stdout;
      return { fe, qa, savedToDisk: /"sql\/\*\*"/.test(onDisk) };
    });
    // depuração (ADR-0006, R4): o gdb do backend. Sem gdb no sistema, o pane di-lo (o caminho
    // honesto); com gdb, uma sessão real sobre um binário Cargo pequeno com um breakpoint:
    // pára na linha, lê as variáveis, dá um passo e corre até ao fim.
    await step("debug", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const available = !!(await inv("debug_available"));
      const G = window as unknown as { startDebug: () => Promise<void>; dbgStep: () => Promise<void>; dbgCurrent: () => { path: string; line: number } | null; toggleBp: (p: string, l: number) => void };
      const pane = () => document.getElementById("pane-debug")?.textContent || "";
      if (!available) { await G.startDebug(); return { available, saysNoGdb: /O gdb não está instalado/.test(pane()) }; }
      // a member of the root workspace below: its own [workspace] table made cargo refuse («multiple workspace roots»)
      writeFile(ROOT + "dbgself/Cargo.toml", '[package]\nname = "dbgself"\nversion = "0.1.0"\nedition = "2021"\n');
      writeFile(ROOT + "dbgself/src/main.rs", "fn main() {\n    let answer = 40 + 2;\n    println!(\"{answer}\");\n}\n");
      writeFile(ROOT + "Cargo.toml", '[workspace]\nmembers = ["dbgself"]\nresolver = "2"\n');
      flushSave(); await idle();
      // the breakpoints persist (LS) across runs: toggling blindly could remove one left by an earlier run
      // line 2, not 3: a line breakpoint on `println!` resolves to several locations (the macro), so each
      // continue stops on line 3 again — real lldb behaviour; `let answer = 40 + 2;` has one location
      for (const old of [ROOT + "dbgself/src/main.rs:3"]) if ((window as unknown as { dbgBreaks: Set<string> }).dbgBreaks.has(old)) G.toggleBp(ROOT + "dbgself/src/main.rs", 3);
      const bpKeyNow = ROOT + "dbgself/src/main.rs:2", breaks = (window as unknown as { dbgBreaks: Set<string> }).dbgBreaks;
      if (!breaks.has(bpKeyNow)) G.toggleBp(ROOT + "dbgself/src/main.rs", 2);
      await G.startDebug();
      const stoppedAt = G.dbgCurrent();
      // A7: over DAP (lldb-dap) when it is installed — the engine, then (after the step, once `answer`
      // exists) the variables tree and the values inline
      const engine = document.querySelector("#pane-debug .dbg-engine")?.textContent || "gdb";
      await G.dbgStep();
      await wait(() => !G.dbgCurrent() || G.dbgCurrent()!.line !== 2, 20000);
      const after = G.dbgCurrent();
      const vars = /answer/.test(pane());
      const inline = [...document.querySelectorAll("#ed-hl .dv-inline")].map(e => e.textContent).join(" | ");
      if (after) await G.startDebug(); // continuar até ao fim
      if (breaks.has(bpKeyNow)) G.toggleBp(ROOT + "dbgself/src/main.rs", 2); // a próxima execução começa limpa
      return { available, engine, stoppedAt, vars, inline, after, ended: /O programa terminou/.test(pane()), pane: pane().slice(0, 400) };
    });
    // A8: «Under the hood» real com a toolchain desta máquina — as instruções de uma linha em debug e
    // em release, o bytecode Python, os estágios do compilador, uma execução medida, o crescimento com N
    // e o traço real (Rust e Python).
    await step("hoodReal", async () => {
      const hd = tauriHood();
      const rs = "fn sum(n: u64) -> u64 {\n    let mut s = 0u64;\n    for i in 0..n { s = s.wrapping_add(i ^ (s >> 3)); }\n    s\n}\nfn main() {\n    let n: u64 = std::env::args().nth(1).map(|a| a.parse().unwrap()).unwrap_or(10);\n    println!(\"{}\", sum(n));\n}\n";
      const [dbg, rel] = [await hd.lineAsm(rs, false), await hd.lineAsm(rs, true)];
      const py = await hd.bytecode("def add(a, b):\n    return a + b\n\nprint(add(1, 2))\n");
      const pipe = await hd.pipeline(rs);
      const run = await hd.measured(rs);
      const grow = await hd.growth(rs, [20000000, 40000000, 80000000, 160000000, 320000000]); // big enough for the work to dominate the noise
      const trRs = await hd.trace("rust", rs);
      const trPy = await hd.trace("python", "def add(a, b):\n    s = a + b\n    return s\n\nprint(add(2, 3))\n");
      return {
        debugTotal: dbg.total, releaseTotal: rel.total, line3: (dbg.lines.find((l) => l.line === 3)?.instructions.length ?? 0) > 0,
        pyOps: py.ok && py.lines.some((l) => l.scope === "add" && l.ops.some((o) => o.startsWith("BINARY_OP"))),
        llvm: pipe.llvmIr.includes("define"), asm: pipe.asm.length > 0,
        ran: run.run.ok && run.run.stdout.trim().length > 0, peakKb: run.telemetry.peakRssKb,
        growth: grow.ok ? `${grow.bigO} (R² ${grow.rSquared?.toFixed(2)}, ${grow.confidence})` : grow.notes.slice(0, 120),
        traceRust: trRs.supported ? trRs.steps.length : trRs.notes.slice(0, 120), tracePython: trPy.supported ? trPy.steps.length : trPy.notes.slice(0, 120),
      };
    });
    // A9: Ops em só leitura — um plano real do OpenTofu/Terraform numa pasta infra/ do repositório
    // temporário; o kubectl contra um kubeconfig TEMPORÁRIO e vazio (nunca os clusters do utilizador);
    // e o estado das CLIs de cloud desta máquina.
    await step("ops", async () => {
      const op = tauriOps(), root = R.root as string;
      const tf = ROOT + "infra/main.tf", kc = ROOT + "kubeconfig-selftest.yaml";
      writeFile(tf, 'resource "terraform_data" "web" {\n  input = { image = "nginx:1.27", replicas = 2 }\n}\n');
      writeFile(kc, "apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n");
      flushSave(); await idle();
      try {
        const dirs = await op.iacDirs(root);
        const plan = await op.iacPlan(root, "infra", false);
        const kube = await op.kubeState({ kubeconfig: root.replace(/\/$/, "") + "/kubeconfig-selftest.yaml", context: "selftest-nowhere", namespace: "default" });
        const cloud = await op.cloudStatus();
        return {
          dirs, tool: plan.tool, planOk: plan.ok, add: plan.add, address: plan.changes[0]?.address, unknownId: !!plan.changes[0]?.attrs.some((a) => a.name === "id" && a.unknown), planNotes: plan.notes.slice(0, 160),
          kubeOk: kube.ok, kubeSaysWhy: /selftest-nowhere/.test(kube.notes),
          cloud: cloud.map((c) => `${c.provider}:${c.installed ? "installed" : "absent"}`).join(" "),
        };
      } finally {
        delete FS[tf]; delete FS[kc]; flushSave(); await idle();
      }
    });
    // contentores (ADR-0006, R5a): ligar o runtime real (docker info pelo socket) e o pane
    // Containers lista os contentores e as imagens reais (ps/images em JSON).
    await step("containers", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const W = window as unknown as { ENVS: { rt: string; rtOn: boolean }; rtConnect: () => Promise<void> };
      W.ENVS.rt = "docker";
      if (!W.ENVS.rtOn) await W.rtConnect();
      await wait(() => W.ENVS.rtOn, 15000);
      const host = () => document.getElementById("dk-containers"), imgs = () => document.getElementById("dk-images");
      await R.drawContainers?.();
      await wait(() => !/A ler os contentores/.test(host()?.textContent || ""), 20000);
      return { connected: W.ENVS.rtOn, containers: host()?.querySelectorAll(".dk-row").length ?? -1, images: imgs()?.querySelectorAll(".dk-row").length ?? -1, text: (host()?.textContent || "").slice(0, 80) };
    });
    // dev-container (ADR-0006, R5b): a sessão real do backend (devcontainer_session_up/down) sobre
    // um devcontainer.json com uma imagem que já existe nesta máquina (sem descarregar nada).
    await step("devcontainer", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 200)); return f(); };
      const W = window as unknown as { P_DC: string; DEVC: { name: string; image: string } | null; dcAttach: () => void; dcDetach: () => void; ENVS: { rtOn: boolean } };
      const img = ((await sh("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"])).stdout.trim().split("\n").filter(x => x && !x.includes("<none>"))[0]) || "";
      if (!img) return { skipped: "sem imagens locais" };
      writeFile(W.P_DC, JSON.stringify({ name: "selftest", image: img }) + "\n"); flushSave(); await idle();
      W.dcAttach();
      const up = await wait(() => !!W.DEVC, 60000);
      const name = W.DEVC ? W.DEVC.name : "", engine = (W.DEVC as unknown as { engine?: string } | null)?.engine || "docker";
      const bin = engine === "host" ? "docker" : engine;
      const inPs = name ? (await sh(bin, ["ps"])).stdout.includes(name) : false; /* o delonix ignora o --format: procura-se o nome na tabela */
      W.dcDetach();
      const down = await wait(() => W.DEVC === null, 30000);
      const gone = name ? !(await sh(bin, ["ps", "-a"])).stdout.includes(name) : false;
      return { image: img, engine, up, name, inPs, down, gone };
    });
    // observabilidade (ADR-0006, R5c2): uma stack de um serviço (nome de projecto único, a primeira
    // imagem local, um entrypoint que escreve linhas conhecidas), observada pela porta real —
    // `stats` e `compose logs` —, e depois `compose down`.
    await step("observe", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 250)); return f(); };
      const W = window as unknown as { ROOT: string; STACK: Array<{ name: string }> | null; OBS: Record<string, { polled: boolean; logs: Array<{ m: string }>; cpu: number[]; mem: number[]; sampleErr: string; logErr: string }>; dxRun: () => unknown; dxStop: () => unknown; openObserve: (e: string, n: string) => void; ENVS: { rtOn: boolean } };
      const img = ((await sh("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"])).stdout.trim().split("\n").filter(x => x && !x.includes("<none>"))[0]) || "";
      if (!img || !W.ENVS.rtOn) return { skipped: !img ? "sem imagens locais" : "runtime desligado" };
      const proj = "dxtutor-selftest-" + Date.now().toString(36);
      writeFile(W.ROOT + "docker-compose.yml", `name: ${proj}\nservices:\n  obs:\n    image: ${img}\n    entrypoint: ["sh", "-c", "echo dxtutor-selftest up; while true; do echo tick; sleep 1; done"]\n`);
      flushSave(); await idle();
      W.dxRun();
      const up = await wait(() => !!W.STACK && W.STACK.some(x => x.name === "obs"), 120000);
      W.openObserve("local", "obs");
      const polled = await wait(() => { const o = W.OBS["local:obs"]; return !!o && o.polled && o.logs.some(l => /dxtutor-selftest up/.test(l.m)); }, 30000);
      await wait(() => (W.OBS["local:obs"]?.mem.length || 0) >= 1, 15000);
      const o = W.OBS["local:obs"];
      const res = { image: img, up, polled, logLines: o ? o.logs.length : 0, firstLog: o?.logs[0]?.m || "", mem: o?.mem.slice(-1)[0], cpu: o?.cpu.slice(-1)[0], sampleErr: o?.sampleErr, logErr: o?.logErr };
      W.dxStop();
      const down = await wait(() => W.STACK === null, 60000);
      const left = (await sh("docker", ["ps", "-a", "-q", "--filter", `label=com.docker.compose.project=${proj}`])).stdout.trim();
      return { ...res, down, gone: !left };
    });
    // ambientes (ADR-0006, R5c1): o kubectl real, mas NUNCA contra os clusters do utilizador — um
    // kubeconfig temporário com um contexto cujo servidor não responde. Prova a leitura real dos
    // contextos, o erro de ler um namespace e o apply por stdin a falhar sem inventar nada.
    await step("environments", async () => {
      const W = window as unknown as { ENVS: { kube: string; ctx: string; ns: string; k8sOn: boolean }; ENVX: { ctx: Record<string, string>; ns: Record<string, string>; hist: unknown[] }; KCTX: string[]; k8sConnect: () => Promise<void>; envState: (e: string) => unknown; promote: (e: string) => void };
      const kc = (await sh("mktemp", [])).stdout.trim();
      const cfg = "apiVersion: v1\nkind: Config\nclusters:\n- name: dx-selftest\n  cluster:\n    server: https://127.0.0.1:9\n    insecure-skip-tls-verify: true\ncontexts:\n- name: dx-selftest\n  context:\n    cluster: dx-selftest\n    user: dx-selftest\n    namespace: dx\nusers:\n- name: dx-selftest\n  user:\n    token: x\ncurrent-context: dx-selftest\n";
      await sh("sh", ["-c", 'cat > "$1"', "sh", kc], { stdin: cfg });
      const prev = { kube: W.ENVS.kube, ctx: W.ENVS.ctx, on: W.ENVS.k8sOn };
      W.ENVS.kube = kc; W.ENVS.k8sOn = false;
      await W.k8sConnect();
      const contexts = [...W.KCTX];
      const cluster = desktopPorts.infra?.cluster;
      let readErr = "";
      try { await cluster!.read({ env: "staging", ctx: "dx-selftest", ns: "dx" }); } catch (e) { readErr = String((e as Error).message || e).slice(0, 120); }
      const applied = await cluster!.apply({ env: "staging", ctx: "dx-selftest", ns: "dx" }, "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: dx-selftest\n", "abc1234");
      W.ENVX.ctx.staging = "dx-selftest";
      const res = { contexts, connected: W.ENVS.k8sOn, readErr, applied, staging: W.envState("staging"), hist: W.ENVX.hist.length };
      W.ENVS.kube = prev.kube; W.ENVS.ctx = prev.ctx; W.ENVS.k8sOn = prev.on; W.ENVX.ctx.staging = "";
      await sh("rm", ["-f", kc]);
      return res;
    });
    // Studio (ADR-0006, R6a): sem desenho semeado; o desenho guarda-se no projecto, em
    // .dxtutor/studio.json (autosave para o disco), e volta ao reabrir a pasta.
    await step("studio", async () => {
      const W = window as unknown as { SD: { nodes: Array<{ n: string }> }; sdAdd: (t: string) => void; loadSD: () => { nodes: unknown[] } };
      const key = ROOT + ".dxtutor/studio.json";
      const emptyAtStart = W.SD.nodes.length === 0 && !FS[key];
      sdAdd("rust-axum"); flushSave(); await idle();
      const disk = (await sh("cat", [".dxtutor/studio.json"])).stdout;
      let onDisk = 0; try { onDisk = JSON.parse(disk).nodes.length; } catch { /* não gravou */ }
      W.SD = { nodes: [] } as never;
      document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: R.root } }));
      const reloaded = W.SD.nodes.map(n => n.n);
      delete FS[key]; flushSave(); await idle();
      const removed = (await sh("test", ["-e", ".dxtutor/studio.json"])).code !== 0;
      document.dispatchEvent(new CustomEvent("dx:workspace", { detail: { root: R.root } }));
      return { emptyAtStart, onDisk, reloaded, removed, emptyAfter: W.SD.nodes.length === 0 };
    });
    // extensões (ADR-0006, R6b): o Open VSX real — pesquisa (vsix_search_open_vsx) e instalar um
    // tema (só contribuições declarativas, VSIX pequeno), ver o tema aplicável e desinstalar. Sem
    // rede, diz-se (não é uma falha da app).
    await step("extensions", async () => {
      const W = window as unknown as { EXS: { inst: Record<string, unknown>; vsix: Array<{ id: string; contrib?: { themes: string[] } }> }; extInstall: (id: string) => Promise<void>; extRemove: (id: string) => void; renderExtPane: () => void; PANE: string };
      let hits: Array<{ id: string; downloads: number }> = [];
      try { hits = await (await import("../tauri/extensions")).searchOpenVsx("rust-analyzer", 3); } catch (e) { return { offline: String((e as Error).message || e).slice(0, 120) }; }
      const id = "dracula-theme.theme-dracula";
      await W.extInstall(id);
      const x = W.EXS.vsix.find(v => v.id === id);
      const res = { searched: hits.map(h => h.id), firstHasDownloads: (hits[0]?.downloads || 0) > 0, installed: !!W.EXS.inst[id], themes: x?.contrib?.themes || [] };
      W.extRemove(id);
      return { ...res, removed: !W.EXS.inst[id] && !W.EXS.vsix.some(v => v.id === id) };
    });
    // Remote (ADR-0006, R6c): os hosts do ~/.ssh/config real. Só escreve um config temporário se
    // NÃO houver nenhum (e apaga-o no fim) — nunca mexe no do utilizador. O host aponta para uma
    // porta local fechada: o teste de ligação (ssh BatchMode) falha com a mensagem real do ssh.
    await step("remote", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 150)); return f(); };
      const home = R.info.home || "", cfg = home + "/.ssh/config";
      const had = (await sh("test", ["-e", cfg])).code === 0, hadDir = (await sh("test", ["-d", home + "/.ssh"])).code === 0;
      if (!had) { await sh("mkdir", ["-p", home + "/.ssh"]); await sh("sh", ["-c", 'cat > "$1"', "sh", cfg], { stdin: "Host dx-selftest\n  HostName 127.0.0.1\n  Port 9\n  User nobody\n" }); }
      const side = document.querySelector(".side");
      if (side && !document.getElementById("pane-remote")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-remote"></div>');
      window.renderRemotePane();
      const el = () => document.getElementById("pane-remote")?.textContent || "";
      const status = () => { const b = document.querySelector('#pane-remote [data-remote="test"][data-host="dx-selftest"]'); return b?.closest(".scm-row")?.querySelector(".pth")?.textContent || ""; };
      const listed = await wait(() => had ? !/A ler o/.test(el()) : /nobody@127\.0\.0\.1:9/.test(status()), 10000);
      let tested = "";
      if (!had) {
        document.querySelector<HTMLElement>('#pane-remote [data-remote="test"][data-host="dx-selftest"]')?.click();
        await wait(() => /^[✖✓]/.test(status()), 20000);
        tested = status().slice(0, 120);
        await sh("rm", ["-f", cfg]);
        if (!hadDir) await sh("rmdir", [home + "/.ssh"]);
      }
      const local = document.querySelector("#pane-remote .scm-row .nm")?.textContent || "";
      return { hadConfig: had, listed, local, tested };
    });
    await step("llmNoKey", async () => { try { await desktopSample("hi"); return "unexpected"; } catch (e) { return String((e as Error) && (e as Error).message || e).slice(0, 120); } });
    // feature `lsp`: o editor ligado ao servidor de linguagem, conduzido como um utilizador —
    // abrir o ficheiro (editor:tab → lsp_start + didOpen), esperar os diagnósticos no gutter,
    // rato parado sobre um símbolo (mousemove → cartão de hover), F12 numa chamada (salta
    // para a definição), Shift+F12 (lista de referências) e F2 + nome novo + Enter (rename em
    // todos os ficheiros, gravado no disco); pelo meio completion, assinatura, code actions,
    // formatação e Go to Symbol (Ctrl+Shift+O + o Outline). Só corre para as linguagens com servidor instalado.
    for (const lang of ["java", "kotlin"] as const) await step("lsp-" + lang, () => lspProbe(lang));
  }
  /* sem handlers inline em lado nenhum do DOM vivo (depois de o auto-teste ter aberto as vistas) e sem violações do CSP */
  await step("csp", async () => {
    const inlineHandlers = [...document.querySelectorAll("*")].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "")).slice(0, 20);
    const violations = cspViolations.slice(0, 20);
    /* prova de que o CSP está activo: um handler inline plantado não pode correr */
    const b = document.createElement("button");
    b.setAttribute("onclick", "this.dataset.ran='1'");
    document.body.appendChild(b); b.click();
    await new Promise((r) => setTimeout(r, 50));
    const ran = b.dataset.ran === "1"; b.remove();
    return { inlineHandlers, violations, inlineBlocked: !ran };
  });
  rep.errors = R.errors;
  await app.selftestReport(rep);

  /* Uma linguagem no editor real: ficheiros com um erro de tipo, um símbolo para o hover e
     uma chamada cuja definição está noutro ficheiro (Java) ou mais acima (Kotlin). */
  async function lspProbe(lang: "java" | "kotlin"): Promise<unknown> {
    const W = window as unknown as {
      cur: string | null; openPath: (k: string, line?: number) => void;
      diagnostics: () => { p: string; line: number; sev: string; msg: string }[];
      toast: (m: string) => void;
    };
    // os avisos da feature (rename aplicado, «still indexing», erros) entram no relatório
    const toasts: string[] = [], realToast = W.toast;
    W.toast = (m: string) => { toasts.push(m); realToast(m); };
    try { return await probe(); } finally { W.toast = realToast; }
    async function probe(): Promise<unknown> {
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
    /* O backend procura o servidor no PATH e, para o jdtls, em $HOME/.local/share/jdtls/bin; sem
       servidor não abre sessão nenhuma (sem erro), e o passo esperaria 180 s em silêncio. Com o HOME
       temporário do auto-teste, o jdtls instalado na pasta pessoal real não se encontra: diz-se já,
       com o remédio (pôr a pasta dele no PATH). */
    const server = lang === "java" ? "jdtls" : "kotlin-language-server";
    const where = lang === "java" ? 'command -v jdtls || { test -x "$HOME/.local/share/jdtls/bin/jdtls" && echo "$HOME/.local/share/jdtls/bin/jdtls"; }' : "command -v kotlin-language-server";
    const serverPath = (await sh("sh", ["-c", where], { cwd: R.info.home })).stdout.trim();
    for (const [rel, text] of Object.entries(files)) writeFile(ROOT + rel, text);
    flushSave(); await idle();
    if (!serverPath) {
      /* sem servidor: o editor tem de o dizer (o aviso no topo da vista do ficheiro) */
      W.openPath(main);
      const notice = await until(() => document.getElementById("lsp-missing")?.textContent, 15_000);
      return { skipped: `${server} não encontrado no PATH${lang === "java" ? " nem em $HOME/.local/share/jdtls/bin" : ""} — com um HOME temporário, põe a pasta dele no PATH`, editorNotice: notice ? notice.replace(/\s+/g, " ").slice(0, 160) : null };
    }

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
    const caretLine = caretLineNow(), defFile = W.cur;
    // 3b) completion: numa linha nova escreve `Util.` (Java) / `gre` (Kotlin), a lista abre
    //     sozinha, Enter aceita a sugestão; no fim o ficheiro volta ao que era.
    if (W.cur !== main) W.openPath(main);
    const original = ta()!.value;
    const typed = lang === "java" ? "\n        int again = Util." : "\n    val again = gre";
    const lineEnd = original.split("\n").slice(0, callLine + 1).join("\n").length;
    const type = () => {
      const el = ta()!; el.focus();
      el.value = original.slice(0, lineEnd) + typed + original.slice(lineEnd);
      el.setSelectionRange(lineEnd + typed.length, lineEnd + typed.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    type();
    const suggestions = await until(() => {
      const labels = [...document.querySelectorAll("#lsp-complete .lsp-c-label")].map(l => l.textContent ?? "");
      if (labels.some(l => l.startsWith(callWord))) return labels;
      ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true, bubbles: true, cancelable: true }));
      return null;
    }, 90_000, 3000);
    // escolhe a sugestão do símbolo e aceita com Enter
    if (suggestions) {
      for (let k = 0; k < suggestions.length; k++) {
        const on = document.querySelector("#lsp-complete .lsp-c-row.on .lsp-c-label")?.textContent ?? "";
        if (on.startsWith(callWord)) break;
        ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      }
      ta()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }
    const insertedLine = ta()!.value.split("\n")[callLine + 1] ?? "";
    const completed = insertedLine.includes(callWord + "(");
    const el0 = ta()!; el0.value = original; el0.setSelectionRange(0, 0); el0.dispatchEvent(new Event("input", { bubbles: true }));
    await until(() => FS[main].content === original, 5_000, 100);
    // 3c) assinatura: escrever a chamada abre o cartão com o 1.º parâmetro a negrito; em Java,
    //     depois de «1,» o activo passa ao 2.º. O ficheiro volta ao que era.
    const callTyped = lang === "java" ? "\n        int x = Util.add(" : "\n    val y = greet(";
    const typeAt = (extra: string) => {
      const el = ta()!; el.focus();
      const t = original.slice(0, lineEnd) + callTyped + extra + original.slice(lineEnd);
      el.value = t;
      const c = lineEnd + callTyped.length + extra.length;
      el.setSelectionRange(c, c);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const sigNow = () => {
      const c = document.getElementById("lsp-signature");
      return c ? { label: c.querySelector(".lsp-sig-label")?.textContent ?? "", active: c.querySelector(".lsp-sig-label b")?.textContent ?? null } : null;
    };
    const firstSig = await until(() => { const s = sigNow(); if (s && s.active) return s; typeAt(""); return null; }, 60_000, 2500);
    let secondSig: { label: string; active: string | null } | null = null;
    if (lang === "java" && firstSig) {
      secondSig = await until(() => { const s = sigNow(); if (s && s.active && s.active !== firstSig.active) return s; typeAt("1,"); return null; }, 30_000, 2000);
    }
    const el1 = ta()!; el1.value = original; el1.setSelectionRange(0, 0); el1.dispatchEvent(new Event("input", { bubbles: true }));
    el1.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await until(() => FS[main].content === original, 5_000, 100);
    // 3d) code actions: Ctrl+. na linha com o erro de tipo abre o menu; em Java a 1.ª é a
    //     correcção do jdtls, e aplicá-la muda o ficheiro. O ficheiro volta ao que era.
    const brokenLine = original.split("\n").findIndex(l => /\bbroken\b/.test(l) && l.includes("="));
    const actionTitles = await until(() => {
      const rows = [...document.querySelectorAll("#lsp-actions .lsp-act-title")].map(r => r.textContent ?? "");
      if (rows.length || document.querySelector("#lsp-actions .lsp-pop-h")?.textContent === "No code actions here") return rows.length ? rows : ["(nenhuma)"];
      const el = ta()!; el.focus();
      const o = original.split("\n").slice(0, brokenLine).join("\n").length + 1 + original.split("\n")[brokenLine].indexOf("broken");
      el.setSelectionRange(o, o);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: ".", ctrlKey: true, bubbles: true, cancelable: true }));
      return null;
    }, 60_000, 3000);
    let actionApplied: string | null = null;
    // aplica a CORRECÇÃO (tipo «fix»), não a primeira acção qualquer
    const fixAction = [...document.querySelectorAll<HTMLButtonElement>("#lsp-actions .lsp-action:not([disabled])")]
      .find(b => b.querySelector(".lsp-act-kind")?.textContent === "fix");
    if (lang === "java" && fixAction) {
      fixAction.click();
      const changed = await until(() => FS[main].content !== original && FS[main].content.split("\n")[brokenLine], 20_000, 250);
      actionApplied = changed ? changed.trim() : null;
    }
    document.getElementById("lsp-actions")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (FS[main].content !== original) {
      const el2 = ta()!; el2.value = original; el2.setSelectionRange(0, 0); el2.dispatchEvent(new Event("input", { bubbles: true }));
      await until(() => FS[main].content === original, 5_000, 100);
    }
    // 3e) formatação: estraga o espaçamento de uma linha, Shift+Alt+F (sem selecção) formata o
    //     documento pelo servidor e a linha volta ao estilo dele. O ficheiro volta ao que era.
    const fmtLineNo = original.split("\n").findIndex(l => l.includes(lang === "java" ? "int total" : "val message"));
    const uglyLine = lang === "java" ? "  int   total=Util.add(1,2) ;" : 'val   message=greet("dxtutor")';
    const uglyText = original.split("\n").map((l, i) => (i === fmtLineNo ? uglyLine : l)).join("\n");
    const formattedLine = await until(() => {
      const now = (FS[main].content.split("\n")[fmtLineNo] ?? "");
      if (FS[main].content !== uglyText && now.trim() && now !== uglyLine && FS[main].content.includes(uglyLine) === false && now.startsWith("    ")) return now;
      const el = ta()!; el.focus();
      if (el.value !== uglyText) { el.value = uglyText; el.dispatchEvent(new Event("input", { bubbles: true })); }
      el.setSelectionRange(0, 0);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "F", code: "KeyF", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));
      return null;
    }, 60_000, 3000);
    if (FS[main].content !== original) {
      const el3 = ta()!; el3.value = original; el3.setSelectionRange(0, 0); el3.dispatchEvent(new Event("input", { bubbles: true }));
      await until(() => FS[main].content === original, 5_000, 100);
    }
    // 3f) Go to Symbol: Ctrl+Shift+O lista os símbolos do ficheiro; filtrar por «mai» e Enter
    //     levam o cursor à linha do `main`. E o Outline mostra os símbolos do servidor.
    const symRows = () => [...document.querySelectorAll("#lsp-symbols .lsp-sym")].map(b => `${b.querySelector(".lsp-act-kind")?.textContent} ${b.querySelector(".lsp-sym-n")?.textContent}`);
    const symbolList = await until(() => {
      const rows = symRows();
      if (rows.some(r => r.includes("main"))) return rows;
      if (W.cur !== main) W.openPath(main);
      if (!document.getElementById("lsp-symbols")) {
        const el = ta()!; el.focus(); el.setSelectionRange(0, 0);
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "O", code: "KeyO", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
      }
      return null;
    }, 60_000, 2500);
    const symInput = document.querySelector<HTMLInputElement>("#lsp-symbols input");
    let filtered: string[] | null = null, symbolJump: number | null = null;
    if (symInput) {
      symInput.value = "mai"; symInput.dispatchEvent(new Event("input", { bubbles: true }));
      filtered = symRows();
      await sleep(1500); // o cartão filtrado fica no ecrã para a captura
      symInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      symbolJump = caretLineNow();
    }
    document.getElementById("lsp-symbols")?.remove();
    const outlineRows = await until(() => {
      const rows = [...document.querySelectorAll("#outline .s-hit")].map(h => h.textContent ?? "");
      return rows.some(r => r.includes("main")) ? rows : null;
    }, 20_000, 500);
    // 4) Shift+F12 na chamada → a lista de referências (a declaração e a chamada)
    const caretOn = (line: number, word: string) => { if (W.cur !== main) W.openPath(main); const el = ta()!; const o = offsetOf(line, word); el.focus(); el.setSelectionRange(o, o); return el; };
    const refRows = await until(() => {
      const rows = [...document.querySelectorAll("#lsp-refs .lsp-ref")].map(b => b.textContent ?? "");
      if (rows.length >= 2) return rows;
      caretOn(callLine, callWord).dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true, bubbles: true }));
      return null;
    }, 60_000, 2500);
    document.getElementById("lsp-refs")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // 5) F2 na chamada → caixa com o nome → escrever o nome novo + Enter → todos os ficheiros
    const newName = lang === "java" ? "sum" : "salute";
    // um F2 de cada vez (o prepareRename pode demorar): dois F2 seguidos abririam duas caixas e a
    // segunda substitui a primeira — escrever-se-ia numa caixa que já não está no ecrã
    let lastF2 = 0;
    const found = await until(() => {
      const input = document.querySelector<HTMLInputElement>("#lsp-rename input");
      if (input) return input;
      if (Date.now() - lastF2 > 8000) {
        lastF2 = Date.now();
        caretOn(callLine, callWord).dispatchEvent(new KeyboardEvent("keydown", { key: "F2", bubbles: true }));
      }
      return null;
    }, 40_000, 500);
    if (found) await sleep(800);
    const box = document.querySelector<HTMLInputElement>("#lsp-rename input"); // a caixa que está no ecrã
    const placeholder = box ? box.value : null;
    if (box) { box.value = newName; box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
    const renamed = await until(() => Object.keys(files).every(rel => !FS[ROOT + rel].content.includes(callWord + "(")) && Object.keys(files).some(rel => FS[ROOT + rel].content.includes(newName + "(")), 60_000, 500);
    flushSave(); await idle();
    const onDisk = renamed ? (await sh("cat", Object.keys(files))).stdout.split(newName + "(").length - 1 : 0;
    // diagnóstico se falhou: o que o servidor responde AGORA ao rename na posição esperada
    let probeRename: unknown = null;
    if (!renamed) {
      const abs = `${R.root}/${main.slice(ROOT.length)}`, text = FS[main].content, ls = text.split("\n");
      const character = ls[callLine].indexOf(callWord) + 1;
      const inv = (window as unknown as { __TAURI__: { core: { invoke: (c: string, a: unknown) => Promise<unknown> } } }).__TAURI__.core.invoke;
      const res = await inv("lsp_rename", { path: abs, line: callLine, character, newName }).catch(e => `ERR ${e}`);
      probeRename = { cur: W.cur, abs, line: callLine, character, lineText: ls[callLine], res: JSON.stringify(res).slice(0, 300) };
    }
    return {
      server: serverPath,
      diagnostic: diag ? `${diag.line}: ${diag.msg.slice(0, 90)}` : null, gutterErr, diagMs,
      hover: hoverText ? hoverText.replace(/\s+/g, " ").slice(0, 120) : null,
      definition: { jumped: !!jumped, file: defFile, caretLine, expectedLine: defLine },
      completion: { suggestions: suggestions ? suggestions.slice(0, 6) : null, accepted: insertedLine.trim(), completed },
      signature: { first: firstSig, ...(lang === "java" ? { afterComma: secondSig } : {}) },
      codeActions: { titles: actionTitles ? actionTitles.slice(0, 5) : null, ...(lang === "java" ? { applied: actionApplied } : {}) },
      formatting: { from: uglyLine, to: formattedLine },
      symbols: { list: symbolList, filtered, caretLineAfterEnter: symbolJump, expectedLine: lang === "java" ? 2 : 3, outline: outlineRows },
      references: refRows ? refRows.map(r => r.replace(/\s+/g, " ").slice(0, 70)) : null,
      rename: { placeholder, to: newName, applied: !!renamed, occurrencesOnDisk: onDisk, ...(probeRename ? { probe: probeRename } : {}) },
      toasts,
    };
    }
  }
}
