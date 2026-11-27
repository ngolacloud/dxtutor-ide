/* ═══════════ Co-Dev — ui: o compositor da conversa (o padrão: o chat do Claude) ═══════════
   Dono do DOM de `#ag-compose`: anexos em chips, caixa de texto com microfone, barra
   inferior (＋ anexar, / acções, assistente, contexto, sub-agentes, modelo+esforço,
   modo, enviar/parar) e os popovers de cada botão. Enquanto o agente trabalha, Enter
   põe a mensagem na fila e o botão de enviar passa a parar. É o mesmo para todos os
   provedores: trocar de provedor muda só os modelos listados (os desse provedor) e o
   que ele suporta (o esforço é só do Claude). O microfone usa o whisper.cpp local no
   desktop (porta `DictationPort`) e o reconhecimento de voz do motor web no browser.

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
  DICTATION_LANGS,
  WRITE_PACES,
  buildPrompt,
  filterActions,
  formatSize,
  isTextFile,
  isImageFile,
  imagesOf,
  base64OfDataUrl,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  modelLabel,
  effectiveModel,
  nextMode,
  supportsEffort,
  type Attachment,
  type ComposerMode,
  type Effort,
  type SlashAction,
} from "../domain/composer";
import type { DictationPort } from "../application/ports";
import { bus } from "../../../app/bus";
import { translator } from "../../../app/i18n";
import { CODEV_CHAT_MESSAGES } from "./chat-messages";
import { AGENT_MAP_MESSAGES } from "./agent-map-messages";
import { CODEV_IMAGE_MESSAGES } from "./image-messages";

const tc = translator(CODEV_CHAT_MESSAGES);
const tm = translator(AGENT_MAP_MESSAGES);
const ti = translator(CODEV_IMAGE_MESSAGES);

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
  /** Envia um pedido (o `handlePrompt` da feature: slash commands, missões, agente); `images` (H5c): as imagens
   *  anexadas, em base64. */
  send(q: string, images?: Array<{ name: string; data: string }>): void;
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
  /** O assistente da conversa (Co-Dev/Tutor/…): escolher e redesenhar o chip. */
  pickPersona(): void;
  refreshPersona(): void;
  /** Definições dos modelos e provedores. */
  openModelSettings(): void;
  /** Trocar de provedor (a lista de modelos só mostra os do provedor activo). */
  switchProvider(): void;
  /** Ditado local com whisper.cpp (`null` = sem backend). */
  dictation(): DictationPort | null;
  /** A língua do ditado (`pt`, `en` ou `auto`) e escolhê-la. */
  dictationLang(): string;
  setDictationLang(l: string): void;
  /** RF-S02: the editor's writing pace (`slow`/`normal`/`fast`/`instant`). */
  writePace?(): string;
  setWritePace?(id: string): void;
  /** Os modelos instalados no Ollama local. */
  localModels(): Promise<string[]>;
}

/* ───── ícones próprios do compositor (16×16, traço, como os do `svg()` do core) ───── */

const P: Record<string, string> = {
  plus: '<path d="M8 3v10M3 8h10"/>',
  slash: '<rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M9.5 5 6.5 11"/>',
  mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.8 7.8a4.2 4.2 0 0 0 8.4 0M8 12v2"/>',
  up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  stop: '<rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor" stroke="none"/>',
  spin: '<path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5"/>',
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 11v2h10v-2"/>',
  at: '<circle cx="8" cy="8" r="2.4"/><path d="M10.4 8v1a1.8 1.8 0 0 0 3.6 0V8A6 6 0 1 0 11 13.2"/>',
  file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m3 12 3.5-3.5 2.5 2.5 2-2 2.5 2.5"/>',
  close: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  hand: '<path d="M5.5 8V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7V4a1 1 0 0 1 2 0v5c0 3-1.6 5-4.2 5-1.8 0-2.8-1-3.8-2.6L2.2 9a1 1 0 0 1 1.7-1l1.6 1.6"/>',
  shield: '<path d="M8 2 3 4v3.5C3 10.8 5.2 13 8 14c2.8-1 5-3.2 5-6.5V4z"/>',
  plan: '<path d="M4 2.5h6l2.5 2.5v8.5H4z"/><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5"/>',
  bolt: '<path d="M9 1.8 3.5 9H8l-1 5.2L12.5 7H8z"/>',
  chevr: '<path d="m6.5 4.5 3.5 3.5-3.5 3.5"/>',
  gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  agents: '<circle cx="8" cy="4" r="1.8"/><circle cx="3.5" cy="12" r="1.8"/><circle cx="12.5" cy="12" r="1.8"/><path d="M8 5.8v2.4M8 8.2 4.4 10.5M8 8.2l3.6 2.3"/>',
};
const icon = (n: string, cls = ""): string =>
  `<svg class="ico cc-ico${cls ? " " + cls : ""}" viewBox="0 0 16 16" aria-hidden="true">${P[n] ?? ""}</svg>`;
