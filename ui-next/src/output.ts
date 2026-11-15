// Painel Output: registo client-side dos eventos REAIS do IDE — mensagens e ferramentas
// do Co-Dev, corridas de testes. Nada é inventado: cada linha nasce de uma acção real;
// vazio significa que nada aconteceu ainda.

import { t } from "./i18n";

export class Output {
  private lines: { at: string; text: string }[] = [];

  constructor(private host: HTMLElement) {
    this.render();
  }

  get count(): number {
    return this.lines.length;
  }

  log(text: string): void {
    this.lines.push({ at: new Date().toLocaleTimeString(), text });
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  private render(): void {
    if (!this.lines.length) {
      this.host.innerHTML = `<div class="out-empty"></div>`;
      (this.host.querySelector(".out-empty") as HTMLElement).textContent = t("out.empty");
      return;
    }
    this.host.innerHTML = this.lines
      .map(() => `<div class="out-line"><span class="out-at"></span><span class="out-txt"></span></div>`)
      .join("");
    this.host.querySelectorAll(".out-line").forEach((row, i) => {
      const l = this.lines[i];
      (row.querySelector(".out-at") as HTMLElement).textContent = l.at;
      (row.querySelector(".out-txt") as HTMLElement).textContent = l.text;
    });
    this.host.scrollTop = this.host.scrollHeight;
  }
}
