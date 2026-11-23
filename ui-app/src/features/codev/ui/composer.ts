/* ═══════════ Co-Dev — ui: o compositor da conversa (estilo chat do Claude) ═══════════
   Dono do DOM de `#ag-compose`: anexos em chips, caixa de texto com microfone, barra
   inferior (＋ anexar, / acções, assistente, contexto, sub-agentes, modelo+esforço,
   modo, enviar/parar) e os popovers de cada botão. Enquanto o agente trabalha, Enter
   põe a mensagem na fila e o botão de enviar passa a parar.

   Não toca no `window` (regra A8): o mundo chega pelo `ComposerHost`, montado no resíduo
   `features/codev.ts`, que tem o bridge à mão. Os cliques passam pela tabela de acções
   delegada da feature (`composerActions` → `data-action`/`data-on`); só o teclado da
   caixa de texto e o fecho dos popovers têm listeners próprios, no `mountComposer`. */

import { esc } from "../../../core";
import type { ActionTable } from "./actions";
import {
  EFFORTS,
  EFFORT_LABEL,
  MODEL_CATALOG,
  MODE_OPTIONS,
  SLASH_ACTIONS,
  buildPrompt,
  filterActions,
  formatSize,
  isTextFile,
  modelLabel,
  nextMode,
  supportsEffort,
  type Attachment,
  type ComposerMode,
  type Effort,
  type SlashAction,
} from "../domain/composer";

/* ───── o que o compositor precisa do resto da app ───── */

export interface ProviderChoice {
  key: string;
  name: string;
  model: string;
  on: boolean;
}

export interface SpeechLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

export interface ComposerHost {
  /** Envia um pedido (o `handlePrompt` da feature: slash commands, missões, agente). */
  send(q: string): void;
  /** Pára a execução em curso (o botão enviar vira parar). */
  stop(): void;
  running(): boolean;
  /** Modo de aprovação actual (`manual`/`assist`/`auto`). */
  mode(): string;
  setMode(m: string): void;
  provider(): string;
  model(): string;
  providers(): ProviderChoice[];
  selectModel(provider: string, model: string): void;
  effort(): Effort;
  setEffort(e: Effort): void;
  ctxOn(): boolean;
  toggleCtx(): void;
  projectFiles(): string[];
  palette(ph: string, items: Array<{ l: string; d?: string; run: () => void }>): void;
  newChat(): void;
  exportConversation(): void;
  toast(m: string): void;
  /** O reconhecimento de voz do motor web, se existir (o WebKitGTK não o tem). */
  speech(): (new () => SpeechLike) | null;
}

/* ───── ícones próprios do compositor (16×16, traço, como os do `svg()` do core) ───── */

const P: Record<string, string> = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  slash: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M9.5 5 6.5 11"/>',
  mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none"/>',
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 11v2h10v-2"/>',
  at: '<circle cx="8" cy="8" r="2.4"/><path d="M10.4 8v1a1.8 1.8 0 0 0 3.6 0V8A6 6 0 1 0 11 13.2"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  close: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  hand: '<path d="M5.5 8V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v5c0 3-1.6 5-4.2 5-1.8 0-2.8-1-3.8-2.6L2.2 9a1 1 0 0 1 1.7-1l1.6 1.6"/>',
  shield: '<path d="M8 2 3 4v3.5C3 10.8 5.2 13 8 14c2.8-1 5-3.2 5-6.5V4z"/>',
  plan: '<path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5"/>',
  bolt: '<path d="M9 1.8 3.5 9H8l-1 5.2L12.5 7H8z"/>',
  agents: '<circle cx="8" cy="4" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M8 5.8v2.4M8 8.2 4.4 10.5M8 8.2l3.6 2.3"/>',
};
const icon = (n: string, cls = ""): string =>
  `<svg class="ico cc-ico${cls ? " " + cls : ""}" viewBox="0 0 16 16" aria-hidden="true">${P[n] ?? ""}</svg>`;
const MODE_ICON: Record<ComposerMode, string> = { manual: "hand", assist: "shield", plan: "plan", auto: "bolt" };

/* ───── estado do compositor ───── */

interface Subagent {
  id: string;
  label: string;
  state: "running" | "done" | "error";
}

