/* ═══════════ Co-Dev — chat view (ADR-0002, Phase 3) ═══════════
   The presentation layer for the agent transcript. Owns every byte of HTML and
   all DOM/run-control side-effects that used to be inline in the engine; the
   application use cases (`../application/*`) call these methods with plain data
   and never touch markup themselves.

   This module implements `MissionPresenter` + `ApprovalGate` (see
   `../application/ports.ts`). It reads the running app's shell state through the
   legacy bridge (`run()`, `hhmm()`, panel, log/note/toast) — the bridge is the
   one typed window facade; the use cases stay free of it.

   The low-level helpers it exports (`scrollMsgs`, `user`, `card`, `phase`, `md`,
   `beat`, `runState`, `runLabel`, `agCtl`, `waiting`, `ask`, `tl`, `ctxPill`)
   are published verbatim onto `window` by `../index.ts`, because
   `features/board.ts` drives this same engine through those globals and relies
   on their exact behaviour (including the `RUN.stop`/`RUN.pend`/`STOP`
   cancellation path). That cross-feature coupling is why cancellation here
   still throws the shared `STOP` sentinel rather than an `AbortError`. */

import { $, esc } from "../../../core";
import * as bridge from "../infrastructure/legacy-bridge";
import { RUBRIC } from "../domain/scoring";
import type {
  ApprovalGate,
  CardRef,
  ClarifyHandle,
  CouncilHandle,
  DeliverView,
  Mission,
  MissionPresenter,
  PlanHandle,
  ProviderInfo,
  ToolHost,
  ToolRef,
} from "../application/ports";
import type { Mode, Requirement, Question, Step, CheckResult } from "../domain/types";

/* animation speed multiplier; only ever 1 in production, left as a knob the
   engine used to carry locally. */
const SPEED = 1;

/* a card handle: the message element, its body and its tool strip. The use
   cases see only the opaque `CardRef` ({ tools, body }); here we work with the
   full shape. */
interface FullCard {
  el: HTMLElement;
  bd: HTMLElement;
  tools: HTMLElement;
  body: HTMLElement;
}
function asCard(ref: CardRef): FullCard {
  return ref as unknown as FullCard;
}
function el(ref: ToolRef): HTMLElement {
  return ref as HTMLElement;
}

/* ───── low-level transcript helpers (published to window for board.ts) ───── */

export function scrollMsgs(): void {
  const m = $("#ag-msgs")!;
  m.scrollTop = $("#ag-intro") ? 0 : m.scrollHeight;
}

export function user(t: string): void {
  const i = $("#ag-intro");
  if (i) i.remove();
  $("#ag-msgs")!.insertAdjacentHTML(
    "beforeend",
    `<div class="m user"><div class="bub"><div class="bh"><span class="br2">tu</span><span class="bt">${bridge.hhmm()}</span></div><div class="bd">${esc(t)}</div></div></div>`,
  );
  scrollMsgs();
}

export function card(w: string, html: string): FullCard {
  const i = $("#ag-intro");
  if (i) i.remove();
  const d = document.createElement("div");
  d.className = "m ai";
  d.innerHTML = `<div class="bub"><div class="bh"><span class="br2">${esc(w || "co-dev")}</span><span class="bt">${bridge.hhmm()}</span></div><div class="bd">${html}</div><div class="tools"></div></div>`;
  $("#ag-msgs")!.appendChild(d);
  scrollMsgs();
  const bd = d.querySelector(".bd") as HTMLElement;
  return { el: d, bd, body: bd, tools: d.querySelector(".tools") as HTMLElement };
}

export function phase(n: number, l: string): void {
  $("#ag-msgs")!.insertAdjacentHTML("beforeend", `<div class="phase"><i>${n}</i>${l}</div>`);
  bridge.run().label = l;
  runLabel();
  bridge.log("co-dev", "fase " + n + " — " + l);
  scrollMsgs();
}

