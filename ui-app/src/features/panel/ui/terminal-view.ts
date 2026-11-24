/* ═════════ feature `panel` — vista do Terminal (xterm.js) ═════════
   Dona do DOM do separador Terminal na app desktop: um xterm por instância, os grupos de
   divisão lado a lado, a lista de instâncias à direita (como no VS Code), os links
   `ficheiro:linha` e URLs (Ctrl+clique), copiar/colar, o tema tirado dos tokens CSS da
   app, e a integração de shell (OSC 7 / OSC 633 → cwd, comando, código de saída, com a
   cauda da saída lida do buffer). O estado das instâncias é do gestor (`terminals`). */

import { Terminal, type IMarker, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import type { TerminalMeta } from "../domain/types";
import { parseOsc633, parseOsc7 } from "../domain/shell-integration";
import { detectLinks, linkCandidates } from "../domain/links";
import { shortCwd, terminalTitle } from "../domain/naming";
import type { Terminals } from "../application/terminals";
import type { WorkspacePort } from "../application/ports";

interface Pane {
  meta: TerminalMeta;
  term: Terminal;
  fit: FitAddon;
  el: HTMLElement;
  prompt: IMarker | null;
  /** Último comando anunciado (OSC 633;E), para cortar o prompt da saída capturada. */
  command: string;
  started: boolean;
}

export interface TerminalView {
  /** Re-mede e re-desenha (separador mostrado, painel redimensionado). */
  layout(): void;
  focus(): void;
  clear(): void;
  /** O terminal partilhado do PairCode (o terminal de linha legado) está à vista. */
  sharedShown(): boolean;
  showShared(on: boolean): void;
  refreshList(): void;
  retheme(): void;
  /** Texto do buffer de uma instância (selftest / inspecção). */
  text(id: string): string;
}

const css = (name: string, fallback: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function themeFromTokens(): ITheme {
  const light = css("color-scheme", "") === "light" || document.documentElement.style.colorScheme === "light";
  return {
    background: css("--bg-panel", "#161618"),
    foreground: css("--fg", "#e8e8ea"),
    cursor: css("--accent-hover", "#f08a4b"),
    cursorAccent: css("--bg-panel", "#161618"),
    selectionBackground: light ? "rgba(0,0,0,.18)" : "rgba(255,255,255,.18)",
    black: light ? "#3b3b3b" : "#1f1f22",
    red: css("--red", "#f1707a"),
    green: css("--green", "#5cc9a7"),
    yellow: css("--yellow", "#e0b64a"),
    blue: css("--blue", "#4a9eff"),
    magenta: css("--purple", "#c678dd"),
    cyan: css("--cyan", "#5fcad6"),
    white: light ? "#6e6e75" : "#d6d6d9",
    brightBlack: css("--fg-muted", "#6e6e75"),
    brightRed: css("--red", "#f1707a"),
    brightGreen: css("--git-u", "#73c991"),
    brightYellow: css("--yellow", "#e0b64a"),
    brightBlue: css("--blue", "#4a9eff"),
    brightMagenta: css("--purple", "#c678dd"),
    brightCyan: css("--cyan", "#5fcad6"),
    brightWhite: light ? "#1d1d20" : "#ffffff",
  };
}

const OUTPUT_LINES = 120;
const OUTPUT_CHARS = 8000;

export function mountTerminalView(deps: {
  host: HTMLElement;
  legacy: HTMLElement | null;
  terminals: Terminals;
  workspace: WorkspacePort;
  pairLive: () => boolean;
  icons: { terminal: string; task: string; split: string; trash: string };
  onState: () => void;
}): TerminalView {
  const { host, legacy, terminals, workspace } = deps;
  host.classList.add("xt-on");
  const root = document.createElement("div");
  root.className = "xt";
  root.innerHTML = `<div class="xt-main"></div><div class="xt-list"></div>`;
  host.appendChild(root);
  const main = root.querySelector(".xt-main") as HTMLElement;
  const listEl = root.querySelector(".xt-list") as HTMLElement;
  const panes = new Map<string, Pane>();
  let shared = false;

  const fitPane = (p: Pane): void => {
    if (!p.el.isConnected || p.el.clientWidth < 20 || p.el.clientHeight < 10) return;
    try {
      p.fit.fit();
    } catch {
      /* sem medidas ainda */
    }
    if (p.started) terminals.resize(p.meta.id, p.term.rows, p.term.cols);
  };

  /** Cauda da saída do último comando: do prompt anterior (marcado no OSC 7) até ao cursor. */
  function capture(p: Pane): string {
    const b = p.term.buffer.active;
    const end = b.baseY + b.cursorY;
    const start = p.prompt && !p.prompt.isDisposed ? p.prompt.line + 1 : Math.max(0, end - OUTPUT_LINES);
    const lines: string[] = [];
    for (let y = Math.max(start, end - OUTPUT_LINES); y < end; y++) {
      const l = b.getLine(y);
      if (l) lines.push(l.translateToString(true));
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    // um prompt longo ocupa várias linhas: a saída começa depois da linha do comando
    const cmd = p.command.trim();
    if (cmd) {
      const at = lines.slice(0, 6).findIndex((l) => l.includes(cmd) || (cmd.length > 20 && l.includes(cmd.slice(-20))));
      if (at >= 0) lines.splice(0, at + 1);
    }
    const s = lines.join("\n");
    return s.length > OUTPUT_CHARS ? s.slice(-OUTPUT_CHARS) : s;
  }

  function createPane(meta: TerminalMeta): Pane {
    const el = document.createElement("div");
    el.className = "xt-pane";
    el.dataset.id = meta.id;
    main.appendChild(el);
    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: css("--font-mono", "monospace"),
      fontSize: 13,
      lineHeight: 1.15,
      scrollback: 10000,
      theme: themeFromTokens(),
      overviewRulerWidth: 8,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    const p: Pane = { meta, term, fit, el, prompt: null, command: "", started: false };

    term.parser.registerOscHandler(7, (data) => {
      const path = parseOsc7(data);
      if (path) terminals.shellEvent(meta.id, { kind: "cwd", path });
      p.prompt?.dispose();
      p.prompt = term.registerMarker(0) ?? null;
      return true;
    });
    term.parser.registerOscHandler(633, (data) => {
      const ev = parseOsc633(data);
      if (!ev) return true;
      if (ev.kind === "exit") {
        terminals.shellEvent(meta.id, ev, capture(p));
        if (ev.code !== 0 && ev.code !== 130 && p.prompt && !p.prompt.isDisposed) {
          term.registerDecoration({ marker: p.prompt, overviewRulerOptions: { color: css("--red", "#f1707a"), position: "full" } });
        }
      } else {
        p.command = ev.command;
        terminals.shellEvent(meta.id, ev);
      }
      return true;
    });

    term.onData((d) => {
      const m = terminals.get(meta.id);
      if (!m) return;
      if (m.exited !== null) {
        void terminals.kill(meta.id); // «press any key to close»
        return;
      }
      terminals.write(meta.id, d);
    });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const c = e.ctrlKey || e.metaKey;
      if (c && e.shiftKey && e.code === "KeyC") {
        if (term.hasSelection()) document.execCommand("copy");
        e.preventDefault();
        return false;
      }
      if (c && e.shiftKey && e.code === "KeyV") {
        e.preventDefault();
        void navigator.clipboard?.readText().then((t) => t && term.paste(t)).catch(() => {});
        return false;
      }
      // Ctrl+C com selecção copia; Ctrl+V cola (o browser trata e o xterm recebe o paste).
      if (c && !e.shiftKey && e.code === "KeyC" && term.hasSelection()) return false;
      if (c && !e.shiftKey && e.code === "KeyV") return false;
      return !isAppKey(e);
    });
    term.registerLinkProvider({
      provideLinks(y, cb) {
        const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
        const r = workspace.root();
        const found = detectLinks(line).flatMap((l) => {
          let open: (() => void) | null = null;
          if (l.kind === "url") open = () => workspace.openUrl(l.text);
          else if (r && l.path) {
            const rel = linkCandidates(l.path, terminals.get(meta.id)?.cwd ?? null, r, workspace.home()).find((c) => workspace.hasFile(c));
            if (rel) open = () => workspace.openFile(rel, l.line);
          }
          if (!open) return [];
          const go = open;
          return [{
            range: { start: { x: l.start + 1, y }, end: { x: l.end, y } },
            text: l.text,
            decorations: { underline: true, pointerCursor: true },
            activate: (ev: MouseEvent) => {
              if (ev.ctrlKey || ev.metaKey) go();
            },
            hover: () => {
              el.title = l.kind === "url" ? "Follow link (Ctrl+click)" : "Open file (Ctrl+click)";
            },
            leave: () => {
              el.title = "";
            },
          }];
        });
        cb(found.length ? found : undefined);
      },
    });
    term.textarea?.addEventListener("focus", () => {
      terminals.focus(meta.id);
      markFocus();
    });
    new ResizeObserver(() => fitPane(p)).observe(el);

    if (meta.kind === "task" && meta.command) {
      term.write(`\x1b[90m> Executing task: ${meta.command.split("\n").join(" ⏎ ")} <\x1b[0m\r\n\r\n`);
    }
    panes.set(meta.id, p);
    // Arranque: mede se puder, senão 80×24 (o ResizeObserver corrige quando aparecer).
    try {
      if (el.clientWidth > 20) fit.fit();
    } catch {
      /* oculto */
    }
    p.started = true;
    void terminals.start(meta.id, term.rows || 24, term.cols || 80);
    return p;
  }

  function markFocus(): void {
    const a = terminals.active();
    panes.forEach((p, id) => p.el.classList.toggle("focus", id === a && terminals.group(id).length > 1));
  }

  function render(): void {
    const metas = terminals.list();
    for (const [id, p] of panes) {
      if (!metas.some((m) => m.id === id)) {
        p.term.dispose();
        p.el.remove();
        panes.delete(id);
      }
    }
    for (const m of metas) {
      const p = panes.get(m.id);
      if (p) p.meta = m;
      else createPane(m);
    }
    const a = terminals.active();
    const groupIds = new Set((a ? terminals.group(a) : []).map((m) => m.id));
    const showShared = shared && deps.pairLive();
    if (legacy) legacy.classList.toggle("xt-hide", !showShared);
    main.classList.toggle("xt-hide", showShared);
    panes.forEach((p, id) => p.el.classList.toggle("xt-hide", !groupIds.has(id)));
    markFocus();
    refreshList();
    requestAnimationFrame(() => panes.forEach((p, id) => groupIds.has(id) && fitPane(p)));
    deps.onState();
  }

  function refreshList(): void {
    const metas = terminals.list();
    const live = deps.pairLive();
    if (!live && shared) shared = false;
    const showList = metas.length > 1 || live;
    root.classList.toggle("with-list", showList);
    if (!showList) {
      listEl.innerHTML = "";
      return;
    }
    const a = shared ? null : terminals.active();
    const groups = new Map<string, TerminalMeta[]>();
    metas.forEach((m) => groups.set(m.group, [...(groups.get(m.group) ?? []), m]));
    const rows: string[] = [];
    for (const g of groups.values()) {
      g.forEach((m, i) => {
        const tree = g.length > 1 ? `<span class="xt-tree">${i === g.length - 1 ? "└" : i === 0 ? "┌" : "├"}</span>` : "";
        const failed = m.exited !== null ? m.exited !== 0 : m.lastExit !== null && m.lastExit !== 0 && m.lastExit !== 130;
        const state = m.exited !== null ? `<span class="xt-ex ${m.exited === 0 ? "ok" : "er"}">${m.exited}</span>` : failed ? `<span class="xt-ex er" title="last command failed (exit ${m.lastExit})">●</span>` : "";
        const cwd = shortCwd(m.cwd, workspace.root(), null, workspace.home());
        rows.push(`<div class="xt-item${m.id === a ? " on" : ""}" data-action="xt-focus" data-on="${m.id}" title="${escAttr(`${terminalTitle(m)} — ${m.cwd ?? ""}`)}">${tree}<span class="xt-ic">${m.kind === "task" ? deps.icons.task : deps.icons.terminal}</span><span class="xt-nm">${escText(terminalTitle(m))}</span><span class="xt-cwd">${escText(cwd.split("/").pop() ?? "")}</span>${state}<span class="xt-acts"><button data-action="xt-split" data-on="${m.id}" title="Split">${deps.icons.split}</button><button data-action="xt-kill" data-on="${m.id}" title="Kill">${deps.icons.trash}</button></span></div>`);
      });
    }
    if (live) rows.push(`<div class="xt-item${shared ? " on" : ""}" data-action="xt-shared" title="Shared terminal of the PairCode session (runs on the host)"><span class="xt-ic">${deps.icons.terminal}</span><span class="xt-nm">PairCode · shared</span></div>`);
    listEl.innerHTML = rows.join("");
  }

  terminals.setSink({
    data: (id, data) => panes.get(id)?.term.write(data),
    exited: (m, code) => {
      const p = panes.get(m.id);
      if (!p) return;
      p.term.write(
        m.kind === "task"
          ? `\r\n\x1b[90m * The task finished with exit code ${code}. Press any key to close the terminal.\x1b[0m\r\n`
          : `\r\n\x1b[90m[process exited with code ${code}] — press any key to close\x1b[0m\r\n`,
      );
    },
  });
  terminals.subscribe(render);
  render();

  return {
    layout: () => {
      const a = terminals.active();
      (a ? terminals.group(a) : []).forEach((m) => {
        const p = panes.get(m.id);
        if (p) fitPane(p);
      });
    },
    focus: () => {
      const a = terminals.active();
      if (a && !shared) panes.get(a)?.term.focus();
    },
    clear: () => {
      const a = terminals.active();
      if (a) panes.get(a)?.term.clear();
    },
    sharedShown: () => shared && deps.pairLive(),
    showShared: (on) => {
      shared = on;
      render();
    },
    refreshList,
    retheme: () => {
      const t = themeFromTokens();
      panes.forEach((p) => (p.term.options.theme = t));
    },
    text: (id) => {
      const b = panes.get(id)?.term.buffer.active;
      if (!b) return "";
      const out: string[] = [];
      for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) ?? "");
      return out.join("\n").replace(/\n+$/, "");
    },
  };
}

/** Atalhos que continuam a ir para a IDE mesmo com o foco no terminal (o resto é da
 *  shell: Ctrl+L, Ctrl+R, Ctrl+K, F10… — como o `commandsToSkipShell` do VS Code). */
export function isAppKey(e: KeyboardEvent): boolean {
  const c = e.ctrlKey || e.metaKey;
  if (e.key === "F1") return true;
  if (!c || e.altKey) return false;
  if (e.code === "Backquote") return true;
  if (e.shiftKey) return ["KeyP", "KeyE", "KeyF", "KeyG", "KeyM", "KeyX", "KeyD", "KeyT", "KeyA", "Digit5"].includes(e.code);
  return ["KeyP", "KeyB", "KeyJ", "Comma"].includes(e.code);
}

const escText = (s: string): string => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
const escAttr = (s: string): string => escText(s).replace(/"/g, "&quot;");
