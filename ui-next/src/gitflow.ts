// GitFlow panel (lives inside the SCM view): start feature/fix/release/hotfix branches and
// finish (integrate) the current one — all against the real repo. Unlike the v7 reference
// (which only printed the finish commands), the backend now exposes `exec`, so finish RUNS
// the real `git merge --no-ff` + `git branch -d` and reports git's own stderr on failure.
//
// Base convention: feature/fix/release start from `develop` when it exists, otherwise from
// main/master (trunk-based repos stay honest — no silent branch-from-wherever); hotfix always
// starts from main/master.

import { api } from "./tauri";
import { t } from "./i18n";

export type FlowKind = "feature" | "fix" | "release" | "hotfix";
const FLOW = /^(feature|fix|release|hotfix)\//;

export interface FinishInfo {
  branch: string;
  base: string;
}

/** Normaliza um nome em slug de ramo; mantém pontos (ex. versões 0.3.0). */
export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

export class Gitflow {
  private branch = "";
  private branches: string[] = [];
  private busy = false;

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private onChanged: () => void,
  ) {
    this.host.innerHTML = `
      <div class="scm-sec gf-title"></div>
      <div class="gf-branch"></div>
      <div class="gf-bar"></div>`;
    this.applyLocale();
  }

  /** Repinta os rótulos estáticos + botões na locale corrente. */
  applyLocale(): void {
    (this.host.querySelector(".gf-title") as HTMLElement).textContent = t("gf.title");
    this.render();
  }

  /** Recarrega o estado git real (ramo actual + lista de ramos) e repinta. */
  async refresh(): Promise<void> {
    const root = this.root();
    if (!root) { this.branch = ""; this.branches = []; this.render(); return; }
    try {
      [this.branch, this.branches] = await Promise.all([
        api.gitBranch(root).then((b) => b ?? ""),
        api.gitBranches(root),
      ]);
    } catch {
      this.branch = "";
      this.branches = [];
    }
    this.render();
  }

  get current(): string {
    return this.branch;
  }
  get onFlowBranch(): boolean {
    return FLOW.test(this.branch);
  }

  /** O ramo base para um tipo de fluxo, dado o que EXISTE no repo (nunca inventa). */
  private baseFor(kind: FlowKind): string | null {
    const has = (b: string): boolean => this.branches.includes(b);
    if (kind !== "hotfix" && has("develop")) return "develop";
    if (has("main")) return "main";
    if (has("master")) return "master";
    return null;
  }

  /** Inicia um ramo de fluxo: checkout da base certa e `checkout -b kind/slug`. */
  async start(kind: FlowKind, name: string): Promise<string> {
    const root = this.root();
    if (!root) throw new Error(t("gf.noRepo"));
    const s = slug(name);
    if (!s) throw new Error(t("gf.emptyName"));
    await this.refresh();
    const base = this.baseFor(kind);
    if (!base) throw new Error(t("gf.baseMissing"));
    const branch = `${kind}/${s}`;
    await api.gitCheckout(root, base);
    await api.gitCreateBranch(root, branch); // git checkout -b: cria E muda
    await this.refresh();
    this.onChanged();
    return branch;
  }

  /** Finaliza o ramo de fluxo actual: merge --no-ff na base real (+tag em release/hotfix,
   * +merge em develop quando existe) e apaga o ramo. Devolve null se não estamos num ramo
   * de fluxo ou se o git recusar (o erro do git chega ao chamador via Error). */
  async finish(): Promise<FinishInfo | null> {
    const root = this.root();
    if (!root) throw new Error(t("gf.noRepo"));
    await this.refresh();
    const branch = this.branch;
    if (!FLOW.test(branch)) return null;
    const kind = branch.split("/")[0] as FlowKind;
    const base = this.baseFor(kind);
    if (!base) throw new Error(t("gf.baseMissing"));
    const git = async (args: string[]): Promise<void> => {
      const r = await api.exec("git", args, root);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
    };
    await api.gitCheckout(root, base);
    await git(["merge", "--no-ff", branch, "-m", `merge ${branch}`]);
    if (kind === "release" || kind === "hotfix") {
      await git(["tag", branch.slice(branch.indexOf("/") + 1)]);
      // release/hotfix fundem na main E em develop quando ela existe (convenção GitFlow).
      if (base !== "develop" && this.branches.includes("develop")) {
        await api.gitCheckout(root, "develop");
        await git(["merge", "--no-ff", branch, "-m", `merge ${branch}`]);
        await api.gitCheckout(root, base);
      }
    }
    await git(["branch", "-d", branch]);
    await this.refresh();
    this.onChanged();
    return { branch, base };
  }

  // ── UI ──
  private render(): void {
    const br = this.host.querySelector(".gf-branch") as HTMLElement;
    br.textContent = this.branch ? t("gf.onBranch", { branch: this.branch }) : t("gf.noRepo");
    const bar = this.host.querySelector(".gf-bar") as HTMLElement;
    bar.innerHTML = "";
    const btn = (label: string, run: () => void, pri = false): void => {
      const b = document.createElement("button");
      b.textContent = label;
      if (pri) b.className = "pri";
      b.disabled = this.busy;
      b.onclick = run;
      bar.appendChild(b);
    };
    if (this.onFlowBranch) {
      btn(t("gf.btnFinish", { branch: this.branch }), () => void this.finishUi(), true);
      return;
    }
    btn(t("gf.btnFeature"), () => void this.startUi("feature"));
    btn(t("gf.btnFix"), () => void this.startUi("fix"));
    btn(t("gf.btnRelease"), () => void this.startUi("release"));
    btn(t("gf.btnHotfix"), () => void this.startUi("hotfix"));
  }

  private toast(msg: string): void {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  private async startUi(kind: FlowKind): Promise<void> {
    const cap = kind.charAt(0).toUpperCase() + kind.slice(1);
    const raw = window.prompt(t(`gf.prompt${cap}`));
    if (raw === null) return;
    this.busy = true;
    this.render();
    try {
      const branch = await this.start(kind, raw);
      const base = this.baseFor(kind) ?? "";
      this.toast(t("gf.created", { branch, base }));
    } catch (e) {
      this.toast(String(e instanceof Error ? e.message : e));
    } finally {
      this.busy = false;
      void this.refresh();
    }
  }

  private async finishUi(): Promise<void> {
    await this.refresh();
    if (!this.onFlowBranch) { this.toast(t("gf.notFlow")); return; }
    const kind = this.branch.split("/")[0] as FlowKind;
    const base = this.baseFor(kind) ?? "?";
    // Finalizar funde e apaga o ramo — acção com peso: pede sempre confirmação no UI.
    if (!window.confirm(t("gf.confirmFinish", { branch: this.branch, base }))) return;
    this.busy = true;
    this.render();
    try {
      const fin = await this.finish();
      if (fin) this.toast(t("gf.finished", { branch: fin.branch, base: fin.base }));
      else this.toast(t("gf.notFlow"));
    } catch (e) {
      this.toast(t("gf.finishFailed", { err: String(e instanceof Error ? e.message : e) }));
    } finally {
      this.busy = false;
      void this.refresh();
    }
  }
}
