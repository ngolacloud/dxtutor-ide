/* ═══════════ Co-Dev — mission engine use cases (ADR-0002, Phase 3) ═══════════
   The mission orchestration, lifted out of `features/codev.ts` with every byte
   of HTML removed: `decideQ`, `council`, `execSteps`, `evaluate`, `reflect` and
   the top-level `runMission`. They decide (via `domain/`) and drive the UI (via
   the `MissionPresenter`/`ApprovalGate` ports); they never touch the DOM,
   `window` or Tauri.

   `throw STOP` is driven by an `AbortSignal`: `runMission` opens a controller
   (`presenter.startAbort`, wired to `RUN.abort` so `agCtl('stop')` aborts it)
   and threads the signal into every sub-step; `presenter.beat` observes it. The
   thrown value stays `presenter.stopValue()` (the shared `window.STOP`) because
   the same low-level helpers are shared with `features/board.ts`. */

import { candidateTotal, scoreChecks, passesThreshold, RETRY_LIMIT } from "../domain/scoring";
import type { Decision } from "../domain/types";
import type { MissionDeps, Mission } from "./ports";

const NEVER: AbortSignal = new AbortController().signal;

export function makeMissionEngine(deps: MissionDeps) {
  const { presenter, gate, providers, notifier, scm, checkpoints, clock } = deps;
  const who = (role: string) => providers.speakerLabel(role);

  /** Record a decision on the mission and the global decision log. */
  function dec(M: Mission, d: Decision): void {
    d.id = deps.decisions.length + 1;
    d.mission = M.title;
    M.decs.push(d);
    deps.decisions.unshift(d);
    notifier.log("decisão", `${d.q} → ${d.choice} (${d.by}${d.conf ? ", " + Math.round(d.conf * 100) + "%" : ""})`);
  }

  async function decideQ(q: any, M: any, signal: AbortSignal = NEVER): Promise<void> {
    const mode = deps.mode();
    const auto = mode === "auto" || (mode === "assist" && q.conf >= 0.8);
    const pct = Math.round(q.conf * 100);
    const view = presenter.clarify(who("plan"), q, !auto && mode === "assist", pct);
    let pick: number;
    let by: string;
    let status = "ok";
    if (auto) {
      view.draw(null, false);
      await clock.beat(850, signal);
      pick = q.best;
      by = "agente";
      if (q.conf < 0.8) status = "pressuposto";
    } else {
      pick = await view.awaitPick();
      by = "humano";
      presenter.setLabel("Clarificar");
    }
    view.draw(pick, false);
    view.foot(by, status, q.basis);
    dec(M, { phase: "Clarificação", q: q.q, choice: q.opts[pick].l, by, conf: q.conf, basis: q.basis, status } as Decision);
    providers.trackUsage(providers.provFor("plan"), 600);
    await clock.beat(250, signal);
  }

  async function council(S: any, M: any, signal: AbortSignal = NEVER): Promise<any> {
    const mode = deps.mode();
    presenter.phase(3, "Conselho de modelos");
    const on = providers.connected();
    const cs: any[] = S.cands
      .map((c: any, i: number) => ({ ...c, i }))
      .filter((c: any) => c.i === S.best || on.includes(c.prov))
      .map((c: any, n: number) => ({ ...c, L: "ABCD"[n], prov: on.includes(c.prov) ? c.prov : on[0], tot: candidateTotal(c.sc) }));
    const PROV = providers.providers();
    const h = presenter.councilCard(who("judge"), cs.length);
    for (const x of cs) {
      x.el = h.candidate({ L: x.L, prov: x.prov, title: x.title, sum: x.sum }, PROV[x.prov]);
      providers.trackUsage(x.prov, 1800);
      notifier.log("conselho", `${PROV[x.prov].name} propôs: ${x.title}`);
      await clock.beat(480, signal);
    }
    presenter.setLabel("Juiz a avaliar as propostas");
    await clock.beat(700, signal);
    cs.forEach((x) => h.score(x.el, x.tot, x.sc));
    providers.trackUsage(providers.provFor("judge"), 1200);
    const best = cs.reduce((a, b) => (b.tot > a.tot ? b : a));
    let pick = best;
    let by = "juiz";
    if (mode === "manual") {
      const sel = cs.filter((x) => x.steps || x === best);
      pick = await gate.ask(
        h.card.body,
        sel.map((x) => ({ l: (x === best ? "★ " : "") + "Escolher a proposta " + x.L, v: x, pri: x === best, done: "✓ escolhida por ti: proposta " + x.L })),
      );
      by = "humano";
      presenter.setLabel("Conselho de modelos");
    }
    h.markBest(pick.el);
    h.foot(by);
    dec(M, {
      phase: "Conselho",
      q: "Que abordagem seguir?",
      choice: `${pick.L} — ${pick.title}`,
      by,
      conf: pick.tot / 100,
      basis: "rubrica do juiz",
      status: "ok",
    } as Decision);
    M.councilDec = M.decs[M.decs.length - 1];
    await clock.beat(300, signal);
    return pick;
  }

  async function execSteps(steps: any[], title: string, approve?: boolean, signal: AbortSignal = NEVER): Promise<void> {
    const mode = deps.mode();
    const n = steps.length;
    const h = presenter.plan(who("code"), title, steps);
    if (approve && mode === "manual") {
      const v = await gate.ask(h.card.body, [
        { l: "Aprovar plano", v: 1, pri: 1, done: "✓ plano aprovado por ti" },
        { l: "Parar", v: 0 },
      ]);
      if (!v) throw presenter.stopValue();
    }
    for (let i = 0; i < n; i++) {
      const s = steps[i];
      const t0 = clock.now();
      h.stepStart(i, s.l);
      presenter.setLabel(s.l);
      await clock.beat(300, signal);
      let ok = true;
      for (const t of s.tools) {
        if ((await deps.tool(t, h.card.tools, undefined, signal)) === false) ok = false;
      }
      h.stepDone(i, ok, (clock.now() - t0) / 1000);
      h.progress(i, n);
    }
  }

  async function evaluate(S: any, M: any, again?: boolean, signal: AbortSignal = NEVER): Promise<{ score: number; ok: boolean; fails: any[] }> {
    presenter.phase(6, again ? "Verificar de novo" : "Verificar e auto-avaliar");
    const c = presenter.evalCard(who("review"), !!again);
    for (const cmd of S.verify) await deps.tool({ t: "run", cmd }, c.tools, "review", signal);
    await clock.beat(450, signal);
    const res = S.checks.map((k: any) => ({ ...k, ok: !!k.fn() }));
    const score = scoreChecks(res);
    const ok = passesThreshold(score, deps.threshold());
    providers.trackUsage(providers.provFor("review"), 1500);
    presenter.evalResult(c, { score, ok, res, threshold: deps.threshold() });
    M.score = score;
    notifier.log("auto-avaliação", `${score}/100 — ${ok ? "aprovado" : "reprovado: " + res.filter((k: any) => !k.ok).map((k: any) => k.id).join(", ")}`);
    presenter.scrollMsgs();
    await clock.beat(350, signal);
    return { score, ok, fails: res.filter((k: any) => !k.ok) };
  }

  async function reflect(S: any, M: any, ev: any, signal: AbortSignal = NEVER): Promise<void> {
    const mode = deps.mode();
    presenter.phase(7, `Reflectir e corrigir · tentativa ${M.retries}/${RETRY_LIMIT}`);
    const sw = M.retries > 1 || S.fix.strategy === "switch";
    const c = presenter.reflectCard(who("plan"), { score: ev.score, threshold: deps.threshold(), fails: ev.fails, sw });
    if (mode === "manual") {
      const v = await gate.ask(c.body, [
        { l: "Aprovar correcção", v: 1, pri: 1, done: "✓ correcção aprovada por ti" },
        { l: "Parar", v: 0 },
      ]);
      if (!v) throw presenter.stopValue();
    }
    if (sw && M.councilDec) M.councilDec.status = "corrigida";
    dec(M, {
      phase: "Auto-correcção",
      q: `Avaliação ${ev.score}/100 — como corrigir?`,
      choice: sw ? "Reverter e trocar de abordagem" : "Correcção incremental",
      by: mode === "manual" ? "humano" : "agente",
      conf: 0.9,
      basis: "critérios falhados: " + ev.fails.map((k: any) => k.id).join(", "),
      status: "ok",
    } as Decision);
    checkpoints.create(`Antes da correcção ${M.retries} · ${S.title}`);
    let steps: any[];
    if (sw) {
      checkpoints.restore(M.ck0, true);
      steps = (S.cands[S.best].steps || S.steps).concat(S.fix.steps || []);
    } else {
      steps = S.fix.steps.filter((s: any) => ev.fails.some((k: any) => k.id === s.for));
    }
    if (!steps.length) {
      steps = (S.cands[S.best].steps || S.steps).concat(S.fix.steps || []);
    }
    await execSteps(steps, sw ? "Refazer com a melhor abordagem" : "Correcções", undefined, signal);
  }

  async function runMission(S: any, text: string): Promise<void> {
    if (presenter.isRunning()) {
      notifier.toast("Já há uma missão em curso");
      return;
    }
    presenter.userMessage(text);
    if (!providers.connected().length) {
      presenter.systemNoProvider();
      return;
    }
    const rd = S.ready();
    if (rd) {
      presenter.scenarioReady(rd);
      return;
    }
    const mode = deps.mode();
    const M: any = {
      id: deps.nextId(),
      title: S.title,
      mode,
      state: "em curso",
      score: null,
      t0: clock.now(),
      decs: [],
      retries: 0,
      files: new Set<string>(),
    };
    deps.missions.unshift(M);
    presenter.beginRun("A começar");
    presenter.setMissionContext(M);
    const signal = presenter.startAbort();
    try {
      /* the git-flow branch is a scenario field (`flow`); the fallback
         reproduces the old `S.id==='a'?…:…` for scenarios without it (e.g. the
         synthetic characterization scenario). */
      const flow = S.flow ?? (S.id === "a" ? { kind: "fix", branch: "e0382-lexer" } : { kind: "feature", branch: "historico-conversas" });
      scm.gfStart(flow.kind, flow.branch);
      scm.setAuthor("lead");
      M.ck0 = checkpoints.create("Antes de «" + S.title + "»");
      presenter.phase(1, "Entender requisitos");
      const c = presenter.understandStart(who("plan"));
      for (const p of S.reads) await deps.tool({ t: "read", p }, c.tools, undefined, signal);
      providers.trackUsage(providers.provFor("plan"), 4200);
      presenter.understandDone(c, S.understand, S.reqs);
      await clock.beat(500, signal);
      presenter.phase(2, "Clarificar");
      for (const q of S.questions) await decideQ(q, M, signal);
      const pick = await council(S, M, signal);
      presenter.phase(4, "Planear e executar");
      await execSteps(pick.steps || S.steps, "Plano · " + pick.title, true, signal);
      let ev = await evaluate(S, M, false, signal);
      while (!ev.ok && M.retries < RETRY_LIMIT) {
        M.retries++;
        await reflect(S, M, ev, signal);
        ev = await evaluate(S, M, true, signal);
      }
      if (!ev.ok) {
        presenter.phase(8, "Pedir orientação");
        presenter.blocked(who("plan"), ev.score, deps.threshold(), ev.fails);
        M.state = "bloqueada";
        notifier.note("Missão bloqueada: " + S.title);
      } else {
        presenter.phase(8, "Entregar");
        checkpoints.create("Entrega · " + S.title);
        const ass = M.decs.filter((d: any) => d.status === "pressuposto");
        const d = presenter.deliver(who("plan"), {
          title: S.title,
          score: ev.score,
          retries: M.retries,
          done: S.done,
          assumptions: ass.map((a: any) => ({ q: a.q, choice: a.choice })),
          decCount: M.decs.length,
          fileCount: M.files.size,
        });
        const doC = mode === "auto"
          ? 1
          : await gate.ask(d.body, [
              { l: "Fazer commit", v: 1, pri: 1, done: "✓ commit aprovado por ti" },
              { l: "Deixar por commitar", v: 0, done: "fica por commitar" },
            ]);
        if (doC) {
          const staged = scm.staged();
          staged.clear();
          M.files.forEach((p: string) => {
            if (scm.isTracked(p)) staged.add(p);
          });
          const k = scm.commit(S.commit);
          if (k) presenter.commitConfirm(d, k.h, mode, S.commit);
        }
        await scm.gfAsk(d.body, M);
        M.state = "concluída";
        notifier.note("Missão concluída: " + S.title + " (" + ev.score + "/100)");
      }
    } catch (e: any) {
      if (e !== presenter.stopValue()) {
        console.error(e);
        presenter.missionError((e && e.message) || e);
      } else {
        presenter.missionStopped();
      }
      M.state = e === presenter.stopValue() ? "parada" : "erro";
    } finally {
      scm.setAuthor("w");
      M.dur = Math.round((clock.now() - M.t0) / 1000);
      presenter.endRun();
      deps.refresh();
      presenter.scrollMsgs();
    }
  }

  return { dec, decideQ, council, execSteps, evaluate, reflect, runMission };
}

export type MissionEngine = ReturnType<typeof makeMissionEngine>;
