/* ═══════════ Co-Dev — ui: o mapa de agentes (modal) ═══════════
   Dono do DOM de `#agent-map`: a sessão da conversa num cartão à esquerda, ligada por linhas à
   coluna dos seus agentes à direita (sub-agentes `task` e, numa sprint, as outras sessões Co-Dev
   com os sub-agentes delas por baixo). Cada cartão: ponto de estado (verde a correr, cinzento
   concluído, vermelho falhou), rótulo, tempo e tokens. Clicar num cartão mostra o detalhe: o que
   lhe pediram, estado, ferramentas, a última resposta ou relatório, tokens e custo.

   Os cliques passam pela tabela delegada da feature (`data-action`/`data-on`); só o Esc tem um
   listener próprio, enquanto o modal está aberto. Não toca no `window` (regra A8). */

import { esc } from "../../../core";
import type { ActionTable } from "./actions";
import type { AgentMapStore } from "../application/agent-map";
import { findCard, formatElapsed, formatTokens, elapsedOf, sessionUsage, sessionLabel, type MapCard, type ToolRun } from "../domain/agent-map";
import { costUSD } from "../domain/pricing";
import type { Usage } from "../domain/agent-events";
import { translator } from "../../../app/i18n";
import { AGENT_MAP_MESSAGES } from "./agent-map-messages";

const t = translator(AGENT_MAP_MESSAGES);

export interface AgentMapViewOptions {
  /** O nome da raiz (o assistente da conversa). */
  base(): string;
  /** Leva à conversa (fecha o mapa e põe o foco no chat). */
  showInChat(): void;
  /** Abre o separador «Co-Dev run» (o turno da sessão da conversa, passo a passo). */
  openRun(): void;
  /** Milissegundos desde a época. */
  now(): number;
  every(ms: number, f: () => void): () => void;
}

const ID = "agent-map";
const ESC_KEY = "__agentMapEsc__";

const dot = (s: MapCard["status"]): string => `<span class="cc-dot ${s === "running" ? "live" : s === "failed" ? "error" : "done"}"></span>`;

function cardHtml(c: MapCard, sel: string | null): string {
  const meta = `${formatElapsed(c.elapsedMs)} · ${t("tokens", { n: formatTokens(c.tokens) })}`;
  return `<button class="agmap-card st-${c.status}${sel === c.key ? " sel" : ""}" data-action="agmap-pick" data-on="${esc(c.key)}" title="${esc(c.label)} · ${esc(t(c.status))}">${dot(c.status)}<span class="agmap-l notr">${esc(c.label)}</span><span class="agmap-m">${esc(meta)}</span></button>`;
}

function toolsHtml(tools: ToolRun[]): string {
  if (!tools.length) return `<p class="agmap-none">${esc(t("noTools"))}</p>`;
  const mark = (s: ToolRun["status"]): string => (s === "ok" ? "✓" : s === "error" ? "✗" : "…");
  return `<ul class="agmap-tools">${tools
    .slice(-12)
    .map((x) => `<li class="${x.status}"><span class="agmap-tm">${mark(x.status)}</span><code>${esc(x.name)}</code><span class="notr">${esc(x.label)}</span></li>`)
    .join("")}</ul>`;
}

function usageHtml(model: string, u: Usage): string {
  const row = (k: string, v: string): string => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  const cost = costUSD(model, u);
  return (
    row(t("tokensIn"), formatTokens(u.input_tokens)) +
    row(t("tokensOut"), formatTokens(u.output_tokens)) +
    row(t("cacheRead"), formatTokens(u.cache_read_input_tokens)) +
    row(t("cacheWrite"), formatTokens(u.cache_creation_input_tokens)) +
    row(t("cost"), cost === null ? t("costUnknown") : `$${cost.toFixed(cost < 0.01 ? 4 : cost < 1 ? 3 : 2)}`)
  );
}

const clip = (s: string, n: number): string => (s.length > n ? "…" + s.slice(-n) : s);

