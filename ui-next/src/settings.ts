// Painel Definições: idioma, tema, chaves de provedor e motor sandbox — tudo real.
// As chaves vão para o backend via save_key e o estado volta por keys_status (booleano);
// o valor da chave NUNCA é relido nem renderizado — só um badge mascarado (padrão
// providers.ts). O motor sandbox é lido/escrito via get/set_sandbox_engine. O Ollama
// (host/modelo) vem de get_providers_config — campos não-secretos, só leitura aqui.

import { api, type ProvidersConfig } from "./tauri";
import { svg } from "./icons";
import { t, getLocale, setLocale, type Locale } from "./i18n";
import { getTheme, setTheme, THEMES, type Theme } from "./theme";

const HOSTED = [
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
];

const ENGINES = ["host", "delonix", "docker", "podman"];

export class Settings {
  private keys: Record<string, boolean> = {};
  private config: ProvidersConfig | null = null;
  private engine = "";
  private note = "";
  private loaded = false;

  constructor(private host: HTMLElement) {
    this.host.innerHTML = `<div class="stg"></div>`;
    this.render();
  }

  /** Recarrega o estado real (keys_status + config + motor sandbox) e repinta. */
  async refresh(): Promise<void> {
    try {
      [this.keys, this.config, this.engine] = await Promise.all([
        api.keysStatus(),
        api.getProvidersConfig(),
        api.getSandboxEngine(),
      ]);
      this.loaded = true;
    } catch {
      this.keys = {};
      this.config = null;
      this.engine = "";
      this.loaded = false;
    }
    this.render();
  }

  /** O estado real do painel — exposto para o harness. */
  state(): { loaded: boolean; engine: string; locale: Locale; theme: Theme; configured: string[] } {
    return {
      loaded: this.loaded,
      engine: this.engine,
      locale: getLocale(),
      theme: getTheme(),
      configured: HOSTED.filter((p) => this.keys[p.id] === true).map((p) => p.id),
    };
  }

  /** Muda o idioma pelo caminho do painel (o que o selector faz). */
  setLanguage(l: Locale): void {
    setLocale(l);
    this.render();
  }

  /** Muda o tema pelo caminho do painel. */
  setTheme(tm: Theme): void {
    setTheme(tm);
    this.render();
  }

  /** Guarda uma chave via save_key e relê o estado por keys_status. O valor nunca fica no DOM. */
  async saveKey(provider: string, key: string): Promise<void> {
    await api.saveKey(provider, key);
    this.note = t("stg.keySaved", { provider });
    await this.refresh();
  }

  /** Troca o motor sandbox via set_sandbox_engine e relê por get_sandbox_engine. */
  async setEngine(engine: string): Promise<string> {
    const applied = await api.setSandboxEngine(engine);
    this.engine = await api.getSandboxEngine();
    this.note = t("stg.engineSet", { engine: this.engine });
    this.render();
    return applied;
  }

  private render(): void {
    const el = this.host.querySelector(".stg") as HTMLElement;
    const locale = getLocale();
    const theme = getTheme();
    const langBtn = (l: Locale, label: string) =>
      `<button class="stg-opt ${locale === l ? "on" : ""}" data-lang="${l}">${label}</button>`;
    const themeBtn = (tm: Theme) =>
      `<button class="stg-opt ${theme === tm ? "on" : ""}" data-theme-opt="${tm}">${t(`stg.theme.${tm}`)}</button>`;
    const keyRow = (p: { id: string; label: string }) => {
      const on = this.keys[p.id] === true;
      const badge = on
        ? `<span class="pv-key set">${t("pv.keySet")}</span>`
        : `<span class="pv-key none">${t("pv.noKey")}</span>`;
      return `<div class="stg-keyrow" data-id="${p.id}">
        <span class="stg-keyname">${p.label}</span>
        <span class="stg-badge ${on ? "on" : ""}">${on ? t("stg.configured") : t("stg.notConfigured")}</span>
        ${badge}
        <input class="stg-keyinput" type="password" placeholder="${t("stg.keyPlaceholder")}" spellcheck="false" autocomplete="off" />
        <button class="stg-keysave">${t("stg.saveKey")}</button>
      </div>`;
    };
    const engineBtn = (e: string) =>
      `<button class="stg-opt ${this.engine === e ? "on" : ""}" data-engine="${e}">${e}</button>`;
    const ollama = this.config
      ? `<div class="stg-kv"><span>${t("stg.ollama")} ${t("stg.ollamaHost")}</span><span>${this.config.ollamaHost || "http://localhost:11434"}</span></div>
         <div class="stg-kv"><span>${t("stg.ollama")} ${t("stg.ollamaModel")}</span><span>${this.config.ollamaModel || "—"}</span></div>`
      : "";

    el.innerHTML = `
      <div class="stg-sub">${t("stg.sub")}</div>
      <div class="stg-sec">${t("stg.language")}</div>
      <div class="stg-opts">${langBtn("ptAO", t("stg.lang.ptAO"))}${langBtn("en", t("stg.lang.en"))}</div>
      <div class="stg-sec">${t("stg.appearance")}</div>
      <div class="stg-opts">${THEMES.map(themeBtn).join("")}</div>
      <div class="stg-sec">${t("stg.providers")}</div>
      ${HOSTED.map(keyRow).join("")}
      ${ollama}
      <div class="stg-sec">${t("stg.sandbox")}</div>
      <div class="stg-note">${t("stg.sandboxNote")}</div>
      <div class="stg-opts">${ENGINES.map(engineBtn).join("")}</div>
      <div class="stg-status"></div>
      <div class="stg-head"><button class="stg-refresh" title="${t("pv.refresh")}">${svg("refresh")}</button></div>`;

    (el.querySelector(".stg-status") as HTMLElement).textContent = this.note;
    el.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((b) => {
      b.onclick = () => this.setLanguage(b.dataset.lang as Locale);
    });
    el.querySelectorAll<HTMLButtonElement>("[data-theme-opt]").forEach((b) => {
      b.onclick = () => this.setTheme(b.dataset.themeOpt as Theme);
    });
    el.querySelectorAll<HTMLElement>(".stg-keyrow").forEach((row) => {
      const input = row.querySelector(".stg-keyinput") as HTMLInputElement;
      const save = async () => {
        const key = input.value.trim();
        if (!key) return;
        input.value = "";
        try {
          await this.saveKey(row.dataset.id ?? "", key);
        } catch (e) {
          this.note = t("stg.keyFailed", { err: String(e) });
          this.render();
        }
      };
      (row.querySelector(".stg-keysave") as HTMLButtonElement).onclick = () => void save();
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") void save(); });
    });
    el.querySelectorAll<HTMLButtonElement>("[data-engine]").forEach((b) => {
      b.onclick = async () => {
        try {
          await this.setEngine(b.dataset.engine ?? "host");
        } catch (e) {
          this.note = t("stg.engineFailed", { err: String(e) });
          this.render();
        }
      };
    });
    (el.querySelector(".stg-refresh") as HTMLButtonElement).onclick = () => void this.refresh();
  }
}