export function md(t: unknown): string {
  const parts = String(t).split(/```/);
  return parts
    .map((p, i) =>
      i % 2
        ? `<pre>${esc(p.replace(/^[a-z]*\n/, ""))}</pre>`
        : esc(p)
            .replace(/`([^`\n]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
            .replace(/^#{1,4}\s+(.+)$/gm, "<b>$1</b>")
            .replace(/^\s*[-*]\s+(.+)$/gm, "• $1")
            .replace(/\n/g, "<br>"),
    )
    .join("");
}

/* ───── execution control (published; shared with board.ts) ───── */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms * SPEED)));

export async function beat(ms: number, signal?: AbortSignal): Promise<void> {
  await sleep(ms);
  const RUN = bridge.run();
  while (RUN.paused && !RUN.stop && !(signal && signal.aborted)) await new Promise((r) => setTimeout(r, 120));
  if (RUN.stop || (signal && signal.aborted)) throw bridge.stopSignal();
}

export function runState(on: boolean, label?: string): void {
  const RUN = bridge.run();
  RUN.active = on;
  RUN.paused = false;
  RUN.stop = false;
  RUN.pend = null;
  if (on) {
    RUN.t0 = Date.now();
    RUN.label = label || "";
  }
  if (!on) {
    RUN.abort = null;
    RUN.M = null;
  }
  $("#ag-runctl")!.classList.toggle("hidden", !on);
  $("#rc-pause")!.innerHTML = "<kbd>p</kbd> pausar";
  runLabel();
  bridge.badges();
}

export function runLabel(): void {
  const RUN = bridge.run();
  if (!RUN.active) return;
  $("#rc-lbl")!.textContent = (RUN.paused ? "em pausa · " : "") + RUN.label;
  const s = Math.round((Date.now() - RUN.t0) / 1000);
  $("#rc-el")!.textContent = s < 60 ? s + "s" : Math.floor(s / 60) + "m" + String(s % 60).padStart(2, "0") + "s";
}

export function agCtl(a: string): void {
  const RUN = bridge.run();
  if (!RUN.active) return;
  if (a === "pause") {
    RUN.paused = !RUN.paused;
    $("#rc-pause")!.innerHTML = RUN.paused ? "<kbd>p</kbd> retomar" : "<kbd>p</kbd> pausar";
    runLabel();
  } else if (a === "stop") {
    RUN.stop = true;
    RUN.paused = false;
    if (RUN.abort) RUN.abort.abort();
    if (RUN.pend) RUN.pend();
  } else if (a === "details") {
    bridge.setPanelTab("output");
  }
}

export function waiting(): void {
  const RUN = bridge.run();
  RUN.label = "à espera da tua decisão";
  runLabel();
  bridge.note("O Co-Dev precisa da tua decisão");
}

export function ask<T>(host: ToolHost, btns: Array<{ l: string; v: T; pri?: unknown; done?: string }>): Promise<T> {
  return new Promise((res, rej) => {
    const bar = document.createElement("div");
    bar.className = "gate";
    btns.forEach((b) => {
      const x = document.createElement("button");
      x.className = "gb" + (b.pri ? " pri" : "");
      x.innerHTML = b.l;
      x.onclick = () => {
        bar.innerHTML = `<span class="gdone">${b.done || b.l}</span>`;
        bridge.run().pend = null;
        res(b.v);
      };
      bar.appendChild(x);
    });
    (host as HTMLElement).appendChild(bar);
    scrollMsgs();
    bridge.run().pend = () => {
      bar.remove();
      rej(bridge.stopSignal());
    };
    waiting();
  });
}

export function tl(host: ToolHost, name: string, arg: unknown): HTMLElement {
  const d = document.createElement("div");
  d.className = "tool";
  d.innerHTML = `<span class="tn">${name}</span><span class="ta">${esc(arg)}</span><span class="tr"></span>`;
  (host as HTMLElement).appendChild(d);
  scrollMsgs();
  return d;
}

/* ───── context pill (published; used by the glue's updateAgentUI + live chat) ───── */
export function ctxPill(): void {
  const t = bridge.tabOf(bridge.monolith.currentTabId);
  const pill = $("#pill-ctx");
  if (!pill) return;
  pill.textContent = "@ " + (t && t.path ? t.title : "sem ficheiro");
  pill.classList.toggle("on", bridge.monolith.contextEnabled && !!(t && t.path));
  const fs = bridge.files();
  const u = Math.min(
    99,
    Math.round(
      (bridge.chat().reduce((s, m) => s + m.content.length, 0) + (t && t.path && fs[t.path] ? fs[t.path].content.length : 0)) / 4 / 2000,
    ),
  );
  $("#st-ctx")!.textContent = "ctx " + u + "%";
}

/* ───── demo chips reused across the live-chat system cards ───── */
const demoChips = `<div class="chips"><button class="chip" data-action="demo" data-on="b"><b>Missão: histórico de conversas persistente</b></button><button class="chip" data-action="demo" data-on="a"><b>Missão: corrigir o E0382 em lib.rs</b></button></div>`;

/* ═══════════ MissionPresenter + ApprovalGate implementation ═══════════ */

export const gate: ApprovalGate = {
  ask<T>(host: ToolHost, btns: Array<{ l: string; v: T; pri?: unknown; done?: string }>): Promise<T> {
    return ask(host, btns);
  },
};

export const presenter: MissionPresenter = {
  /* general */
  scrollMsgs,
  userMessage: user,
  isRunning: () => bridge.run().active,
  beginRun: (label: string) => runState(true, label),
  endRun: () => runState(false),
  setMissionContext(m: Mission | null) {
    bridge.run().M = m as unknown as { files: Set<string> } | null;
  },
  startAbort(): AbortSignal {
    const ctl = new AbortController();
    bridge.run().abort = ctl;
    return ctl.signal;
  },
  setLabel(label: string) {
    bridge.run().label = label;
    runLabel();
  },
  trackFile(path: string) {
    const m = bridge.run().M;
    if (m) m.files.add(path);
  },
  phase,
  revealTerminal() {
    if (bridge.getVar("--panel-h") !== "0px") bridge.setPanelTab("terminal", true);
  },
  stopValue: () => bridge.stopSignal(),

  /* tool lines */
  toolLine: (host, name, arg) => tl(host, name, arg),
  toolOk(ref: ToolRef) {
    el(ref).querySelector(".tr")!.innerHTML = '<span class="okc">✓</span>';
  },
  toolNoChange(host: ToolHost, shortPath: string) {
    tl(host, "edit_file", shortPath).querySelector(".tr")!.textContent = "sem alterações";
  },
  toolEdit(host, o) {
    const d = tl(host, o.create ? "create_file" : "edit_file", o.shortPath);
    d.querySelector(".tr")!.innerHTML = `<span class="pls">+${o.add}</span><span class="mns">−${o.del}</span><button class="lnk">ver diff</button>`;
    (d.querySelector(".lnk") as HTMLElement).onclick = () => o.onDiff();
    return d;
  },
  toolRun: (host, cmd) => tl(host, "$", cmd),
  toolRunResult(ref: ToolRef, ok: boolean, sum: string) {
    el(ref).querySelector(".tr")!.innerHTML = `<span class="${ok ? "okc" : "bad"}">${ok ? "✓" : "✖"} ${esc(sum || "")}</span>`;
  },

  /* mission cards */
  systemNoProvider() {
    card("sistema", "Não há nenhum provedor ligado. Liga pelo menos um em <b>Definições → Modelos e provedores</b>.");
  },
  scenarioReady(msg: string) {
    card("co-dev", msg);
  },
  understandStart(speaker: string): CardRef {
    return card(speaker, '<p><span class="spin"></span> A ler as regras do projecto, os ADRs e o código relevante…</p>');
  },
  understandDone(ref: CardRef, understand: string, reqs: Requirement[]) {
    asCard(ref).bd.innerHTML = `<p>${understand}</p>${reqs
      .map((r) => `<div class="req"><b>${r.t}</b>${r.ac.map((a) => `<div class="ac">${a}</div>`).join("")}</div>`)
      .join("")}`;
    scrollMsgs();
  },
  clarify(speaker: string, q: Question, showLowConf: boolean, pct: number): ClarifyHandle {
    const c = card(
      speaker,
      `<p><b>${q.q}</b></p>${
        showLowConf
          ? `<p style="color:var(--fg-dim)">Confiança baixa (${pct}%) e nenhuma regra do projecto cobre isto — prefiro perguntar-te.</p>`
          : ""
      }<div class="qo"></div><div class="qfoot"></div>`,
    );
    const qo = c.bd.querySelector(".qo") as HTMLElement;
    const draw = (pick: number | null, click: boolean) => {
      qo.innerHTML = q.opts
        .map(
          (o, i) =>
            `<${click ? "button" : "div"} class="qopt${pick === i ? " pick" : pick != null ? " dim" : ""}" data-i="${i}"><span class="ql">${o.l}<small>${o.why}</small></span>${
              i === q.best ? `<span class="tag acc">recomendada · ${pct}%</span>` : ""
            }</${click ? "button" : "div"}>`,
        )
        .join("");
      scrollMsgs();
    };
    return {
      draw,
      awaitPick(): Promise<number> {
        draw(null, true);
        return new Promise<number>((res, rej) => {
          qo.querySelectorAll("button").forEach(
            (b) =>
              ((b as HTMLElement).onclick = () => {
                bridge.run().pend = null;
                res(+(b as HTMLElement).dataset.i!);
              }),
          );
          bridge.run().pend = () => rej(bridge.stopSignal());
          waiting();
        });
      },
      foot(by: string, status: string, basis: string) {
        c.bd.querySelector(".qfoot")!.innerHTML = `<span class="tag ${by === "agente" ? "acc" : "live"}">${
          by === "agente" ? "decidido pelo Co-Dev" : "decidido por ti"
        }</span>${status === "pressuposto" ? '<span class="tag warn">pressuposto reversível</span>' : ""}<span>base: ${basis}</span>`;
      },
    };
  },
  councilCard(speaker: string, count: number): CouncilHandle {
    const c = card(
      speaker,
      `<p>${
        count > 1
          ? `Pedi uma proposta a cada provedor ligado (${count}) e avalio-as às cegas com a mesma rubrica.`
          : "Só há um provedor ligado, por isso não há propostas concorrentes — sigo com esta."
      }</p><div class="cl"></div><div class="qfoot"></div>`,
    );
    const cl = c.bd.querySelector(".cl") as HTMLElement;
    return {
      card: c,
      candidate(x, info: ProviderInfo): ToolRef {
        const e = document.createElement("div");
        e.className = "cand";
        e.innerHTML = `<div class="ch"><span class="pdot" style="background:${info.col}"></span>Proposta ${x.L} · ${info.name}<span class="tot"><span class="spin"></span></span></div><div class="ct">${x.title}</div><div class="cs">${x.sum}</div><div class="crit"></div>`;
        cl.appendChild(e);
        scrollMsgs();
        return e;
      },
      score(candEl: ToolRef, tot: number, sc: Record<string, number>) {
        el(candEl).querySelector(".tot")!.textContent = tot.toFixed(1);
        el(candEl).querySelector(".crit")!.innerHTML = RUBRIC.map(
          (k) => `<span>${k.s}<i><b style="width:${sc[k.k] * 10}%"></b></i></span>`,
        ).join("");
      },
      markBest(candEl: ToolRef) {
        el(candEl).classList.add("best");
      },
      foot(by: string) {
        c.bd.querySelector(".qfoot")!.innerHTML = `<span class="tag ${by === "juiz" ? "acc" : "live"}">${
          by === "juiz" ? "decidido pelo juiz" : "decidido por ti"
        }</span><span>rubrica: ${RUBRIC.map((k) => k.l + " " + k.w).join(" · ")}</span>`;
      },
    };
  },
  plan(speaker: string, title: string, steps: Step[]): PlanHandle {
    const n = steps.length;
    const c = card(
      speaker,
      `<div class="plan" style="margin:0"><div class="plan-h"><span class="plan-t">${title}</span><span class="plan-c">0/${n}</span></div><div class="bar"><span style="width:0"></span></div>${steps
        .map((s) => `<div class="stp todo"><span class="g">·</span><span class="l">${s.l}</span><span class="d"></span></div>`)
        .join("")}</div>`,
    );
    const rows = c.bd.querySelectorAll(".stp");
    return {
      card: c,
      stepStart(i: number) {
        const r = rows[i];
        r.className = "stp run";
        r.querySelector(".g")!.textContent = "◐";
      },
      stepDone(i: number, ok: boolean, secs: number) {
        const r = rows[i];
        r.className = "stp done";
        r.querySelector(".g")!.textContent = ok ? "✓" : "✗";
        if (!ok) (r.querySelector(".g") as HTMLElement).style.color = "var(--red)";
        r.querySelector(".d")!.textContent = secs.toFixed(1) + "s";
      },
      progress(i: number, nn: number) {
        c.bd.querySelector(".plan-c")!.textContent = `${i + 1}/${nn}`;
        (c.bd.querySelector(".bar span") as HTMLElement).style.width = ((i + 1) / nn) * 100 + "%";
      },
    };
  },
  evalCard(speaker: string, again: boolean): CardRef {
    return card(
      speaker,
      `<p>${
        again
          ? "Volto a correr tudo depois da correcção."
          : "Corro os testes e o lint e pontuo o resultado contra os critérios — quem revê não é quem escreveu."
      }</p>`,
    );
  },
  evalResult(ref: CardRef, o: { score: number; ok: boolean; res: CheckResult[]; threshold: number }) {
    asCard(ref).bd.insertAdjacentHTML(
      "beforeend",
      `<div class="evalbox"><div class="score ${o.ok ? "ok" : "bad"}">${o.score}<small>/100</small></div><div style="flex:1;min-width:0">${o.res
        .map(
          (k) => `<div class="chk ${k.ok ? "ok" : "no"}"><span class="g">${k.ok ? "✓" : "✗"}</span><span>${k.l}</span><span class="w">${k.w}</span></div>`,
        )
        .join("")}</div></div><div class="qfoot"><span class="tag ${o.ok ? "live" : "bad"}">${o.ok ? "acima" : "abaixo"} do limiar ${o.threshold}</span></div>`,
    );
    scrollMsgs();
  },
  reflectCard(speaker: string, o: { score: number; threshold: number; fails: CheckResult[]; sw: boolean }): CardRef {
    return card(
      speaker,
      `<p>A entrega não passou na minha própria avaliação (<b>${o.score}</b> &lt; ${o.threshold}). Não entrego assim.</p>${o.fails
        .map((k) => `<div class="fixl"><b>✗ ${k.l}</b><span>Causa: ${k.cause}</span><span>Correcção: ${k.fixd}</span></div>`)
        .join("")}<p style="margin-top:8px"><b>Estratégia:</b> ${
        o.sw
          ? "reverter ao checkpoint inicial e refazer com a abordagem mais bem classificada — a decisão anterior estava errada."
          : "corrigir incrementalmente — a abordagem está certa, os defeitos são locais."
      }</p>`,
    );
  },
  blocked(speaker: string, score: number, threshold: number, fails: CheckResult[]) {
    card(
      speaker,
      `<p>Depois de 2 tentativas a avaliação continua em <b>${score}/100</b>. Em vez de insistir, paro aqui.</p>${fails
        .map((k) => `<div class="fixl"><b>✗ ${k.l}</b><span>${k.cause}</span></div>`)
        .join("")}<p style="margin-top:8px">Diz-me como queres avançar, ou restaura o checkpoint inicial no Gestor de missões.</p>`,
    );
    void threshold;
  },
  deliver(speaker: string, o: DeliverView): CardRef {
    return card(
      speaker,
      `<p><b>${o.title}</b> — concluído com auto-avaliação <b style="color:var(--green)">${o.score}/100</b>${
        o.retries ? `, depois de ${o.retries} correcção(ões) feita(s) por mim` : ""
      }.</p><ul>${o.done.map((x) => `<li>${x}</li>`).join("")}</ul>${
        o.assumptions.length
          ? `<p><span class="tag warn">pressuposto a rever</span> ${o.assumptions.map((a) => a.q + " → <b>" + a.choice + "</b>").join("; ")}</p>`
          : ""
      }<p style="color:var(--fg-dim)">${o.decCount} decisões registadas · ${o.fileCount} ficheiro(s) alterado(s).</p><div class="gate"><button class="gb" data-action="go-pane" data-on="scm">Ver alterações</button><button class="gb" data-action="open-manager">Registo de decisões</button></div>`,
    );
  },
  commitConfirm(ref: CardRef, hash: string, mode: Mode, commitMsg: string) {
    asCard(ref).bd.insertAdjacentHTML(
      "beforeend",
      `<p>Commit <code>${hash}</code> ${mode === "auto" ? "feito automaticamente" : "feito"}: <code>${esc(commitMsg)}</code>. O <code>git push</code> fica contigo — exige sempre aprovação humana.</p>`,
    );
  },
  missionError(msg: string) {
    card("sistema", "Erro inesperado: " + esc(msg));
  },
  missionStopped() {
    card(
      "co-dev",
      "Execução parada a teu pedido. O que já foi alterado continua nos ficheiros; podes restaurar o checkpoint inicial no Gestor de missões.",
    );
  },

  /* live chat */
  providerOff(name: string) {
    card("sistema", `<b>${name}</b> está desligado. Liga-o nas Definições ou escolhe outro modelo.`);
  },
  providerSimulated(name: string, ep: string) {
    card(
      "sistema",
      `<b>${name}</b> está <b>simulado</b> neste protótipo: a página não pode chamar ${esc(ep)}. Para uma resposta real muda para Claude, ou corre uma missão guionada:${demoChips}`,
    );
  },
  liveUnavailable() {
    card("sistema", `A ligação ao vivo ao Claude não está disponível nesta vista. As missões guionadas funcionam na mesma:${demoChips}`);
  },
  thinking(speaker: string): CardRef {
    return card(speaker, '<span class="spin"></span> a pensar…');
  },
  assistantText(ref: CardRef, text: string) {
    asCard(ref).bd.innerHTML = md(text);
    scrollMsgs();
  },
  liveError(ref: CardRef, aborted: boolean, code: string | undefined, msg: string) {
    asCard(ref).bd.innerHTML =
      bridge.run().stop || aborted
        ? "Resposta interrompida."
        : code === "not_granted"
          ? "O acesso ao Claude não foi autorizado nesta página. As missões guionadas continuam disponíveis."
          : code === "rate_limited"
            ? "Limite de pedidos atingido — tenta daqui a pouco."
            : "Não consegui obter resposta do Claude (" + esc(msg) + ").";
  },
  refreshCtx: ctxPill,

  /* agente v2 (ADR-0003, F4) */
  agentReasoning(ref: CardRef, text: string) {
    const c = asCard(ref);
    let box = c.el.querySelector(".agent-reason") as HTMLElement | null;
    if (!box) {
      box = document.createElement("details");
      box.className = "agent-reason";
      box.innerHTML = `<summary>raciocínio</summary><div class="ar-b"></div>`;
      c.bd.before(box);
    }
    (box.querySelector(".ar-b") as HTMLElement).innerHTML = md(text);
  },
  agentNote(ref: CardRef, key: string, text: string) {
    const c = asCard(ref);
    let notes = c.el.querySelector(".agent-notes") as HTMLElement | null;
    if (!notes) {
      notes = document.createElement("div");
      notes.className = "agent-notes";
      c.el.querySelector(".bub")!.appendChild(notes);
    }
    let n = notes.querySelector(`[data-k="${CSS.escape(key)}"]`) as HTMLElement | null;
    if (!n) {
      n = document.createElement("div");
      n.dataset.k = key;
      notes.appendChild(n);
    }
    n.textContent = text;
    scrollMsgs();
  },
  toolReason(ref: ToolRef, reason: string, dangerous: boolean) {
    const t = el(ref);
    const w = document.createElement("span");
    w.className = "why" + (dangerous ? " bad" : "");
    w.textContent = (dangerous ? "⚠ " : "") + reason;
    t.appendChild(w);
  },
};
