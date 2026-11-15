// Painel Testing: descobre e corre os testes REAIS do projecto aberto (crate
// tutor-eval::testnav). A lista vem de list_tests (análise sintáctica com syn); o
// veredicto vem do runner (cargo test --exact / go test -run / pytest), nunca de um
// modelo. Sem simulação: lista vazia significa que o projecto não tem testes.

import { api, type TestItem, type TestRun } from "./tauri";
import { t } from "./i18n";
import { svg } from "./icons";

export class Tests {
  items: TestItem[] = [];
  private verdicts = new Map<string, TestRun>();
  private note = "";

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private onJump: (file: string, line: number) => void,
    private onRun: (title: string, run: TestRun, item?: TestItem) => void,
  ) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** Redescobre os testes do projecto aberto. Exposto para o harness. */
  async refresh(): Promise<TestItem[]> {
    const root = this.root();
    if (!root) { this.items = []; this.note = t("tests.noFolder"); this.render(); return []; }
    this.note = t("tests.discovering");
    this.render();
    try {
      this.items = await api.listTests(root);
      this.note = this.items.length ? "" : t("tests.none");
    } catch (e) {
      this.items = [];
      this.note = String(e);
    }
    this.verdicts.clear();
    this.render();
    return this.items;
  }

  /** Corre UM teste; o veredicto (pass/fail) é o do runner real. Exposto para o harness. */
  async runOne(it: TestItem): Promise<TestRun> {
    const run = await api.runTest(this.root(), it.path, it.lang);
    this.verdicts.set(this.key(it), run);
    this.render();
    this.onRun(it.name, run, it);
    return run;
  }

  /** Corre a suite inteira do projecto. */
  async runAll(): Promise<TestRun> {
    const run = await api.runAllTests(this.root());
    this.render();
    this.onRun(t("tests.all"), run);
    return run;
  }

  private key(it: TestItem): string {
    return `${it.file}::${it.path}`;
  }

  private render(): void {
    const root = this.root();
    const relOf = (p: string) => (root && p.startsWith(root) ? p.slice(root.length + 1) : p);
    const byFile = new Map<string, TestItem[]>();
    for (const it of this.items) {
      const a = byFile.get(it.file) ?? [];
      a.push(it);
      byFile.set(it.file, a);
    }
    let rows = "";
    for (const fit of byFile.values()) {
      rows += `<div class="ts-grp"><span class="ts-grp-nm"></span><span class="ts-cnt">${fit.length}</span></div>`;
      rows += fit
        .map(() => `<div class="ts-row"><span class="ts-ind"></span><span class="ts-nm"></span><span class="ts-lang"></span></div>`)
        .join("");
    }
    this.host.innerHTML =
      `<div class="ts-acts">` +
      `<button class="ts-runall">${svg("run")}<span class="ts-runall-lbl"></span></button>` +
      `<button class="ts-refresh">${svg("refresh")}</button>` +
      `</div>` +
      `<div class="ts-note"></div>` +
      `<div class="ts-list">${rows}</div>`;
    (this.host.querySelector(".ts-note") as HTMLElement).textContent = this.note;
    (this.host.querySelector(".ts-runall-lbl") as HTMLElement).textContent = t("tests.runAll");
    (this.host.querySelector(".ts-refresh") as HTMLElement).title = t("tests.refresh");
    (this.host.querySelector(".ts-runall") as HTMLButtonElement).onclick = () => void this.runAll();
    (this.host.querySelector(".ts-refresh") as HTMLButtonElement).onclick = () => void this.refresh();
    // Preenche grupos e linhas por ordem de geração (textContent — nunca HTML de dados).
    const flat: TestItem[] = [];
    for (const fit of byFile.values()) flat.push(...fit);
    const grps = this.host.querySelectorAll(".ts-grp-nm");
    [...byFile.keys()].forEach((file, i) => {
      (grps[i] as HTMLElement).textContent = relOf(file);
    });
    this.host.querySelectorAll(".ts-row").forEach((row, i) => {
      const it = flat[i];
      const v = this.verdicts.get(this.key(it));
      const ind = row.querySelector(".ts-ind") as HTMLElement;
      ind.textContent = v ? (!v.ran ? "•" : v.passed ? "✓" : "✗") : "▸";
      ind.className = "ts-ind" + (v ? (!v.ran ? " warn" : v.passed ? " ok" : " bad") : "");
      (row.querySelector(".ts-nm") as HTMLElement).textContent = it.name + (it.ignored ? ` (${t("tests.ignored")})` : "");
      (row.querySelector(".ts-lang") as HTMLElement).textContent = it.lang;
      (row.querySelector(".ts-nm") as HTMLElement).onclick = () => void this.runOne(it);
      ind.onclick = () => void this.runOne(it);
      (row as HTMLElement).onclick = (e) => {
        if ((e.target as HTMLElement).closest(".ts-nm, .ts-ind")) return;
        this.onJump(it.file, it.line);
      };
    });
  }
}
