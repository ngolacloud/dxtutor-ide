/* ═══════════ Co-Dev — ui: a faixa «Co-Devs» (Multi Co-Dev, fases 2 e 3) ═══════════
   Dono do DOM de `#ag-codevs`, por cima da conversa: um cartão por sessão Co-Dev aberta («Co-Dev ·
   DX-12», estado, tempo, tokens — do mapa de agentes) e um por issue à espera de que outra feche.
   Clicar num cartão mostra a conversa dessa sessão; o «×» fecha-a. Só existe com mais de uma sessão
   (ou uma issue à espera): com uma só, o painel fica como sempre foi.

   Fase 3: o cartão de uma sessão numa worktree diz o ramo («⎇ feature/dx-2-…») e quantos ficheiros
   reservou, e tem «Ficheiros» (os que mudou, abertos só de leitura) e «Commit» (no ramo dela). As
   worktrees sem sessão (guardadas com alterações, ou deixadas por um crash) têm cartão próprio, com
   «Ficheiros» e «Limpar» (aprovado). Com uma worktree ou uma destas, a faixa aparece mesmo com uma sessão.

   Os cliques passam pela tabela delegada da feature (`data-action`/`data-on`). Não toca no `window`
   (regra A8). */

import { esc } from "../../../core";
import type { ActionTable } from "./actions";
import type { CodevSessions, SlotInfo } from "../application/codev-sessions";
import type { AgentMapStore } from "../application/agent-map";
import type { Worktrees } from "../application/worktrees";
import { elapsedOf, formatElapsed, formatTokens, sessionUsage, totalTokens, type AgentSession } from "../domain/agent-map";
import { branchLabel, type ListedWorktree } from "../domain/worktrees";
import { translator } from "../../../app/i18n";
import { CODEVS_MESSAGES } from "./codevs-messages";

const t = translator(CODEVS_MESSAGES);
const ID = "ag-codevs";

export interface CodevsViewOptions {
  now(): number;
  every(ms: number, f: () => void): () => void;
  /** Fase 3: as worktrees do Co-Dev (lista, reservas, acções). */
  worktrees?: Worktrees;
  /** Uma lista para escolher (a paleta): os ficheiros de uma worktree. */
  pick?(placeholder: string, items: Array<{ label: string; detail: string; run(): void }>): void;
}

/** O estado de um cartão: a decisão à espera primeiro, depois o que o mapa diz da sessão. */
function status(s: SlotInfo, m: AgentSession | undefined): "decision" | "running" | "done" | "failed" {
  if (s.waiting) return "decision";
  if (s.running || m?.status === "running") return "running";
  return m?.status === "failed" ? "failed" : "done";
}

const btn = (cls: string, action: string, on: string, title: string, glyph: string): string =>
  `<button class="${cls}" data-action="${action}" data-on="${esc(on)}" title="${esc(title)}" aria-label="${esc(title)}">${glyph}</button>`;