let host: ComposerHost | null = null;
let attachments: Attachment[] = [];
let queue: string[] = [];
let planNext = false;
let open: "" | "plus" | "slash" | "model" | "mode" | "agents" = "";
let slashFilter = "";
let slashSel = 0;
let subagents: Subagent[] = [];
let recog: SpeechLike | null = null;
let attSeq = 0;

const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const input = (): HTMLTextAreaElement | null => el<HTMLTextAreaElement>("ag-input");

/* ───── markup ───── */

/** A estrutura do compositor (substitui o conteúdo de `#ag-compose`). Mantém os ids que o
 *  resto da app usa: `#ag-input`, `.comp-bar` (onde o `app.ts` põe `#pill-agent`), `#pill-ctx`. */
function skeleton(): string {
  return `<div class="composer cc" id="cc">
  <div class="cc-pop" id="cc-pop" hidden></div>
  <div class="cc-atts" id="cc-atts" hidden><button class="cc-att cc-ctx" id="pill-ctx" hidden title="Ficheiro activo como contexto (clica para ligar/desligar)" data-action="cc-ctx"></button><span class="cc-attl" id="cc-attl"></span></div>
  <div class="cc-in">
    <textarea id="ag-input" rows="1" placeholder="Pede ao Co-Dev…"></textarea>
    <button class="cc-ib cc-mic" id="cc-mic" title="Ditar (voz)" data-action="cc-mic">${icon("mic")}</button>
  </div>
  <div class="cc-bar">
    <button class="cc-ib" id="cc-plus" title="Anexar e contexto" data-action="cc-open" data-on="plus">${icon("plus")}</button>
    <button class="cc-ib" id="cc-slash" title="Acções ( / )" data-action="cc-open" data-on="slash">${icon("slash")}</button>
    <span class="comp-bar cc-chips"></span>
    <button class="cc-chip" id="cc-agents" title="Sub-agentes desta conversa" data-action="cc-open" data-on="agents"></button>
    <span class="cc-q" id="cc-queue" hidden></span>
    <span class="cc-sp"></span>
    <button class="cc-chip cc-model" id="cc-model" title="Modelo e esforço" data-action="cc-open" data-on="model"></button>
    <button class="cc-mode" id="cc-mode" title="Modo (Shift+Tab muda)" data-action="cc-open" data-on="mode"></button>
    <button class="cc-send" id="cc-send" title="Enviar (Enter)" data-action="cc-send">${icon("up")}</button>
  </div>
  <input type="file" id="cc-file" multiple hidden data-action="cc-file">
</div>`;
}

function currentMode(): ComposerMode {
  if (planNext) return "plan";
  const m = host?.mode() ?? "assist";
  return m === "manual" || m === "auto" ? m : "assist";
}

/** Redesenha a barra (chips de modelo/modo/agentes/fila, botão enviar/parar, placeholder). */
export function refreshComposer(): void {
  if (!host) return;
  const running = host.running();
  const prov = host.provider();
  const model = el("cc-model");
  if (model) {
    const eff = supportsEffort(prov) ? ` <span class="cc-dim">${EFFORT_LABEL[host.effort()]}</span>` : "";
    model.innerHTML = `${esc(modelLabel(prov, host.model()))}${eff}`;
  }
  const mode = el("cc-mode");
  if (mode) {
    const m = currentMode();
    const o = MODE_OPTIONS.find((x) => x.id === m)!;
    mode.innerHTML = `${icon(MODE_ICON[m])}<span>${o.label}</span>`;
    mode.classList.toggle("on", open === "mode");
  }
  const ag = el("cc-agents");
  if (ag) {
    const live = subagents.filter((s) => s.state === "running").length;
    ag.innerHTML = `<span class="cc-dot${live ? " live" : ""}"></span><span class="cc-agn">${live}</span><span class="cc-agl">${live} ${live === 1 ? "agente" : "agentes"}</span>`;
  }
  const q = el("cc-queue");
  if (q) {
    q.hidden = !queue.length;
    q.textContent = queue.length ? `${queue.length} na fila` : "";
  }
  const send = el("cc-send");
  if (send) {
    send.innerHTML = icon(running ? "stop" : "up");
    send.classList.toggle("stop", running);
    send.title = running ? "Parar" : "Enviar (Enter)";
  }
  const i = input();
  if (i) i.placeholder = running ? "Põe outra mensagem na fila…" : planNext ? "O que queres planear?" : "Pede ao Co-Dev…";
  for (const k of ["plus", "slash", "model", "agents"]) el("cc-" + k)?.classList.toggle("on", open === k);
}

