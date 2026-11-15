// Team panel: the roster of assistant roles the Co-Dev concept uses, each shown with the model
// it would route to RIGHT NOW. No simulation: the roster itself is a fixed design catalog (like
// the provider catalog in providers.ts), but every "recommended provider" is resolved by a
// deterministic router over the REAL, live `list_providers` backend data — a role only ever
// recommends a provider the backend actually reports as available. Nothing is persisted, nothing
// is seeded into localStorage, and the panel makes NO claim that the per-role harness (paths it
// may write, commands it may run) is enforced on backend tool calls — that enforcement is not
// wired, so this panel does not pretend otherwise. It is preview, grounded in real availability.

import { api, type ProviderInfo } from "./tauri";
import { svg } from "./icons";
import { t } from "./i18n";

type Cap = "reason" | "code" | "speed" | "cost" | "priv" | "ctx";
type TaskId = "arch" | "code" | "db" | "ui" | "test" | "ops" | "teach" | "sens";

interface Role {
  key: string;
  task: TaskId;
  color: string;
}

// The fixed roster of assistant roles (design catalog — the real set the Co-Dev concept uses).
// Names/descriptions live in i18n.ts under tv.role.<key> / tv.role.<key>.d.
const ROSTER: Role[] = [
  { key: "lead", task: "arch", color: "#e06c3b" },
  { key: "arq", task: "arch", color: "#e08a5b" },
  { key: "be", task: "code", color: "#dea584" },
  { key: "db", task: "db", color: "#5cc9a7" },
  { key: "fe", task: "ui", color: "#6ea8ff" },
  { key: "qa", task: "test", color: "#e0b64a" },
  { key: "ops", task: "ops", color: "#c678dd" },
  { key: "tutor", task: "teach", color: "#5fcad6" },
];

// Weight of each task profile over the capabilities (design constants; used only to rank the
// providers the backend reports as available).
const TASK_WEIGHTS: Record<TaskId, Partial<Record<Cap, number>>> = {
  arch: { reason: 5, ctx: 3, code: 1 },
  code: { code: 5, reason: 2, speed: 1 },
  db: { reason: 4, code: 3, ctx: 1 },
  ui: { code: 3, speed: 3, cost: 2 },
  test: { code: 3, speed: 3, cost: 3 },
  ops: { reason: 3, code: 3, cost: 2 },
  teach: { reason: 5, speed: 2 },
  sens: { priv: 10, cost: 1 },
};

const CAPS: Cap[] = ["reason", "code", "speed", "cost", "priv", "ctx"];

// Capability profiles per provider id (design constants, 0–10). Keyed by the real ids the
// backend's list_providers returns. A provider the backend doesn't report simply never appears.
const CAP: Record<string, Record<Cap, number>> = {
  claude: { reason: 10, code: 9, speed: 6, cost: 4, priv: 3, ctx: 9 },
  gemini: { reason: 8, code: 8, speed: 8, cost: 7, priv: 3, ctx: 10 },
  openai: { reason: 8, code: 10, speed: 7, cost: 6, priv: 3, ctx: 7 },
  ollama: { reason: 5, code: 6, speed: 5, cost: 10, priv: 10, ctx: 4 },
  copilot: { reason: 6, code: 8, speed: 7, cost: 6, priv: 3, ctx: 6 },
};
const DEFAULT_CAP: Record<Cap, number> = { reason: 5, code: 5, speed: 5, cost: 5, priv: 5, ctx: 5 };

export interface RoleRoute { key: string; name: string; task: TaskId; recommended: string | null; recommendedName: string | null; source: "harness" | "router" }

export class Team {
  private providers: ProviderInfo[] = [];
  private loaded = false;
  // Routing papel→modelo do harness do projecto (.dxtutor/harness.toml). Um pin só é
  // honrado quando o provedor está DISPONÍVEL no list_providers vivo — a disponibilidade
  // real continua a decidir; sem pin (ou pin indisponível) manda o router determinista.
  private routing: Record<string, string> | null = null;

