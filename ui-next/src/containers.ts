// Pane Containers: imagens e containers do motor REAL configurado (get_sandbox_engine),
// listados pelo CLI do próprio motor via exec. Os formatos diferem por motor — delonix
// `-o json` devolve UM array; docker `--format json` devolve JSON-lines; podman `--format
// json` devolve um array com outras chaves — por isso detecta-se o motor PRIMEIRO e
// parseia-se o formato desse motor (nunca se assume docker). Sem motor ou sem pasta, o
// erro do CLI aparece tal-e-qual — nunca uma lista simulada.

import { api } from "./tauri";
import { t } from "./i18n";

export interface Ctr { id: string; name: string; image: string; status: string; running: boolean }
export interface Img { tag: string; id: string; size: string }
export interface CtState { engine: string; containers: Ctr[]; images: Img[]; error: string | null }

/** bytes → "28.4 MiB" (delonix/podman devolvem tamanhos numéricos). */
function human(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

export class Containers {
  engine = "";
  containers: Ctr[] = [];
  images: Img[] = [];
  error: string | null = null;
  private devcRunning = false;
  private devcName = "";
  private loaded = false;
  private busy = false;

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private runLine: (line: string) => Promise<number>,
    private notify: (msg: string) => void,
  ) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** Relê motor, containers, imagens e sessão devcontainer. Devolve o estado OU o erro honesto. */
  async refresh(): Promise<CtState> {
    const root = this.root();
    this.loaded = true;
    if (!root) {
      this.containers = []; this.images = []; this.error = t("ct.noFolder");
      this.render();
      return this.state();
    }
    try {
      this.engine = await api.getSandboxEngine();
      if (this.engine === "host") {
        this.containers = []; this.images = []; this.error = t("ct.hostEngine");
        this.render();
        return this.state();
      }
      this.containers = await this.listContainers(root);
      this.images = await this.listImages(root);
      const st = await api.devcontainerSessionStatus(root).catch(() => ({ running: false, name: "" }));
      this.devcRunning = st.running;
      this.devcName = st.name;
      this.error = null;
    } catch (e) {
      this.containers = []; this.images = [];
      this.error = String(e);
    }
    this.render();
    return this.state();
  }

  state(): CtState {
    return { engine: this.engine, containers: this.containers, images: this.images, error: this.error };
  }

  /** `<engine> ps -a` no formato JSON do PRÓPRIO motor, normalizado para Ctr. */
  private async listContainers(root: string): Promise<Ctr[]> {
    if (this.engine === "delonix") {
      const out = await this.cli(["ps", "-a", "-o", "json"], root);
      const rows = JSON.parse(out) as { id: string; name: string; image: string; status: string }[];
      return rows.map((r) => ({
        id: r.id, name: r.name, image: r.image, status: r.status,
        running: /^Up/i.test(r.status),
      }));
    }
    if (this.engine === "podman") {
      const out = await this.cli(["ps", "-a", "--format", "json"], root);
      const rows = JSON.parse(out) as { Id: string; Names: string[]; Image: string; State: string; Status: string }[];
      return rows.map((r) => ({
        id: r.Id.slice(0, 12), name: r.Names[0] ?? "", image: r.Image, status: r.Status,
        running: r.State === "running",
      }));
    }
    // docker: JSON-lines (um objecto por linha)
    const out = await this.cli(["ps", "-a", "--format", "json"], root);
    return out.split("\n").filter((l) => l.trim()).map((l) => {
      const r = JSON.parse(l) as { ID: string; Names: string; Image: string; State: string; Status: string };
      return { id: r.ID, name: r.Names, image: r.Image, status: r.Status, running: r.State === "running" };
    });
  }

  /** `<engine> images` no formato JSON do PRÓPRIO motor, normalizado para Img. */
  private async listImages(root: string): Promise<Img[]> {
    if (this.engine === "delonix") {
      const out = await this.cli(["images", "-o", "json"], root);
      const rows = JSON.parse(out) as { repo_tags: string[]; id: string; size_bytes: number }[];
      return rows.map((r) => ({
        tag: r.repo_tags[0] ?? "<none>", id: r.id.replace("sha256:", "").slice(0, 12), size: human(r.size_bytes),
      }));
    }
    if (this.engine === "podman") {
      const out = await this.cli(["images", "--format", "json"], root);
      const rows = JSON.parse(out) as { Names?: string[]; Id: string; Size: number }[];
      return rows.map((r) => ({
        tag: (r.Names && r.Names[0]) ?? "<none>", id: r.Id.slice(0, 12), size: human(r.Size),
      }));
    }
    const out = await this.cli(["images", "--format", "json"], root);
    return out.split("\n").filter((l) => l.trim()).map((l) => {
      const r = JSON.parse(l) as { Repository: string; Tag: string; ID: string; Size: string };
      return { tag: `${r.Repository}:${r.Tag}`, id: r.ID, size: r.Size };
    });
  }

  private async cli(args: string[], root: string): Promise<string> {
    const out = await api.exec(this.engine, args, root);
    if (out.code !== 0) throw new Error(out.stderr.trim() || `${this.engine} ${args[0]} failed (exit ${out.code})`);
    return out.stdout;
  }

  /** Arranca/pára a stack compose do projecto no terminal REAL (run_shell — saída visível). */
  private async compose(up: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.runLine(up ? "docker compose up -d" : "docker compose stop");
    } finally {
      this.busy = false;
    }
    await this.refresh();
  }

  /** Liga/desliga a sessão devcontainer persistente (devcontainer_session_up/_down). */
  private async devcontainer(up: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (up) {
        const r = await api.devcontainerSessionUp(this.root());
        this.notify(r.stdout.slice(0, 160));
      } else {
        await api.devcontainerSessionDown(this.root());
      }
    } catch (e) {
      this.notify(String(e));
    } finally {
      this.busy = false;
    }
    await this.refresh();
  }

  private render(): void {
    if (!this.loaded) {
      this.host.innerHTML = `<div class="ct-note"></div>`;
      (this.host.querySelector(".ct-note") as HTMLElement).textContent = t("ct.hint");
      return;
    }
    if (this.error) {
      this.host.innerHTML = `<div class="ct-note ct-engine"></div><div class="ct-error"></div>`;
      (this.host.querySelector(".ct-engine") as HTMLElement).textContent = this.engine ? t("ct.engine", { engine: this.engine }) : "";
      (this.host.querySelector(".ct-error") as HTMLElement).textContent = this.error;
      return;
    }
    const ctrRows = this.containers.length
      ? this.containers.map(() => `<div class="ct-row"><span class="ct-dot"></span><span class="ct-nm"></span><span class="ct-state"></span></div>`).join("")
      : `<div class="ct-note">${t("ct.none")}</div>`;
    const imgRows = this.images.length
      ? this.images.map(() => `<div class="ct-row ct-img"><span class="ct-nm"></span><span class="ct-state"></span></div>`).join("")
      : `<div class="ct-note">${t("ct.noImages")}</div>`;
    this.host.innerHTML = `
      <div class="ct-note ct-engine"></div>
      <div class="ct-sect">${t("ct.containers")}</div>
      <div class="ct-list-c">${ctrRows}</div>
      <div class="ct-sect">${t("ct.imagesSect")}</div>
      <div class="ct-list-i">${imgRows}</div>
      <div class="ct-sect">${t("ct.compose")}</div>
      <div class="ct-actions">
        <button class="rm-btn" data-act="cup">${t("ct.composeUp")}</button>
        <button class="rm-btn" data-act="cstop">${t("ct.composeStop")}</button>
      </div>
      <div class="ct-sect">${t("ct.devc")}</div>
      <div class="ct-devc" title="${this.devcName}">
        <span class="rm-badge ${this.devcRunning ? "on" : ""}">${this.devcRunning ? t("remote.running") : t("remote.stopped")}</span>
        <button class="rm-btn" data-act="dup" ${this.devcRunning ? "disabled" : ""}>${t("ct.connect")}</button>
        <button class="rm-btn" data-act="ddown" ${this.devcRunning ? "" : "disabled"}>${t("ct.disconnect")}</button>
      </div>`;
    (this.host.querySelector(".ct-engine") as HTMLElement).textContent = t("ct.engine", { engine: this.engine });
    this.host.querySelectorAll(".ct-list-c .ct-row").forEach((row, i) => {
      const c = this.containers[i];
      row.setAttribute("data-name", c.name);
      (row.querySelector(".ct-dot") as HTMLElement).classList.toggle("ok", c.running);
      (row.querySelector(".ct-nm") as HTMLElement).textContent = c.name || c.id;
      (row.querySelector(".ct-nm") as HTMLElement).title = `${c.id} — ${c.image}`;
      (row.querySelector(".ct-state") as HTMLElement).textContent = c.status;
    });
    this.host.querySelectorAll(".ct-list-i .ct-row").forEach((row, i) => {
      const im = this.images[i];
      (row.querySelector(".ct-nm") as HTMLElement).textContent = im.tag;
      (row.querySelector(".ct-nm") as HTMLElement).title = im.id;
      (row.querySelector(".ct-state") as HTMLElement).textContent = im.size;
    });
    (this.host.querySelector('[data-act="cup"]') as HTMLButtonElement).onclick = () => void this.compose(true);
    (this.host.querySelector('[data-act="cstop"]') as HTMLButtonElement).onclick = () => void this.compose(false);
    (this.host.querySelector('[data-act="dup"]') as HTMLButtonElement).onclick = () => void this.devcontainer(true);
    (this.host.querySelector('[data-act="ddown"]') as HTMLButtonElement).onclick = () => void this.devcontainer(false);
  }
}