export function makeCodevsView(sessions: CodevSessions, map: AgentMapStore, opts: CodevsViewOptions) {
  let stopTick: (() => void) | null = null;
  const wts = opts.worktrees;

  function cardHtml(s: SlotInfo): string {
    const m = s.session ? map.snapshot().sessions.find((x) => x.id === s.session) : undefined;
    const st = status(s, m);
    const label = s.issue ? `Co-Dev · ${s.issue}` : t("chat");
    const meta = m ? `${formatElapsed(elapsedOf(m, opts.now()))} · ${t("tokens", { n: formatTokens(totalTokens(sessionUsage(m))) })}` : "";
    const dot = `<span class="cc-dot ${st === "running" ? "live" : st === "failed" ? "error" : st === "decision" ? "warn" : "done"}"></span>`;
    const claimed = s.session && wts ? wts.claimsOf(s.session) : [];
    const claims = claimed.length ? t("claims", { n: claimed.length, list: claimed.slice(0, 8).join(", ") + (claimed.length > 8 ? " …" : "") }) : "";
    const wt = s.worktree;
    const title = [`${label} · ${t(st)}`, wt ? t("worktree", { branch: wt.branch ?? "?", path: wt.path }) : "", claims].filter(Boolean).join("\n");
    const where = wt ? `<span class="cdv-wt notr">${esc(branchLabel(wt))}</span>` : "";
    const extra = wt && s.issue
      ? btn("cdv-a", "codevs-files", s.issue, t("files"), "☰") + btn("cdv-a", "codevs-commit", s.issue, t("commit", { branch: wt.branch ?? "?" }), "✓")
      : "";
    return `<span class="cdv-card st-${st}${s.selected ? " sel" : ""}${wt ? " in-wt" : ""}"><button class="cdv-pick" data-action="codevs-pick" data-on="${s.id}" title="${esc(title)}">${dot}<span class="cdv-l notr">${esc(label)}</span>${where}<span class="cdv-m">${esc(t(st))}${meta ? ` · ${esc(meta)}` : ""}${claimed.length ? ` · ${esc(t("claimsShort", { n: claimed.length }))}` : ""}</span></button>${extra}<button class="cdv-x" data-action="codevs-close" data-on="${s.id}" title="${esc(t("close"))}" aria-label="${esc(t("close"))}">✕</button></span>`;
  }

  function keptHtml(w: ListedWorktree): string {
    const state = w.prunable ? t("gone") : w.dirty.length ? t("kept", { n: w.dirty.length }) : t("leftover");
    const files = !w.prunable && w.changed.length ? btn("cdv-a", "codevs-files", w.key, t("files"), "☰") : "";
    const clean = wts && wts.cleanable(w) ? btn("cdv-x", "codevs-cleanup", w.key, t("cleanup"), "⌫") : "";
    return `<span class="cdv-card st-kept" title="${esc(t("keptTitle", { key: w.key, path: w.path }))}"><span class="cdv-pick"><span class="cc-dot done"></span><span class="cdv-l notr">${esc(w.key)}</span><span class="cdv-wt notr">${esc(branchLabel(w))}</span><span class="cdv-m">${esc(state)}</span></span>${files}${clean}</span>`;
  }

  function render(): void {
    const slots = sessions.slots();
    const queued = sessions.queued();
    const kept = wts ? wts.kept() : [];
    let host = document.getElementById(ID);
    if (slots.length < 2 && !queued.length && !kept.length && !slots.some((s) => s.worktree)) {
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
        .join("") +
      kept.map(keptHtml).join("");
    // o tempo dos que trabalham anda sozinho
    if (!stopTick) stopTick = opts.every(1000, () => { if (sessions.slots().some((s) => s.running)) render(); });
  }

  /** «Ficheiros»: os que a worktree da issue mudou; escolher um abre-o só de leitura. */
  function files(key: string): void {
    if (!wts || !opts.pick) return;
    const w = wts.of(key);
    const changed = w?.changed ?? [];
    opts.pick(
      branchLabel(w ?? { branch: null }) + " · " + key,
      changed.map((c) => ({ label: c.path, detail: c.status, run: () => void wts.openFile(key, c.path) })),
    );
  }

  // as worktrees e as reservas relêem-se quando há mais de um Co-Dev, ou worktrees (com um só, nada muda)
  sessions.onChange(() => {
    render();
    const s = sessions.slots();
    if (wts && (s.length > 1 || s.some((x) => x.worktree) || wts.listed().length)) void wts.refresh();
  });
  map.onChange(() => { if (document.getElementById(ID)) render(); });
  wts?.onChange(render);

  const actions: ActionTable = {
    "codevs-pick": { on: "click", run: (e) => sessions.select(Number(e.on)) },
    "codevs-close": { on: "click", run: (e) => sessions.close(Number(e.on)) },
    "codevs-unqueue": { on: "click", run: (e) => sessions.unqueue(e.on) },
    "codevs-files": { on: "click", run: (e) => { void wts?.refresh().then(() => files(e.on)); } },
    "codevs-commit": { on: "click", run: (e) => void wts?.commit(e.on) },
    "codevs-cleanup": { on: "click", run: (e) => void wts?.cleanup(e.on) },
  };

  return { render, actions: (): ActionTable => actions };
}

export type CodevsView = ReturnType<typeof makeCodevsView>;
