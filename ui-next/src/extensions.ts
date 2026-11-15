// Vista Extensions (F10): âmbito mínimo HONESTO sobre o que o backend realmente dá —
// vsix_manifest faz o parse REAL do zip .vsix e devolve o extension/package.json; instalar
// = registar esse manifesto num ficheiro local (<configDir>/extensions.json — ficheiro, não
// localStorage: o perfil WebKitGTK persiste entre execuções e o registo tem de ser legível
// fora da app); remover = apagar do registo. NÃO existe host de extensão: nada é activado
// nem executado, a vista declara-o no topo, e cada `contributes` do manifesto aparece
// marcado «não suportado». Instalar/remover tocam o disco → só por acção explícita do
// utilizador (botão), nunca ao abrir a vista ou ao ler um manifesto.

import { api, type VsixManifest } from "./tauri";
import { t } from "./i18n";

export interface ExtEntry {
  id: string;             // publisher.name — a identidade usual de uma extensão VS Code
  name: string;
  publisher: string;
  version: string;
  displayName: string;
  description: string;
  engine: string;         // engines.vscode do manifesto real ("" se o manifesto o omitir)
  contributes: string[];  // chaves de `contributes` do manifesto — listadas, nunca aplicadas
  from: string;           // caminho do .vsix de origem
}

export interface ExtState { installed: ExtEntry[]; pending: ExtEntry | null; error: string | null }

export class Extensions {
  installed: ExtEntry[] = [];
  private pending: ExtEntry | null = null;
  private error: string | null = null;
  private regPath = "";

  constructor(private host: HTMLElement, private root: () => string) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  private async registryPath(): Promise<string> {
    if (!this.regPath) this.regPath = `${(await api.appInfo()).configDir}/extensions.json`;
    return this.regPath;
  }

  /** Relê o registo local do disco (ficheiro inexistente = registo vazio, sem erro). */
  async refresh(): Promise<ExtState> {
    try {
      const path = await this.registryPath();
      const raw = await api.readTextFile(path).catch(() => "");
      this.installed = raw.trim() ? (JSON.parse(raw) as ExtEntry[]) : [];
      this.error = null;
    } catch (e) {
      this.installed = [];
      this.error = String(e);
    }
    this.render();
    return this.state();
  }

  state(): ExtState {
    return { installed: this.installed, pending: this.pending, error: this.error };
  }

  /** Lê o manifesto REAL de um .vsix do disco: bytes → base64 (coreutils do host) →
   * vsix_manifest (parse do zip no backend). NÃO instala — o manifesto fica pendente com
   * o botão explícito de instalar. Erro honesto se o ficheiro não for um VSIX. */
  async openVsix(path: string): Promise<ExtEntry> {
    const abs = await api.expandPath(path.trim());
    const out = await api.exec("base64", ["-w0", "--", abs], this.root() || "/");
    if (out.code !== 0) throw new Error(out.stderr.trim() || `base64 ${abs}: exit ${out.code}`);
    const m: VsixManifest = await api.vsixManifest(out.stdout.trim());
    const name = m.name ?? "";
    const publisher = m.publisher ?? "";
    this.pending = {
      id: publisher ? `${publisher}.${name}` : name,
      name,
      publisher,
      version: m.version ?? "",
      displayName: m.displayName ?? name,
      description: m.description ?? "",
      engine: m.engines?.vscode ?? "",
      contributes: Object.keys(m.contributes ?? {}),
      from: abs,
    };
    this.error = null;
    this.render();
    return this.pending;
  }

  /** Acção explícita: grava o manifesto pendente no registo em disco (substitui a mesma
   * id). Só escreve o JSON do registo — nunca extrai nem executa nada do pacote. */
  async install(): Promise<ExtEntry> {
    const e = this.pending;
    if (!e || !e.name) throw new Error(t("ext.nothingOpen"));
    const path = await this.registryPath();
    const raw = await api.readTextFile(path).catch(() => "");
    const list = raw.trim() ? (JSON.parse(raw) as ExtEntry[]) : [];
    const next = [...list.filter((x) => x.id !== e.id), e];
    await api.writeTextFile(path, JSON.stringify(next, null, 2) + "\n");
    this.installed = next;
    this.pending = null;
    this.render();
    return e;
  }

  /** Acção explícita: remove a entrada do registo em disco e da lista. */
  async remove(id: string): Promise<void> {
    const path = await this.registryPath();
    const raw = await api.readTextFile(path).catch(() => "");
    const list = raw.trim() ? (JSON.parse(raw) as ExtEntry[]) : [];
    const next = list.filter((x) => x.id !== id);
    await api.writeTextFile(path, JSON.stringify(next, null, 2) + "\n");
    this.installed = next;
    this.render();
  }

