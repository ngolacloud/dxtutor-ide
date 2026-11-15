// Painel Services: os serviços da stack compose sob a pasta aberta, via compose_ps REAL
// (docker compose ps --format json). Sem docker ou sem stack, o erro do backend aparece
// tal-e-qual — nunca uma lista simulada nem um falso «tudo verde».

import { api, type ComposeService } from "./tauri";
import { t } from "./i18n";

export class Services {
  services: ComposeService[] = [];
  error: string | null = null;
  private loaded = false;

  constructor(private host: HTMLElement, private root: () => string) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** Relê os serviços via compose_ps. Devolve a lista OU o erro honesto do backend. */
  async refresh(): Promise<{ services: ComposeService[]; error: string | null }> {
    const root = this.root();
    if (!root) {
      this.services = [];
      this.error = t("sv.noFolder");
      this.loaded = true;
      this.render();
      return { services: [], error: this.error };
    }
    try {
      this.services = await api.composePs(root);
      this.error = null;
    } catch (e) {
      this.services = [];
      this.error = String(e);
    }
    this.loaded = true;
    this.render();
    return { services: this.services, error: this.error };
  }

  private render(): void {
    if (!this.loaded) {
      this.host.innerHTML = `<div class="sv-note"></div>`;
      (this.host.querySelector(".sv-note") as HTMLElement).textContent = t("sv.hint");
      return;
    }
    if (this.error) {
      this.host.innerHTML = `<div class="sv-error"></div>`;
      (this.host.querySelector(".sv-error") as HTMLElement).textContent = this.error;
      return;
    }
    if (!this.services.length) {
      this.host.innerHTML = `<div class="sv-note"></div>`;
      (this.host.querySelector(".sv-note") as HTMLElement).textContent = t("sv.none");
      return;
    }
    this.host.innerHTML = this.services
      .map(() => `<div class="sv-row"><span class="sv-dot"></span><span class="sv-nm"></span><span class="sv-state"></span><span class="sv-ports"></span></div>`)
      .join("");
    this.host.querySelectorAll(".sv-row").forEach((row, i) => {
      const s = this.services[i];
      (row.querySelector(".sv-dot") as HTMLElement).classList.toggle("ok", s.state.toLowerCase() === "running");
      (row.querySelector(".sv-nm") as HTMLElement).textContent = s.service || s.name;
      (row.querySelector(".sv-nm") as HTMLElement).title = `${s.name} — ${s.image}`;
      (row.querySelector(".sv-state") as HTMLElement).textContent = s.status || s.state;
      (row.querySelector(".sv-ports") as HTMLElement).textContent = s.ports.join(", ");
    });
  }
}
