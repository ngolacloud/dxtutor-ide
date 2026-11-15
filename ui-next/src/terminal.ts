// A real terminal panel with two honest modes. Line mode: each command runs through the
// backend `run_shell`, streaming stdout/stderr line by line via proc-line / proc-exit (one
// command at a time, no stdin). PTY mode: a live interactive shell over pty_spawn — bytes
// arrive as pty://data events into an xterm.js view and keystrokes go back via pty_write,
// so programs that read stdin (`read`, REPLs, TUIs) actually work. No simulation anywhere.

import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, listen, type ProcLine, type ProcExit } from "./tauri";
import { t } from "./i18n";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const strip = (s: string) => s.replace(ANSI, "").replace(/\r/g, "");

/** A sessão PTY viva do painel: xterm + listeners Tauri (a limpar SEMPRE no fecho). */
interface PtySession {
  xterm: XTerm;
  fit: FitAddon;
  unlisten: (() => void)[];
  ro: ResizeObserver;
  buf: string; // saída crua acumulada, para o arnês afirmar interactividade
}

export class Terminal {
  private host: HTMLElement;
  private out: HTMLElement;
  private input: HTMLInputElement;
  private xtermHost: HTMLElement;
  private ptyBtn: HTMLButtonElement;
  private pty: PtySession | null = null;
  private running: string | null = null; // id of the in-flight command
  private handlers = new Map<string, { line: (l: string, err: boolean) => void; exit: (code: number) => void }>();
  private history: string[] = [];
  private histIdx = -1;
  private seq = 0;
  private cwd = () => "";

  constructor(host: HTMLElement) {
    this.host = host;
    host.innerHTML = `<div class="term-out"></div><div class="term-xterm hidden"></div>
      <div class="term-inputline"><span class="term-prompt">$</span><input class="term-input" spellcheck="false" autocomplete="off" /><button class="term-ptybtn"></button></div>`;
    this.out = host.querySelector(".term-out") as HTMLElement;
    this.input = host.querySelector(".term-input") as HTMLInputElement;
    this.xtermHost = host.querySelector(".term-xterm") as HTMLElement;
    this.ptyBtn = host.querySelector(".term-ptybtn") as HTMLButtonElement;
    this.ptyBtn.onclick = (e) => { e.stopPropagation(); void (this.pty ? this.stopPty() : this.startPty()); };
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    host.addEventListener("click", () => (this.pty ? this.pty.xterm.focus() : this.input.focus()));
    this.applyLocale();
    void this.wireEvents();
  }

  /** Repinta os rótulos do terminal na locale corrente. */
  applyLocale(): void {
    this.ptyBtn.textContent = this.pty ? t("term.ptyOff") : t("term.ptyOn");
    this.ptyBtn.title = this.pty ? t("term.ptyOffTitle") : t("term.ptyOnTitle");
  }

  /** Point the terminal at the workspace root (where commands run). */
  setCwd(fn: () => string): void {
    this.cwd = fn;
  }

  private async wireEvents(): Promise<void> {
    await listen("proc-line", (p) => {
      const e = p as ProcLine;
      this.handlers.get(e.id)?.line(e.line, e.err);
    });
    await listen("proc-exit", (p) => {
      const e = p as ProcExit;
      const h = this.handlers.get(e.id);
      if (h) {
        this.handlers.delete(e.id);
        h.exit(e.code);
      }
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      const cmd = this.input.value;
      this.input.value = "";
      void this.run(cmd);
    } else if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      if (this.running) {
        void api.killShell(this.running);
        this.write("^C", true);
      }
    } else if (e.key === "ArrowUp") {
      if (this.histIdx < this.history.length - 1) this.histIdx++;
      this.input.value = this.history[this.history.length - 1 - this.histIdx] ?? "";
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      if (this.histIdx > 0) this.histIdx--;
      else this.histIdx = -1;
      this.input.value = this.histIdx < 0 ? "" : this.history[this.history.length - 1 - this.histIdx] ?? "";
      e.preventDefault();
    }
  }

  /** Run one command for real. Resolves with the exit code. Exposed for the harness. */
  run(raw: string): Promise<number> {
    const cmd = raw.trim();
    if (!cmd) return Promise.resolve(0);
    if (cmd === "clear") {
      this.out.innerHTML = "";
      return Promise.resolve(0);
    }
    if (this.running) {
      this.write(t("term.stillRunning"), true);
      return Promise.resolve(-1);
    }
    this.history.push(cmd);
    this.histIdx = -1;
    this.write(`$ ${cmd}`);
    const id = `t${this.seq++}-${cmd.length}`;
    return new Promise<number>((resolve) => {
      this.handlers.set(id, {
        line: (l, err) => this.write(strip(l), err && /error|fatal|denied|failed/i.test(l)),
        exit: (code) => {
          this.running = null;
          if (code !== 0) this.write(`exit ${code}`, true);
          resolve(code);
        },
      });
      this.running = id;
      api.runShell(id, cmd, this.cwd()).catch((e) => {
        this.handlers.delete(id);
        this.running = null;
        this.write(String(e), true);
        resolve(-1);
      });
    });
  }