function renderAttachments(): void {
  const box = el("cc-atts");
  const list = el("cc-attl");
  if (!box || !list) return;
  box.hidden = !attachments.length && !!el("pill-ctx")?.hidden;
  list.innerHTML = attachments
    .map(
      (a) =>
        `<span class="cc-att" title="${esc(a.path ?? a.name)}">${icon(a.kind === "mention" ? "at" : "file")}<b>${esc(a.name)}</b>${
          a.size !== undefined ? `<small>${formatSize(a.size)}</small>` : ""
        }<button class="cc-x" title="Remover" data-action="cc-unattach" data-on="${esc(a.id)}">${icon("close")}</button></span>`,
    )
    .join("");
}

/** O ficheiro activo do editor mudou (o `ctxPill` da conversa): o chip de contexto da
 *  linha dos anexos aparece só com um ficheiro aberto. */
export function composerContext(file: string | null): void {
  const chip = el("pill-ctx");
  if (!chip) return;
  chip.hidden = !file;
  renderAttachments();
}

/* ───── popovers ───── */

function popItem(action: string, on: string, title: string, desc = "", opts: { check?: boolean; ic?: string; hint?: string; sel?: boolean; off?: boolean } = {}): string {
  return `<button class="cc-it${opts.sel ? " sel" : ""}${opts.off ? " off" : ""}" data-action="${action}" data-on="${esc(on)}">${opts.ic ? icon(opts.ic, "cc-it-ic") : ""}<span class="cc-it-t"><span>${esc(title)}</span>${
    desc ? `<small>${esc(desc)}</small>` : ""
  }</span>${opts.hint ? `<kbd>${esc(opts.hint)}</kbd>` : ""}${opts.check ? icon("check", "cc-ok") : ""}</button>`;
}

function effortRow(): string {
  if (!host) return "";
  const cur = host.effort();
  const dots = EFFORTS.map(
    (e, i) => `<button class="cc-ed${EFFORTS.indexOf(cur) >= i ? " on" : ""}${e === cur ? " cur" : ""}" title="${EFFORT_LABEL[e]}" data-action="cc-effort" data-on="${e}"></button>`,
  ).join("");
  const ok = supportsEffort(host.provider());
  return `<div class="cc-row${ok ? "" : " off"}"><span>Esforço <span class="cc-dim">(${ok ? EFFORT_LABEL[cur] : "só Claude"})</span></span><span class="cc-eff">${dots}</span></div>`;
}

