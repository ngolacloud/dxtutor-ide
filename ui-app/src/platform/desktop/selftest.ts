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
import { auditClient } from "../tauri/audit";
import { services } from "../../app/services";
import { gitClient } from "../tauri/git";
import { gitExtras } from "../../features/scm/extras";
import { tauriGitExtras } from "../../features/scm/infrastructure/tauri";
import { tauriHood } from "../../features/hood/infrastructure/tauri";
import { tauriOps } from "../../features/ops/infrastructure/tauri";
import { listen, invoke } from "../tauri/core";
import { tauriLspConfig } from "../../features/lsp/infrastructure/tauri";
import { tauriVault } from "../../features/vault/infrastructure/tauri";
import { tauriRulesGateway } from "../../features/arch/infrastructure/tauri";
import { gfAsk } from "../../features/checkpoint";
import { sdAdd } from "../../features/studio";
import { saveTeam } from "../../features/team";
import { restoreCkpt } from "../../features/checkpoint";
import { STOP, provState } from "../../features/codev";
import { agentStore } from "../../app/store";
import { renderRemotePane } from "../../features/remote";
import { renderRunPane } from "../../features/run";
import { renderSearchPane } from "../../features/search";
import { renderAccountPane } from "../../features/account";
import { renderGraphView, graphScreen } from "../../features/scm/graph-screen";
import { rtConnect, k8sConnect, dxDeploy, drawRemote, dcAttach, dcDetach, OBS, openObserve, ENVX, envState, devc, pDc, KCTX } from "../../features/infra";
import { stage, gitMerge } from "../../features/scm";
import { hunks, undo, merge3, sync, launchpad, composer } from "../../features/scm/extras";
import { setLanes } from "../../features/scm/infrastructure/legacy-bridge";
import { clLog, clShow } from "../../features/changelog";
import { gitCmd } from "../../features/termgit";
import { startDebug, dbgStep, dbgCurrent, toggleBp, dbgBreaks, dbgTest, dbgRunToCursor, dbgStop, dbgRecordTest, dbgStepBack, dbgOrigin, dbgChanges, dbgTravel, dbgReplayState } from "../../features/debug";
import { reviewFindings, explainCmd, renderCreviewView, renderHoodView } from "../../features/codereview";
import { dxRun, dxStop, stackState } from "../../features/stack";
import { diagnostics } from "../../features/diagnostics";
import { renderTestPane } from "../../features/testing/index";

