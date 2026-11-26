/* ═══════════ Co-Dev — ui: a faixa «Co-Devs» (Multi Co-Dev, fase 2) ═══════════
   Dono do DOM de `#ag-codevs`, por cima da conversa: um cartão por sessão Co-Dev aberta («Co-Dev ·
   DX-12», estado, tempo, tokens — do mapa de agentes) e um por issue à espera de que outra feche.
   Clicar num cartão mostra a conversa dessa sessão; o «×» fecha-a. Só existe com mais de uma sessão
   (ou uma issue à espera): com uma só, o painel fica como sempre foi.

   Os cliques passam pela tabela delegada da feature (`data-action`/`data-on`). Não toca no `window`
   (regra A8). */

import { esc } from "../../../core";
import type { ActionTable } from "./actions";
import type { CodevSessions, SlotInfo } from "../application/codev-sessions";
import type { AgentMapStore } from "../application/agent-map";
import { elapsedOf, formatElapsed, formatTokens, sessionUsage, totalTokens, type AgentSession } from "../domain/agent-map";
import { translator } from "../../../app/i18n";
import { CODEVS_MESSAGES } from "./codevs-messages";

const t = translator(CODEVS_MESSAGES);
const ID = "ag-codevs";

export interface CodevsViewOptions {
  now(): number;
  every(ms: number, f: () => void): () => void;
}

/** O estado de um cartão: a decisão à espera primeiro, depois o que o mapa diz da sessão. */
function status(s: SlotInfo, m: AgentSession | undefined): "decision" | "running" | "done" | "failed" {
  if (s.waiting) return "decision";
  if (s.running || m?.status === "running") return "running";
  return m?.status === "failed" ? "failed" : "done";
}

export function makeCodevsView(sessions: CodevSessions, map: AgentMapStore, opts: CodevsViewOptions) {
  let stopTick: (() => void) | null = null;

  function cardHtml(s: SlotInfo): string {
    const m = s.session ? map.snapshot().sessions.find((x) => x.id === s.session) : undefined;
    const st = status(s, m);
    const label = s.issue ? `Co-Dev · ${s.issue}` : t("chat");
    const meta = m ? `${formatElapsed(elapsedOf(m, opts.now()))} · ${t("tokens", { n: formatTokens(totalTokens(sessionUsage(m))) })}` : "";
    const dot = `<span class="cc-dot ${st === "running" ? "live" : st === "failed" ? "error" : st === "decision" ? "warn" : "done"}"></span>`;
    return `<span class="cdv-card st-${st}${s.selected ? " sel" : ""}"><button class="cdv-pick" data-action="codevs-pick" data-on="${s.id}" title="${esc(label)} · ${esc(t(st))}">${dot}<span class="cdv-l notr">${esc(label)}</span><span class="cdv-m">${esc(t(st))}${meta ? ` · ${esc(meta)}` : ""}</span></button><button class="cdv-x" data-action="codevs-close" data-on="${s.id}" title="${esc(t("close"))}" aria-label="${esc(t("close"))}">✕</button></span>`;
  }

  function render(): void {
    const slots = sessions.slots();
    const queued = sessions.queued();
    let host = document.getElementById(ID);
    if (slots.length < 2 && !queued.length) {
      host?.remove();
      stopTick?.();
      stopTick = null;
      return;
    }
    const msgs = document.getElementById("ag-msgs");
    if (!host) {
      if (!msgs) return;
      host = document.createElement("div");
      host.id = ID;
      host.className = "ag-codevs";
      msgs.before(host);
    }
    host.title = t("stripTitle");
    host.innerHTML =
      slots.map(cardHtml).join("") +
      queued
        .map(
          (q) =>
            `<span class="cdv-card st-queued" title="${esc(t("queuedTitle"))}"><span class="cdv-pick"><span class="cc-dot done"></span><span class="cdv-l notr">Co-Dev · ${esc(q.key)}</span><span class="cdv-m">${esc(t("queued", { keys: q.blockers.join(", ") }))}</span></span><button class="cdv-x" data-action="codevs-unqueue" data-on="${esc(q.key)}" title="${esc(t("unqueue"))}" aria-label="${esc(t("unqueue"))}">✕</button></span>`,
        )
        .join("");
    // o tempo dos que trabalham anda sozinho
    if (!stopTick) stopTick = opts.every(1000, () => { if (sessions.slots().some((s) => s.running)) render(); });
  }

  sessions.onChange(render);
  map.onChange(() => { if (document.getElementById(ID)) render(); });

  const actions: ActionTable = {
    "codevs-pick": { on: "click", run: (e) => sessions.select(Number(e.on)) },
    "codevs-close": { on: "click", run: (e) => sessions.close(Number(e.on)) },
    "codevs-unqueue": { on: "click", run: (e) => sessions.unqueue(e.on) },
  };

  return { render, actions: (): ActionTable => actions };
}

export type CodevsView = ReturnType<typeof makeCodevsView>;