function popMarkup(): string {
  if (!host) return "";
  switch (open) {
    case "plus":
      return `<div class="cc-menu cc-small">${popItem("cc-do", "attach", "Carregar do computador", "Ficheiros de texto ou código", { ic: "upload" })}${popItem(
        "cc-do",
        "mention",
        "Mencionar ficheiro do projecto",
        "O agente lê-o antes de responder",
        { ic: "at" },
      )}${popItem("cc-ctx", "", "Incluir o ficheiro activo", "Contexto do editor", { ic: "file", check: host.ctxOn() })}</div>`;
    case "slash": {
      const list = filterActions(SLASH_ACTIONS, slashFilter);
      slashSel = Math.min(slashSel, Math.max(0, list.length - 1));
      let g = "";
      const rows = list
        .map((a, i) => {
          const head = a.group !== g ? `<div class="cc-gh">${(g = a.group)}</div>` : "";
          if (a.id === "effort") return head + effortRow();
          const right = a.id === "model" ? modelLabel(host!.provider(), host!.model()) : a.hint;
          return head + popItem("cc-do", a.id, a.label, "", { hint: right, sel: i === slashSel });
        })
        .join("");
      return `<div class="cc-menu"><input class="cc-filter" id="cc-filter" placeholder="Filtrar acções…" value="${esc(slashFilter)}" autocomplete="off"><div class="cc-list">${
        rows || '<div class="cc-empty">Nenhuma acção</div>'
      }</div></div>`;
    }
    case "model": {
      const prov = host.provider();
      const cur = host.model();
      const rows: string[] = [];
      for (const p of host.providers()) {
        const cat = MODEL_CATALOG[p.key] ?? [{ id: p.model, label: p.model, desc: "Modelo configurado nas Definições" }];
        const known = cat.some((m) => m.id === p.model);
        const items = known ? cat : [{ id: p.model, label: modelLabel(p.key, p.model), desc: "Configurado nas Definições" }, ...cat];
        rows.push(`<div class="cc-gh">${esc(p.name)}${p.on ? "" : " · desligado"}</div>`);
        for (const m of items) {
          const sel = p.key === prov && m.id === cur;
          const desc = (m as { recommended?: boolean }).recommended ? `${m.desc} · recomendado` : m.desc;
          rows.push(popItem("cc-model", `${p.key}|${m.id}`, m.label, desc, { check: sel, sel, off: !p.on }));
        }
      }
      return `<div class="cc-menu"><div class="cc-gh cc-title">Escolhe um modelo</div><div class="cc-list">${rows.join("")}</div>${effortRow()}<div class="cc-foot">O esforço vale para novas conversas.</div></div>`;
    }
    case "mode": {
      const cur = currentMode();
      return `<div class="cc-menu cc-modes"><div class="cc-gh cc-title">Modos<span class="cc-keys"><kbd>⇧</kbd>+<kbd>tab</kbd> muda</span></div>${MODE_OPTIONS.map((m) =>
        popItem("cc-mode", m.id, m.label, m.desc, { ic: MODE_ICON[m.id], check: m.id === cur, sel: m.id === cur }),
      ).join("")}${effortRow()}</div>`;
    }
    case "agents": {
      const rows = subagents.length
        ? subagents
            .map((s) => `<div class="cc-ag"><span class="cc-dot ${s.state === "running" ? "live" : s.state}"></span><span>${esc(s.label)}</span><small>${s.state === "running" ? "a investigar…" : s.state === "done" ? "concluído" : "falhou"}</small></div>`)
            .join("")
        : '<div class="cc-empty">Ainda sem sub-agentes nesta conversa. O agente lança-os (ferramenta <code>task</code>) para investigar em paralelo, só com leitura.</div>';
      return `<div class="cc-menu cc-small"><div class="cc-gh cc-title">Mapa de agentes</div><div class="cc-ag cc-main"><span class="cc-dot live"></span><b>Co-Dev</b><small>${esc(
        modelLabel(host.provider(), host.model()),
      )}</small></div><div class="cc-tree">${rows}</div></div>`;
    }
    default:
      return "";
  }
}

function renderPop(): void {
  const pop = el("cc-pop");
  if (!pop) return;
  pop.hidden = !open;
  pop.dataset.kind = open;
  pop.innerHTML = popMarkup();
  refreshComposer();
  if (open === "slash") {
    const f = el<HTMLInputElement>("cc-filter");
    if (f) {
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    }
  }
}

function toggle(kind: typeof open): void {
  open = open === kind ? "" : kind;
  if (open === "slash") slashSel = 0;
  renderPop();
}

function close(): void {
  if (!open) return;
  open = "";
  slashFilter = "";
  renderPop();
}

/* ───── envio, fila e anexos ───── */

function autosize(): void {
  const i = input();
  if (!i) return;
  i.style.height = "auto";
  i.style.height = Math.min(i.scrollHeight, 220) + "px";
}

/** Enter: envia, ou põe na fila se o agente estiver a trabalhar. */
export function submit(): void {
  const i = input();
  if (!host || !i) return;
  const text = i.value.trim();
  if (!text) return;
  let q = buildPrompt(text, attachments);
  if (planNext && !q.startsWith("/")) q = "/plano " + q;
  i.value = "";
  autosize();
  if (!q.startsWith("/")) {
    attachments = [];
    renderAttachments();
  }
  planNext = false;
  if (host.running()) {
    queue.push(q);
    refreshComposer();
    return;
  }
  host.send(q);
  refreshComposer();
}

/** Fim de uma execução: actualiza a barra e envia a próxima mensagem da fila. */
export function composerRunChanged(running: boolean): void {
  refreshComposer();
  if (!running && host && queue.length) {
    const next = queue.shift()!;
    setTimeout(() => {
      if (host && !host.running()) host.send(next);
      refreshComposer();
    }, 0);
  }
}