  // Esqueleto por innerHTML + conteúdo por textContent: os campos vêm de um manifesto
  // ALHEIO (não confiável) e nunca podem ser interpretados como HTML.
  private render(): void {
    const pendCard = this.pending
      ? `<div class="ext-sect">${t("ext.manifestSect")}</div>
         <div class="ext-card ext-pending">
           <div class="ext-row"><span class="ext-nm"></span><span class="ext-ver"></span></div>
           <div class="ext-desc"></div>
           <div class="ext-kv"><span>${t("ext.publisher")}</span><span class="ext-pub"></span></div>
           <div class="ext-kv"><span>${t("ext.engine")}</span><span class="ext-eng"></span></div>
           <div class="ext-contrib"></div>
           <div class="ext-actions"><button class="rm-btn" data-act="install">${t("ext.install")}</button></div>
         </div>`
      : "";
    const instRows = this.installed.length
      ? this.installed.map(() =>
          `<div class="ext-card">
             <div class="ext-row"><span class="ext-nm"></span><span class="ext-ver"></span></div>
             <div class="ext-kv"><span>${t("ext.engine")}</span><span class="ext-eng"></span></div>
             <div class="ext-kv"><span>${t("ext.from")}</span><span class="ext-from"></span></div>
             <div class="ext-contrib"></div>
             <div class="ext-actions"><button class="rm-btn" data-act="remove">${t("ext.remove")}</button></div>
           </div>`).join("")
      : `<div class="ext-note">${t("ext.none")}</div>`;
    this.host.innerHTML = `
      <div class="ext-banner">${t("ext.banner")}</div>
      ${this.error ? `<div class="ext-error"></div>` : ""}
      <div class="ext-sect">${t("ext.openSect")}</div>
      <div class="ext-open">
        <input class="ext-path" type="text" placeholder="${t("ext.pathPh")}" />
        <button class="rm-btn" data-act="read">${t("ext.read")}</button>
      </div>
      ${pendCard}
      <div class="ext-sect">${t("ext.installedSect")}</div>
      <div class="ext-list">${instRows}</div>`;
    if (this.error) (this.host.querySelector(".ext-error") as HTMLElement).textContent = this.error;
    if (this.pending) this.fillCard(this.host.querySelector(".ext-pending") as HTMLElement, this.pending);
    this.host.querySelectorAll<HTMLElement>(".ext-list .ext-card").forEach((card, i) => {
      const e = this.installed[i];
      card.setAttribute("data-id", e.id);
      this.fillCard(card, e);
      (card.querySelector('[data-act="remove"]') as HTMLButtonElement).onclick = () =>
        void this.remove(e.id).catch((err) => { this.error = String(err); this.render(); });
    });
    (this.host.querySelector('[data-act="read"]') as HTMLButtonElement).onclick = () => {
      const path = (this.host.querySelector(".ext-path") as HTMLInputElement).value;
      if (path.trim()) void this.openVsix(path).catch((err) => { this.error = String(err); this.render(); });
    };
    const inst = this.host.querySelector('[data-act="install"]') as HTMLButtonElement | null;
    if (inst) inst.onclick = () => void this.install().catch((err) => { this.error = String(err); this.render(); });
  }

  private fillCard(card: HTMLElement, e: ExtEntry): void {
    (card.querySelector(".ext-nm") as HTMLElement).textContent = e.displayName || e.name;
    (card.querySelector(".ext-nm") as HTMLElement).title = e.id;
    (card.querySelector(".ext-ver") as HTMLElement).textContent = e.version;
    (card.querySelector(".ext-eng") as HTMLElement).textContent = e.engine || "—";
    const desc = card.querySelector(".ext-desc") as HTMLElement | null;
    if (desc) desc.textContent = e.description;
    const from = card.querySelector(".ext-from") as HTMLElement | null;
    if (from) { from.textContent = e.from.split("/").pop() ?? e.from; from.title = e.from; }
    // Cada contributes do manifesto REAL, cada um com o rótulo honesto «não suportado» —
    // nunca um botão de activar/aplicar, porque não há host de extensão que o cumpra.
    const holder = card.querySelector(".ext-contrib") as HTMLElement;
    holder.innerHTML = e.contributes
      .map(() => `<div class="ext-cap"><span class="ext-cap-nm"></span><span class="ext-cap-no">${t("ext.notSupported")}</span></div>`)
      .join("");
    holder.querySelectorAll(".ext-cap-nm").forEach((el, i) => {
      (el as HTMLElement).textContent = `contributes.${e.contributes[i]}`;
    });
  }
}
