// Vista Conta + Observabilidade (F12): dados 100% MEDIDOS. Conta = o estado real de cada
// provedor (list_providers: disponibilidade viva; keys_status: chave resolvida → badge
// MASCARADO, a chave nunca chega ao DOM — regra dos gates providers/settings) + o provedor
// e modelo de assistente activos lidos de get_providers_config (SÓ os campos não-secretos:
// provider/assistantModel; os campos *Key nunca são lidos daqui). Observabilidade = o uso
// acumulado da sessão lido de Codev.usage() — turnos llm_chat com os tokens que o backend
// devolveu em ChatResp.inputTokens/outputTokens, e turnos de streaming como «não medido»
// porque llm://done não traz contagens (nunca se estima por caracteres). O acumulador vive
// em memória da sessão; esta vista só o apresenta, nunca reconta nem inventa.

import { api } from "./tauri";
import { t } from "./i18n";
import type { Usage } from "./codev";

interface ProvRow { id: string; name: string; available: boolean; configured: boolean; local: boolean }

export class Account {
  private rows: ProvRow[] = [];
  private activeProvider = "";
  private assistantModel = "";
  private loaded = false;
  private error: string | null = null;

  constructor(private host: HTMLElement, private usage: () => Usage) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** Relê provedores/chaves/configuração do backend e repinta com o uso corrente. */
  async refresh(): Promise<{ rows: ProvRow[]; usage: Usage }> {
    try {
      const [provs, keys, cfg] = await Promise.all([
        api.listProviders(),
        api.keysStatus(),
        api.getProvidersConfig(),
      ]);
      this.rows = provs.map((p) => ({
        id: p.id,
        name: p.name,
        available: p.available,
        local: p.id === "ollama",
        configured: p.id === "ollama" ? p.available : keys[p.id] === true,
      }));
      // SÓ campos não-secretos da configuração — os *Key ficam por ler, de propósito.
      this.activeProvider = cfg.provider;
      this.assistantModel = cfg.assistantModel;
      this.loaded = true;
      this.error = null;
    } catch (e) {
      this.rows = [];
      this.loaded = false;
      this.error = String(e);
    }
    this.render();
    return { rows: this.rows, usage: this.usage() };
  }

  state(): { loaded: boolean; rows: ProvRow[]; usage: Usage } {
    return { loaded: this.loaded, rows: this.rows, usage: this.usage() };
  }

  private render(): void {
    const u = this.usage();
    const provRows = this.rows.length
      ? this.rows.map(() =>
          `<div class="ac-prov">
             <span class="ac-nm"></span>
             <span class="ac-avail"></span>
             <span class="ac-key"></span>
           </div>`).join("")
      : `<div class="ac-note">${this.loaded ? t("ac.noProviders") : t("ac.hint")}</div>`;
    this.host.innerHTML = `
      ${this.error ? `<div class="ac-error"></div>` : ""}
      <div class="ac-sect">${t("ac.account")}</div>
      <div class="ac-kv"><span>${t("ac.activeProvider")}</span><span class="ac-active"></span></div>
      <div class="ac-kv"><span>${t("ac.assistantModel")}</span><span class="ac-model"></span></div>
      <div class="ac-provs">${provRows}</div>
      <div class="ac-sect">${t("ac.observability")}</div>
      <div class="ac-kv"><span>${t("ac.turns")}</span><span class="ac-turns"></span></div>
      <div class="ac-kv"><span>${t("ac.inputTokens")}</span><span class="ac-in"></span></div>
      <div class="ac-kv"><span>${t("ac.outputTokens")}</span><span class="ac-out"></span></div>
      <div class="ac-kv"><span>${t("ac.unmeasured")}</span><span class="ac-unm"></span></div>
      <div class="ac-note">${u.turns + u.unmeasured === 0 ? t("ac.noTurns") : t("ac.measuredNote")}</div>`;
    if (this.error) (this.host.querySelector(".ac-error") as HTMLElement).textContent = this.error;
    (this.host.querySelector(".ac-active") as HTMLElement).textContent = this.activeProvider || "—";
    (this.host.querySelector(".ac-model") as HTMLElement).textContent =
      this.assistantModel || t("ac.modelUnset");
    this.host.querySelectorAll<HTMLElement>(".ac-prov").forEach((row, i) => {
      const p = this.rows[i];
      row.setAttribute("data-id", p.id);
      (row.querySelector(".ac-nm") as HTMLElement).textContent = p.name;
      const avail = row.querySelector(".ac-avail") as HTMLElement;
      avail.textContent = p.available ? t("ac.available") : t("ac.unavailable");
      avail.classList.toggle("on", p.available);
      // Como nos painéis Provedores/Definições: badge mascarado ou «sem chave» — NUNCA a chave.
      (row.querySelector(".ac-key") as HTMLElement).textContent =
        p.local ? t("pv.local") : p.configured ? t("pv.keySet") : t("pv.noKey");
    });
    (this.host.querySelector(".ac-turns") as HTMLElement).textContent = String(u.turns);
    (this.host.querySelector(".ac-in") as HTMLElement).textContent = String(u.inputTokens);
    (this.host.querySelector(".ac-out") as HTMLElement).textContent = String(u.outputTokens);
    (this.host.querySelector(".ac-unm") as HTMLElement).textContent = String(u.unmeasured);
  }
}
