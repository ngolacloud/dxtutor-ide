/* ═══════════ Co-Dev — chat view (ADR-0002, Phase 3) ═══════════
   The presentation layer for the agent transcript. Owns every byte of HTML and
   all DOM/run-control side-effects that used to be inline in the engine; the
   application use cases (`../application/*`) call these methods with plain data
   and never touch markup themselves.

   This module implements `ChatPresenter` + `ApprovalGate` (see
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
import { composerContext, trackSubagent } from "./composer";
import { bus } from "../../../app/bus";
import { explainProviderError, type ProviderError } from "../domain/provider-errors";
import { translator } from "../../../app/i18n";
import { CODEV_CHAT_MESSAGES } from "./chat-messages";
import { CODEV_STREAM_MESSAGES } from "./stream-messages";
import { CODE_IN_EDITOR } from "../domain/prose";
import { rangeLabel, type PlanPlace } from "../domain/plan-order";
import { codevAsk } from "../../../app/codev-ask";

const tc = translator(CODEV_CHAT_MESSAGES);
const ts = translator(CODEV_STREAM_MESSAGES);
import type {
  ApprovalGate,
  CardRef,
  ChatPresenter,
  ToolHost,
  ToolRef,
} from "../application/ports";

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

/** Texto do humano → HTML da bolha: escapado; as quebras de linha ficam (a bolha tem
 *  `white-space: pre-wrap`) e os blocos ``` viram `<pre>` (sem as crases à vista). Texto
 *  sem blocos dá exactamente `esc(t)`. */
export function userHtml(t: string): string {
  return esc(t).replace(/\n?```[^\n]*\n([\s\S]*?)\n?```\n?/g, (_m, code: string) => `<pre>${code}</pre>`);
}

/** O título e o passo seguinte de um erro de provedor reconhecido, na língua da interface. */
export function providerErrorText(e: ProviderError): { title: string; hint: string } {
  const who = e.provider ?? tc("theProvider"), alt = tc("alt");
  const hint = e.kind === "network" ? tc(e.local ? "networkHintLocal" : "networkHint") : tc(`${e.kind}Hint`, { alt });
  return { title: tc(`${e.kind}Title`, { who }), hint };
}

/** Erro de um provedor → HTML do cartão: explicação e passo seguinte quando o caso é
 *  reconhecido (sem créditos, chave recusada, limite, …), com o erro original em detalhe;
 *  senão a mensagem tal-e-qual. */
export function providerErrorHtml(msg: string, active?: string | null): string {
  const e = explainProviderError(msg, active);
  if (!e) return tc("noAnswer", { msg: esc(msg) });
  const { title, hint } = providerErrorText(e);
  const actions = e.kind === "credit" || e.kind === "auth" || e.kind === "nokey" || e.kind === "model"
    ? `<div style="margin-top:8px"><button class="mini" data-action="open-settings">${tc("openSettings")}</button></div>`
    : "";
  return `<b>${esc(title)}</b><div style="margin-top:4px">${esc(hint)}</div>${e.url ? `<div style="margin-top:6px">${tc("fixHere")} <code>${esc(e.url)}</code></div>` : ""}${actions}<details style="margin-top:8px;color:var(--fg-muted)"><summary>${tc("details")}</summary><code style="white-space:pre-wrap;word-break:break-word">${esc(e.detail)}</code></details>`;
}

