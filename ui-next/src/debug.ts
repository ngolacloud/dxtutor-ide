// Debug panel driving the real gdb/MI backend: launch a binary with symbols, hit breakpoints
// set in the editor, and show the real call stack + variables. No simulation — when gdb is
// absent or nothing is stopped the panel says so honestly.

import { api, type DebugStop, type DebugFrame, type DebugVar } from "./tauri";
import { svg } from "./icons";
import { t } from "./i18n";

export interface DebugHooks {
  root(): string;
  breakpoints(): { file: string; line: number }[]; // absolute file paths
  showStop(file: string, line: number): void; // reveal the stopped line in the editor
}

const SID = "main";

export class Debug {
  private running = false;
  private stack: DebugFrame[] = [];
  private vars: DebugVar[] = [];
  private status = "";
  private programInput: HTMLInputElement;

  constructor(private host: HTMLElement, private hooks: DebugHooks) {
    host.innerHTML = `
      <div class="dbg">
        <div class="dbg-controls">
          <button class="dbg-btn" data-act="launch">${svg("run", "fill")}</button>
          <button class="dbg-btn" data-act="continue" disabled>${svg("run")}</button>
          <button class="dbg-btn" data-act="next" disabled>${svg("chev")}</button>
          <button class="dbg-btn" data-act="step" disabled>${svg("chev")}</button>
          <button class="dbg-btn" data-act="stop" disabled>${svg("close")}</button>
        </div>
        <input class="dbg-prog" spellcheck="false" />
        <div class="dbg-status"></div>
        <div class="dbg-sec dbg-sec-vars"></div>
        <div class="dbg-vars"></div>
        <div class="dbg-sec dbg-sec-stack"></div>
        <div class="dbg-stack"></div>
      </div>`;
    this.programInput = host.querySelector(".dbg-prog") as HTMLInputElement;
    host.querySelectorAll<HTMLButtonElement>(".dbg-btn").forEach((b) => {
      b.onclick = () => void this.onAct(b.dataset.act ?? "");
    });
    this.applyLocale();
    this.render();
  }

  /** Repinta os rótulos estáticos do painel na locale corrente. */
  applyLocale(): void {
    const titles: Record<string, string> = {
      launch: t("debug.launch"), continue: t("debug.continue"), next: t("debug.stepOver"),
      step: t("debug.stepInto"), stop: t("debug.stopTitle"),
    };
    this.host.querySelectorAll<HTMLButtonElement>(".dbg-btn").forEach((b) => {
      b.title = titles[b.dataset.act ?? ""] ?? "";
    });
    this.programInput.placeholder = t("debug.progPlaceholder");
    (this.host.querySelector(".dbg-sec-vars") as HTMLElement).textContent = t("debug.vars");
    (this.host.querySelector(".dbg-sec-stack") as HTMLElement).textContent = t("debug.stack");
  }

  private async onAct(act: string): Promise<void> {
    try {
      if (act === "launch") await this.launch();
      else if (act === "continue") await this.applyStop(await api.debugContinue(SID));
      else if (act === "next") await this.applyStop(await api.debugStep(SID, false));
      else if (act === "step") await this.applyStop(await api.debugStep(SID, true));
      else if (act === "stop") await this.stop();
    } catch (e) {
      this.status = String(e);
      this.render();
    }
  }

  /** Launch gdb on the program, set the editor's breakpoints, and run to the first one. */
  async launch(program?: string): Promise<DebugStop | null> {
    const root = this.hooks.root();
    const prog = (program ?? this.programInput.value).trim();
    if (program) this.programInput.value = program;
    if (!root || !prog) { this.status = t("debug.setProgram"); this.render(); return null; }
    const abs = prog.startsWith("/") ? prog : `${root}/${prog}`;
    await api.debugLaunch(SID, abs, root);
    this.running = true;
    for (const bp of this.hooks.breakpoints()) {
      await api.debugBreak(SID, bp.file, bp.line).catch(() => 0);
    }
    const stop = await api.debugRun(SID);
    await this.applyStop(stop);
    return stop;
  }

  private async applyStop(stop: DebugStop): Promise<void> {
    if (stop.exited) {
      this.status = t("debug.exited", { code: stop.exitCode != null ? t("debug.exitCode", { n: stop.exitCode }) : "" });
      this.running = false;
      this.stack = [];
      this.vars = [];
    } else if (stop.stopped) {
      this.status = t("debug.stoppedIn", { reason: stop.reason, func: stop.func, loc: `${stop.file.split("/").pop()}:${stop.line}` });
      this.stack = await api.debugStack(SID).catch(() => []);
      this.vars = await api.debugLocals(SID).catch(() => []);
      if (stop.file && stop.line) this.hooks.showStop(stop.file, stop.line);
    }
    this.render();
  }

  async stop(): Promise<void> {
    await api.debugStop(SID).catch(() => {});
    this.running = false;
    this.stack = [];
    this.vars = [];
    this.status = t("debug.ended");
    this.render();
  }

  /** Current debug snapshot — exposed for the harness and the Debug Assistant (F14). */
  snapshot(): { running: boolean; stack: number; frames: DebugFrame[]; vars: DebugVar[]; status: string } {
    return { running: this.running, stack: this.stack.length, frames: [...this.stack], vars: this.vars, status: this.status };
  }

  private render(): void {
    this.host.querySelectorAll<HTMLButtonElement>('.dbg-btn[data-act]').forEach((b) => {
      const a = b.dataset.act;
      if (a === "launch") b.disabled = this.running;
      else b.disabled = !this.running;
    });
    (this.host.querySelector(".dbg-status") as HTMLElement).textContent = this.status;
    const vs = this.host.querySelector(".dbg-vars") as HTMLElement;
    vs.innerHTML = this.vars.length
      ? this.vars.map(() => `<div class="dbg-row"><span class="dbg-k"></span><span class="dbg-v"></span></div>`).join("")
      : `<div class="dbg-empty">—</div>`;
    this.vars.forEach((v, i) => {
      const r = vs.children[i];
      (r.querySelector(".dbg-k") as HTMLElement).textContent = v.name;
      (r.querySelector(".dbg-v") as HTMLElement).textContent = v.value;
    });
    const st = this.host.querySelector(".dbg-stack") as HTMLElement;
    st.innerHTML = this.stack.length
      ? this.stack.map(() => `<div class="dbg-frame"><span class="dbg-fn"></span><span class="dbg-loc"></span></div>`).join("")
      : `<div class="dbg-empty">—</div>`;
    this.stack.forEach((f, i) => {
      const r = st.children[i];
      (r.querySelector(".dbg-fn") as HTMLElement).textContent = f.func;
      (r.querySelector(".dbg-loc") as HTMLElement).textContent = `${f.file.split("/").pop()}:${f.line}`;
    });
  }
}