  constructor(private host: HTMLElement) {
    this.host.innerHTML = `<div class="tv"></div>`;
    this.render();
  }

  /** Reload the real provider list from the backend and repaint. */
  async refresh(): Promise<void> {
    try {
      this.providers = await api.listProviders();
      this.loaded = true;
    } catch {
      this.providers = [];
      this.loaded = false;
    }
    this.render();
  }

  /** The best available provider for a role's task, ranked over the LIVE availability. Returns
   * null when the backend reports no usable provider. */
  private route(task: TaskId): ProviderInfo | null {
    const w = TASK_WEIGHTS[task];
    const ranked = this.providers
      .filter((p) => p.available)
      .map((p) => {
        const cap = CAP[p.id] ?? DEFAULT_CAP;
        const score = CAPS.reduce((acc, c) => acc + cap[c] * (w[c] ?? 0), 0);
        return { p, score };
      })
      .sort((a, b) => b.score - a.score);
    return ranked.length ? ranked[0].p : null;
  }

  /** Aplica (ou limpa, com null) o routing do harness e repinta. */
  setRouting(routing: Record<string, string> | null): void {
    this.routing = routing;
    if (this.host.innerHTML) this.render();
  }

  /** O provedor resolvido para um papel: pin do harness quando disponível, senão router. */
  private resolve(r: Role): { p: ProviderInfo | null; source: "harness" | "router" } {
    const pin = this.routing?.[r.key];
    if (pin) {
      const p = this.providers.find((x) => x.id === pin && x.available);
      if (p) return { p, source: "harness" };
    }
    return { p: this.route(r.task), source: "router" };
  }

  /** The real state the panel is showing — exposed for the headless harness. */
  state(): { roles: RoleRoute[]; providersAvailable: string[]; loaded: boolean; rendered: number } {
    const roles = ROSTER.map((r) => {
      const { p: rec, source } = this.resolve(r);
      return { key: r.key, name: t(`tv.role.${r.key}`), task: r.task, recommended: rec?.id ?? null, recommendedName: rec?.name ?? null, source };
    });
    return {
      roles,
      providersAvailable: this.providers.filter((p) => p.available).map((p) => p.id),
      loaded: this.loaded,
      rendered: this.host.querySelectorAll(".tv-card").length,
    };
  }

  /** Repinta na locale corrente sem ir ao backend (os dados já estão carregados). */
  applyLocale(): void {
    this.render();
  }

  private render(): void {
    const el = this.host.querySelector(".tv") as HTMLElement;
    const avail = this.providers.filter((p) => p.available).length;
    const header = `<div class="tv-head">
      <span class="tv-count">${t("tv.avail", { n: avail, m: this.providers.length })}</span>
      <button class="tv-refresh" title="${t("tv.refresh")}">${svg("refresh")}</button>
    </div>
    <div class="tv-note">${t("tv.note")}</div>`;
    el.innerHTML = header + ROSTER.map((r) => this.card(r)).join("");
    (el.querySelector(".tv-refresh") as HTMLButtonElement).onclick = () => void this.refresh();
  }

  private card(r: Role): string {
    const { p: rec, source } = this.resolve(r);
    const name = t(`tv.role.${r.key}`);
    const recCell = rec
      ? `<span class="tv-model on"><span class="tv-dot" style="background:${r.color}"></span>${rec.name}${source === "harness" ? ` <i class="hub-src">${t("hub.src.harness")}</i>` : ""}</span>`
      : `<span class="tv-model none">${t("tv.none")}</span>`;
    return `<div class="tv-card" data-key="${r.key}">
      <div class="tv-row">
        <span class="tv-name"><span class="tv-av" style="background:${r.color}">${name.charAt(0)}</span>${name}</span>
        <span class="tv-task">${t(`tv.task.${r.task}`)}</span>
      </div>
      <div class="tv-desc">${t(`tv.role.${r.key}.d`)}</div>
      <div class="tv-kv"><span>${t("tv.router")}</span>${recCell}</div>
    </div>`;
  }
}