export function makeAgentMapView(store: AgentMapStore, opts: AgentMapViewOptions) {
  let sel: string | null = null;
  let stopTick: (() => void) | null = null;
  let offChange: (() => void) | null = null;

  const host = (): HTMLElement | null => document.getElementById(ID);

  function detailHtml(): string {
    if (!sel) return `<p class="agmap-hint">${esc(t("pick"))}</p>`;
    const f = findCard(store.snapshot(), sel);
    if (!f) return `<p class="agmap-hint">${esc(t("gone"))}</p>`;
    const { session, agent } = f;
    const now = opts.now();
    const primary = store.primary();
    const ownChat = session.id === primary;
    const label = agent ? agent.label || agent.role : sessionLabel(session, opts.base());
    const status = agent ? agent.status : session.status;
    const kind = agent ? t("subagentKind", { role: agent.role }) : t("sessionKind");
    const asked = agent ? agent.prompt : session.request;
    const usage = agent ? agent.usage : sessionUsage(session);
    const elapsed = formatElapsed(elapsedOf(agent ?? session, now));
    const output = agent ? agent.summary : session.lastText;
    const row = (k: string, v: string): string => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
    const links = ownChat
      ? `<div class="agmap-links"><button class="agmap-link" data-action="agmap-chat">${esc(t("showInChat"))}</button><button class="agmap-link" data-action="agmap-run">${esc(t("openRun"))}</button></div>`
      : "";
    return `<div class="agmap-dh">${dot(status)}<div><b class="notr">${esc(label)}</b><small>${esc(kind)}</small></div></div>
<dl class="agmap-kv">${row(t("status"), t(status))}${session.model ? `<dt>${esc(t("model"))}</dt><dd class="notr">${esc(session.model)}</dd>` : ""}${row(t("elapsed"), elapsed)}${usageHtml(session.model, usage)}</dl>
${!agent && session.outcome ? `<p class="agmap-out">${esc(t("ended", { o: session.outcome }))}</p>` : ""}
<h4>${esc(t("asked"))}</h4>${asked ? `<pre class="agmap-pre">${esc(clip(asked, 2000))}</pre>` : `<p class="agmap-none">${esc(t("nothingAsked"))}</p>`}
<h4>${esc(t("tools", { n: (agent ?? session).tools.length }))}</h4>${toolsHtml((agent ?? session).tools)}
<h4>${esc(t(agent ? "report" : "lastOutput"))}</h4>${output ? `<pre class="agmap-pre">${esc(clip(output, 1500))}</pre>` : `<p class="agmap-none">${esc(t("noOutput"))}</p>`}
${links}`;
  }

  function treeHtml(): string {
    const v = store.view(opts.base());
    // os sub-agentes de uma sessão que não é a raiz ficam agrupados por baixo dela
    const groups: string[] = [];
    for (let i = 0; i < v.cards.length; i++) {
      const c = v.cards[i];
      const kids: string[] = [];
      while (i + 1 < v.cards.length && v.cards[i + 1].depth === 1) kids.push(cardHtml(v.cards[++i], sel));
      groups.push(`<div class="agmap-row">${cardHtml(c, sel)}${kids.length ? `<div class="agmap-sub">${kids.map((k) => `<div class="agmap-row">${k}</div>`).join("")}</div>` : ""}</div>`);
    }
    const right = groups.length ? `<div class="agmap-col">${groups.join("")}</div>` : `<p class="agmap-empty">${esc(t("empty"))}</p>`;
    return `<div class="agmap-tree${groups.length ? "" : " solo"}"><div class="agmap-rootcol">${cardHtml(v.root, sel)}</div>${right}</div>`;
  }

  function headerText(): string {
    const v = store.view(opts.base());
    const n = v.cards.length;
    const base = n === 0 ? t("headerNone") : n === 1 ? t("headerOne") : t("header", { n });
    return v.working ? `${base} · ${t("working", { n: v.working })}` : base;
  }

  function render(): void {
    const h = host();
    if (!h) return;
    const d = h.querySelector<HTMLElement>(".agmap-detail");
    const scroll = d ? d.scrollTop : 0;
    h.querySelector(".agmap-sub-h")!.textContent = headerText();
    h.querySelector(".agmap-body")!.innerHTML = `<div class="agmap-main">${treeHtml()}</div><aside class="agmap-detail${sel ? " on" : ""}">${detailHtml()}</aside>`;
    const nd = h.querySelector<HTMLElement>(".agmap-detail");
    if (nd) nd.scrollTop = scroll;
  }

  function open(): void {
    if (host()) return render();
    const el = document.createElement("div");
    el.id = ID;
    el.className = "agmap-back";
    el.dataset.action = "agmap-backdrop";
    // o modal pára a procura do `[data-action]`: só um clique no fundo escuro chega ao fundo
    el.innerHTML = `<div class="agmap" data-action="agmap-stay" role="dialog" aria-modal="true" aria-labelledby="agmap-t" tabindex="-1">
  <header class="agmap-h"><div class="agmap-ht"><b id="agmap-t">${esc(t("title"))}</b><span class="agmap-sub-h"></span></div><button class="agmap-x" data-action="agmap-close" title="${esc(t("close"))}" aria-label="${esc(t("close"))}">✕</button></header>
  <div class="agmap-body"></div>
</div>`;
    document.body.appendChild(el);
    render();
    (el.querySelector(".agmap") as HTMLElement).focus();
    const doc = document as Document & { [ESC_KEY]?: EventListener };
    if (doc[ESC_KEY]) document.removeEventListener("keydown", doc[ESC_KEY]!, true);
    const onKey: EventListener = (ev) => {
      if ((ev as KeyboardEvent).key !== "Escape" || !host()) return;
      ev.preventDefault();
      ev.stopPropagation();
      close();
    };
    doc[ESC_KEY] = onKey;
    document.addEventListener("keydown", onKey, true);
    offChange = store.onChange(render);
    // o tempo dos que correm anda sozinho
    stopTick = opts.every(1000, () => {
      if (store.view(opts.base()).working || store.snapshot().sessions.some((s) => s.status === "running")) render();
    });
    void store.refresh();
  }

  function close(): void {
    host()?.remove();
    sel = null;
    stopTick?.();
    stopTick = null;
    offChange?.();
    offChange = null;
    const doc = document as Document & { [ESC_KEY]?: EventListener };
    if (doc[ESC_KEY]) {
      document.removeEventListener("keydown", doc[ESC_KEY]!, true);
      delete doc[ESC_KEY];
    }
  }

  const actions: ActionTable = {
    "agmap-open": { on: "click", run: () => open() },
    "agmap-close": { on: "click", run: () => close() },
    // clicar no fundo escuro (fora do modal) fecha; dentro do modal, fora dos botões, nada
    "agmap-backdrop": { on: "click", run: () => close() },
    "agmap-stay": { on: "click", run: () => undefined },
    "agmap-pick": {
      on: "click",
      run: (e) => {
        sel = sel === e.on ? null : e.on;
        render();
      },
    },
    "agmap-chat": {
      on: "click",
      run: () => {
        close();
        opts.showInChat();
      },
    },
    "agmap-run": {
      on: "click",
      run: () => {
        close();
        opts.openRun();
      },
    },
  };

  return { open, close, isOpen: (): boolean => !!host(), actions: (): ActionTable => actions, selected: (): string | null => sel };
}

export type AgentMapView = ReturnType<typeof makeAgentMapView>;
