/* ═════════ feature `panel` — raiz de composição (painel inferior real) ═════════
   Na app desktop, o painel inferior deixa de ter demo:
     • Terminal — a shell do SO num PTY (várias instâncias, dividir, matar, perfis),
       com integração de shell; as tarefas da IDE (compose, deploy, logs) correm num
       terminal de tarefa com o código de saída real;
     • Problems — os checkers do projecto (cargo/tsc/go vet/ruff/eslint) + LSP;
     • Output — canais reais (dxtutor, Tasks, Problems, Co-Dev, Language Server, …);
     • Services — portas TCP em escuta e o compose do workspace, lidos a sério;
     • Debug assistant — comandos que falharam e erros reais, enviados ao Co-Dev num clique.
   No browser (sem Tauri) e no harness de testes este módulo não faz nada: o caminho de
   demonstração e os goldens ficam intactos. Liga as portas (Tauri + legado) aos casos de
   uso e às vistas; o `window` só é tocado através do `legacy-bridge`. */

import { isDesktop } from "../../platform/tauri/core";
import type { Problem, ShellProfile } from "./domain/types";
import { ALL, type ProblemFilter } from "./domain/problems";
import { translator } from "../../app/i18n";
import { PANEL_SCOPE_MESSAGES } from "./ui/scope-messages";
import { problemsScope } from "../../app/problems-scope";
const scopeText = translator(PANEL_SCOPE_MESSAGES);
import { makeOutput } from "./application/output";
import { makeTerminals, TASKS_CHANNEL } from "./application/terminals";
import { makeProblems } from "./application/problems-service";
import type { Clock, WorkspacePort } from "./application/ports";
import { tauriPorts, tauriProblems, tauriPty, openExternal, onLspStatus } from "./infrastructure/tauri";
import * as L from "./infrastructure/legacy-bridge";
import { mountTerminalView, isAppKey, type TerminalView } from "./ui/terminal-view";
import { renderProblems, problemCounts } from "./ui/problems-view";
import { renderOutput } from "./ui/output-view";
import { renderServices, type ServicesModel } from "./ui/services-view";
import { renderAssistant, promptForCommand, promptForProblem, ASSISTANT_MARK } from "./ui/assistant-view";
import { bindActions, type ActionTable } from "./ui/actions";

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

