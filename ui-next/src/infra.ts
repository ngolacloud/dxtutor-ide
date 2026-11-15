// Pane Infra/K8s (F11): kubectl REAL do host sobre o KUBECONFIG existente — nada simulado.
// O que a vista mostra vem medido: versão do cliente (`kubectl version --client`), contexto
// corrente do kubeconfig (ou a ausência dele, honesta), alcance do servidor
// (`kubectl version --request-timeout`) e os recursos que ficaram no cluster (`kubectl get
// -o json`). Deploy = aplicar os manifests k8s que o scaffold do Studio GERA
// (arch_scaffold_preview — nunca arch_scaffold, que escreve no workspace) num namespace
// escolhido; como o exec do backend tem stdin:null, os manifests são escritos num
// directório temporário e aplicados com `-f <dir>`, nunca por pipe. Apagar o namespace é
// DESTRUTIVO → confirmação explícita no UI; a vista nunca toca recursos fora do namespace
// escolhido. Promoção de ambientes (dev→staging→prod) fica como extensão futura declarada
// — é política de release, não kubectl.

import { api } from "./tauri";
import { t } from "./i18n";

export interface K8sRes { kind: string; name: string; detail: string }
export interface InfraState {
  kubectl: string | null;      // versão do cliente, null = kubectl ausente no host
  context: string | null;      // current-context do kubeconfig, null = não definido
  server: string | null;       // versão do servidor quando alcançável
  serverErr: string | null;    // erro honesto do kubectl quando não alcançável
  manifests: string[];         // caminhos k8s do preview do Studio
  resources: K8sRes[];         // o que o último kubectl get viu no namespace
  namespace: string;
  error: string | null;
}

export class Infra {
  private kubectl: string | null = null;
  private context: string | null = null;
  private server: string | null = null;
  private serverErr: string | null = null;
  private manifests: string[] = [];
  private resources: K8sRes[] = [];
  private namespace = "dxtutor-app";
  private error: string | null = null;
  private loaded = false;
  private busy = false;

