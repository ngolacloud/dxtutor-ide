// Explain panel: explains the active file through the real governed llm_chat (origin
// tutor-llm). No simulation — without a provider it says so; it never fabricates an answer.

import { svg } from "./icons";
import { t } from "./i18n";

export interface ExplainHooks {
  activeFile(): { rel: string; content: string } | null;
  explain(rel: string, content: string): Promise<{ text: string; origin: string }>;
}

export class Explain {
  private out: HTMLElement;
  private busy = false;

  constructor(private host: HTMLElement, private hooks: ExplainHooks) {
    this.buildScaffold();
    this.out = host.querySelector(".ex-out") as HTMLElement;
  }

  private buildScaffold(): void {
    this.host.innerHTML = `
      <div class="ex">
        <button class="ex-btn">${svg("bulb", "fill")} ${t("explain.btn")}</button>
        <div class="ex-out"><div class="ex-empty">${t("explain.empty")}</div></div>
      </div>`;
    (this.host.querySelector(".ex-btn") as HTMLButtonElement).onclick = () => void this.run();
  }

  /** Repinta o scaffold estático na locale corrente (o painel não guarda estado). */
  applyLocale(): void {
    if (this.busy) return;
    this.buildScaffold();
    this.out = this.host.querySelector(".ex-out") as HTMLElement;
  }

  /** Explain the active file. Returns the origin for the harness. */
  async run(): Promise<{ text: string; origin: string } | null> {
    if (this.busy) return null;
    const f = this.hooks.activeFile();
    if (!f) { this.out.innerHTML = `<div class="ex-empty">${t("explain.noFile")}</div>`; return null; }
    this.busy = true;
    this.out.innerHTML = `<div class="ex-empty"></div>`;
    (this.out.firstChild as HTMLElement).textContent = t("explain.busy", { file: f.rel });
    try {
      const r = await this.hooks.explain(f.rel, f.content);
      this.out.textContent = r.text || t("explain.emptyResp");
      return r;
    } catch (e) {
      this.out.innerHTML = `<div class="ex-empty"></div>`;
      (this.out.firstChild as HTMLElement).textContent = String(e);
      return null;
    } finally {
      this.busy = false;
    }
  }
}