const MODE_ICON: Record<ComposerMode, string> = { manual: "hand", assist: "shield", plan: "plan", auto: "bolt" };

/* ───── estado do compositor ───── */


let host: ComposerHost | null = null;
let attachments: Attachment[] = [];
let queue: string[] = [];
let planNext = false;
let open: "" | "plus" | "slash" | "model" | "mode" = "";
/** Microfone: parado, a gravar (whisper ou motor web) ou a transcrever. */
let mic: "idle" | "rec" | "busy" = "idle";
/** Os modelos do Ollama (carregados ao abrir a lista com o Ollama activo). */
let ollamaList: string[] | null = null;
let slashFilter = "";
let slashSel = 0;
/** Quantos agentes trabalham agora (o mapa de agentes conta-os: `setAgentCount`). */
let agentCount = 0;
let recog: SpeechLike | null = null;
let attSeq = 0;

const el = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;
const input = (): HTMLTextAreaElement | null => el<HTMLTextAreaElement>("ag-input");

/* ───── markup ───── */

/** A estrutura do compositor (substitui o conteúdo de `#ag-compose`). Mantém os ids que o
 *  resto da app usa: `#ag-input`, `.comp-bar` (com o `#pill-agent`) e `#pill-ctx`. */
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
    <span class="comp-bar cc-chips"><button class="pill" id="pill-agent" title="Assistente da conversa" data-action="cc-persona"></button></span>
    <button class="cc-chip" id="cc-agents" title="${esc(tm("chipTitle"))}" data-action="agmap-open"></button>
    <span class="cc-q" id="cc-queue" hidden></span>
    <span class="cc-sp"></span>
    <button class="cc-chip cc-model" id="cc-model" title="Modelo" data-action="cc-open" data-on="model"></button>
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
    model.innerHTML = `${esc(modelLabel(prov, effectiveModel(host.model())))}${eff}`;
  }
  const mode = el("cc-mode");
  if (mode) {
    const m = currentMode();
    const o = MODE_OPTIONS.find((x) => x.id === m)!;
    mode.innerHTML = `${icon(MODE_ICON[m])}<span>${o.label}</span>`;
    mode.classList.toggle("on", open === "mode");
  }
  const micBtn = el("cc-mic");
  if (micBtn) {
    micBtn.classList.toggle("rec", mic === "rec");
    micBtn.classList.toggle("busy", mic === "busy");
    micBtn.innerHTML = icon(mic === "busy" ? "spin" : "mic");
    const lang = DICTATION_LANGS.find((l) => l.id === host?.dictationLang())?.label ?? "";
    micBtn.title = mic === "rec" ? "Parar e transcrever" : mic === "busy" ? "A transcrever…" : `Ditar (voz) — ${lang}`;
  }
  const ag = el("cc-agents");
  if (ag) {
    const live = agentCount;
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
  if (i)
    i.placeholder =
      mic === "rec"
        ? "A ouvir… clica no microfone para terminar"
        : mic === "busy"
          ? "A transcrever…"
          : running
            ? "Põe outra mensagem na fila…"
            : planNext
              ? "O que queres planear?"
              : "Pede ao Co-Dev…";
  for (const k of ["plus", "slash", "model"]) el("cc-" + k)?.classList.toggle("on", open === k);
}