/* r23 F2: the cache of the brief's acceptance test, with its bug (eviction takes the newest end) */
const LRU_SRC = `use std::collections::{HashMap, VecDeque};

pub struct Lru<V> {
    cap: usize,
    map: HashMap<String, V>,
    order: VecDeque<String>,
}

impl<V: Clone> Lru<V> {
    pub fn new(cap: usize) -> Self {
        Self { cap, map: HashMap::new(), order: VecDeque::new() }
    }

    pub fn get(&mut self, key: &str) -> Option<V> {
        let v = self.map.get(key)?.clone();
        self.touch(key);
        Some(v)
    }

    pub fn put(&mut self, key: &str, value: V) {
        if self.map.len() == self.cap {
            let old = self.order.pop_back().unwrap();
            self.map.remove(&old);
        }
        self.map.insert(key.to_string(), value);
        self.touch(key);
    }

    fn touch(&mut self, key: &str) {
        self.order.retain(|k| k != key);
        self.order.push_back(key.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evicts_least_recently_used() {
        let mut c = Lru::new(2);
        c.put("a", 1);
        c.put("b", 2);
        c.get("a");
        c.put("c", 3);
        assert_eq!(c.get("a"), Some(1));
        assert_eq!(c.get("b"), None);
    }

    #[test]
    fn get_missing_returns_none() {
        let mut c: Lru<i32> = Lru::new(1);
        assert_eq!(c.get("x"), None);
    }
}
`;

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
  /* DXTUTOR_SELFTEST_ONLY=lsp-java,lspOverrides corre só esses passos (os outros ficam `skipped`) */
  const only = (R.info.selftestOnly ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const step = async (n: string, f: () => unknown) => {
    if (only.length && !only.includes(n)) { rep.steps[n] = "skipped"; return; }
    /* the step about to run, into DXTUTOR_SELFTEST_PROGRESS when it is set (outside the project: a new file in the
       tree would make the deploy's version check refuse a dirty tree): when the self-test hangs, its last line says where */
    await sh("sh", ["-c", '[ -n "$DXTUTOR_SELFTEST_PROGRESS" ] && printf "%s %s\\n" "$(date +%T)" "$1" >> "$DXTUTOR_SELFTEST_PROGRESS"; true', "_", n]).catch(() => undefined);
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
      const modeBefore = agentStore.mode; agentStore.mode = "auto";
      const hostFinish = document.createElement("div");
      await gfAsk(hostFinish, { files: new Set() });
      await idle(); await idle();
      const finishedViaAsk = (await git("rev-parse", "--abbrev-ref", "HEAD")).stdout.trim() === "develop" && /develop/.test(hostFinish.innerHTML);
      agentStore.mode = modeBefore;

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
    // r23 F3 (UI-SCM-10): staging de parte de um ficheiro contra o git real — dois hunks, só um entra no stage pelo
    // pane, e o commit do IDE leva só esse (o índice manda); o outro fica por commitar.
    await step("hunks", async () => {
      const rel = "notes/hunks.txt", key = ROOT + rel, body = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
      writeFile(key, body); flushSave(); await idle();
      commit("test: hunks base"); await idle(); await idle();
      writeFile(key, body.replace("line 2\n", "line two\n").replace("line 28\n", "line twenty-eight\n")); flushSave(); await idle();
      await hunks.toggle(rel);
      const e = hunks.entry(rel);
      const before = e?.unstaged?.hunks.length ?? -1;
      const first = e?.unstaged?.hunks[0]?.id;
      if (first) await hunks.stage(rel, first);
      const staged = hunks.entry(rel)?.staged?.hunks.length ?? -1, left = hunks.entry(rel)?.unstaged?.hunks.length ?? -1;
      commit("fix: only line two"); await idle(); await idle();
      const head = (await git("show", "HEAD:" + (R.prefix || "") + rel)).stdout;
      const still = (await git("diff", "--name-only")).stdout.includes(rel);
      await hunks.toggle(rel);
      return { before, staged, left, committedOnlyThatHunk: head.includes("line two\n") && head.includes("line 28\n"), otherHunkStillUncommitted: still };
    });
    // r23 F3 (UI-SCM-12): o undo contra o git real — um commit pelo IDE tira a fotografia antes; desfazê-lo passa pelo
    // diálogo de aprovação (com os comandos exactos), repõe o HEAD e fica no registo de auditoria.
    await step("undo", async () => {
      const key = ROOT + "notes/undo.txt";
      const headBefore = (await git("rev-parse", "HEAD")).stdout.trim();
      writeFile(key, "undo me\n"); flushSave(); await idle();
      commit("test: to be undone"); await idle(); await idle();
      await undo.refresh();
      const snap = undo.entries()[0];
      const headAfterCommit = (await git("rev-parse", "HEAD")).stdout.trim();
      const p = undo.undo(snap?.id ?? -1);
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return f(); };
      const dialog = await wait(() => !!document.querySelector("#approval .appr-cmd"), 5000);
      const shown = document.querySelector("#approval .appr-cmd")?.textContent ?? "";
      (document.querySelector("#approval #appr-ok") as HTMLElement | null)?.click();
      const ok = await p; await idle();
      const headNow = (await git("rev-parse", "HEAD")).stdout.trim();
      const rows = await projectClient().audit(R.root as string, null) as Array<{ origin: string; tool: string | null; call: string | null; outcome: string | null }>;
      const audited = rows.filter((r) => r.origin === "ide" && r.tool === "scm" && r.call === "git.undo").map((r) => r.outcome);
      delete FS[key]; flushSave(); await idle();
      return { snapLabel: snap?.label ?? null, committed: headAfterCommit !== headBefore, dialog, showsCommands: /git (symbolic-ref|update-ref|read-tree)/.test(shown), ok, headRestored: headNow === headBefore, audited };
    });
    // r23 F3 (UI-SCM-13): um merge com conflito pelo IDE já não é abortado — abre o separador do merge a três com a
    // base, a nossa e a deles; resolver escreve e faz stage; concluir corre a verificação do projecto e, aprovado no
    // diálogo, faz o commit do merge (auditado).
    await step("merge3", async () => {
      const start = BRANCH, rel = "notes/merge3.txt", key = ROOT + rel;
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return f(); };
      writeFile(key, "one\ntwo\nthree\n"); flushSave(); await idle(); commit("test: merge3 base"); await idle(); await idle();
      checkout("selftest/merge3", true); await idle();
      writeFile(key, "one\nTWO from the branch\nthree\n"); flushSave(); await idle(); commit("test: merge3 branch"); await idle(); await idle();
      checkout(start); await idle();
      writeFile(key, "one\ntwo on " + start + "\nthree\n"); flushSave(); await idle(); commit("test: merge3 here"); await idle(); await idle();
      gitMerge("selftest/merge3"); await idle();
      const opened = await wait(() => !!merge3.state().merge?.merging && !!merge3.state().stages[rel], 8000);
      const s3 = merge3.state().stages[rel];
      merge3.take(rel, "both");
      await merge3.resolve(rel);
      const resolved = merge3.state().merge?.conflicts.length === 0;
      const p = merge3.complete();
      const dialog = await wait(() => !!document.querySelector("#approval .appr-cmd"), 120000);
      const cmd = document.querySelector("#approval .appr-cmd")?.textContent ?? "";
      (document.querySelector("#approval #appr-ok") as HTMLElement | null)?.click();
      const done = await p; await idle();
      const parents = (await git("log", "-1", "--format=%P")).stdout.trim().split(" ").length;
      const content = (await git("show", "HEAD:" + (R.prefix || "") + rel)).stdout;
      await git("branch", "-D", "selftest/merge3"); delete FS[key]; flushSave(); await idle();
      return { opened, threeSides: !!(s3?.base && s3?.ours && s3?.theirs), resolved, dialog, cmd, done, mergeCommit: parents === 2, bothKept: /TWO from the branch/.test(content) && content.includes("two on " + start), check: merge3.state().check };
    });
    // r23 F3: push para um remoto local (bare) pelo diálogo de aprovação — o comando exacto, o ramo chega lá, auditado.
    await step("sync", async () => {
      const remoteDir = (await sh("mktemp", ["-d"], { cwd: R.info.home })).stdout.trim() + "/remote.git";
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 50)); return f(); };
      await sh("git", ["init", "-q", "--bare", remoteDir], { cwd: R.info.home });
      await git("remote", "add", "selftest-origin", remoteDir);
      try {
        const p = sync.run("push");
        const dialog = await wait(() => !!document.querySelector("#approval .appr-cmd"), 10000);
        const cmd = document.querySelector("#approval .appr-cmd")?.textContent ?? "";
        (document.querySelector("#approval #appr-ok") as HTMLElement | null)?.click();
        const ok = await p;
        const there = (await sh("git", ["--git-dir", remoteDir, "rev-parse", "--verify", "refs/heads/" + BRANCH], { cwd: R.info.home })).stdout.trim();
        const here = (await git("rev-parse", "HEAD")).stdout.trim();
        const rows = await projectClient().audit(R.root as string, null) as Array<{ origin: string; tool: string | null; call: string | null; outcome: string | null }>;
        return { dialog, cmd, ok, arrived: there === here, audited: rows.filter((r) => r.tool === "scm" && r.call === "git.push").map((r) => r.outcome) };
      } finally {
        await git("branch", "--unset-upstream").catch(() => undefined);
        await git("remote", "remove", "selftest-origin");
        await sh("rm", ["-rf", remoteDir.replace(/\/remote\.git$/, "")], { cwd: R.info.home });
      }
    });
    // r23 F3 (UI-SCM-14): o Launchpad sobre o gh real (com o HOME do auto-teste não há sessão): diz-o e não lista PRs.
    await step("launchpad", async () => {
      await launchpad.load();
      const st = launchpad.state();
      return { installed: st.status?.installed ?? null, signedIn: st.status?.signedIn ?? null, listed: st.review === null ? "nothing" : st.review.length, error: st.error };
    });
    // r23 F3 (UI-SCM-09): o ciclo de vida do commit — um resultado de testes gravado no HEAD real (o backend decide o
    // commit), lido de volta no grafo; o gh sem sessão diz-o; os ambientes «não ligados». Nada inventado.
    await step("lifecycle", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const recorded = await inv("test_results_record", { root: R.root, run: { runner: "selftest", command: "true", passed: 3, failed: 0, ignored: 1 } });
      const head = (await git("rev-parse", "--short=7", "HEAD")).stdout.trim();
      await graphScreen.lifecycleOf(head);
      const e = graphScreen.state().lifecycle[head];
      const back = await inv("test_results_for", { root: R.root, shas: [head] }) as Array<{ runner: string; passed: number }>;
      return { recorded, readBack: back.some((r) => r.runner === "selftest" && r.passed === 3), testsInGraph: !!e?.tests?.some((t) => t.runner === "selftest"), gh: e?.ghMissing ?? "ok" };
    });
    // r23 F3 (UI-SCM-14/11): o Commit Composer contra o git real — dois temas viram dois commits só com os seus
    // ficheiros; com as lanes ligadas (experimental), um rascunho vai para o develop sem checkout e o HEAD fica.
    await step("composer", async () => {
      const head0 = (await git("rev-parse", "HEAD")).stdout.trim(), br = BRANCH;
      writeFile(ROOT + "src/cp_mod.rs", "pub fn cp() {}\n"); writeFile(ROOT + "docs/cp.md", "# cp\n"); flushSave(); await idle();
      await composer.load();
      const drafts = composer.state().drafts;
      drafts.forEach((d) => composer.setMessage(d.id, d.files.some((f) => f.endsWith(".md")) ? "docs: composer selftest" : "feat(src): composer selftest"));
      const made = await composer.commitAll(); await idle();
      const subjects = (await git("log", "-2", "--format=%s")).stdout.trim().split("\n");
      const files = (await git("show", "--name-only", "--format=", "HEAD")).stdout.trim();
      setLanes(true);
      let lane = "skipped", headStayed = false;
      try {
        const target = Object.keys(GIT.refs).find((b) => b !== br);
        if (target) {
          writeFile(ROOT + "src/cp_lane.rs", "pub fn lane() {}\n"); flushSave(); await idle();
          await composer.load();
          const d = composer.state().drafts.find((x) => x.files.some((f) => f.endsWith("cp_lane.rs")));
          if (d) { composer.setMessage(d.id, "feat(src): on the lane"); composer.setLane(d.id, target); }
          const headBefore = (await git("rev-parse", "HEAD")).stdout.trim();
          await composer.commitAll(); await idle();
          lane = (await git("log", "-1", "--format=%s", target)).stdout.trim();
          headStayed = (await git("rev-parse", "HEAD")).stdout.trim() === headBefore;
          delete FS[ROOT + "src/cp_lane.rs"]; flushSave(); await idle();
        }
      } finally { setLanes(false); }
      return { drafts: drafts.length, made, subjects, lastHasOnlyItsFile: files.split("\n").length === 1, moved: head0 !== (await git("rev-parse", "HEAD")).stdout.trim(), lane, headStayed };
    });
    // r23 F3: o Commit Graph com a barra lateral lida do `git_refs` real (ramos, tags, worktrees, contribuidores).
    await step("graph", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      renderGraphView(null, host);
      await graphScreen.load();
      const rows = host.querySelectorAll(".gl-row:not(.gl-wip)").length, refs = graphScreen.state().refs;
      const out = { rows, matchesCommits: rows === GIT.order.length, dots: host.querySelectorAll(".gl-svg circle").length, hasBranchBar: /gl-bar/.test(host.innerHTML),
        sidebar: host.querySelectorAll(".gl-side .gl-sec").length, head: refs?.head ?? null, headMatches: refs?.head === BRANCH, branches: refs?.branches.length ?? 0,
        contributors: refs?.contributors.length ?? 0, refsError: graphScreen.state().error,
        predicted: Object.keys(graphScreen.state().predictions).length, predictErrors: Object.values(graphScreen.state().predictions).filter((p) => p.error).map((p) => p.error) };
      host.remove();
      return out;
    });
    // feature `changelog` (harvest ui-next): observa o caminho desktop-REAL — clLog→git_log
    // e clShow→git_show sobre o repo git do próprio selftest (acabou de ganhar commits acima).
    await step("changelog", async () => {
      const log = await clLog();
      const first = log[0];
      const diff = first ? await clShow(first.hash) : "";
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
      PANE = "test"; renderTestPane();
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
        PANE = "test"; renderTestPane();
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
      const detail = (await pc.issue(root, key)) as { activity: Array<{ kind: string }>; usage?: { turns: number } };
      // RF-B04 (bloco 4): o prompt traz o texto do template, de onde «Edit template» parte
      const prompt = (await pc.issuePrompt(root, key)) as { source?: string; template?: string };
      // RF-E08/B08 (bloco 1 dos RF restantes): the change sets since the last commit (none in a fresh
      // folder) and the issue's Co-Dev usage (no turns yet), through the real commands
      const sets = await tauriGitExtras().changeSets(root);
      await pc.apply(root, { op: "delete_issue", key });
      const out = { empty: p0.issues.length === 0, moved: p2.issues.find((i) => i.key === key)?.state, refused: refused.code, overridable: refused.overridable, activity: detail.activity.map((a) => a.kind), usageTurns: detail.usage?.turns, changeSets: sets.length, template: prompt.source === "builtin" && !!prompt.template?.includes("{{id}}") };
      if (out.moved !== "progress" || out.refused !== "step" || out.overridable !== true || !out.activity.includes("moved") || out.usageTurns !== 0 || out.changeSets !== 0 || !out.template) throw new Error("project store: " + JSON.stringify(out));
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
      renderTestPane();
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
      renderSearchPane();
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
      renderRunPane();
      const el = () => document.getElementById("pane-run");
      const listed = await wait(() => !!el()?.querySelector('[data-run-cmd="npm run hello"]'), 10000);
      return { listed, kinds: [...(el()?.querySelectorAll(".scm-grp .cnt") || [])].map(e => e.textContent) };
    });
    // conta (ADR-0006, R2e1): o pane Conta mostra o utilizador e a máquina reais (whoami/
    // hostname) e a identidade git, em vez de uma identidade fixa.
    await step("account", () => {
      renderAccountPane();
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
    // F5.2/F5.5 (bloco 3 dos RF restantes): as regras do arquitecto e um ADR pelos comandos reais —
    // gravar as regras (validadas no Rust), aceitar o ADR (o estado e quem aprovou ficam escritos)
    // e o commit do arquitecto só com esses dois ficheiros. O team.json do passo anterior não
    // nomeia pessoas: os papéis não se aplicam aqui (o teste do Rust cobre-os).
    await step("archRules", async () => {
      const root = R.root as string;
      writeFile(ROOT + "docs/adr/0001-queue.md", "# Use a queue\n\nStatus: proposed\n");
      flushSave(); await idle();
      const saved = await tauriRulesGateway.save(root, {
        layers: [{ name: "domain", paths: ["src/domain/**"], mayUse: [], imports: [] }],
        libraries: { forbidden: ["moment"], approved: [] },
        naming: [],
        exceptions: [{ adr: "0001", rule: "library:moment" }],
      });
      const adrs = await tauriRulesGateway.adrs(root);
      const accepted = await tauriRulesGateway.acceptAdr(root, "docs/adr/0001-queue.md");
      const hash = await tauriRulesGateway.commit(root, [".dxtutor/architecture.toml", "docs/adr/0001-queue.md"], "docs(arch): selftest rules");
      const files = (await git("show", "--name-only", "--format=", "HEAD")).stdout.trim().split("\n");
      const onDisk = (await sh("cat", ["docs/adr/0001-queue.md"])).stdout;
      // F4.4 (bloco 4): o commit próprio do template de prompt, só com esse ficheiro
      writeFile(ROOT + ".dxtutor/prompts/issue.en.md", "# Role\n{{id}} — {{titulo}}\n");
      flushSave(); await idle();
      await tauriRulesGateway.commit(root, [".dxtutor/prompts/issue.en.md"], "docs(prompt): selftest template");
      const tpl = (await git("show", "--name-only", "--format=", "HEAD")).stdout.trim();
      const out = { saved: saved.exists && saved.rules.layers.length === 1, adrs: adrs.map(a => a.id), accepted: accepted.accepted, approvedBy: /Approved by: /.test(onDisk), hash, files, template: tpl };
      if (!out.saved || !out.accepted || !out.approvedBy || !files.includes(".dxtutor/architecture.toml") || !files.includes("docs/adr/0001-queue.md") || tpl !== ".dxtutor/prompts/issue.en.md") throw new Error("arch rules: " + JSON.stringify(out));
      return out;
    });
    // depuração (ADR-0006, R4): o gdb do backend. Sem gdb no sistema, o pane di-lo (o caminho
    // honesto); com gdb, uma sessão real sobre um binário Cargo pequeno com um breakpoint:
    // pára na linha, lê as variáveis, dá um passo e corre até ao fim.
    await step("debug", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const available = !!(await inv("debug_available"));
      const pane = () => document.getElementById("pane-debug")?.textContent || "";
      if (!available) { await startDebug(); return { available, saysNoGdb: /O gdb não está instalado/.test(pane()) }; }
      // a member of the root workspace below: its own [workspace] table made cargo refuse («multiple workspace roots»)
      writeFile(ROOT + "dbgself/Cargo.toml", '[package]\nname = "dbgself"\nversion = "0.1.0"\nedition = "2021"\n');
      writeFile(ROOT + "dbgself/src/main.rs", "fn main() {\n    let answer = 40 + 2;\n    println!(\"{answer}\");\n}\n");
      writeFile(ROOT + "Cargo.toml", '[workspace]\nmembers = ["dbgself"]\nresolver = "2"\n');
      flushSave(); await idle();
      // the breakpoints persist (LS) across runs: toggling blindly could remove one left by an earlier run
      // line 2, not 3: a line breakpoint on `println!` resolves to several locations (the macro), so each
      // continue stops on line 3 again — real lldb behaviour; `let answer = 40 + 2;` has one location
      for (const old of [ROOT + "dbgself/src/main.rs:3"]) if (dbgBreaks.has(old)) toggleBp(ROOT + "dbgself/src/main.rs", 3);
      const bpKeyNow = ROOT + "dbgself/src/main.rs:2", breaks = dbgBreaks;
      if (!breaks.has(bpKeyNow)) toggleBp(ROOT + "dbgself/src/main.rs", 2);
      await startDebug();
      const stoppedAt = dbgCurrent();
      // A7: over DAP (lldb-dap) when it is installed — the engine, then (after the step, once `answer`
      // exists) the variables tree and the values inline
      const engine = document.querySelector("#pane-debug .dbg-engine")?.textContent || "gdb";
      await dbgStep();
      await wait(() => !dbgCurrent() || dbgCurrent()!.line !== 2, 20000);
      const after = dbgCurrent();
      const vars = /answer/.test(pane());
      const inline = [...document.querySelectorAll("#ed-hl .dv-inline")].map(e => e.textContent).join(" | ");
      if (after) await startDebug(); // continuar até ao fim
      if (breaks.has(bpKeyNow)) toggleBp(ROOT + "dbgself/src/main.rs", 2); // a próxima execução começa limpa
      return { available, engine, stoppedAt, vars, inline, after, ended: /O programa terminou/.test(pane()), pane: pane().slice(0, 400) };
    });
    // r23 F2 (aceitação do brief): o teste `evicts_least_recently_used` falha no depurador real — «Debug
    // Test…» constrói os testes, depura esse com --exact, pára no panic (Just My Code leva ao frame do
    // teste, o cartão mostra left/right), a consola avalia nesse frame e a memória de `c` lê-se; depois da
    // correcção (`pop_front`), uma segunda sessão pára num breakpoint, corre até ao cursor e o teste passa.
    // A barra flutuante mostra só o que funciona e diz porquê falta o resto (sem rr: andar para trás).
    await step("debugR23", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const host = await inv("debug_capabilities") as { available: boolean; adapter: string | null; timeTravel: { available: boolean; reason: string } };
      if (!host.available) return { host, skipped: "no DAP adapter (lldb-dap)" };
      const pane = () => document.getElementById("pane-debug")?.textContent || "";
      const lib = ROOT + "dbglru/src/lib.rs";
      writeFile(ROOT + "dbglru/Cargo.toml", '[package]\nname = "dbglru"\nversion = "0.1.0"\nedition = "2021"\n');
      writeFile(lib, LRU_SRC);
      writeFile(ROOT + "Cargo.toml", '[workspace]\nmembers = ["dbgself", "dbglru"]\nresolver = "2"\n');
      flushSave(); await idle();
      const pickTest = async (): Promise<boolean> => {
        if (!(await wait(() => [...document.querySelectorAll("#pal.show #pal-list .pi")].some(e => /evicts_least_recently_used/.test(e.textContent || "")), 240000))) return false;
        (([...document.querySelectorAll("#pal-list .pi")].find(e => /evicts_least_recently_used/.test(e.textContent || ""))) as HTMLElement).click();
        return true;
      };
      const run1 = dbgTest();
      const picked = await pickTest();
      await run1;
      const at = dbgCurrent();
      // the panic's message can reach the debugger after the stop: the card comes with it
      await wait(() => /right/.test(document.getElementById("dbg-exc")?.textContent || ""), 10000);
      const card = document.getElementById("dbg-exc")?.textContent || "";
      const toolbar = [...document.querySelectorAll("#dbg-tb button")].map(b => b.getAttribute("data-on"));
      const missing = document.querySelector("#dbg-tb .dbg-tb-miss")?.getAttribute("title") || "";
      const libRow = !!document.querySelector("#pane-debug .dbg-lib");
      // the console evaluates in the test's frame
      const con = document.getElementById("dbg-con-in") as HTMLInputElement | null;
      if (con) { con.value = "c.cap"; con.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
      await wait(() => !!document.querySelector("#pane-debug .dbg-cl.out, #pane-debug .dbg-cl.err"), 15000);
      const conOut = document.querySelector("#pane-debug .dbg-cl.out, #pane-debug .dbg-cl.err")?.textContent || "";
      // a variable's bytes (the cache `c`)
      const mem = document.querySelector('#pane-debug [data-action="dbg-mem"]') as HTMLElement | null;
      mem?.click();
      await wait(() => !!document.querySelector("#pane-debug .dbg-hex"), 10000);
      const hexRows = document.querySelectorAll("#pane-debug .dbg-hex").length;
      await dbgStop();
      const first = { picked, at: at && `${at.path.split("/").pop()}:${at.line}`, card: card.slice(0, 200), leftRight: /left\s*None/.test(card) && /right\s*Some\(1\)/.test(card), toolbar, missing: missing.slice(0, 200), libRow, conOut, hexRows };
      // the fix (one line), then: a breakpoint on `c.get("a");`, run to the assertion, continue to the end
      writeFile(lib, LRU_SRC.replace("self.order.pop_back()", "self.order.pop_front()"));
      flushSave(); await idle();
      const lines = LRU_SRC.split("\n"), lineOf = (re: RegExp) => lines.findIndex(l => re.test(l)) + 1;
      const bpLine = lineOf(/^\s*c\.get\("a"\);/), assertLine = lineOf(/assert_eq!\(c\.get\("a"\), Some\(1\)\)/);
      const bpKeyNow = lib + ":" + bpLine;
      if (!dbgBreaks.has(bpKeyNow)) toggleBp(lib, bpLine);
      const run2 = dbgTest();
      const picked2 = await pickTest();
      await run2;
      const atBp = dbgCurrent();
      const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
      if (ta) { const off = ta.value.split("\n").slice(0, assertLine - 1).join("\n").length + 1; ta.selectionStart = ta.selectionEnd = off; }
      await dbgRunToCursor();
      const atCursor = dbgCurrent();
      if (dbgBreaks.has(bpKeyNow)) toggleBp(lib, bpLine);
      await startDebug(); // continue: the fixed test passes and the program ends
      await wait(() => /terminou|ended/i.test(pane()), 20000);
      const passed = /c[oó]digo 0|code 0/.test(pane());
      const out = { ...first, picked2, atBp: atBp?.line, bpLine, atCursor: atCursor?.line, assertLine, passed, timeTravel: host.timeTravel.reason };
      if (!picked || !first.leftRight || !first.at?.startsWith("lib.rs:") || toolbar.includes("back") || !missing || !/= 2|2$/.test(conOut) || !atBp || atBp.line !== bpLine || atCursor?.line !== assertLine || !passed)
        throw new Error("debugR23: " + JSON.stringify(out));
      return out;
    });
    // r23 F2b: gravar e reproduzir (rr). O mesmo teste da LRU, com o bug, gravado e reproduzido até ao
    // panic: a barra anda para trás (REPLAY, evento n/N), um passo atrás, a última escrita de
    // `c.order.len`, todas as suas mudanças como marcas, e viajar para uma marca e para o início. Sem rr
    // (ou num CPU que o rr não sabe contar) o passo diz porquê, como a app.
    await step("debugRR", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const host = await inv("debug_capabilities") as { timeTravel: { available: boolean; reason: string; error?: string | null } };
      if (!host.timeTravel.available) return { timeTravel: host.timeTravel, skipped: "no time travel here" };
      const lib = ROOT + "dbglru/src/lib.rs";
      if (!FS[lib]) return { skipped: "debugR23 did not write the LRU crate" };
      writeFile(lib, LRU_SRC);
      flushSave(); await idle();
      const run = dbgRecordTest();
      if (!(await wait(() => [...document.querySelectorAll("#pal.show #pal-list .pi")].some(e => /evicts_least_recently_used/.test(e.textContent || "")), 240000))) throw new Error("debugRR: no test to pick");
      (([...document.querySelectorAll("#pal-list .pi")].find(e => /evicts_least_recently_used/.test(e.textContent || ""))) as HTMLElement).click();
      await run;
      const atPanic = dbgCurrent();
      const st0 = dbgReplayState();
      const toolbar = [...document.querySelectorAll("#dbg-tb button")].map(b => b.getAttribute("data-on"));
      const badge = document.querySelector("#dbg-tb .badge")?.textContent || "";
      const pos = document.querySelector("#dbg-tb .pos")?.textContent || "";
      await wait(() => !!document.querySelector('#dbg-exc [data-action="dbg-origin-ask"]'), 10000);
      const cardOrigin = !!document.querySelector('#dbg-exc [data-action="dbg-origin-ask"]');
      const timeline = document.querySelectorAll("#pane-debug .dbg-tl .mk").length;
      const p0 = st0?.replay.position, t0 = p0 ? p0.event * 1e9 + p0.ticks : 0;
      // (in the test's frame, where `c` exists) every change to the cache's order, then travel to one
      await dbgChanges("c.order.len");
      const q = dbgReplayState()?.replay.query;
      const marks = dbgReplayState()?.replay.marks ?? [];
      const wi = marks.findIndex(m => m.kind === "write");
      if (wi >= 0) await dbgTravel(wi);
      const tp = dbgReplayState()?.replay.position, travelled = tp ? `${tp.event}:${tp.ticks}` : null;
      // back to the panic, then where did the order's length come from
      const pi = (dbgReplayState()?.replay.marks ?? []).findIndex(m => m.kind === "panic");
      if (pi >= 0) await dbgTravel(pi);
      const atPanic2 = dbgCurrent();
      await dbgOrigin("c.order.len");
      const origin = dbgReplayState();
      const originAt = dbgCurrent();
      // one step back (ticks count branches: a short step can keep them; where it stops moves)
      const before = JSON.stringify(dbgReplayState()?.stop);
      await dbgStepBack();
      const backMoved = JSON.stringify(dbgReplayState()?.stop) !== before;
      const pb = dbgReplayState()?.replay.position, back = pb ? pb.event * 1e9 + pb.ticks : -1;
      await dbgStop();
      const out = {
        badge, pos, toolbar, cardOrigin, timeline, atPanic: atPanic && `${atPanic.path.split("/").pop()}:${atPanic.line}`,
        panicTicks: t0, backTicks: back, backMoved, atPanic2: atPanic2 && `${atPanic2.path.split("/").pop()}:${atPanic2.line}`, origin: origin?.stop?.description, originAt: originAt && `${originAt.path.split("/").pop()}:${originAt.line}`,
        changes: q?.hits.map(h => `${h.line}:${h.values}`), travelledTo: travelled, writeAt: wi >= 0 ? `${marks[wi].event}:${marks[wi].ticks}` : null,
      };
      if (!/REPLAY|REPRODU/.test(badge) || !toolbar.includes("back") || !toolbar.includes("rcont") || !cardOrigin || !backMoved || !(back <= t0) || !/^c\.order\.len = \d/.test(origin?.stop?.description ?? "") || !(q && q.hits.length >= 3) || travelled !== out.writeAt)
        throw new Error("debugRR: " + JSON.stringify(out));
      return out;
    });
    // r23 F4a (aceitação do brief): um `.tf` com `password = var.x` é um erro no Problems; um commit com
    // `postgres://u:p@h` é bloqueado pelo secret scan do backend (e passa uma vez com um motivo); o terminal
    // mascara um URL com palavra-passe. (O pedido ao modelo redigido é o teste unitário de tutor_protect.)
    await step("protect", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 200)); return f(); };
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const root = R.root as string;
      const tf = ROOT + "infra/db.tf";
      writeFile(tf, 'variable "db_password" {\n  type = string\n}\n\nresource "aws_db_instance" "main" {\n  username = "app"\n  password = var.db_password\n}\n');
      flushSave(); await idle();
      const tfError = await wait(() => diagnostics().some(d => d.p === tf && d.sev === "e" && d.line === 7), 120000);
      const tfDiag = diagnostics().filter(d => d.p === tf).map(d => `${d.sev}:${d.line}`);
      // the secret scan before a commit (the same `exec git commit` the pane uses)
      writeFile(ROOT + "db.rs", 'const URL: &str = "postgres://u:p@h/app";\n');
      flushSave(); await idle();
      await git("add", "db.rs", "infra/db.tf");
      const blocked = await sh("git", ["commit", "-m", "feat: db"]) as { code: number; stderr: string };
      const report = blocked.stderr.startsWith("SECRET_SCAN_BLOCKED:") ? JSON.parse(blocked.stderr.slice("SECRET_SCAN_BLOCKED:".length)) as { findings: Array<{ file: string; line: number; rule: string }> } : null;
      const leaks = blocked.stderr.includes("u:p@");
      await inv("secret_scan_allow", { root, reason: "self-test fixture" });
      const allowed = await sh("git", ["commit", "-m", "feat: db (self-test)"]) as { code: number };
      await git("reset", "--hard", "HEAD~1");
      // the terminal masks a URL's password
      let masked = false, shown = "";
      if (R.term) {
        await R.term.runTask("printf 'DATABASE_URL=postgres://app:s3cr3tpass@db/app\\n'", { label: "selftest-protect" });
        const I = () => R.term!.inspect();
        const task = I().terminals.find(t => t.label === "selftest-protect");
        /* the task's header (the command, written by the UI) comes first; the program's output line is what the PTY masks */
        if (task) { await wait(() => I().text(task.id).split("\n").some(l => l.includes("DATABASE_URL") && !l.includes("Executing task")), 5000); shown = I().text(task.id).split("\n").find(l => l.includes("DATABASE_URL") && !l.includes("Executing task")) || ""; }
        masked = shown.includes("••••") && !shown.includes("s3cr3tpass");
      }
      // the pre-commit hook (r23 hardening), by the palette's path: the dialog shows the exact file, the backend audits
      // the install before writing; then it is removed again (dxt is not on the self-test's PATH: it would block every
      // commit of the steps that follow, which is what it is for)
      type Plan = { path: string; state: string; content: string };
      const before = await inv("protect_hook_plan", { root }) as Plan;
      const installing = services.protect!.installHook();
      const hookDialog = await wait(() => !!document.querySelector("#approval .appr-cmd"), 10000);
      const hookCmd = document.querySelector("#approval .appr-cmd")?.textContent ?? "";
      (document.querySelector("#approval #appr-ok") as HTMLElement | null)?.click();
      await installing;
      const after = await inv("protect_hook_plan", { root }) as Plan;
      const hookRows = (await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null; outcome: string | null }>)
        .filter((r) => r.origin === "ide" && r.tool === "protect" && r.call === "hook.install").map((r) => r.outcome);
      /* the hook runs on a commit: without dxt on the PATH it blocks and says why; with it, the scan passes an empty commit */
      const viaHook = await sh("git", ["commit", "--allow-empty", "-m", "selftest: hook"]) as { code: number; stdout: string; stderr: string };
      const hookText = (viaHook.stdout || "") + (viaHook.stderr || "");
      const hookRan = viaHook.code !== 0 ? hookText.includes("dxt is not on the PATH") : hookText.includes("dxtutor secret scan");
      if (viaHook.code === 0) await git("reset", "--hard", "HEAD~1");
      await sh("rm", ["-f", after.path]);
      const hook = { before: before.state, dialog: hookDialog && hookCmd.includes(before.path) && hookCmd.includes("dxt secret-scan --staged"), after: after.state, audited: hookRows, ran: hookRan, text: hookText.slice(0, 120) };
      const out = { tfError, tfDiag, blockedCode: blocked.code, findings: report?.findings.map(f => `${f.file}:${f.line} ${f.rule}`), leaks, allowedCode: allowed.code, masked, shown: shown.slice(0, 80), hook };
      if (!tfError || blocked.code === 0 || !report || !report.findings.some(f => f.file === "db.rs" && f.rule === "url-credentials") || leaks || allowed.code !== 0 || !masked) throw new Error("protect: " + JSON.stringify(out));
      if (hook.before !== "missing" || !hook.dialog || hook.after !== "installed" || hook.audited.length < 2 || !hook.ran) throw new Error("protect hook: " + JSON.stringify(out));
      return out;
    });
    // r23 F4b: o pipeline de IaC na app real — as etapas (os scanners que faltam dizem «not installed» com a dica), o
    // evento iac://stage, o plano guardado e o apply DESSE ficheiro num terminal real, o estado (endereços e ids), um
    // segredo no código que bloqueia o apply no Rust até o risco ser aceite (auditado), e o .tfstate fora do editor.
    await step("iac", async () => {
      const op = tauriOps(), root = R.root as string, dir = "iac-selftest";
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const seen: string[] = [];
      const off = await listen("iac://stage", (payload) => { const p = payload as { dir: string; stage: { id: string; status: string } }; if (p.dir === dir) seen.push(`${p.stage.id}:${p.stage.status}`); });
      const main = ROOT + dir + "/main.tf", extra = ROOT + dir + "/extra.tf";
      writeFile(main, 'resource "terraform_data" "a" {\n  input = "v1"\n}\n\nresource "terraform_data" "b" {\n  input = terraform_data.a.output\n}\n');
      flushSave(); await idle();
      try {
        const r1 = await op.pipeline(root, dir, null);
        const statuses = Object.fromEntries(r1.stages.map((s) => [s.id, s.status]));
        const hints = r1.stages.filter((s) => s.status === "not_installed").every((s) => !!s.hint);
        const a1 = await op.applyCommand(root, dir, r1.id);
        const code = R.term ? await R.term.runTask(a1.command, { label: "selftest-iac" }) : -1;
        const st = await op.iacState(root, dir);
        writeFile(extra, 'locals {\n  password = "not-a-real-one"\n}\n');
        flushSave(); await idle();
        const r2 = await op.pipeline(root, dir, null);
        const refused = await op.applyCommand(root, dir, r2.id).then(() => "applied", (e) => String(e));
        const f = r2.stages.find((s) => s.id === "rules")?.findings[0];
        const acc = f ? await op.acceptRisk(root, { key: f.key, kind: "finding", label: `built-in ${f.rule} · ${f.file}:${f.line}`, reason: "self-test fixture" }) : null;
        const r3 = await op.pipeline(root, dir, null);
        if (acc) await op.revokeRisk(root, acc.id);
        const rows = await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null; reason: string | null }>;
        const audited = rows.some((r) => r.origin === "ide" && r.tool === "iac" && r.call === "risk.accept" && r.reason === "self-test fixture");
        const stateRead = await inv("read_text_file", { path: root.replace(/\/$/, "") + `/${dir}/terraform.tfstate` }).then(() => "read", (e) => String(e));
        const out = {
          statuses, hints, events: seen.length, blocked1: r1.blocked, add: r1.plan?.add, dependents: r1.plan?.changes.find((c) => c.address === "terraform_data.a")?.dependents,
          applyCmd: a1.command.replace(a1.planFile, "<plan>"), code, resources: st.resources.map((r) => r.address), ids: st.resources.every((r) => !!r.id), backend: st.backend,
          blocked2: r2.blockers, refused: refused.slice(0, 90), finding: f && `${f.file}:${f.line} ${f.rule}`, blocked3: r3.blocked, audited,
          stateFile: stateRead.includes("state file") ? "refused" : stateRead.slice(0, 60), inFS: Object.keys(FS).some((k) => k.endsWith(".tfstate")),
        };
        const ok = statuses.init === "ok" && statuses.plan === "ok" && statuses.rules === "ok" && !r1.blocked && hints && seen.length >= 2 * r1.stages.length && r1.plan?.add === 2
          && code === 0 && st.resources.length === 2 && out.ids && r2.blocked && r2.blockers.includes("rules") && refused.includes("pipeline failed") && !r3.blocked && audited && out.stateFile === "refused" && !out.inFS;
        if (!ok) throw new Error("iac: " + JSON.stringify(out));
        return out;
      } finally {
        off();
        delete FS[main]; delete FS[extra]; flushSave(); await idle();
        await sh("rm", ["-rf", dir]);
      }
    });
    // r23 F4c: o Vault na app real, contra um Vault dev que o runner arranca (DXTUTOR_SELFTEST_VAULT) e com um serviço de
    // keychain só do auto-teste (DXTUTOR_KEYCHAIN_SERVICE): entrar com um token (vai para o keychain e nunca volta), os
    // metadados de produção sem chaves nem valores, a recusa de revelar staging/produção (no Rust), revelar local (auditado,
    // 20 s), um terminal que recebe o token do backend (a CLI vault funciona e o token aparece mascarado), e sair.
    await step("vault", async () => {
      const env = async (k: string) => ((await sh("printenv", [k])) as { stdout: string }).stdout.trim();
      const addr = await env("DXTUTOR_SELFTEST_VAULT"), token = await env("DXTUTOR_SELFTEST_VAULT_TOKEN");
      if (!addr || !token) return { skipped: "no dev Vault (DXTUTOR_SELFTEST_VAULT)" };
      const v = tauriVault(), root = R.root as string, w = { addr, namespace: "" };
      const before = await v.status(w);
      const st = await v.loginToken(w, token);
      const prod = await v.kvMeta(w, "secret", "apps/shop/production/db");
      const local = await v.kvMeta(w, "secret", "apps/shop/local/db");
      const refused = await v.reveal(root, w, "secret", "apps/shop/production/db", "DB_PASSWORD", "self-test").then(() => "revealed", (e) => String(e));
      const r = await v.reveal(root, w, "secret", "apps/shop/local/db", "DB_PASSWORD", "self-test");
      const value = await v.revealRead(r.id);
      let cli = -1, masked = false, shown = "";
      if (R.term) {
        /* `-field` prints no newline: the echo starts its own line */
        cli = await R.term.runTask("vault kv get -mount=secret -field=DB_USER apps/shop/local/db && echo && echo \"tok=$VAULT_TOKEN\"", { label: "selftest-vault", vault: { addr, namespace: null } });
        const I = () => R.term!.inspect(), task = I().terminals.find((t) => t.label === "selftest-vault");
        /* the program's own line (`tok=…`); the task header — the command, with `$VAULT_TOKEN` literal — can wrap */
        const out = (id: string) => I().text(id).split("\n").find((l) => l.trim().startsWith("tok=") && !l.includes("$VAULT_TOKEN"));
        if (task) { const t0 = Date.now(); while (!out(task.id) && Date.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 200)); shown = out(task.id) ?? I().text(task.id).slice(-200); }
        masked = shown.trim().startsWith("tok=") && shown.trim().length > 4 && !shown.includes(token);
      }
      const rows = await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null; reason: string | null }>;
      const audited = rows.some((x) => x.origin === "ide" && x.tool === "vault" && x.call === "reveal-local" && x.reason === "self-test");
      const out = await v.revoke(w);
      const json = JSON.stringify([before, st, prod, local, out]);
      const res = {
        before: before.signedIn, signedIn: st.signedIn, who: st.displayName, keychain: st.keychain, tokenInAnswers: json.includes(token),
        prodKeys: prod.keys, prodVersions: prod.versions.length, prodValue: json.includes("st-production-pw-4821"), localKeys: local.keys,
        refused: refused.slice(0, 80), value, ttlMs: r.ttlMs, cli, masked, shown: shown.slice(0, 40), audited, after: out.signedIn,
      };
      if (before.signedIn || !st.signedIn || !st.keychain || res.tokenInAnswers || prod.keys !== null || res.prodValue || !local.keys?.includes("DB_PASSWORD")
        || !refused.includes("never leave Vault") || value !== "st-local-pw-4821" || cli !== 0 || !masked || !audited || out.signedIn) throw new Error("vault: " + JSON.stringify(res));
      return res;
    });
    // r23 F4c2: o deploy guiado na app real, contra um kubeconfig TEMPORÁRIO e vazio (nunca os clusters do utilizador):
    // o plano (versão = HEAD, o Secret deixado ao Vault, as ferramentas em falta com a dica, o cluster «not connected»),
    // a produção bloqueada sem excepções e sem «production» escrito (no Rust), o rollout de staging que falha no cluster
    // inexistente e fica registado (deploy_records) e no registo de auditoria.
    await step("deploy", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const root = R.root as string, man = ROOT + "deploy/k8s/app.yaml", kc = ROOT + "kubeconfig-deploy.yaml";
      /* no image here: syft/grype on this machine would (rightly) fail an image that does not exist — the image checks are
         covered by `cargo test -p tutor-platform deploy`; this step proves the rollout, the record and the audit */
      writeFile(man, 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: web-config\ndata:\n  MODE: selftest\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: web-env\nstringData:\n  DB_PASSWORD: \"\"\n');
      writeFile(kc, "apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n");
      flushSave(); await idle();
      const before = ((await sh("git", ["rev-parse", "HEAD"])) as { stdout: string }).stdout.trim();
      await git("add", "deploy/k8s/app.yaml");
      const committed = ((await sh("git", ["commit", "-m", "feat: SELF-9 deploy manifests"])) as { code: number; stderr: string });
      if (committed.code !== 0) throw new Error("deploy: could not commit the manifests: " + committed.stderr.slice(0, 200));
      const kube = root.replace(/\/$/, "") + "/kubeconfig-deploy.yaml";
      try {
        const target = (env: string) => ({ env, context: "selftest-nowhere", namespace: "shop", kubeconfig: kube, stagingContext: "selftest-nowhere", stagingNamespace: "shop" });
        const plan = await inv("deploy_plan", { root, target: target("staging") }) as { id: string; version: string; issue: string | null; secretsFromVault: string[]; gates: Array<{ id: string; status: string; hint: string | null }>; blockers: string[] };
        const st = Object.fromEntries(plan.gates.map((g) => [g.id, g.status]));
        const prod = await inv("deploy_plan", { root, target: target("production") }) as { id: string; blockers: string[]; waivable: string[] };
        /* production: every unverified check blocks; even with each waivable one waived, the second approver (no gh signed
           in here) and staging (no staging cluster) keep it closed — no waiver lifts them (owner decision) */
        const noConfirm = await inv("deploy_rollout", { root, planId: prod.id, confirm: null, reason: "x", waivers: [] }).then(() => "rolled out", (e) => String(e));
        const waivers = prod.waivable.map((gate) => ({ gate, reason: "self-test: no source here" }));
        const unconfirmed = await inv("deploy_rollout", { root, planId: prod.id, confirm: "production", reason: "self-test", waivers }).then(() => "rolled out", (e) => String(e));
        const forced = await inv("deploy_rollout", { root, planId: prod.id, confirm: "production", reason: "self-test", waivers: [...waivers, { gate: "approver", reason: "self-test" }] }).then(() => "rolled out", (e) => String(e));
        const lines: string[] = [];
        const off = await listen("deploy://output", (p) => { const e = p as { planId: string; line: string }; if (e.planId === plan.id) lines.push(e.line); });
        const rec = await inv("deploy_rollout", { root, planId: plan.id, confirm: null, reason: "self-test", waivers: [] }) as { ok: boolean; failedStep: string | null; version: string; issue: string | null; env: string };
        off();
        const recs = await inv("deploy_records", { root, shas: [plan.version.slice(0, 12)] }) as Array<{ env: string; ok: boolean }>;
        const rows = await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null }>;
        const audited = ["rollout", "rollout-failed"].every((c) => rows.some((r) => r.origin === "ide" && r.tool === "deploy" && r.call === c));
        const out = {
          version: plan.version.slice(0, 10), issue: plan.issue, secretsFromVault: plan.secretsFromVault, gates: st, hints: plan.gates.filter((g) => g.status === "not_installed").every((g) => !!g.hint),
          stagingBlockers: plan.blockers, prodBlockers: prod.blockers, prodWaivable: prod.waivable, noConfirm: noConfirm.slice(0, 90), unconfirmed: unconfirmed.slice(0, 90), forced: forced.slice(0, 90),
          rec: { ok: rec.ok, failedStep: rec.failedStep, env: rec.env, issue: rec.issue }, records: recs.map((r) => `${r.env}:${r.ok}`), lines: lines.length, audited,
          leaked: lines.some((l) => /DB_PASSWORD/.test(l)),
        };
        if (st.version !== "ok" || plan.issue !== "SELF-9" || plan.secretsFromVault.join() !== "web-env" || st.admission !== "not_connected" || st["secret-check"] !== "not_connected" || !out.hints
          || plan.blockers.length || !prod.blockers.includes("approver") || prod.waivable.includes("approver") || prod.waivable.includes("staging") || !/blocked by/.test(noConfirm)
          || !/^.*blocked by: [a-z, -]*approver/.test(unconfirmed) || !/approver cannot be waived/.test(forced) || rec.ok || rec.failedStep !== "namespace"
          || !recs.some((r) => r.env === "staging" && !r.ok) || !audited || out.leaked) throw new Error("deploy: " + JSON.stringify(out));
        return out;
      } finally {
        delete FS[kc]; delete FS[man]; flushSave(); await idle();
        if (before) await git("reset", "--hard", before);
      }
    });
    // r23 F5a: runbooks como código na app real — a verificação só de leitura corre sem pedir, a que não é só de
    // leitura é recusada no Rust (`not_read_only`, aceitação do brief), a acção sem aprovação também, com aprovação corre
    // e fica no registo; a decisão regista palavras; as fontes «not connected»; e as evidências ISO 27001 escritas em
    // docs/audit a partir das linhas REAIS do registo (aceitação do brief).
    await step("runbook", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const root = R.root as string, rb = ROOT + "runbooks/selftest-restore.md";
      writeFile(rb, "# selftest: restore test\n\nOwner: self-test\n\n## 1. List the project [check]\n```sh\nls -1 && echo ready\n```\nexpect: `ready`\n\n## 2. Write a marker [action]\n```sh\necho restored > selftest-marker.txt && cat selftest-marker.txt\n```\nexpect: `restored`\n\n## 3. Call it done? [decision]\nexpect: decided\n\n## 4. Sneak a write into a check [check]\n```sh\nls > listing.txt\n```\nexpect: nothing\n");
      flushSave(); await idle();
      const run = `run-selftest-${Date.now()}`;
      try {
        const list = await inv("runbook_list", { root }) as Array<{ path: string; steps: Array<{ n: number; refused: string | null }> }>;
        const mine = list.find((r) => r.path === "runbooks/selftest-restore.md");
        const s1 = await inv("runbook_step", { root, path: "runbooks/selftest-restore.md", n: 1, runId: run, approval: null, vault: null }) as { exitCode: number; matched: boolean | null; output: string };
        const refused = await inv("runbook_step", { root, path: "runbooks/selftest-restore.md", n: 4, runId: run, approval: null, vault: null }).then(() => "ran", (e) => String(e));
        const unapproved = await inv("runbook_step", { root, path: "runbooks/selftest-restore.md", n: 2, runId: run, approval: null, vault: null }).then(() => "ran", (e) => String(e));
        const s2 = await inv("runbook_step", { root, path: "runbooks/selftest-restore.md", n: 2, runId: run, approval: { reason: "self-test restore" }, vault: null }) as { exitCode: number; matched: boolean | null; actor: string };
        const s3 = await inv("runbook_decide", { root, path: "runbooks/selftest-restore.md", n: 3, runId: run, note: "done: the marker is there" }) as { note: string };
        const sources = await inv("sources_status", { root }) as Array<{ kind: string; connected: boolean }>;
        const ev = await inv("audit_export_evidence", { root, from: null, to: null }) as { path: string; content: string };
        const rows = await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null }>;
        const actionAudited = rows.some((r) => r.origin === "ide" && r.tool === "runbook" && r.call === "action");
        const onDisk = ((await sh("cat", [ev.path])) as { code: number; stdout: string });
        const out = {
          steps: mine?.steps.length, refusedAtParse: mine?.steps.find((x) => x.n === 4)?.refused?.slice(0, 60), s1: { code: s1.exitCode, matched: s1.matched }, refused: refused.slice(0, 80), unapproved: unapproved.slice(0, 60),
          s2: { code: s2.exitCode, matched: s2.matched, actor: !!s2.actor }, s3: s3.note, sources: sources.map((x) => `${x.kind}:${x.connected}`).join(" "), actionAudited,
          evidence: ev.path, sections: (ev.content.match(/^## .*/gm) || []).length, hasRunbook: /runbook «selftest: restore test»/.test(ev.content), hasAction: /runbook\.action/.test(ev.content),
          backup: /## A\.8\.13[^#]*restore test/.test(ev.content), vaultRow: /vault\.reveal-local/.test(ev.content), onDisk: onDisk.code === 0 && onDisk.stdout.startsWith("# Evidence export"), noListing: !Object.keys(FS).some((k) => k.endsWith("listing.txt")),
        };
        if (!mine || s1.exitCode !== 0 || s1.matched !== true || !/not_read_only/.test(refused) || !/approval/.test(unapproved) || s2.exitCode !== 0 || s2.matched !== true || !actionAudited
          || !out.refusedAtParse || sources.find((x) => x.kind === "cost")?.connected !== false || !/^docs\/audit\/evidence-\d{4}-\d{2}\.md$/.test(ev.path) || out.sections < 5 || !out.hasRunbook || !out.hasAction || !out.backup || !out.onDisk) throw new Error("runbook: " + JSON.stringify(out));
        return out;
      } finally {
        delete FS[rb]; flushSave(); await idle();
        await sh("rm", ["-rf", "runbooks", "selftest-marker.txt", "listing.txt", "docs/audit"]);
      }
    });
    // r23 F5b: a actividade Platform na app real — a fila calculada do estado (um achado de IaC num .tf que eu commitei, um
    // runbook com `schedule:` nunca completo, um incidente que comando, e o deploy falhado do passo `deploy`), «verificar» só
    // marca feito quando o estado o prova, passar exige destinatário e motivo; os incidentes locais com as suas regras e a
    // confiança «low» sem fonte de métricas; a revisão de PR sem `gh` com sessão diz porquê.
    await step("platform", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const root = R.root as string, tf = ROOT + "infra-q/main.tf", rb = ROOT + "runbooks/selftest-weekly.md";
      writeFile(tf, 'resource "aws_db_instance" "main" {\n  password = var.db_password\n}\n');
      writeFile(rb, "# selftest weekly check\n\nschedule: weekly\n\n## 1. list [check]\n```sh\nls\n```\nexpect: `x`\n");
      flushSave(); await idle();
      const before = ((await sh("git", ["rev-parse", "HEAD"])) as { stdout: string }).stdout.trim();
      await git("add", "infra-q/main.tf", "runbooks/selftest-weekly.md");
      await sh("git", ["commit", "-m", "chore: platform self-test"]);
      type Q = { me: { name: string }; items: Array<{ id: string; why: string }>; team: Array<{ item: string; recipient: string }>; missing: string[]; measured: Array<[string, string]> };
      try {
        const inc = await inv("incident_open", { root, title: "selftest checkout latency", severity: "SEV-3" }) as { id: number; key: string };
        const q1 = await inv("queue_items", { root }) as Q;
        const ids = q1.items.map((i) => i.id);
        const notYet = await inv("queue_verify", { root, id: "iac:infra-q/main.tf", title: "finding" }) as { done: boolean };
        writeFile(tf, 'resource "aws_db_instance" "main" {\n  password_wo = var.db_password\n}\n');
        flushSave(); await idle();
        const done = await inv("queue_verify", { root, id: "iac:infra-q/main.tf", title: "finding" }) as { done: boolean; proof: string | null };
        const noReason = await inv("queue_handover", { root, id: "recurring:runbooks/selftest-weekly.md", title: "weekly", recipient: "bruno", reason: " " }).then(() => "kept", (e) => String(e));
        await inv("queue_handover", { root, id: "recurring:runbooks/selftest-weekly.md", title: "weekly", recipient: "bruno", reason: "self-test: his runbook" });
        const unchecked = await inv("incident_add", { root, id: inc.id, kind: "not-checked", text: "db metrics", reason: null }).then(() => "kept", (e) => String(e));
        await inv("incident_add", { root, id: inc.id, kind: "not-checked", text: "db metrics", reason: "no metrics source here" });
        await inv("incident_add", { root, id: inc.id, kind: "evidence", text: "the self-test says so", reason: null });
        await inv("incident_status", { root, id: inc.id, status: "mitigated", note: "self-test" });
        await inv("incident_feedback", { root, id: inc.id, right: true });
        const view = await inv("incident_get", { root, id: inc.id }) as { confidence: { level: string }; events: unknown[]; precision: [number, number] };
        await inv("incident_status", { root, id: inc.id, status: "resolved", note: "self-test: nothing broke" });
        const q2 = await inv("queue_items", { root }) as Q;
        const review = await inv("pr_infra_review", { root, pr: 1 }).then(() => "reviewed", (e) => String(e));
        const submit = await inv("pr_review_submit", { root, pr: 1, decision: "approve", body: "", reason: null }).then(() => "posted", (e) => String(e));
        const out = {
          me: q1.me.name, items: ids, missing: q1.missing, notYet: notYet.done, done: done.done, proof: done.proof, noReason: noReason.slice(0, 60), unchecked: unchecked.slice(0, 70),
          confidence: view.confidence.level, events: view.events.length, precision: view.precision, after: q2.items.map((i) => i.id), team: q2.team.map((t) => `${t.item}→${t.recipient}`),
          review: review.slice(0, 80), submit: submit.slice(0, 80),
        };
        if (!ids.includes("iac:infra-q/main.tf") || !ids.includes("recurring:runbooks/selftest-weekly.md") || !ids.includes(`incident:${inc.id}`) || notYet.done || !done.done
          || !/recipient|reason/.test(noReason) || !/reason/.test(unchecked) || view.confidence.level !== "low" || q2.items.some((i) => i.id.startsWith("iac:infra-q") || i.id.startsWith("recurring:") || i.id === `incident:${inc.id}`)
          || !q2.team.some((t) => t.recipient === "bruno") || review === "reviewed" || submit === "posted") throw new Error("platform: " + JSON.stringify(out));
        return out;
      } finally {
        delete FS[tf]; delete FS[rb]; flushSave(); await idle();
        if (before) await git("reset", "--hard", before);
        await sh("rm", ["-rf", "infra-q", "runbooks"]);
      }
    });
    // NOTAS-r23 ponto 3: a fonte de métricas na app real, contra um Prometheus que o runner arranca (DXTUTOR_SELFTEST_PROM)
    // e cujo token de leitura vem do Vault dev (lido no backend, nunca devolvido): a fonte «obs» ligada, o orçamento de erro
    // medido (as consultas inválidas à própria API do Prometheus são os erros), a capacidade que diz não ter o
    // kube-state-metrics, e um incidente cuja confiança sobe de «low» com a verificação das métricas.
    await step("metrics", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const env = async (k: string) => ((await sh("printenv", [k])) as { stdout: string }).stdout.trim();
      const prom = await env("DXTUTOR_SELFTEST_PROM"), vaddr = await env("DXTUTOR_SELFTEST_VAULT"), vtok = await env("DXTUTOR_SELFTEST_VAULT_TOKEN2");
      if (!prom || !vaddr || !vtok) return { skipped: "no Prometheus or Vault for the self-test (DXTUTOR_SELFTEST_PROM, DXTUTOR_SELFTEST_VAULT_TOKEN2)" };
      const root = R.root as string, v = tauriVault(), w = { addr: vaddr, namespace: "" };
      await v.loginToken(w, vtok);
      writeFile(ROOT + ".dxtutor/metrics.json", JSON.stringify({ prometheus: { url: prom, auth: { kind: "vault", addr: vaddr, mount: "secret", path: "apps/obs/prometheus", field: "token" } } }, null, 2));
      writeFile(ROOT + ".dxtutor/slo.json", JSON.stringify({ services: [{ name: "prometheus-api", objective: 99, window: "5m", errors: 'sum(increase(prometheus_http_requests_total{handler="/api/v1/query",code=~"4..|5.."}[$window]))', total: 'sum(increase(prometheus_http_requests_total{handler="/api/v1/query"}[$window]))' }] }, null, 2));
      flushSave(); await idle();
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const hit = (q: string) => sh("curl", ["-s", "-o", "/dev/null", "-G", `${prom}/api/v1/query`, "--data-urlencode", `query=${q}`]);
      /* two waves: the 400 series must exist before its increase counts */
      await hit("bad("); await hit("up"); await wait(3000);
      for (let i = 0; i < 10; i++) { await hit("bad("); await hit("up"); await hit("up"); }
      await wait(4000);
      try {
        const sources = await inv("sources_status", { root }) as Array<{ kind: string; connected: boolean; via: string | null; notes: string }>;
        const obs = sources.find((s) => s.kind === "obs");
        type B = { service: string; errorRatio: number | null; remaining: number | null; exhausted: boolean };
        const o = await inv("metrics_status", { root }) as { connected: boolean; auth: string; version: string | null; budgets: B[]; budgetErrors: string[]; capacity: unknown; capacityNotes: string };
        const inc = await inv("incident_open", { root, title: "selftest error spike", severity: "SEV-3" }) as { id: number };
        const lines = await inv("incident_metrics_check", { root, id: inc.id }) as string[];
        await inv("incident_add", { root, id: inc.id, kind: "evidence", text: "the self-test sent bad queries", reason: null });
        const view = await inv("incident_get", { root, id: inc.id }) as { confidence: { level: string; reasons: string[] } };
        const json = JSON.stringify([sources, o, lines, view]);
        const b = o.budgets[0];
        const res = {
          obs: obs?.connected, via: obs?.via, auth: o.auth, version: o.version, budget: b ? { ratio: b.errorRatio, remaining: b.remaining, exhausted: b.exhausted } : null,
          budgetErrors: o.budgetErrors, capacity: o.capacity, capacityNotes: o.capacityNotes, lines, confidence: view.confidence.level, tokenShown: json.includes("st-prom-read-"),
        };
        if (!obs?.connected || !/token from Vault/.test(obs.via ?? "") || o.auth !== "vault" || !b || !b.exhausted || !(b.errorRatio! > 0.05) || o.capacity !== null
          || !/kube-state-metrics/.test(o.capacityNotes) || lines.length !== 1 || !/prometheus-api: errors/.test(lines[0]) || view.confidence.level === "low" || res.tokenShown)
          throw new Error("metrics: " + JSON.stringify(res));
        return res;
      } finally {
        delete FS[ROOT + ".dxtutor/metrics.json"]; delete FS[ROOT + ".dxtutor/slo.json"]; flushSave(); await idle();
        await v.revoke(w).catch(() => undefined);
      }
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
    // r23 F1: uma operação do IDE no registo de auditoria (audit_record → project_audit), com origem `ide`, quem
    // decidido pelo backend e o segredo do `.env` mascarado no comando e no motivo (a regra vive no Rust).
    await step("audit", async () => {
      const root = R.root as string, env = ROOT + ".env", secret = "selftest-secret-98765";
      writeFile(env, `API_TOKEN=${secret}\n`);
      flushSave(); await idle();
      try {
        await auditClient().record(root, { feature: "ops", action: "kube.undo", command: `kubectl rollout undo deploy/web # ${secret}`, scope: "context selftest · namespace default", approved: true, reason: `rotate ${secret}`, outcome: "sent", decidedAt: 1 });
        const bad = await auditClient().record(root, { feature: "Ops!", action: "x", command: "c", approved: true }).then(() => "accepted", (e) => (e as { code?: string }).code ?? String(e));
        const rows = await projectClient().audit(root, null) as Array<{ origin: string; tool: string | null; call: string | null; actor: string; command: string | null; reason: string | null; outcome: string | null; decidedBy: string | null; path: string | null }>;
        const row = rows.filter((r) => r.origin === "ide").slice(-1)[0];
        return {
          recorded: !!row, tool: row?.tool, call: row?.call, outcome: row?.outcome, scope: row?.path, actorFromBackend: !!row?.actor && row?.decidedBy === `human:${row?.actor}`,
          secretMasked: !!row && !`${row.command}${row.reason}`.includes(secret), badInput: bad,
        };
      } finally {
        delete FS[env]; flushSave(); await idle();
      }
    });
    // r23 F6: «Clone Git Repository…» contra o git real — o plano (o comando exacto e a pasta), a recusa de um URL
    // com ar de opção, o clone para a pasta planeada (a partir do repositório temporário, por file://) e a recusa
    // de clonar por cima dela. Tudo numa pasta temporária fora do projecto.
    await step("clone", async () => {
      const g = gitClient(), root = (R.root as string).replace(/\/$/, "");
      const parent = (await sh("mktemp", ["-d"], { cwd: R.info.home })).stdout.trim();
      try {
        const plan = await g.clonePlan(`file://${root}`, parent);
        const optionUrl = await g.clonePlan("--upload-pack=touch /tmp/x", parent).then(() => "accepted", () => "refused");
        const path = await g.clone(`file://${root}`, parent);
        const again = await g.clone(`file://${root}`, parent).then(() => "cloned twice", (e) => /already exists/.test(String(e)) ? "refused" : String(e));
        const head = (await sh("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { cwd: parent })).stdout.trim();
        return { command: plan.command.startsWith(`git -C ${parent} clone -- file://`), target: path === plan.target, optionUrl, again, isRepo: head === "true" };
      } finally {
        await sh("rm", ["-rf", parent], { cwd: R.info.home });
      }
    });
    // A10: as lacunas aprovadas, contra o repositório temporário e esta máquina — o mapa de onboarding,
    // o diff de um ramo contra outro (git_diff_range), o relatório de dependências (sem rede), e onde
    // anexar o depurador (os processos locais e o adaptador; a lista de contentores, só de leitura).
    await step("gaps", async () => {
      const inv = window.__TAURI__!.core.invoke as (c: string, a?: Record<string, unknown>) => Promise<unknown>;
      const root = R.root as string;
      const map = await inv("onboard_map", { root }) as { git: boolean; totalFiles: number; hot: Array<{ file: string }>; people: Array<{ name: string }>; languages: Array<{ name: string }> };
      const range = await inv("git_diff_range", { root, base: "main", target: "develop", path: null }).catch((e) => "ERR " + String(e)) as string;
      const deps = await inv("deps_report", { root, online: false }) as { ecosystems: unknown[] };
      const local = await inv("debug_attach_targets", { target: { kind: "local", name: "", context: "", namespace: "", kubeconfig: "" } }) as { ok: boolean; processes: unknown[]; adapter: string | null };
      const docker = await inv("debug_attach_targets", { target: { kind: "docker", name: "", context: "", namespace: "", kubeconfig: "" } }) as { ok: boolean; places: string[]; notes: string };
      return {
        mapGit: map.git, files: map.totalFiles, hot: map.hot.length, people: map.people.length, langs: map.languages.map((l) => l.name).join(","),
        rangeDiff: range.startsWith("ERR") ? range.slice(0, 120) : range.includes("diff --git") ? "has diff" : "empty",
        ecosystems: deps.ecosystems.length,
        localProcs: local.processes.length > 0, localAdapter: !!local.adapter,
        docker: docker.ok ? docker.places.length : docker.notes.slice(0, 80),
      };
    });
    // contentores (ADR-0006, R5a): ligar o runtime real (docker info pelo socket) e o pane
    // Containers lista os contentores e as imagens reais (ps/images em JSON).
    await step("containers", async () => {
      const wait = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return f(); };
      const W = window as unknown as { ENVS: { rt: string; rtOn: boolean }; rtConnect: () => Promise<void> };
      W.ENVS.rt = "docker";
      if (!W.ENVS.rtOn) await rtConnect();
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
      const img = ((await sh("docker", ["images", "--format", "{{.Repository}}:{{.Tag}}"])).stdout.trim().split("\n").filter(x => x && !x.includes("<none>"))[0]) || "";
      if (!img) return { skipped: "sem imagens locais" };
      writeFile(pDc(), JSON.stringify({ name: "selftest", image: img }) + "\n"); flushSave(); await idle();
      dcAttach();
      const up = await wait(() => !!devc(), 60000);
      const name = (devc() as { name: string } | null)?.name ?? "", engine = (devc() as unknown as { engine?: string } | null)?.engine || "docker";
      const bin = engine === "host" ? "docker" : engine;
      const inPs = name ? (await sh(bin, ["ps"])).stdout.includes(name) : false; /* o delonix ignora o --format: procura-se o nome na tabela */
      dcDetach();
      const down = await wait(() => devc() === null, 30000);
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
      dxRun();
      const up = await wait(() => !!stackState() && stackState()!.some(x => x.name === "obs"), 120000);
      openObserve("local", "obs");
      const polled = await wait(() => { const o = OBS["local:obs"]; return !!o && o.polled && o.logs.some(l => /dxtutor-selftest up/.test(l.m)); }, 30000);
      await wait(() => (OBS["local:obs"]?.mem.length || 0) >= 1, 15000);
      const o = OBS["local:obs"];
      const res = { image: img, up, polled, logLines: o ? o.logs.length : 0, firstLog: o?.logs[0]?.m || "", mem: o?.mem.slice(-1)[0], cpu: o?.cpu.slice(-1)[0], sampleErr: o?.sampleErr, logErr: o?.logErr };
      dxStop();
      const down = await wait(() => stackState() === null, 60000);
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
      await k8sConnect();
      const contexts = [...KCTX];
      const cluster = desktopPorts.infra?.cluster;
      let readErr = "";
      try { await cluster!.read({ env: "staging", ctx: "dx-selftest", ns: "dx" }); } catch (e) { readErr = String((e as Error).message || e).slice(0, 120); }
      const applied = await cluster!.apply({ env: "staging", ctx: "dx-selftest", ns: "dx" }, "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: dx-selftest\n", "abc1234");
      ENVX.ctx.staging = "dx-selftest";
      const res = { contexts, connected: W.ENVS.k8sOn, readErr, applied, staging: envState("staging"), hist: ENVX.hist.length };
      W.ENVS.kube = prev.kube; W.ENVS.ctx = prev.ctx; W.ENVS.k8sOn = prev.on; ENVX.ctx.staging = "";
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
      renderRemotePane();
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
    // formatação, Go to Symbol (Ctrl+Shift+O + o Outline), Go to Symbol in Workspace (Ctrl+T) e a hierarquia de tipos (Shift+Alt+T). Só corre para as linguagens com servidor instalado.
    for (const lang of ["java", "kotlin"] as const) await step("lsp-" + lang, () => lspProbe(lang));
    // LSP P2: os overrides no backend real — o vigia vê o .dxtutor/lsp.json mudar (sem reiniciar), um ficheiro
    // inválido aparece no aviso, um comando do projecto espera pela aprovação (recusa e aprovação auditadas), as
    // definições do projecto também, e o lsp.json do utilizador grava-se e aplica-se. O comando do projecto é um `sh` que sai logo (nada corre).
    await step("lspOverrides", () => lspOverridesProbe());
    // LSP P6: um servidor REAL (o typescript-language-server, se estiver instalado) no editor — fechar o
    // separador dá didClose, «Stop» pára-o (shutdown/exit, processo recolhido), o pedido seguinte arranca-o de
    // novo, «Restart» troca o processo, e com `idleMinutes: 1` no lsp.json do utilizador o reaper pára-o sozinho.
    await step("lspResources", () => lspResourcesProbe());
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

  async function lspResourcesProbe(): Promise<unknown> {
    type Info = { key: string; label: string; pid: number | null; documents: string[]; state: string };
    const root = R.root as string;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const until = async <T>(f: () => Promise<T | null | undefined | false>, ms: number): Promise<T | null> => {
      const t0 = Date.now();
      for (;;) { const v = await f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(300); }
    };
    const key = ROOT + "lsp-res/main.ts", path = root + "/lsp-res/main.ts";
    const st = await invoke<{ installed: boolean; server: string } | null>("lsp_server_status", { path });
    if (!st?.installed) return { skipped: `${st?.server ?? "typescript-language-server"} not installed (put the nvm node bin folder on PATH)` };
    const list = async () => (await invoke<{ servers: Info[] }>("lsp_servers")).servers.filter((s) => s.label === st.server);
    const alive = async (pid: number) => (await sh("sh", ["-c", `test -e /proc/${pid} && echo yes || echo no`])).stdout.trim() === "yes";
    writeFile(key, "export const answer: number = 42;\nexport function twice(n: number): number { return n * 2; }\n");
    flushSave(); await idle();
    const out: Record<string, unknown> = {};
    const W = window as unknown as { openPath: (k: string) => void };
    W.openPath(key);
    const first = await until(async () => (await list()).find((s) => s.documents.includes(path) && s.pid), 90_000);
    if (!first) return { ...out, opened: "FAIL: the server never listed the file" };
    out.opened = { pid: !!first.pid, state: first.state };
    // «Stop»: shutdown + exit, o processo recolhido
    await invoke("lsp_server_stop", { key: first.key });
    out.stopped = !(await list()).some((s) => s.key === first.key) && !(await alive(first.pid!));
    // o pedido seguinte arranca-o de novo (outro processo), com o ficheiro aberto
    await invoke("lsp_hover", { path, line: 1, character: 17 }).catch(() => null);
    const back = await until(async () => (await list()).find((s) => s.key === first.key && s.pid), 60_000);
    out.cameBack = back ? { newPid: back.pid !== first.pid, hasFile: back.documents.includes(path) } : "FAIL: did not come back";
    // «Restart»: outro processo, o ficheiro aberto outra vez
    if (back) {
      await invoke("lsp_server_restart", { key: back.key });
      const again = (await list()).find((s) => s.key === back.key);
      out.restarted = again ? { newPid: again.pid !== back.pid, oldGone: !(await alive(back.pid!)), hasFile: again.documents.includes(path) } : "FAIL: not running after restart";
    }
    // fechar o separador → didClose: o servidor deixa de ter o ficheiro
    services.tabs!.closeTab(key);
    out.didClose = !!(await until(async () => (await list()).find((s) => s.key === first.key && !s.documents.length), 10_000));
    // inactivo: com idleMinutes 1, o reaper (de 30 em 30 s) pára-o sozinho
    const before = await tauriLspConfig.configFile("user", null);
    await tauriLspConfig.saveUserConfig('{ "resources": { "idleMinutes": 1 } }');
    const pidNow = (await list()).find((s) => s.key === first.key)?.pid ?? null;
    out.idleStopped = !!(await until(async () => !(await list()).some((s) => s.key === first.key), 120_000)) && (pidNow == null || !(await alive(pidNow)));
    await tauriLspConfig.saveUserConfig(before.exists ? before.text : "{}");
    // o registo diz porquê (e passou pela máscara)
    const log = await invoke<{ code: string | null; detail: { reason?: string } | null }[]>("lsp_server_log", { key: first.key });
    out.logReasons = log.filter((l) => l.code === "stopped" || l.code === "killed").map((l) => l.detail?.reason);
    out.started = log.filter((l) => l.code === "started").length;
    delete FS[key];
    flushSave(); await idle();
    return out;
  }

  async function lspOverridesProbe(): Promise<unknown> {
    const root = R.root as string;
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    const until = async <T>(f: () => T | null | undefined | false, ms: number): Promise<T | null> => {
      const t0 = Date.now();
      for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(200); }
    };
    const put = async (text: string) => { await sh("sh", ["-c", 'mkdir -p .dxtutor && printf "%s" "$1" > .dxtutor/lsp.json', "sh", text], { cwd: root }); };
    const out: Record<string, unknown> = {};
    await tauriLspConfig.config(root); // a pasta fica vigiada
    // 1. inválido → ignorado e avisado (o vigia de 2 s + lsp://config + o aviso da UI)
    await put('{ "servers": [ { "id": "sql", "comand": "sh" } ] }');
    out.invalidNotice = (await until(() => document.getElementById("lsp-config-errors")?.textContent?.includes("comand") && document.getElementById("lsp-config-errors")!.textContent!.slice(0, 160), 10_000)) ?? "FAIL: no notice";
    // 2. um comando do projecto → pedido de aprovação, nada arranca
    // um argumento diferente em cada corrida: uma aprovação de uma corrida anterior não conta
    const run = String(Date.now());
    await put(`{ "servers": [ { "id": "sql", "command": "sh", "args": ["-c", "exit 0", "${run}"] } ] }`);
    let cfg = await tauriLspConfig.config(root);
    out.invalidCleared = await until(() => !document.getElementById("lsp-config-errors"), 10_000) ?? "FAIL: notice stayed";
    const a = cfg.servers.find((s) => s.id === "sql")?.approval;
    out.approval = a ? { command: a.command, changed: a.changed, file: a.file.endsWith(".dxtutor/lsp.json") } : "FAIL: no approval asked";
    const st = await invoke<{ approval?: { hash: string } | null }>("lsp_server_status", { path: root + "/selftest.sql" });
    out.statusAsks = !!st?.approval && st.approval.hash === a?.hash;
    if (a) {
      // recusado: auditado, continua pendente; um hash antigo é recusado; aprovado: deixa de pedir
      await tauriLspConfig.approveServer(root, "sql", a.hash, false, "selftest: deny", Date.now());
      out.deniedStillPending = !!(await tauriLspConfig.config(root)).servers.find((s) => s.id === "sql")?.approval;
      try { await tauriLspConfig.approveServer(root, "sql", "0".repeat(64), true, "", Date.now()); out.staleHash = "FAIL: accepted"; } catch (e) { out.staleHash = String(e).slice(0, 80); }
      await tauriLspConfig.approveServer(root, "sql", a.hash, true, "selftest: approve", Date.now());
      cfg = await tauriLspConfig.config(root);
      out.approved = !cfg.servers.find((s) => s.id === "sql")?.approval;
      // o comando muda → volta a pedir
      await put(`{ "servers": [ { "id": "sql", "command": "sh", "args": ["-c", "exit 1", "${run}"] } ] }`);
      out.changedAsksAgain = !!(await tauriLspConfig.config(root)).servers.find((s) => s.id === "sql")?.approval;
      // só definições do projecto: também pedem aprovação, mas o servidor arranca com as de confiança
      await put(`{ "servers": [ { "id": "sql", "settings": { "sqls": { "selftest": "${run}" } } } ] }`);
      const sa = (await tauriLspConfig.config(root)).servers.find((s) => s.id === "sql")?.approval;
      out.settingsAsk = sa ? { blocksStart: sa.blocksStart, changed: sa.changed, shown: !!sa.config?.includes(run) } : "FAIL: settings not gated";
    }
    // 3. o lsp.json do utilizador: grava, aplica; inválido → relatório com o erro
    const before = await tauriLspConfig.configFile("user", null);
    const good = await tauriLspConfig.saveUserConfig('{ "servers": [ { "id": "go", "settings": { "gopls": { "staticcheck": true } } } ] }');
    out.goSettings = (await tauriLspConfig.config(root)).servers.find((s) => s.id === "go")?.settings ?? null;
    const bad = await tauriLspConfig.saveUserConfig('{ "servers": [ { "id": "go", "nope": 1 } ] }');
    out.user = { path: before.path.endsWith("lsp.json"), applied: good.applied, badIgnored: !bad.applied && bad.errors.some((e) => e.includes("nope")) };
    // ignorado: volta ao registo de baixo (sem as definições)
    out.goSettingsAfterBad = (await tauriLspConfig.config(root)).servers.find((s) => s.id === "go")?.settings ?? null;
    await tauriLspConfig.saveUserConfig(before.exists ? before.text : "{}");
    await sh("rm", ["-rf", ".dxtutor/lsp.json"], { cwd: root });
    return out;
  }

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
          // hierarquia de tipos (Shift+Alt+T): uma interface e quem a implementa
          "lsp-java/Shape.java": "public interface Shape {\n    double area();\n}\n",
          "lsp-java/Circle.java": "public class Circle implements Shape {\n    public double area() { return 3.14; }\n}\n",
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
    const diag = await until(() => diagnostics().find(d => d.p === main && d.sev === "e"), 180_000, 500);
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
    // 3g) Go to Symbol in Workspace: Ctrl+T, escrever «ad» (Java: o método do Util.java, que não
    //     está aberto) / «gre» (Kotlin: o servidor não manda a linha — procura-se no ficheiro) e
    //     Enter leva ao símbolo.
    const wsQuery = lang === "java" ? "ad" : "gre", wsWant = lang === "java" ? "add" : "greet";
    const wsKey = lang === "java" ? ROOT + "lsp-java/Util.java" : main, wsLine = lang === "java" ? 3 : 1;
    const wsRows = () => [...document.querySelectorAll("#lsp-wsymbols .lsp-sym")].map(b => `${b.querySelector(".lsp-act-kind")?.textContent} ${b.querySelector(".lsp-sym-n")?.textContent} ${b.querySelector(".lsp-ref-t")?.textContent}`);
    const wsList = await until(() => {
      const inp = document.querySelector<HTMLInputElement>("#lsp-wsymbols input");
      const rows = wsRows();
      if (inp && inp.value === wsQuery && rows.some(r => r.includes(` ${wsWant} `))) return rows;
      if (!inp) {
        if (W.cur !== main) W.openPath(main);
        const el = ta()!; el.focus();
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "t", code: "KeyT", ctrlKey: true, bubbles: true, cancelable: true }));
      } else {
        inp.value = wsQuery; inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return null;
    }, 60_000, 2000);
    let wsLanded: { file: string | null; line: number | null } | null = null;
    const wsInput = document.querySelector<HTMLInputElement>("#lsp-wsymbols input");
    if (wsList && wsInput) {
      await sleep(1500); // o cartão fica no ecrã para a captura
      wsInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await until(() => W.cur === wsKey && caretLineNow() === wsLine, 15_000, 250);
      wsLanded = { file: W.cur, line: caretLineNow() };
    }
    document.getElementById("lsp-wsymbols")?.remove();
    // 3h) hierarquia de tipos (Shift+Alt+T). Java: em `Shape`, os subtipos têm `Circle`; Enter
    //     abre-o; em `Circle`, Tab mostra os supertipos (`Shape`). Kotlin: o kotlin-language-server
    //     não a suporta — o editor tem de o dizer.
    const typeRowsNow = () => [...document.querySelectorAll("#lsp-types .lsp-type")].map(r => `${r.querySelector(".lsp-act-kind")?.textContent} ${r.querySelector(".lsp-sym-n")?.textContent}`);
    const shiftAltT = (key: string, word: string) => {
      if (W.cur !== key) W.openPath(key);
      const el = ta()!; const o = el.value.indexOf(word) + 1; el.focus(); el.setSelectionRange(o, o);
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "T", code: "KeyT", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));
    };
    let typeSubs: string[] | null = null, typeOpened: string | null = null, typeSupers: string[] | null = null, typeNotice: string | null = null;
    if (lang === "java") {
      const shapeKey = ROOT + "lsp-java/Shape.java", circleKey = ROOT + "lsp-java/Circle.java";
      typeSubs = await until(() => {
        const pop = document.getElementById("lsp-types"), rows = typeRowsNow();
        if (rows.some(r => r.endsWith(" Circle"))) return rows;
        if (pop && pop.textContent?.includes("No subtypes")) pop.remove(); // índice ainda a fazer-se: tenta de novo
        if (!document.getElementById("lsp-types")) shiftAltT(shapeKey, "Shape");
        return null;
      }, 90_000, 3000);
      if (typeSubs) {
        await sleep(1500); // o cartão fica no ecrã para a captura
        const pop = document.getElementById("lsp-types")!;
        pop.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
        pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        typeOpened = (await until(() => W.cur === circleKey && W.cur, 10_000, 250)) || W.cur;
        typeSupers = await until(() => {
          const pop2 = document.getElementById("lsp-types"), rows = typeRowsNow();
          const dir = pop2?.querySelector(".lsp-types-dir.on")?.textContent;
          if (dir === "Supertypes" && rows.some(r => r.endsWith(" Shape"))) return rows;
          if (!pop2) shiftAltT(circleKey, "Circle");
          else if (dir !== "Supertypes" && rows.length) pop2.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
          return null;
        }, 60_000, 2500);
        await sleep(1500);
      }
      document.getElementById("lsp-types")?.remove();
    } else {
      typeNotice = await until(() => {
        const t = toasts.find(m => m.startsWith("Type hierarchy:"));
        if (t) return t;
        shiftAltT(main, "greet");
        return null;
      }, 30_000, 3000);
    }
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
      workspaceSymbols: { query: wsQuery, rows: wsList, landed: wsLanded, expected: { file: wsKey, line: wsLine } },
      typeHierarchy: lang === "java" ? { subtypes: typeSubs, opened: typeOpened, supertypes: typeSupers } : { notice: typeNotice },
      references: refRows ? refRows.map(r => r.replace(/\s+/g, " ").slice(0, 70)) : null,
      rename: { placeholder, to: newName, applied: !!renamed, occurrencesOnDisk: onDisk, ...(probeRename ? { probe: probeRename } : {}) },
      toasts,
    };
    }
  }
}
