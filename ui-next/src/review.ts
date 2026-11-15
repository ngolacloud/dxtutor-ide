// Problems panel: runs the real review (review_code → clippy/ruff/rustc/…) over the active
// file and lists the findings. No simulation — an empty list means the analyzers found nothing
// (or none is installed); the honest note from the backend says which ran.

import { api, type Finding } from "./tauri";
import { t } from "./i18n";

export class Review {
  private findings: Finding[] = [];
  private note = "";

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private onJump: (file: string, line: number) => void,
    private onCount: (n: number) => void,
  ) {
    this.render();
  }

  /** Run the real review on a file (project-relative path). Exposed for the harness. */
  async run(rel: string | null): Promise<Finding[]> {
    const root = this.root();
    if (!root || !rel) { this.findings = []; this.note = t("review.openFile"); this.render(); return []; }
    this.note = t("review.reviewing");
    this.render();
    try {
      const report = await api.reviewCode(root, "file", `${root}/${rel}`);
      this.findings = report.findings;
      const ran = report.analyzers.filter((a) => a.ran).map((a) => a.analyzer);
      this.note = ran.length ? t("review.analyzers", { list: ran.join(", ") }) : t("review.noneRan");
    } catch (e) {
      this.findings = [];
      this.note = String(e);
    }
    this.onCount(this.findings.length);
    this.render();
    return this.findings;
  }

  get count(): number {
    return this.findings.length;
  }

  private render(): void {
    const sev = (s: string) => (s.toLowerCase().startsWith("err") ? "err" : s.toLowerCase().startsWith("warn") ? "warn" : "info");
    this.host.innerHTML =
      `<div class="pr-note"></div>` +
      (this.findings.length === 0
        ? `<div class="pr-empty">${t("review.noProblems")}</div>`
        : this.findings
            .map(() => `<div class="pr-row"><span class="pr-dot"></span><span class="pr-msg"></span><span class="pr-loc"></span></div>`)
            .join(""));
    (this.host.querySelector(".pr-note") as HTMLElement).textContent = this.note;
    this.host.querySelectorAll(".pr-row").forEach((row, i) => {
      const f = this.findings[i];
      (row.querySelector(".pr-dot") as HTMLElement).className = `pr-dot ${sev(f.severity)}`;
      (row.querySelector(".pr-msg") as HTMLElement).textContent = `${f.analyzer}${f.rule ? ` ${f.rule}` : ""}: ${f.message}`;
      (row.querySelector(".pr-loc") as HTMLElement).textContent = `${f.primary.file.split("/").pop()}:${f.primary.startLine}`;
      (row as HTMLElement).onclick = () => this.onJump(f.primary.file, f.primary.startLine);
    });
  }
}