function renderAttachments(): void {
  const box = el("cc-atts");
  const list = el("cc-attl");
  if (!box || !list) return;
  box.hidden = !attachments.length && !!el("pill-ctx")?.hidden;
  list.innerHTML = attachments
    .map(
      (a) =>
        `<span class="cc-att" title="${esc(a.path ?? a.name)}">${icon(a.kind === "mention" ? "at" : a.kind === "image" ? "image" : "file")}<b>${esc(a.name)}</b>${
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

function catalogOf(p: ProviderChoice): Array<{ id: string; label: string; desc: string; recommended?: boolean }> {
  const cat =
    p.key === "ollama" && ollamaList?.length
      ? ollamaList.map((id) => ({ id, label: id, desc: "Instalado no Ollama" }))
      : (MODEL_CATALOG[p.key] ?? []);
  const m = effectiveModel(p.model);
  return cat.some((x) => x.id === m) || !m ? cat : [{ id: m, label: modelLabel(p.key, m), desc: "Configurado nas Definições" }, ...cat];
}

/** Só os modelos do provedor activo, com descrição; trocar de provedor e as definições
 *  são entradas à parte. */
function modelCards(): string {
  if (!host) return "";
  const prov = host.provider();
  const cur = effectiveModel(host.model());
  const me = host.providers().find((p) => p.key === prov);
  const rows = me
    ? catalogOf(me).map((m) =>
        popItem("cc-model", `${prov}|${m.id}`, m.label, m.recommended ? `${m.desc} · recomendado` : m.desc, { check: m.id === cur, sel: m.id === cur }),
      )
    : [];
  const effort = supportsEffort(prov) ? `${effortRow()}<div class="cc-foot">O esforço vale para novas conversas.</div>` : "";
  const title = me ? `Modelos ${me.name}` : "Escolhe um modelo";
  const empty = !rows.length ? `<div class="cc-empty">${prov === "ollama" ? "Sem modelos instalados no Ollama (ex.: <code>ollama pull qwen2.5-coder</code>)." : "Sem modelos."}</div>` : "";
  return `<div class="cc-menu"><div class="cc-gh cc-title">${esc(title)}</div><div class="cc-list">${rows.join("")}${empty}</div>${effort}<div class="cc-sep"></div>${popItem(
    "cc-do",
    "providers",
    "Outros provedores…",
    "",
    { ic: "chevr" },
  )}${popItem("cc-do", "settings", "Definições de modelos", "", { ic: "gear" })}</div>`;
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
          const right =
            a.id === "model"
              ? modelLabel(host!.provider(), host!.model())
              : a.id === "dictlang"
                ? DICTATION_LANGS.find((l) => l.id === host!.dictationLang())?.label
                : a.hint;
          return head + popItem("cc-do", a.id, a.label, "", { hint: right, sel: i === slashSel });
        })
        .join("");
      return `<div class="cc-menu"><input class="cc-filter" id="cc-filter" placeholder="Filtrar acções…" value="${esc(slashFilter)}" autocomplete="off"><div class="cc-list">${
        rows || '<div class="cc-empty">Nenhuma acção</div>'
      }</div></div>`;
    }
    case "model":
      return modelCards();
    case "mode": {
      const cur = currentMode();
      return `<div class="cc-menu cc-modes"><div class="cc-gh cc-title">Modos<span class="cc-keys"><kbd>⇧</kbd>+<kbd>tab</kbd> muda</span></div>${MODE_OPTIONS.map((m) =>
        popItem("cc-mode", m.id, m.label, m.desc, { ic: MODE_ICON[m.id], check: m.id === cur, sel: m.id === cur }),
      ).join("")}${supportsEffort(host.provider()) ? effortRow() : ""}</div>`;
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
  // Ollama: a lista são os modelos instalados no servidor local
  if (open === "model" && host?.provider() === "ollama") {
    void host
      .localModels()
      .then((list) => {
        ollamaList = list;
        if (open === "model") renderPop();
      })
      .catch(() => undefined);
  }
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
  const images = imagesOf(attachments);
  // H5c: images wait for a turn of their own (the queue keeps text); a /command takes none
  if (images.length && host.running()) {
    host.toast(ti("imagesWait"));
    return;
  }
  if (images.length && q.startsWith("/")) host.toast(ti("imagesNotWithCommand"));
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
  if (images.length && !q.startsWith("/")) host.send(q, images);
  else host.send(q);
  refreshComposer();
}

/** Fim de uma execução: actualiza a barra e envia a próxima mensagem da fila. Ligado ao
 *  evento `agent:run` do bus (U3c); exportado também para os testes. */
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
bus.on("agent:run", ({ active }) => composerRunChanged(active));

/** `codev.ask` lands here: the context becomes removable chips, the question goes into the
 *  box, and with `send` it is sent as if the human pressed Enter. */
export function composerAsk(text: string, context: Array<{ kind: string; label: string; text?: string; path?: string }>, send: boolean): void {
  for (const c of context) {
    if (c.kind === "file" && c.path && !c.text) {
      addMention(c.path);
      continue;
    }
    if (attachments.some((a) => a.kind === "snippet" && a.name === c.label && a.content === (c.text ?? ""))) continue;
    attachments.push({ id: "a" + ++attSeq, kind: "snippet", name: c.label, content: c.text ?? "", path: c.path, context: c.kind });
  }
  renderAttachments();
  const i = input();
  if (!i) return;
  if (text) i.value = text;
  autosize();
  i.focus();
  if (send && i.value.trim()) submit();
}

function addMention(path: string): void {
  if (attachments.some((a) => a.path === path)) return;
  attachments.push({ id: "a" + ++attSeq, kind: "mention", name: path.split("/").pop() || path, path });
  renderAttachments();
}

/** H5c: an image file becomes an image attachment (PNG/JPEG/GIF/WebP, ≤ 3.75 MB, ≤ 8 per message). */
function addImage(f: File): void {
  if (!host) return;
  const h = host;
  if (!isImageFile(f.type)) {
    h.toast(ti("imageKind", { name: f.name }));
    return;
  }
  if (f.size > MAX_IMAGE_BYTES) {
    h.toast(ti("imageTooBig", { name: f.name, size: formatSize(f.size) }));
    return;
  }
  if (attachments.filter((a) => a.kind === "image").length >= MAX_IMAGES) {
    h.toast(ti("imageLimit"));
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    const data = base64OfDataUrl(String(r.result ?? ""));
    if (!data) return h.toast(ti("imageKind", { name: f.name }));
    attachments.push({ id: "a" + ++attSeq, kind: "image", name: f.name || "image.png", data, size: f.size });
    renderAttachments();
  };
  r.readAsDataURL(f);
}

/** H5c: an image pasted into the box (a screenshot in the clipboard) is attached; text pastes as before. */
function onPaste(ev: ClipboardEvent): void {
  const files = Array.from(ev.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    ev.preventDefault();
    files.forEach(addImage);
    return;
  }
  setTimeout(autosize, 0);
}

function readFiles(list: FileList | null): void {
  if (!list || !host) return;
  for (const f of Array.from(list)) {
    if (f.type.startsWith("image/")) {
      addImage(f);
      continue;
    }
    if (!isTextFile(f.name, f.type)) {
      host.toast(tc("textOnly", { name: f.name }));
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

/** Põe o texto ditado no cursor (com espaço a separar do que já lá estava). */
function insertText(text: string): void {
  const i = input();
  if (!i || !text) return;
  const at = i.selectionStart ?? i.value.length;
  const before = i.value.slice(0, at);
  const after = i.value.slice(i.selectionEnd ?? at);
  const sep = before && !/\s$/.test(before) ? " " : "";
  i.value = before + sep + text + after;
  const pos = (before + sep + text).length;
  i.setSelectionRange(pos, pos);
  autosize();
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** whisper.cpp no backend: 1.º clique grava, 2.º pára e transcreve. */
async function toggleWhisper(d: DictationPort): Promise<void> {
  if (!host || mic === "busy") return;
  const h = host;
  if (mic === "rec") {
    mic = "busy";
    refreshComposer();
    try {
      const text = await d.stop(h.dictationLang());
      if (text) insertText(text);
      else h.toast("Não percebi nada — tenta outra vez, mais perto do microfone");
    } catch (e) {
      h.toast(errText(e));
    } finally {
      mic = "idle";
      refreshComposer();
      input()?.focus();
    }
    return;
  }
  const st = await d.status().catch(() => null);
  if (!st) {
    h.toast("Ditado indisponível");
    return;
  }
  if (!st.ready) {
    h.toast("Ditado local por configurar — falta " + st.missing.join("; "));
    return;
  }
  try {
    await d.start();
    mic = "rec";
  } catch (e) {
    h.toast(errText(e));
  }
  refreshComposer();
}

/** Esc durante o ditado: pára sem transcrever. */
function cancelMic(): void {
  if (mic !== "rec") return;
  const d = host?.dictation();
  if (d && d.available()) void d.cancel();
  else recog?.stop();
  mic = "idle";
  refreshComposer();
}

/** O reconhecimento de voz do motor web (Chromium/Safari), quando não há backend. */
function toggleWebSpeech(): void {
  if (!host) return;
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
    mic = "idle";
    refreshComposer();
  };
  recog = r;
  mic = "rec";
  refreshComposer();
  r.start();
}

function toggleMic(): void {
  const d = host?.dictation();
  if (d && d.available()) void toggleWhisper(d);
  else toggleWebSpeech();
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
    case "pace": {
      const cur = h.writePace?.() ?? "normal";
      h.palette(
        "Velocidade de escrita no editor…",
        WRITE_PACES.map((p) => ({
          l: p.label,
          d: (p.id === cur ? "actual · " : "") + (p.id === "instant" ? "mostra tudo de uma vez" : `${p.cps} caracteres/s`),
          run: () => {
            h.setWritePace?.(p.id);
            refreshComposer();
          },
        })),
      );
      break;
    }
    case "dictlang": {
      const cur = h.dictationLang();
      h.palette(
        "Língua do ditado…",
        DICTATION_LANGS.map((l) => ({
          l: l.label,
          d: l.id === cur ? "actual" : l.id === "auto" ? "o whisper detecta-a (pior em frases curtas)" : "",
          run: () => {
            h.setDictationLang(l.id);
            refreshComposer();
          },
        })),
      );
      return;
    }
    case "model":
    case "effort":
      toggle("model");
      return;
    case "mode":
      toggle("mode");
      return;
    case "persona":
      h.pickPersona();
      return;
    case "providers":
      h.switchProvider();
      return;
    case "settings":
      h.openModelSettings();
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
    case "backlog":
    case "project":
      // the context goes after the command: the human writes it and sends
      composerAsk(`/${id} `, [], false);
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
          host.toast(tc("providerOffToast", { name: choice.name }));
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
    "cc-persona": { on: "click", run: () => host?.pickPersona() },
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
  if (ev.key === "Escape" && mic === "rec") {
    ev.preventDefault();
    cancelMic();
    return;
  }
  if (ev.key === "Escape" && open) {
    ev.preventDefault();
    close();
    return;
  }
  // RF-G07: with nothing to close, Esc in the box stops a running turn (like the Stop button)
  if (ev.key === "Escape" && host.running()) {
    ev.preventDefault();
    host.stop();
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
  remount();
}

const safe = <T>(f: () => T, dflt: T): T => {
  try {
    return f() ?? dflt;
  } catch {
    return dflt;
  }
};

/** Monta o esqueleto, mantendo o texto escrito, os anexos e o chip do ficheiro activo. */
function remount(): void {
  const h = host;
  const root = el("ag-compose");
  if (!h || !root) return;
  const keep = input()?.value ?? "";
  const ctxShown = !(el("pill-ctx")?.hidden ?? true);
  const ctxText = el("pill-ctx")?.textContent ?? "";
  const ctxOnCls = el("pill-ctx")?.classList.contains("on") ?? false;
  open = "";
  root.innerHTML = skeleton();
  const chip = el("pill-ctx");
  if (chip) {
    chip.hidden = !ctxShown;
    chip.textContent = ctxText;
    chip.classList.toggle("on", ctxOnCls);
  }
  const i = input()!;
  i.value = keep;
  i.addEventListener("keydown", onKey);
  i.addEventListener("input", onInput);
  i.addEventListener("paste", onPaste);
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
  safe(() => h.refreshPersona(), undefined);
}

/* ───── o mapa de agentes (ui/agent-map-view.ts) ───── */

/** O chip conta os agentes que trabalham agora; clicá-lo abre o mapa. */
export function setAgentCount(n: number): void {
  if (n === agentCount) return;
  agentCount = n;
  refreshComposer();
}

/** Multi Co-Dev: a fila é da conversa à vista — trocar de sessão leva a fila dela e devolve a da outra. */
export function swapQueue(next: string[]): string[] {
  const prev = queue;
  queue = next;
  refreshComposer();
  return prev;
}

/** Nova conversa: esquece a fila e o modo Plano pendente (o mapa de agentes esquece a sessão). */
export function resetComposer(): void {
  queue = [];
  planNext = false;
  refreshComposer();
}

/** Só para os testes: o estado interno. */
export const _composerState = () => ({ attachments, queue, planNext, open, agentCount });
