// Providers / Extensions panel: shows the REAL configuration state of each LLM provider
// (Claude / Codex / Gemini / Ollama) straight from the backend `keys_status` command, which
// resolves keys.json → the legacy ~/.config/dxtutor/providers.json → the matching env var. No
// simulation: a provider is "configured" only if the backend actually resolved a usable key
// (Ollama is local and always usable). The key itself is NEVER rendered — only a masked badge,
// so a key sitting in cleartext in providers.json is not leaked by this panel.

import { api } from "./tauri";
import { svg } from "./icons";
import { t } from "./i18n";

interface ProviderDef {
  id: string;
  label: string;
  vendor: string;
  local: boolean;
  endpoint: string;
  model: string;
}

// Mirrors the backend's provider set in bridge.rs::keys_status (claude/codex/gemini/ollama) and
// the defaults the Co-Dev dock uses. Endpoints/models are the real defaults, not invented data.
const CATALOG: ProviderDef[] = [
  { id: "claude", label: "Claude", vendor: "Anthropic", local: false, endpoint: "https://api.anthropic.com", model: "claude-haiku-4-5" },
  { id: "codex", label: "Codex", vendor: "OpenAI", local: false, endpoint: "https://api.openai.com", model: "gpt-4o-mini" },
  { id: "gemini", label: "Gemini", vendor: "Google", local: false, endpoint: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash" },
  { id: "ollama", label: "Ollama", vendor: "local", local: true, endpoint: "http://localhost:11434", model: "qwen2.5-coder:14b" },
];

export interface ProviderState {
  id: string;
  label: string;
  kind: "hosted" | "local";
  configured: boolean;
}

export class Providers {
  private status: Record<string, boolean> = {};
  private loaded = false;

  constructor(private host: HTMLElement) {
    this.host.innerHTML = `<div class="pv"></div>`;
    this.render();
  }

  /** Reload the real per-provider status from the backend and repaint. */
  async refresh(): Promise<void> {
    try {
      this.status = await api.keysStatus();
      this.loaded = true;
    } catch {
      this.status = {};
      this.loaded = false;
    }
    this.render();
  }

  /** The real state the panel is showing — exposed for the headless harness. */
  state(): { providers: ProviderState[]; loaded: boolean; rendered: number } {
    const providers = CATALOG.map((p) => ({
      id: p.id,
      label: p.label,
      kind: (p.local ? "local" : "hosted") as "hosted" | "local",
      configured: this.isConfigured(p),
    }));
    return { providers, loaded: this.loaded, rendered: this.host.querySelectorAll(".pv-card").length };
  }

  /** A hosted provider counts as configured only if the backend resolved a key; a local one
   * (Ollama) is always usable. No key value is ever read here — just the boolean. */
  private isConfigured(p: ProviderDef): boolean {
    return p.local || this.status[p.id] === true;
  }

  /** Repinta na locale corrente sem ir ao backend (os dados já estão carregados). */
  applyLocale(): void {
    this.render();
  }

  private render(): void {
    const el = this.host.querySelector(".pv") as HTMLElement;
    const configured = CATALOG.filter((p) => this.isConfigured(p)).length;
    const header = `<div class="pv-head">
      <span class="pv-count">${t("pv.ready", { n: configured, m: CATALOG.length })}</span>
      <button class="pv-refresh" title="${t("pv.refresh")}">${svg("refresh")}</button>
    </div>`;
    el.innerHTML = header + CATALOG.map((p) => this.card(p)).join("");
    (el.querySelector(".pv-refresh") as HTMLButtonElement).onclick = () => void this.refresh();
  }

  private card(p: ProviderDef): string {
    const on = this.isConfigured(p);
    // Hosted + configured → masked badge (never the key). Hosted + absent → "not set".
    // Local → "local runtime" (no key concept).
    const keyCell = p.local
      ? `<span class="pv-key local">${t("pv.local")}</span>`
      : on
        ? `<span class="pv-key set">${t("pv.keySet")}</span>`
        : `<span class="pv-key none">${t("pv.noKey")}</span>`;
    const badge = on ? t("pv.badgeOn") : t("pv.badgeOff");
    return `<div class="pv-card" data-id="${p.id}">
      <div class="pv-row">
        <span class="pv-name">${p.label} <span class="pv-vendor">${p.vendor}</span></span>
        <span class="pv-badge ${on ? "on" : ""}">${badge}</span>
      </div>
      <div class="pv-kv"><span>${t("pv.kind")}</span><span>${p.local ? t("pv.kindLocal") : t("pv.hosted")}</span></div>
      <div class="pv-kv"><span>${t("pv.endpoint")}</span><span>${p.endpoint}</span></div>
      <div class="pv-kv"><span>${t("pv.model")}</span><span>${p.model}</span></div>
      <div class="pv-kv"><span>${t("pv.auth")}</span>${keyCell}</div>
    </div>`;
  }
}
