// Remote (devcontainers): reads the real .devcontainer of the open folder and drives a real
// container session. No simulation — when there is no .devcontainer or no container runtime,
// the panel says so honestly instead of pretending.

import { api, type DevcontainerInfo } from "./tauri";
import { t } from "./i18n";

export class Remote {
  private info: DevcontainerInfo | null = null;
  private running = false;

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private log: (line: string, err?: boolean) => void,
  ) {
    this.host.innerHTML = `<div class="rm"></div>`;
  }

  async refresh(): Promise<void> {
    const root = this.root();
    if (!root) { this.info = null; this.render(); return; }
    try {
      this.info = await api.devcontainerInfo(root);
      const st = await api.devcontainerSessionStatus(root).catch(() => ({ running: false, name: "" }));
      this.running = st.running;
    } catch {
      this.info = null;
    }
    this.render();
  }

  async start(): Promise<boolean> {
    const root = this.root();
    if (!root) return false;
    this.setBusy(t("remote.starting"));
    try {
      const up = await api.devcontainerSessionUp(root);
      this.log(up.stdout || up.ran, !up.ok);
      if (up.stderr) this.log(up.stderr, true);
      this.running = up.ok;
    } catch (e) {
      this.log(String(e), true);
      this.running = false;
    }
    await this.refresh();
    return this.running;
  }

  async stop(): Promise<void> {
    const root = this.root();
    if (!root) return;
    try { await api.devcontainerSessionDown(root); } catch (e) { this.log(String(e), true); }
    await this.refresh();
  }

  /** Current devcontainer info — exposed for the harness. */
  state(): { present: boolean; image: string | null; running: boolean } {
    return { present: !!this.info?.present, image: this.info?.image ?? null, running: this.running };
  }

  private setBusy(msg: string): void {
    (this.host.querySelector(".rm") as HTMLElement).innerHTML = `<div class="rm-note">${msg}</div>`;
  }

  private render(): void {
    const el = this.host.querySelector(".rm") as HTMLElement;
    if (!this.info) { el.innerHTML = `<div class="rm-note">${t("remote.openFolder")}</div>`; return; }
    if (!this.info.present) {
      el.innerHTML = `<div class="rm-note">${t("remote.none")}</div>`;
      return;
    }
    el.innerHTML = `
      <div class="rm-card">
        <div class="rm-row"><b>${t("remote.title")}</b><span class="rm-badge ${this.running ? "on" : ""}">${this.running ? t("remote.running") : t("remote.stopped")}</span></div>
        <div class="rm-kv"><span>${t("remote.name")}</span><span></span></div>
        <div class="rm-kv"><span>${t("remote.image")}</span><span></span></div>
        <div class="rm-actions">
          <button class="rm-btn" data-act="start" ${this.running ? "disabled" : ""}>${t("remote.start")}</button>
          <button class="rm-btn" data-act="stop" ${this.running ? "" : "disabled"}>${t("remote.stop")}</button>
        </div>
      </div>`;
    const kv = el.querySelectorAll(".rm-kv span:last-child");
    (kv[0] as HTMLElement).textContent = this.info.name ?? t("remote.unnamed");
    (kv[1] as HTMLElement).textContent = this.info.image ?? t("remote.fromDockerfile");
    (el.querySelector('[data-act="start"]') as HTMLButtonElement).onclick = () => void this.start();
    (el.querySelector('[data-act="stop"]') as HTMLButtonElement).onclick = () => void this.stop();
  }
}