const ICON_TERMINAL = `<svg class="ico" viewBox="0 0 16 16"><path d="M2.5 3h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor"/><path d="m4.5 6 2 2-2 2M8 10.5h3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TASK = `<svg class="ico" viewBox="0 0 16 16"><path d="M5 3.5 11.5 8 5 12.5Z" fill="none" stroke="currentColor" stroke-linejoin="round"/></svg>`;

function boot(): void {
  const host = $("#pc-terminal");
  if (!host) return;

  const clock: Clock = {
    now: () => Date.now(),
    after: (ms, f) => {
      const t = setTimeout(f, ms);
      return () => clearTimeout(t);
    },
  };
  const workspace: WorkspacePort = {
    root: L.root,
    name: L.rootName,
    home: L.home,
    env: L.extraEnv,
    hasFile: L.hasFile,
    openFile: L.openFile,
    openUrl: (url) => openExternal(url, L.os()),
  };
  const output = makeOutput(clock.now, ["dxtutor", TASKS_CHANNEL, "Problems", "Co-Dev", "Language Server"]);
  const terminals = makeTerminals({ pty: tauriPty, workspace, output, clock });
  const problems = makeProblems({ port: tauriProblems, workspace, output, clock });

  /* ───── Output: o log() legado escreve em #pc-output; cada linha muda-se para o seu canal ───── */
  const outEl = $("#pc-output");
  const CHANNEL_OF: Record<string, string> = { desktop: "dxtutor", "co-dev": "Co-Dev", pair: "PairCode", codev: "Co-Dev" };
  let channel: string | null = null;
  let channelPicked = false; // até o utilizador escolher, mostra o canal mais relevante
  function adoptLegacy(node: Node): boolean {
    if (!(node instanceof HTMLElement) || node.className || node.tagName !== "DIV") return false;
    const src = node.querySelector(".r")?.textContent?.trim() ?? "";
    const text = (node.textContent ?? "").replace(/^\[\d\d:\d\d\]\s*/, "").replace(src, "").trim();
    node.remove();
    // A linha «rust-analyzer · 2 crates indexados» do arranque do monólito é demo: o estado
    // real do language server chega pelo canal «Language Server» (lsp://status).
    if (src === "rust-analyzer") return true;
    output.append(CHANNEL_OF[src] ?? (src ? src[0].toUpperCase() + src.slice(1) : "dxtutor"), text);
    return true;
  }
  if (outEl) {
    [...outEl.childNodes].forEach(adoptLegacy);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(adoptLegacy))).observe(outEl, { childList: true });
  }
  void onLspStatus((s) => output.append("Language Server", `${s.server}${s.kind ? ` · ${s.kind}` : ""}${s.title ? ` · ${s.title}` : ""}${s.message ? ` — ${s.message}` : ""}${s.percentage != null ? ` (${s.percentage}%)` : ""}`));

  /* ───── Terminal ───── */
  const view: TerminalView = mountTerminalView({
    host,
    legacy: $("#term"),
    terminals,
    workspace,
    pairLive: L.pairLive,
    icons: { terminal: ICON_TERMINAL, task: ICON_TASK, split: L.svg("split"), trash: L.svg("trash") },
    // adiado: o primeiro render corre durante este boot, antes de a barra existir
    onState: () => queueMicrotask(() => {
      if (activeTab() === "terminal") drawToolbar();
    }),
  });
  let shells: ShellProfile[] = [];
  void tauriPty.shells().then((s) => (shells = s)).catch(() => {});

  /* ───── estado das outras vistas ───── */
  let filter: ProblemFilter = { ...ALL };
  /* RF-A05: the Project asks to show only an issue's files */
  problemsScope.subscribe((sc) => {
    filter = { ...filter, files: sc.files, scope: sc.label };
    L.setPanelTab("problems");
    drawToolbar();
    drawProblemsAll();
  });
  const collapsed = new Set<string>();
  const svc: ServicesModel = { ports: null, portsError: null, showAll: false, root: null, rootName: null, home: null, compose: null, stack: null, stackLoading: false };

  const activeTab = (): string => $(".ptab.on")?.dataset.pt ?? "";
  const visible = (pt: string): boolean => activeTab() === pt && !L.panelHidden();

  function drawProblemsAll(): void {
    const all = problems.all();
    const c = problemCounts(all);
    const badge = $("#pb-prob");
    if (badge) badge.textContent = String(c.total);
    const st = $("#st-prob");
    if (st) {
      st.innerHTML = problems.state().running && !problems.state().scan ? "✖ … ⚠ …" : `✖ ${c.errors} ⚠ ${c.warnings}`;
      st.style.color = c.errors ? "var(--red)" : c.warnings ? "var(--yellow)" : "var(--git-u)";
    }
    // O `#st-tests` é do features/testing (resultados reais das corridas; ADR-0006, R2a).
    const el = $("#pc-problems");
    if (el) renderProblems(el, { state: problems.state(), problems: all, filter, collapsed, root: L.root() });
    if (activeTab() === "dbg") drawAssistant();
  }

  function drawOutput(): void {
    const chs = output.channels();
    if (!channelPicked || !channel || !chs.includes(channel)) channel = chs[0] ?? null;
    if (outEl) renderOutput(outEl, output, channel);
    drawToolbarIfChannelsChanged();
  }
  output.subscribe((c) => {
    if (activeTab() === "output" && (!channelPicked || !channel || c === channel || !output.channels().includes(channel))) drawOutput();
    else if (activeTab() === "output") drawToolbarIfChannelsChanged();
  });
  function drawToolbarIfChannelsChanged(): void {
    const sel = $<HTMLSelectElement>("#op-channel");
    if (sel && document.activeElement !== sel && (sel.options.length !== output.channels().length || sel.value !== channel)) drawToolbar();
  }

  async function refreshPorts(): Promise<void> {
    svc.root = L.root();
    svc.rootName = L.rootName();
    svc.home = L.home();
    try {
      svc.ports = await tauriPorts.list(svc.root);
      svc.portsError = null;
    } catch (e) {
      svc.portsError = String(e);
    }
    drawServices();
  }
  async function refreshCompose(): Promise<void> {
    svc.compose = L.root() ? L.composeFile() : null;
    if (!svc.compose) {
      drawServices();
      return;
    }
    svc.stackLoading = true;
    drawServices();
    await L.readStack().catch(() => {});
    svc.stack = L.stack();
    svc.stackLoading = false;
    drawServices();
  }
  function drawServices(): void {
    const el = $("#pc-services");
    if (el) renderServices(el, svc);
  }

  const dbgEl = (): HTMLElement | null => $("#pc-dbg");
  function drawAssistant(): void {
    const el = dbgEl();
    if (!el || !L.root()) return;
    renderAssistant(el, {
      failures: terminals.failures(),
      errors: problems.all().filter((p) => p.severity === "error"),
      integration: terminals.list().some((t) => /(^|\/)(bash|zsh)$/.test(t.shell)) || !terminals.list().length,
      now: clock.now(),
      icon: L.svg("bug"),
    });
  }

  /* ───── barra do painel, por separador ───── */
  const tools = $(".panel-tools");
  function drawToolbar(): void {
    if (!tools) return;
    const pt = activeTab();
    const b = (action: string, icon: string, title: string, on = "") => `<button data-action="${action}"${on ? ` data-on="${on}"` : ""} title="${title}">${icon}</button>`;
    let left = "";
    if (pt === "terminal") {
      left = b("xt-new", L.svg("plus"), "New Terminal (Ctrl+Shift+`)") + b("xt-profiles", L.svg("chev"), "Launch Profile…") + b("xt-split", L.svg("split"), "Split Terminal (Ctrl+Shift+5)") + b("xt-kill", L.svg("trash"), "Kill Terminal") + b("xt-clear", L.svg("collapse"), "Clear Terminal");
    } else if (pt === "problems") {
      const tg = (k: keyof ProblemFilter, ic: string, t: string) => `<button class="pt-tg${filter[k] ? " on" : ""}" data-action="pb-sev" data-on="${k}" title="${t}">${ic}</button>`;
      const scope = filter.scope ? `<button class="pt-scope" data-action="pb-clear-scope" title="${L.esc(scopeText("pbScopeTitle", { n: filter.files?.length ?? 0 }))}">${L.esc(scopeText("pbScope", { scope: filter.scope }))} ✕</button>` : "";
      left = scope + `<input class="pt-filter" id="pb-filter" placeholder="Filter (e.g. text, !exclude)" data-action="pb-filter" value="${L.esc(filter.text)}">` + tg("errors", "✖", "Show Errors") + tg("warnings", "⚠", "Show Warnings") + tg("infos", "ℹ", "Show Infos") + b("pb-collapse", L.svg("collapse"), "Collapse All") + b("pb-rescan", L.svg("refresh"), "Check the workspace again");
    } else if (pt === "output") {
      const chs = output.channels();
      left = `<select class="pt-sel" id="op-channel" data-action="op-channel">${chs.map((c) => `<option${c === channel ? " selected" : ""}>${L.esc(c)}</option>`).join("")}</select>` + b("op-clear", L.svg("trash"), "Clear Output");
    } else if (pt === "services") {
      left = b("sv-refresh", L.svg("refresh"), "Refresh");
    }
    tools.innerHTML = left + `<span class="pt-sep"></span>` + b("panel-close", L.svg("close"), "Close Panel");
  }

  /* ───── menu de perfis (shells do SO) ───── */
  let menu: HTMLElement | null = null;
  function closeMenu(): void {
    menu?.remove();
    menu = null;
  }
  function openProfiles(anchor: HTMLElement): void {
    closeMenu();
    const r = anchor.getBoundingClientRect();
    menu = document.createElement("div");
    menu.className = "menu-pop show xt-menu";
    const items = shells.map((s) => `<div class="mi" data-action="xt-new-shell" data-on="${L.esc(s.path)}">${ICON_TERMINAL}<span>${L.esc(s.name)}</span><span class="key">${L.esc(s.path)}${s.default ? " · default" : ""}</span></div>`);
    menu.innerHTML = (items.length ? items.join("") : `<div class="mi"><span>No shells found</span></div>`) + `<div class="mi-sep"></div><div class="mi" data-action="xt-split"><span>Split Terminal</span><span class="key">Ctrl+Shift+5</span></div><div class="mi" data-action="xt-kill-all"><span>Kill All Terminals</span></div>`;
    document.body.appendChild(menu);
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(r.left, document.documentElement.clientWidth - w - 8))}px`;
    menu.style.top = `${Math.max(8, r.top - h - 4)}px`;
  }
  document.addEventListener("mousedown", (e) => {
    if (menu && !(e.target as HTMLElement).closest(".xt-menu") && !(e.target as HTMLElement).closest('[data-action="xt-profiles"]')) closeMenu();
  }, true);

  const newTerminal = (shell?: string | null) => {
    L.setPanelTab("terminal");
    view.showShared(false);
    terminals.create({ shell: shell ?? null });
    requestAnimationFrame(() => view.focus());
  };
  const ensureTerminal = () => {
    if (!terminals.list().length) terminals.create();
  };

  const ACTIONS: ActionTable = {
    "xt-new": { on: "click", run: () => newTerminal() },
    "xt-new-shell": { on: "click", run: (e) => { closeMenu(); newTerminal(e.on); } },
    "xt-profiles": { on: "click", run: (e) => (menu ? closeMenu() : openProfiles(e.el)) },
    "xt-split": { on: "click", run: (e) => { closeMenu(); view.showShared(false); terminals.split(e.on || terminals.active()); requestAnimationFrame(() => view.focus()); } },
    "xt-kill": { on: "click", run: (e) => { const id = e.on || terminals.active(); if (id) void terminals.kill(id); } },
    "xt-kill-all": { on: "click", run: () => { closeMenu(); terminals.list().map((t) => t.id).forEach((id) => void terminals.kill(id)); } },
    "xt-clear": { on: "click", run: () => view.clear() },
    "xt-focus": { on: "click", run: (e) => { view.showShared(false); terminals.focus(e.on); requestAnimationFrame(() => view.focus()); } },
    "xt-shared": { on: "click", run: () => view.showShared(true) },
    "panel-close": { on: "click", run: () => L.togglePanel() },
    "pb-open": { on: "click", run: (e) => { const i = e.on.lastIndexOf("|"); L.openFile(e.on.slice(0, i), parseInt(e.on.slice(i + 1), 10) || 1); } },
    "pb-toggle": { on: "click", run: (e) => { if (collapsed.has(e.on)) collapsed.delete(e.on); else collapsed.add(e.on); drawProblemsAll(); } },
    "pb-collapse": { on: "click", run: () => { const all = new Set(problems.all().map((p) => p.file)); const allCollapsed = [...all].every((f) => collapsed.has(f)); collapsed.clear(); if (!allCollapsed) all.forEach((f) => collapsed.add(f)); drawProblemsAll(); } },
    "pb-filter": { on: "input", run: (e) => { filter = { ...filter, text: e.value }; drawProblemsAll(); } },
    "pb-clear-filter": { on: "click", run: () => { filter = { ...ALL }; drawToolbar(); drawProblemsAll(); } },
    /* RF-A05: drop the issue's file filter the Project set */
    "pb-clear-scope": { on: "click", run: () => { filter = { ...filter, files: undefined, scope: undefined }; drawToolbar(); drawProblemsAll(); } },
    "pb-sev": { on: "click", run: (e) => { const k = e.on as "errors" | "warnings" | "infos"; filter = { ...filter, [k]: !filter[k] }; e.el.classList.toggle("on", filter[k]); drawProblemsAll(); } },
    "pb-rescan": { on: "click", run: () => problems.request("manual refresh", true) },
    "op-channel": { on: "change", run: (e) => { channel = e.value; channelPicked = true; drawOutput(); } },
    "op-clear": { on: "click", run: () => { if (channel) output.clear(channel); } },
    "sv-refresh": { on: "click", run: () => { void refreshPorts(); void refreshCompose(); } },
    "sv-toggle-all": { on: "change", run: (e) => { svc.showAll = (e.el as HTMLInputElement).checked; drawServices(); } },
    "sv-all": { on: "click", run: () => { svc.showAll = true; drawServices(); } },
    "sv-open": { on: "click", run: (e) => workspace.openUrl(e.on) },
    "sv-copy": { on: "click", run: (e) => { void navigator.clipboard?.writeText(e.on).then(() => L.toast(`Copied ${e.on}`)).catch(() => L.toast(e.on)); } },
    "sv-up": { on: "click", run: () => { L.composeUp(); } },
    "sv-down": { on: "click", run: () => { L.composeDown(); } },
    "dx-ask-cmd": { on: "click", run: (e) => {
      const f = terminals.failures()[parseInt(e.on, 10)];
      if (!f) return;
      const errs = problems.all().filter((p) => p.severity === "error" && f.output.includes(p.file.split("/").pop() ?? "\u0000"));
      L.askCodev(promptForCommand(f, errs));
    } },
    "dx-ask-err": { on: "click", run: (e) => { const p = problems.all().filter((x) => x.severity === "error")[parseInt(e.on, 10)]; if (p) L.askCodev(promptForProblem(p)); } },
    "dx-rerun": { on: "click", run: (e) => {
      const f = terminals.failures()[parseInt(e.on, 10)];
      if (!f) return;
      const t = terminals.get(f.terminalId);
      L.setPanelTab("terminal");
      const id = t && t.exited === null && t.kind === "shell" ? t.id : terminals.create({ cwd: f.cwd }).id;
      terminals.focus(id);
      // uma shell acabada de criar ainda não arrancou: espera o primeiro prompt
      setTimeout(() => terminals.write(id, f.command + "\r"), t ? 0 : 600);
      requestAnimationFrame(() => view.focus());
    } },
    "dx-show": { on: "click", run: (e) => { if (terminals.get(e.on)) { terminals.focus(e.on); L.setPanelTab("terminal"); requestAnimationFrame(() => view.focus()); } } },
  };
  bindActions(ACTIONS);

  /* ───── mudança de separador (setPanelTab do monólito alterna .on nas .ptab) ───── */
  let lastTab = "";
  function onTab(): void {
    const pt = activeTab();
    if (pt === lastTab) return;
    lastTab = pt;
    closeMenu();
    drawToolbar();
    if (pt === "terminal") {
      ensureTerminal();
      requestAnimationFrame(() => { view.layout(); view.focus(); });
    } else if (pt === "problems") drawProblemsAll();
    else if (pt === "output") drawOutput();
    else if (pt === "services") { void refreshPorts(); void refreshCompose(); }
    else if (pt === "dbg") drawAssistant();
  }
  const tabs = $(".panel-tabs");
  if (tabs) new MutationObserver(onTab).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class"], childList: true });

  /* a demo do monólito volta a desenhar o #pc-dbg vazio: com pasta real, repõe o real */
  const watchDbg = () => {
    const el = dbgEl();
    if (!el || (el as HTMLElement & { __dbgx?: boolean }).__dbgx) return;
    (el as HTMLElement & { __dbgx?: boolean }).__dbgx = true;
    new MutationObserver(() => {
      if (L.root() && !el.querySelector("." + ASSISTANT_MARK)) drawAssistant();
    }).observe(el, { childList: true });
  };

  terminals.subscribe(() => { if (activeTab() === "dbg") drawAssistant(); });
  problems.subscribe(drawProblemsAll);

  /* ───── workspace aberto / ficheiros gravados (eventos do bridge.ts) ───── */
  function onWorkspace(): void {
    if (!L.root()) return;
    problems.reset();
    problems.request("workspace opened", true);
    terminals.workspaceChanged();
    svc.stack = null;
    void refreshCompose();
    watchDbg();
    drawProblemsAll();
  }
  document.addEventListener("dx:workspace", onWorkspace);
  document.addEventListener("dx:saved", () => problems.request("files saved"));

  /* ───── teclado: o terminal é dono das suas teclas; atalhos de terminal do VS Code ───── */
  const inTerminal = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.(".xterm");
  document.addEventListener("keydown", (e) => {
    const c = e.ctrlKey || e.metaKey;
    if (c && e.shiftKey && e.code === "Backquote") {
      e.preventDefault();
      newTerminal();
    } else if (c && e.shiftKey && e.code === "Digit5") {
      e.preventDefault();
      L.setPanelTab("terminal");
      terminals.split(terminals.active());
      requestAnimationFrame(() => view.focus());
    } else if (c && !e.shiftKey && e.code === "Backquote") {
      // o monólito já mostrou o separador; com o foco no terminal, Ctrl+` esconde o painel
      if (inTerminal(e)) L.togglePanel();
      else requestAnimationFrame(() => { ensureTerminal(); view.focus(); });
    }
  }, true);

  /* ───── tema da app → tema do xterm ───── */
  new MutationObserver(() => view.retheme()).observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });

  /* ───── títulos (processo em primeiro plano) e portas, enquanto o painel está à vista ───── */
  setInterval(() => {
    if (L.panelHidden()) return;
    if (activeTab() === "terminal") terminals.list().forEach((t) => void terminals.refreshInfo(t.id));
    if (visible("services")) void refreshPorts();
  }, 2500);

  /* ───── publicação + arranque ───── */
  L.publish({
    term: {
      runTask: (line, o) => {
        L.setPanelTab("terminal");
        view.showShared(false);
        return terminals.runTask(line, { label: o?.label, cwd: o?.cwd ?? null, env: o?.env ?? null });
      },
      log: (ch, text, err) => output.append(ch, text, err ? "error" : "info"),
      inspect: () => ({
        terminals: terminals.list().map((t) => ({ id: t.id, kind: t.kind, label: t.label, shell: t.shell, process: t.process, cwd: t.cwd, exited: t.exited })),
        failures: terminals.failures().map((f) => ({ command: f.command, exitCode: f.exitCode, output: f.output })),
        problems: problems.all().length,
        scanning: problems.state().running,
        scanned: !!problems.state().scan,
        create: (cwd) => terminals.create({ cwd: cwd ?? null }).id,
        write: (id, data) => terminals.write(id, data),
        kill: (id) => void terminals.kill(id),
        text: (id) => view.text(id),
      }),
    },
    ownsKey: (e) => inTerminal(e) && !isAppKey(e),
    problems: (): Problem[] => problems.all(),
    drawProblems: drawProblemsAll,
    drawServices: () => {
      svc.stack = L.stack();
      svc.compose = L.root() ? L.composeFile() : null;
      drawServices();
    },
  });
  const ot = $('.ptab[data-pt="output"]');
  if (ot) ot.textContent = "Output";
  $(".tmux")?.classList.add("hidden");
  watchDbg();
  drawToolbar();
  drawOutput();
  onTab();
  if (L.root()) onWorkspace();
}

if (isDesktop()) {
  try {
    boot();
  } catch (e) {
    L.reportError("boot", e);
  }
}