export function user(t: string): void {
  const i = $("#ag-intro");
  if (i) i.remove();
  $("#ag-msgs")!.insertAdjacentHTML(
    "beforeend",
    `<div class="m user"><div class="bub"><div class="bh"><span class="br2">tu</span><span class="bt">${bridge.hhmm()}</span></div><div class="bd">${userHtml(t)}</div></div></div>`,
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
  // U3c: quem precisa de saber (o compositor: enviar↔parar e a fila) subscreve o bus
  bus.emit("agent:run", { active: on, label: RUN.label });
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
  } else if (a === "stop" || a === "esc") {
    // RF-G07: Esc stops Co-Dev like the Stop button (boot.ts sends "esc" outside text fields)
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
      // texto, nunca HTML: os rótulos podem trazer texto vindo do modelo (comandos, regras)
      x.textContent = b.l;
      x.onclick = () => {
        const done = document.createElement("span");
        done.className = "gdone";
        done.textContent = b.done || b.l;
        bar.replaceChildren(done);
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
  composerContext(t && t.path ? (t.title ?? t.path) : null);
  /* o `ctx` da barra de estado já não é uma percentagem de um orçamento inventado (caracteres/4
     sobre 2000 tokens): é o uso real que o provider reporta, desenhado por features/codev.ts
     (ADR-0006, R2e1). */
}

/* ═══════════ ChatPresenter + ApprovalGate implementation ═══════════ */

export const gate: ApprovalGate = {
  ask<T>(host: ToolHost, btns: Array<{ l: string; v: T; pri?: unknown; done?: string }>): Promise<T> {
    return ask(host, btns);
  },
};

export const presenter: ChatPresenter = {
  /* general */
  scrollMsgs,
  userMessage: user,
  beginRun: (label: string) => runState(true, label),
  subagent: (id: string, label: string, state: "running" | "done" | "error") => trackSubagent(id, label, state),
  endRun: () => runState(false),
  startAbort(): AbortSignal {
    const ctl = new AbortController();
    bridge.run().abort = ctl;
    return ctl.signal;
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
  /* live chat */
  providerOff(name: string) {
    card("sistema", tc("providerOff", { name: `<b>${name}</b>` }));
  },
  providerNeedsDesktop(name: string, ep: string) {
    card(
      "sistema",
      tc("providerNeedsDesktop", { name: `<b>${name}</b>`, ep: esc(ep) }),
    );
  },
  liveUnavailable() {
    card("sistema", tc("liveUnavailable"));
  },
  thinking(speaker: string): CardRef {
    return card(speaker, '<span class="spin"></span> a pensar…');
  },
  assistantText(ref: CardRef, text: string) {
    const bd = asCard(ref).bd;
    bd.innerHTML = md(text);
    // RF-S01 (F3.2): where a long code block was left out of the chat, a button asks Co-Dev to make
    // the change in the editor (edit_lines/edit) instead
    if (text.includes(CODE_IN_EDITOR)) {
      bd.innerHTML = bd.innerHTML.split(esc(CODE_IN_EDITOR)).join(`<span class="cd-code-ed">${esc(CODE_IN_EDITOR)}</span>`);
      bd.querySelectorAll<HTMLElement>(".cd-code-ed").forEach((span) => {
        const b = document.createElement("button");
        b.className = "mini cd-apply";
        b.textContent = ts("applyCode");
        b.disabled = !codevAsk.available();
        b.onclick = () => { b.disabled = true; void codevAsk.ask({ intent: "chat", text: ts("applyAsk"), context: [], send: true }); };
        span.after(b);
      });
    }
    scrollMsgs();
  },
  liveError(ref: CardRef, aborted: boolean, code: string | undefined, msg: string) {
    asCard(ref).bd.innerHTML =
      bridge.run().stop || aborted
        ? "Resposta interrompida."
        : code === "not_granted"
          ? tc("notGranted")
          : code === "rate_limited"
            ? tc("rateLimited")
            : providerErrorHtml(msg, bridge.monolith.activeProvider);
    scrollMsgs();
  },
  refreshCtx: ctxPill,

  /* agente v2 (ADR-0003, F4) */
  agentReasoning(ref: CardRef, text: string) {
    const c = asCard(ref);
    let box = c.el.querySelector(".agent-reason") as HTMLElement | null;
    if (!box) {
      box = document.createElement("details");
      box.className = "agent-reason";
      box.innerHTML = `<summary>${tc("reasoning")}</summary><div class="ar-b"></div>`;
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
  agentTodos(ref: CardRef, todos: Array<{ content: string; status: string }>) {
    const c = asCard(ref);
    let box = c.el.querySelector(".agent-todos") as HTMLElement | null;
    if (!box) {
      box = document.createElement("div");
      box.className = "agent-todos";
      c.tools.before(box);
    }
    const done = todos.filter((t) => t.status === "completed").length;
    box.innerHTML =
      `<div class="at-h">Tarefas · ${done}/${todos.length}</div>` +
      todos
        .map((t) => {
          const mark = t.status === "completed" ? "☑" : t.status === "in_progress" ? "◐" : "☐";
          return `<div class="at-i ${esc(t.status)}"><span class="at-m">${mark}</span>${esc(t.content)}</div>`;
        })
        .join("");
    scrollMsgs();
  },
  /* the turn's report (HARNESS-07): built from the events, collapsed under the reply */
  agentReport(ref: CardRef, title: string, markdown: string) {
    const c = asCard(ref);
    const d = document.createElement("details");
    d.className = "agent-report";
    const sum = document.createElement("summary");
    const b = document.createElement("span");
    b.textContent = "Turn report";
    sum.appendChild(b);
    const t = document.createElement("span");
    t.className = "ar-t";
    t.textContent = " · " + title; // text, never HTML
    sum.appendChild(t);
    d.appendChild(sum);
    const body = document.createElement("div");
    body.innerHTML = md(markdown);
    d.appendChild(body);
    c.el.querySelector(".bub")!.appendChild(d);
    scrollMsgs();
  },
  agentPlan(ref: ToolRef, markdown: string) {
    const box = document.createElement("div");
    box.className = "agent-plan";
    box.innerHTML = md(markdown || "(plano vazio)");
    el(ref).appendChild(box);
    scrollMsgs();
  },
  toolDiffLink(ref: ToolRef, onDiff: () => void) {
    const b = document.createElement("button");
    b.className = "lnk";
    b.textContent = "ver diff";
    b.onclick = onDiff;
    el(ref).querySelector(".tr")!.appendChild(b);
  },
  toolReason(ref: ToolRef, reason: string, dangerous: boolean) {
    const t = el(ref);
    const w = document.createElement("span");
    w.className = "why" + (dangerous ? " bad" : "");
    w.textContent = (dangerous ? "⚠ " : "") + reason;
    t.appendChild(w);
  },
  /* live hunks (RF-CODEV-STREAM): the review bar of a call; per-hunk choices live in the editor */
  hunkWriting(ref: CardRef, info: { path: string; start: number; end: number; place: PlanPlace }, open: () => void) {
    const c = asCard(ref);
    const line = document.createElement("div");
    line.className = "cd-writing";
    line.append(ts("writing") + " ");
    const a = document.createElement("a");
    a.className = "cd-writing-path";
    a.textContent = info.path; // text, never HTML
    a.title = ts("openAt", { path: info.path, line: info.start });
    a.onclick = (ev) => { ev.preventDefault(); open(); };
    line.appendChild(a);
    line.append(" " + rangeLabel(info.start, info.end));
    const p = info.place;
    if (p.kind !== "none") {
      const tag = document.createElement("span");
      tag.className = "tag cd-plan" + (p.kind === "in-order" ? "" : " warn");
      tag.textContent = p.kind === "in-order" ? ts("planStep", { step: p.step }) : p.kind === "ahead" ? ts("aheadOfPlan", { step: p.step, pending: p.pending.join(", ") }) : ts("outsidePlan");
      line.append(" ", tag);
    }
    (c.tools ?? c.bd).appendChild(line);
    scrollMsgs();
  },
  hunkReview(ref: ToolRef, info: { path: string; count: number; reason: string }, on: { acceptAll(): void; rejectAll(): void; open(): void }) {
    const t = el(ref);
    const bar = document.createElement("div");
    bar.className = "gate hk-gate";
    const lead = document.createElement("span");
    lead.className = "hk-lead";
    const n = document.createElement("span");
    n.textContent = tc("editorChanges", { n: info.count });
    lead.appendChild(n);
    bar.appendChild(lead);
    const btn = (label: string, pri: boolean, run: () => void) => {
      const x = document.createElement("button");
      x.className = "gb" + (pri ? " pri" : "");
      x.textContent = label; // text, never HTML
      x.onclick = run;
      bar.appendChild(x);
    };
    btn("Aceitar todas", true, () => on.acceptAll());
    btn("Rejeitar todas", false, () => on.rejectAll());
    btn("Ver no editor", false, () => on.open());
    t.appendChild(bar);
    scrollMsgs();
    waiting();
    return {
      settle(label: string) {
        const done = document.createElement("span");
        done.className = "gdone";
        done.textContent = label;
        bar.replaceChildren(done);
      },
    };
  },
};