  /** Kill the in-flight command (the Ctrl+C path), if any. Returns its id. For the harness. */
  killCurrent(): string | null {
    const id = this.running;
    if (id) void api.killShell(id);
    return id;
  }

  // ── Modo PTY: shell interactiva real (pty_spawn/pty_write/pty_resize + xterm.js) ──

  /** Abre a sessão PTY e troca a vista para o xterm. Devolve false (com erro visível)
   * quando o backend recusa — nunca um terminal simulado. */
  async startPty(): Promise<boolean> {
    if (this.pty) return true;
    const xterm = new XTerm({
      fontFamily: '"SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 12.5, cursorBlink: true, convertEol: true,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    this.xtermHost.classList.remove("hidden");
    xterm.open(this.xtermHost);
    try { fit.fit(); } catch { /* host ainda sem tamanho (xvfb/painel oculto) */ }
    const sess: PtySession = { xterm, fit, unlisten: [], ro: new ResizeObserver(() => {}), buf: "" };
    // Listeners ANTES do spawn para não perder os primeiros bytes; guardados para limpeza.
    sess.unlisten.push(await listen("pty://data", (p) => {
      const chunk = String(p);
      sess.buf += chunk;
      if (sess.buf.length > 200000) sess.buf = sess.buf.slice(-100000);
      sess.xterm.write(chunk);
    }));
    sess.unlisten.push(await listen("pty://exit", () => {
      sess.xterm.write(`\r\n\x1b[90m${t("term.ptyExited")}\x1b[0m\r\n`);
      void this.stopPty(false);
    }));
    xterm.onData((d) => { void api.ptyWrite(d).catch(() => { /* sessão já fechada */ }); });
    try {
      await api.ptySpawn(xterm.rows || 24, xterm.cols || 80);
    } catch (e) {
      sess.unlisten.forEach((u) => u());
      xterm.dispose();
      this.xtermHost.classList.add("hidden");
      this.xtermHost.innerHTML = "";
      this.write(t("term.ptyFailed", { err: String(e) }), true);
      return false;
    }
    sess.ro = new ResizeObserver(() => {
      try { sess.fit.fit(); } catch { /* */ }
      void api.ptyResize(sess.xterm.rows || 24, sess.xterm.cols || 80).catch(() => { /* */ });
    });
    sess.ro.observe(this.xtermHost);
    this.pty = sess;
    this.host.querySelector(".term-out")?.classList.add("hidden");
    this.host.querySelector(".term-prompt")?.classList.add("hidden");
    this.input.classList.add("hidden");
    this.applyLocale();
    xterm.focus();
    return true;
  }

  /** Fecha o modo PTY: pede exit à shell (best-effort), LIMPA os listeners Tauri e o
   * ResizeObserver (fugas acumulam memória), e volta ao modo linha run_shell. */
  async stopPty(askExit = true): Promise<void> {
    const sess = this.pty;
    if (!sess) return;
    this.pty = null;
    if (askExit) await api.ptyWrite("exit\n").catch(() => { /* já saiu */ });
    sess.unlisten.forEach((u) => u());
    sess.unlisten.length = 0;
    sess.ro.disconnect();
    sess.xterm.dispose();
    this.xtermHost.innerHTML = "";
    this.xtermHost.classList.add("hidden");
    this.host.querySelector(".term-out")?.classList.remove("hidden");
    this.host.querySelector(".term-prompt")?.classList.remove("hidden");
    this.input.classList.remove("hidden");
    this.applyLocale();
  }

  /** Escreve no stdin da shell PTY (o que o run_shell não tem). Para o arnês e tarefas. */
  ptySend(data: string): void {
    if (this.pty) void api.ptyWrite(data).catch(() => { /* sessão fechada */ });
  }

  /** A saída crua acumulada da sessão PTY corrente (vazia sem sessão). Para o arnês. */
  ptyText(): string {
    return this.pty?.buf ?? "";
  }

  /** Quantos listeners Tauri o modo PTY tem vivos — tem de ser 0 depois de stopPty. */
  ptyListeners(): number {
    return this.pty?.unlisten.length ?? 0;
  }

  private write(text: string, err = false): void {
    const line = document.createElement("div");
    line.className = "term-line" + (err ? " err" : "");
    line.textContent = text;
    this.out.appendChild(line);
    while (this.out.childElementCount > 5000) this.out.removeChild(this.out.firstChild!);
    this.out.scrollTop = this.out.scrollHeight;
  }
}