function addMention(path: string): void {
  if (attachments.some((a) => a.path === path)) return;
  attachments.push({ id: "a" + ++attSeq, kind: "mention", name: path.split("/").pop() || path, path });
  renderAttachments();
}

function readFiles(list: FileList | null): void {
  if (!list || !host) return;
  for (const f of Array.from(list)) {
    if (!isTextFile(f.name, f.type)) {
      host.toast(`${f.name}: o agente ainda só recebe ficheiros de texto`);
      continue;
    }
    const r = new FileReader();
    r.onload = () => {
      attachments.push({ id: "a" + ++attSeq, kind: "file", name: f.name, content: String(r.result ?? ""), size: f.size });
      renderAttachments();
    };
    r.readAsText(f);
  }
}

/* ───── microfone ───── */

function toggleMic(): void {
  if (!host) return;
  const btn = el("cc-mic");
  if (recog) {
    recog.stop();
    return;
  }
  const Ctor = host.speech();
  if (!Ctor) {
    host.toast("Ditado indisponível: o motor web desta plataforma não tem reconhecimento de voz");
    return;
  }
  const i = input();
  const base = i ? i.value : "";
  const r = new Ctor();
  r.lang = "pt-PT";
  r.interimResults = true;
  r.continuous = true;
  r.onresult = (e) => {
    let text = "";
    for (let k = 0; k < e.results.length; k++) text += e.results[k][0].transcript;
    if (i) {
      i.value = (base ? base.trimEnd() + " " : "") + text.trim();
      autosize();
    }
  };
  r.onerror = (e) => {
    if (e.error === "not-allowed") host?.toast("Sem acesso ao microfone");
  };
  r.onend = () => {
    recog = null;
    btn?.classList.remove("rec");
  };
  recog = r;
  btn?.classList.add("rec");
  r.start();
}

/* ───── acções (entram na tabela delegada da feature) ───── */

function doAction(id: string): void {
  if (!host) return;
  const h = host;
  close();
  switch (id) {
    case "attach":
      el<HTMLInputElement>("cc-file")?.click();
      return;
    case "mention": {
      const files = h.projectFiles();
      if (!files.length) {
        h.toast("Abre uma pasta para mencionar ficheiros");
        return;
      }
      h.palette("Mencionar ficheiro…", files.map((p) => ({ l: p.split("/").pop() || p, d: p, run: () => addMention(p) })));
      return;
    }
    case "clear":
      h.newChat();
      return;
    case "export":
      h.exportConversation();
      return;
    case "model":
    case "effort":
      toggle("model");
      return;
    case "plan":
      planNext = true;
      refreshComposer();
      input()?.focus();
      return;
    case "rewind":
      h.send("/reverter");
      return;
    case "resume":
      h.send("/retomar");
      return;
    case "commands":
      h.send("/comandos");
      return;
    case "test":
    case "lint":
      h.send("/" + id);
      return;
  }
}

function setComposerMode(m: string): void {
  if (!host) return;
  if (m === "plan") planNext = true;
  else {
    planNext = false;
    if (m !== host.mode()) host.setMode(m);
  }
  close();
  refreshComposer();
}

export function composerActions(): ActionTable {
  return {
    "cc-open": { on: "click", run: (e) => toggle(e.on as typeof open) },
    "cc-send": {
      on: "click",
      run: () => {
        if (host?.running()) host.stop();
        else submit();
      },
    },
    "cc-do": { on: "click", run: (e) => doAction(e.on) },
    "cc-ctx": {
      on: "click",
      run: () => {
        host?.toggleCtx();
        if (open === "plus") renderPop();
      },
    },
    "cc-mode": { on: "click", run: (e) => setComposerMode(e.on) },
    "cc-model": {
      on: "click",
      run: (e) => {
        const [p, m] = e.on.split("|");
        const choice = host?.providers().find((x) => x.key === p);
        if (!host || !choice) return;
        if (!choice.on) {
          host.toast(`${choice.name} está desligado — liga-o nas Definições`);
          return;
        }
        host.selectModel(p, m);
        close();
      },
    },
    "cc-effort": {
      on: "click",
      run: (e) => {
        host?.setEffort(e.on as Effort);
        renderPop();
      },
    },
    "cc-unattach": {
      on: "click",
      run: (e) => {
        attachments = attachments.filter((a) => a.id !== e.on);
        renderAttachments();
      },
    },
    "cc-file": {
      on: "change",
      run: (e) => {
        readFiles((e.el as HTMLInputElement).files);
        (e.el as HTMLInputElement).value = "";
      },
    },
    "cc-mic": { on: "click", run: () => toggleMic() },
  };
}