  constructor(
    private host: HTMLElement,
    private root: () => string,
    private preview: () => Promise<[string, string][]>,
    private notify: (msg: string) => void,
  ) {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  private cwd(): string {
    return this.root() || "/";
  }

  /** Relê kubectl/contexto/servidor e os manifests k8s do preview do Studio. */
  async refresh(): Promise<InfraState> {
    this.loaded = true;
    this.error = null;
    try {
      const cv = await api.exec("kubectl", ["version", "--client", "-o", "json"], this.cwd());
      this.kubectl = cv.code === 0
        ? ((JSON.parse(cv.stdout) as { clientVersion?: { gitVersion?: string } }).clientVersion?.gitVersion ?? "?")
        : null;
    } catch {
      this.kubectl = null; // exec falhou a arrancar o binário — kubectl ausente
    }
    if (this.kubectl) {
      const cc = await api.exec("kubectl", ["config", "current-context"], this.cwd());
      this.context = cc.code === 0 ? cc.stdout.trim() : null;
      const sv = await api.exec("kubectl", ["version", "--request-timeout=2s", "-o", "json"], this.cwd());
      if (sv.code === 0) {
        this.server = (JSON.parse(sv.stdout) as { serverVersion?: { gitVersion?: string } }).serverVersion?.gitVersion ?? "?";
        this.serverErr = null;
      } else {
        this.server = null;
        this.serverErr = sv.stderr.trim().split("\n").pop() ?? "unreachable";
      }
    } else {
      this.context = null;
      this.server = null;
      this.serverErr = null;
    }
    try {
      this.manifests = (await this.preview()).map(([p]) => p).filter((p) => p.startsWith("deploy/k8s/"));
    } catch {
      this.manifests = []; // sem desenho no Studio não há manifests — honesto
    }
    this.render();
    return this.state();
  }

  state(): InfraState {
    return {
      kubectl: this.kubectl, context: this.context, server: this.server, serverErr: this.serverErr,
      manifests: this.manifests, resources: this.resources, namespace: this.namespace, error: this.error,
    };
  }

  /** Aplica os manifests k8s do preview do Studio no namespace dado (criado se faltar) e
   * relê os recursos. Escreve os ficheiros num dir temporário (exec sem stdin) e limpa-o. */
  async deploy(ns: string): Promise<InfraState> {
    if (this.busy) return this.state();
    this.busy = true;
    try {
      this.namespace = ns;
      const files = (await this.preview()).filter(([p]) => p.startsWith("deploy/k8s/"));
      if (!files.length) throw new Error(t("inf.noManifests"));
      const mk = await api.exec("mktemp", ["-d"], this.cwd());
      if (mk.code !== 0) throw new Error(mk.stderr.trim());
      const dir = mk.stdout.trim();
      try {
        for (const [p, content] of files) {
          const base = p.split("/").pop() ?? p;
          await api.writeTextFile(`${dir}/${base}`, content);
        }
        const cns = await api.exec("kubectl", ["create", "namespace", ns], this.cwd());
        if (cns.code !== 0 && !cns.stderr.includes("AlreadyExists")) throw new Error(cns.stderr.trim());
        const ap = await api.exec("kubectl", ["apply", "-n", ns, "-f", dir], this.cwd());
        if (ap.code !== 0) throw new Error(ap.stderr.trim());
        this.notify(ap.stdout.trim().split("\n").slice(0, 3).join(" · "));
      } finally {
        await api.exec("rm", ["-rf", "--", dir], this.cwd());
      }
      await this.list(ns);
      this.error = null;
    } catch (e) {
      this.error = String(e);
      this.render();
    } finally {
      this.busy = false;
    }
    return this.state();
  }

  /** `kubectl get deploy,svc,pods -n ns -o json` — os recursos REAIS que estão no cluster. */
  async list(ns: string): Promise<K8sRes[]> {
    this.namespace = ns;
    const out = await api.exec("kubectl", ["get", "deploy,svc,pods", "-n", ns, "-o", "json"], this.cwd());
    if (out.code !== 0) throw new Error(out.stderr.trim());
    interface Item {
      kind: string;
      metadata: { name: string };
      status?: { readyReplicas?: number; replicas?: number; phase?: string };
      spec?: { clusterIP?: string };
    }
    const items = (JSON.parse(out.stdout) as { items: Item[] }).items;
    this.resources = items.map((i) => ({
      kind: i.kind,
      name: i.metadata.name,
      detail: i.kind === "Deployment"
        ? `${i.status?.readyReplicas ?? 0}/${i.status?.replicas ?? 0} ready`
        : i.kind === "Service"
          ? (i.spec?.clusterIP ?? "")
          : (i.status?.phase ?? ""),
    }));
    this.render();
    return this.resources;
  }

  /** DESTRUTIVO: apaga o namespace inteiro (e só ele). O botão do UI confirma antes;
   * espera pela remoção para a lista seguinte ser verdade, não um «a desaparecer». */
  async destroy(ns: string): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const del = await api.exec("kubectl", ["delete", "namespace", ns, "--wait=true", "--timeout=120s"], this.cwd());
      if (del.code !== 0) throw new Error(del.stderr.trim());
      this.resources = [];
      this.error = null;
      this.render();
      return true;
    } catch (e) {
      this.error = String(e);
      this.render();
      return false;
    } finally {
      this.busy = false;
    }
  }

  // Esqueleto por innerHTML; valores medidos (contexto/versões/recursos) por textContent.
  private render(): void {
    if (!this.loaded) {
      this.host.innerHTML = `<div class="inf-note">${t("inf.hint")}</div>`;
      return;
    }
    if (!this.kubectl) {
      this.host.innerHTML = `<div class="inf-note">${t("inf.noKubectl")}</div>`;
      return;
    }
    const resRows = this.resources.length
      ? this.resources.map(() => `<div class="inf-res"><span class="inf-kind"></span><span class="inf-nm"></span><span class="inf-detail"></span></div>`).join("")
      : `<div class="inf-note">${t("inf.noRes")}</div>`;
    const mfRows = this.manifests.length
      ? this.manifests.map(() => `<div class="inf-mf"></div>`).join("")
      : `<div class="inf-note">${t("inf.noManifests")}</div>`;
    this.host.innerHTML = `
      <div class="inf-sect">${t("inf.cluster")}</div>
      <div class="inf-kv"><span>kubectl</span><span class="inf-kubectl"></span></div>
      <div class="inf-kv"><span>${t("inf.context")}</span><span class="inf-ctx"></span></div>
      <div class="inf-kv"><span>${t("inf.server")}</span><span class="inf-server"></span></div>
      ${this.error ? `<div class="inf-error"></div>` : ""}
      <div class="inf-sect">${t("inf.manifests")}</div>
      <div class="inf-mfs">${mfRows}</div>
      <div class="inf-sect">${t("inf.deploy")}</div>
      <div class="inf-deploy">
        <input class="inf-ns" type="text" />
        <button class="rm-btn" data-act="apply" ${this.server ? "" : "disabled"}>${t("inf.apply")}</button>
      </div>
      <div class="inf-sect">${t("inf.resources", { ns: this.namespace })}</div>
      <div class="inf-list">${resRows}</div>
      <div class="inf-actions">
        <button class="rm-btn" data-act="list" ${this.server ? "" : "disabled"}>${t("inf.refresh")}</button>
        <button class="rm-btn inf-danger" data-act="destroy" ${this.server ? "" : "disabled"}>${t("inf.destroy")}</button>
      </div>
      <div class="inf-note inf-future">${t("inf.promoFuture")}</div>`;
    (this.host.querySelector(".inf-kubectl") as HTMLElement).textContent = this.kubectl;
    (this.host.querySelector(".inf-ctx") as HTMLElement).textContent = this.context ?? t("inf.noContext");
    (this.host.querySelector(".inf-server") as HTMLElement).textContent =
      this.server ?? `${t("inf.unreachable")}${this.serverErr ? ` — ${this.serverErr}` : ""}`;
    if (this.error) (this.host.querySelector(".inf-error") as HTMLElement).textContent = this.error;
    this.host.querySelectorAll<HTMLElement>(".inf-mf").forEach((el, i) => { el.textContent = this.manifests[i]; });
    this.host.querySelectorAll<HTMLElement>(".inf-list .inf-res").forEach((row, i) => {
      const r = this.resources[i];
      row.setAttribute("data-res", `${r.kind}/${r.name}`);
      (row.querySelector(".inf-kind") as HTMLElement).textContent = r.kind;
      (row.querySelector(".inf-nm") as HTMLElement).textContent = r.name;
      (row.querySelector(".inf-detail") as HTMLElement).textContent = r.detail;
    });
    const nsInput = this.host.querySelector(".inf-ns") as HTMLInputElement;
    nsInput.value = this.namespace;
    (this.host.querySelector('[data-act="apply"]') as HTMLButtonElement).onclick = () => {
      const ns = nsInput.value.trim();
      if (ns) void this.deploy(ns);
    };
    (this.host.querySelector('[data-act="list"]') as HTMLButtonElement).onclick = () =>
      void this.list(nsInput.value.trim() || this.namespace).catch((e) => { this.error = String(e); this.render(); });
    (this.host.querySelector('[data-act="destroy"]') as HTMLButtonElement).onclick = () => {
      const ns = nsInput.value.trim() || this.namespace;
      // Apagar um namespace é destrutivo e irreversível: confirmação explícita SEMPRE.
      if (window.confirm(t("inf.confirmDestroy", { ns }))) {
        void this.destroy(ns).then((ok) => { if (ok) this.notify(t("inf.destroyed", { ns })); });
      }
    };
  }
}