/* ───── montagem ───── */

function onKey(ev: KeyboardEvent): void {
  const i = input();
  if (!host || !i) return;
  if (ev.key === "Tab" && ev.shiftKey) {
    ev.preventDefault();
    setComposerMode(nextMode(currentMode()));
    host.toast("Modo " + MODE_OPTIONS.find((m) => m.id === currentMode())!.label);
    return;
  }
  if (ev.key === "Escape" && open) {
    ev.preventDefault();
    close();
    return;
  }
  if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    submit();
  }
}

function onInput(): void {
  const i = input();
  autosize();
  // «/» numa caixa vazia abre o menu de acções
  if (i && i.value === "/") {
    i.value = "";
    slashFilter = "";
    open = "slash";
    slashSel = 0;
    renderPop();
  }
}

function onFilterKey(ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement | null;
  if (!t || t.id !== "cc-filter") return;
  const list = filterActions(SLASH_ACTIONS, slashFilter).filter((a: SlashAction) => a.id !== "effort");
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    slashSel = (slashSel + (ev.key === "ArrowDown" ? 1 : list.length - 1)) % Math.max(1, list.length);
    renderPop();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    const a = list[slashSel];
    if (a) doAction(a.id);
  } else if (ev.key === "Escape") {
    ev.preventDefault();
    close();
    input()?.focus();
  }
}

function onFilterInput(ev: Event): void {
  const t = ev.target as HTMLInputElement | null;
  if (!t || t.id !== "cc-filter") return;
  slashFilter = t.value;
  slashSel = 0;
  const pop = el("cc-pop");
  if (!pop) return;
  // redesenha só a lista (o campo mantém o foco e o cursor)
  const tmp = document.createElement("div");
  tmp.innerHTML = popMarkup();
  const fresh = tmp.querySelector(".cc-list");
  const cur = pop.querySelector(".cc-list");
  if (fresh && cur) cur.replaceWith(fresh);
}

const BOUND_KEY = "__codevComposerOutside__";

/** Monta o compositor dentro de `#ag-compose`. Idempotente (o harness reavalia a feature). */
export function mountComposer(h: ComposerHost): void {
  host = h;
  const root = el("ag-compose");
  if (!root) return;
  const keep = input()?.value ?? "";
  root.innerHTML = skeleton();
  const i = input()!;
  i.value = keep;
  i.addEventListener("keydown", onKey);
  i.addEventListener("input", onInput);
  i.addEventListener("paste", () => setTimeout(autosize, 0));
  const pop = el("cc-pop")!;
  pop.addEventListener("keydown", onFilterKey);
  pop.addEventListener("input", onFilterInput);
  // fora do compositor fecha o popover (um só listener no document, trocado a cada montagem)
  const doc = document as Document & { [BOUND_KEY]?: EventListener };
  if (doc[BOUND_KEY]) document.removeEventListener("mousedown", doc[BOUND_KEY]!);
  const outside: EventListener = (ev) => {
    const cc = el("cc");
    if (open && cc && !cc.contains(ev.target as Node)) close();
  };
  doc[BOUND_KEY] = outside;
  document.addEventListener("mousedown", outside);
  renderAttachments();
  refreshComposer();
}

/* ───── sub-agentes (a ferramenta `task` do agente v2) ───── */

export function trackSubagent(id: string, label: string, state: Subagent["state"]): void {
  const s = subagents.find((x) => x.id === id);
  if (s) {
    s.state = state;
    if (label) s.label = label;
  } else subagents.push({ id, label: label || "sub-agente", state });
  refreshComposer();
  if (open === "agents") renderPop();
}

/** Nova conversa: esquece os sub-agentes, a fila e o modo Plano pendente. */
export function resetComposer(): void {
  subagents = [];
  queue = [];
  planNext = false;
  refreshComposer();
}

/** Só para os testes: o estado interno. */
export const _composerState = () => ({ attachments, queue, planNext, open, subagents });
