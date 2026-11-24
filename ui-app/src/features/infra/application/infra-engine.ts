/* ═══════════ feature `infra` — motor (casos de uso) (ADR-0002, Fase 3) ═══════════
   Os dois motores da Infra — runtime de contentores / dev-container / Kubernetes, e
   environments / drift / secrets — com as dependências do mundo injectadas por porta
   (`ports.ts`). PURO de `window`/DOM: lê o estado e escreve a UI através dos
   adaptadores que o resíduo (`features/infra.ts`) compõe sobre o legacy-bridge.

   A hidratação de ENVS/ENVX de LS é PREGUIÇOSA (guard-once em closure) pela razão de
   sempre: a feature avalia ANTES de app.ts/v5/v6, logo `LS.get`/`ROOT` ansioso
   quebraria o chunk — só se toca no mundo DENTRO das funções, no 1º uso real.

   Byte-fiel ao resíduo original: o golden de caracterização + o golden do pane
   provam a identidade da saída (geradores, drift, secrets, terminal simulado). */

import { esc } from "../../../core";
import { RTN, ENVL } from "../domain/constants";
import {
  projectContext as domProjectContext, devcontainerJson as domDevcontainerJson,
  appEnv as domAppEnv, k8sInfra as domK8sInfra, k8sDocs as domK8sDocs,
} from "../domain/kubernetes";
import {
  designApps as domDesignApps,
  localSecrets as domLocalSecrets, deriveSecrets as domDeriveSecrets, secretCheck as domSecretCheck,
} from "../domain/secrets";
import {
  envDeps as domEnvDeps, envStateOf as domEnvStateOf, envHealthOf as domEnvHealthOf,
  driftReport as domDriftReport, commitsBetween as domCommitsBetween, envManifest,
} from "../domain/environments";
import type { Catalog, Design, DesignNode, EnvDep, EnvState, K8sDoc, SecretSets } from "../domain/types";
import type { InfraDeps, InfraEngine, DeployResult, EnvTarget } from "./ports";

export function makeInfraEngine(deps: InfraDeps): InfraEngine {
  const { state, catalog, workspace, scm, persist, terminal, nav, notifier, view, clock, envCluster } = deps;
  const cat = (): Catalog => ({ tech: catalog.tech(), kind: catalog.kind(), isApp: catalog.isApp, slug: catalog.slug });

  /* ───── hidratação preguiçosa (guard-once) ───── */
  let envsHyd = false, envxHyd = false;
  function hydrateEnvs(): void { if (envsHyd) return; envsHyd = true; Object.assign(state.envs(), persist.get("env5", {})); state.setPDc(workspace.root() + ".devcontainer/devcontainer.json"); }
  /* ADR-0006, R5c1: a chave passa a `envx7` — a `envx6` guardava estado inventado (versões
     «deployadas» em staging/production, segredos torcidos, promoções simuladas). O estado de cada
     ambiente lê-se do cluster e não se guarda. */
  function hydrateEnvx(): void { if (envxHyd) return; envxHyd = true; const saved = persist.get<Record<string, unknown>>("envx7", {}); delete saved.st; Object.assign(state.envx(), saved); }
  const saveEnv = (): void => persist.set("env5", state.envs());
  const saveEnvx = (): void => { const { st: _st, ...keep } = state.envx(); persist.set("envx7", keep); };
  const cli = (): string => state.envs().rt;

  /* ═══════════ motor runtime / dev-container / Kubernetes ═══════════ */
  function needRt(): boolean {
    hydrateEnvs();
    if (state.envs().rtOn) return true;
    nav.goPane("infra"); notifier.toast("Point the container socket first"); return false;
  }
  /* ADR-0006, R5a: fora da app desktop não há runtime de contentores nem cluster a que ligar —
     as versões de base deixam de fingir a ligação (eram um interruptor com «(simulated)» no log).
     No desktop, a porta `desktopPorts.infra` liga-os a sério (docker/podman info, kubectl). Uma
     ligação «presa» de uma sessão antiga (LS) ainda se pode desligar. */
  function rtConnect(): void {
    hydrateEnvs(); const e = state.envs();
    if (e.rtOn) { e.rtOn = false; saveEnv(); state.setStack(null); state.setDevc(null); view.drawStack(); notifier.log("infra", "container runtime disconnected"); view.redraw(); return; }
    notifier.toast(`Ligar o ${RTN[e.rt]} precisa da app desktop (o socket real em ${e.sock[e.rt]})`);
  }
  function k8sConnect(): void {
    hydrateEnvs(); const e = state.envs();
    if (e.k8sOn) { e.k8sOn = false; saveEnv(); state.setK8s(null); notifier.log("infra", "cluster disconnected"); view.redraw(); return; }
    notifier.toast("Ligar o cluster precisa da app desktop (o kubectl real com o teu KUBECONFIG)");
  }
  const projectContext = (): Array<[string, string]> => domProjectContext(workspace.files());
  function devcontainerJson(): string {
    const ctx = projectContext().map((x) => x[0]);
    const ports = (workspace.composeServices() || []).filter((s) => s.port).map((s) => +(s.port as number | string));
    return domDevcontainerJson(ctx, ports, state.envs().sock[state.envs().rt]);
  }
  /* ADR-0006, R5b: o dev-container a sério (o `devcontainer_session_up` do backend) só existe na app
     desktop — a porta faz isso. A versão de base escreve o `.devcontainer/devcontainer.json` (o
     gerador é real: o ficheiro serve a qualquer ferramenta Dev Containers) e diz que arrancar o
     contentor precisa da app desktop — já não finge um «devcontainer up» nem um contentor ligado. */
  function dcAttach(): void {
    if (!needRt()) return;
    if (!workspace.files()[state.pDc()]) { workspace.writeFile(state.pDc(), devcontainerJson()); notifier.log("infra", ".devcontainer/devcontainer.json escrito a partir do projecto"); }
    notifier.toast("devcontainer.json pronto — arrancar o dev container precisa da app desktop");
    view.redraw();
  }
  function dcDetach(): void { state.setDevc(null); view.redraw(); }
  const appEnv = (n: DesignNode, D: Design): string[] => domAppEnv(n, D, cat());
  const k8sInfra = (D: Design): string => domK8sInfra(D, cat());
  const k8sDocs = (): K8sDoc[] => domK8sDocs(workspace.files());

  function dxDeploy(): DeployResult {
    if (!needRt()) return { ok: false };
    const e = state.envs();
    if (!e.k8sOn) { nav.goPane("infra"); notifier.toast("Point KUBECONFIG and connect the cluster first"); return { ok: false }; }
    terminal.setPanelTab("terminal", true);
    const docs = k8sDocs();
    terminal.echoCmd(`dx deploy --context ${e.ctx}`);
    if (!docs.length) { terminal.echo(`<span class="er">error: the path "deploy/k8s" does not exist</span>\n<span class="dim">Generate the backlog from the Studio and validate the platform issue — the manifests arrive with the merge into develop.</span>`); terminal.newInput(true); return { ok: false }; }
    const depsD = docs.filter((d) => d.k === "Deployment"), built = depsD.filter((d) => /registry\.example\.com/.test(d.img || "")), miss = built.filter((d) => !Object.keys(workspace.files()).some((p) => p.endsWith("/" + d.n + "/Dockerfile")));
    if (miss.length) { terminal.echo(miss.map((d) => `<span class="er">unable to prepare context: no Dockerfile for ${d.n}</span>`).join("\n")); terminal.newInput(true); return { ok: false }; }
    /* o deploy a sério (compose build, carregar as imagens no cluster local, kubectl apply,
       rollout status) só existe na app desktop com a pasta aberta — a porta desktop faz isso; aqui
       já não se finge um cluster (ADR-0006, R5a) */
    terminal.echo(`<span class="dim">${depsD.length} deployment(s) em deploy/k8s, prontos a aplicar em ${esc(e.ctx)}/${esc(e.ns)}.</span>\n<span class="er">O deploy precisa da app desktop com a pasta aberta (docker/podman e kubectl reais).</span>`);
    terminal.newInput(true); return { ok: false };
  }
  /* ADR-0006, R5b: escalar e apagar no cluster a sério é a porta desktop (o `kubectl` real); a versão
     de base já não ecoa um «scaled»/«deleted» inventado nem mexe no estado do cluster. */
  function k8sScale(_n: string, _d: number): void { notifier.toast("Escalar no cluster precisa da app desktop (o kubectl real)"); }
  function k8sDown(): void { notifier.toast("Apagar do cluster precisa da app desktop (o kubectl real)"); }
  function runTaskQuiet(c: string, out: string): void {
    if (terminal.getVar("--panel-h") !== "0px") terminal.setPanelTab("terminal", true); terminal.echoCmd(c); terminal.echo(`<span class="dim">${esc(out)}</span>`); terminal.newInput(true);
  }
  /** Os logs de um workload: abrem o tab de observabilidade do ambiente local. (A versão
   *  antiga, que escrevia três linhas no terminal, era sobreposta pelo v6 ao carregar e
   *  nunca corria — saiu ao dobrar a decoração aqui; ADR-0004, U4g2.) */
  function ctlLogs(n: string): void {
    openObserve("local", n);
  }

  /* ═══════════ motor environments / drift / secrets ═══════════ */
  const designApps = (): DesignNode[] => domDesignApps(catalog.design(), catalog.isApp);
  const localSecrets = () => domLocalSecrets(catalog.design(), cat());
  function initSecrets(): void {
    hydrateEnvx(); const x = state.envx(); if (x.sec) return;
    x.sec = domDeriveSecrets(localSecrets()); saveEnvx();
  }
  const secretCheck = (to: string) => domSecretCheck(localSecrets(), state.envx().sec![to as keyof SecretSets]);
  function envDeps(env: string): EnvDep[] {
    return env === "local" ? domEnvDeps(state.k8s()) : (envState(env)?.deps ?? []);
  }
  function envState(env: string): EnvState | null {
    hydrateEnvx();
    return domEnvStateOf(env, state.k8s(), state.envx().st);
  }
  const envHealth = (env: string): string => domEnvHealthOf(envState(env));
  const commitsBetween = (from: string | null | undefined, to: string | undefined) => domCommitsBetween(from, to, scm.commits());
  const driftReport = (env: string) => domDriftReport(envState(env), k8sDocs(), catalog.design(), cat(), scm.refs().develop);

  /* ═══════════ ambientes no cluster real (ADR-0006, R5c1) ═══════════
     Cada ambiente é um contexto do kubeconfig + um namespace. O local é o do pane Infra; staging e
     production escolhem-se em Environments. O estado lê-se do cluster pela porta desktop
     (`envCluster`); promover aplica os manifestos com os segredos do ambiente. No browser não há
     cluster: os ambientes ficam sem estado e promover diz que precisa da app desktop. */
  const target = (env: string): EnvTarget => {
    const e = state.envs(), x = state.envx();
    return env === "local" ? { env, ctx: e.ctx, ns: e.ns } : { env, ctx: x.ctx[env] || "", ns: x.ns[env] || "" };
  };
  const reading: Record<string, Promise<void> | undefined> = {};
  function refreshEnv(env: string): Promise<void> {
    const c = envCluster(), x = state.envx();
    if (env === "local" || !c || !state.envs().k8sOn) return Promise.resolve();
    const t = target(env);
    if (!t.ctx || !t.ns) { x.st[env] = null; return Promise.resolve(); }
    return reading[env] ??= c.read(t).then(
      (st) => { x.st[env] = st; },
      (e) => { x.st[env] = null; notifier.log("environments", `${env}: não consegui ler ${t.ctx}/${t.ns} — ${e}`); },
    ).finally(() => { reading[env] = undefined; view.rerender("envs"); view.redraw(); });
  }
  function refreshEnvs(): Promise<void> {
    hydrateEnvx();
    return Promise.all(["staging", "production"].map(refreshEnv)).then(() => undefined);
  }
  function setEnvTarget(env: string, field: "ctx" | "ns", v: string): void {
    hydrateEnvx(); const x = state.envx();
    x[field][env] = v.trim(); x.st[env] = null; saveEnvx();
    void refreshEnv(env);
    view.rerender("envs"); view.redraw();
  }
  /** Aplica o manifesto de `env` (com os seus segredos) e relê o ambiente. */
  function applyTo(env: string, ver: string, after: (ok: boolean) => void): void {
    const c = envCluster();
    if (!c) { notifier.toast("Promover para um cluster precisa da app desktop (o kubectl real)"); return; }
    const sec = state.envx().sec![env as keyof SecretSets];
    void c.apply(target(env), envManifest(workspace.files(), sec), ver).then(async (ok) => {
      after(ok);
      await refreshEnv(env);
      const bad = (envState(env)?.deps ?? []).filter((d) => d.status === "crash");
      notifier.toast(!ok ? `${ENVL[env]}: o deploy falhou — vê o terminal` : bad.length ? `${ENVL[env]}: ${bad.length} workload(s) a falhar` : `${ENVL[env]} está em ${ver}`);
      if (ok && bad.length) notifier.note(`${ENVL[env]}: ${bad[0].n} não arranca — ${bad[0].err}`);
    });
  }

  function promote(to: string): void {
    initSecrets();
    const from = to === "staging" ? "local" : "staging", src = envState(from);
    if (!src) { notifier.toast(`Deploy to ${ENVL[from]} first`); openEnvs(); return; }
    const t = target(to);
    if (!t.ctx || !t.ns) { notifier.toast(`Escolhe o contexto e o namespace de ${ENVL[to]} em Environments`); openEnvs(); return; }
    if (to === "production" && envHealth("staging") === "bad") {
      const bad = src.deps.filter((d) => d.status === "crash");
      nav.dlg({ title: "Production is blocked", body: `<p>Staging has failing workloads. Fix staging before promoting:</p>${bad.map((d) => `<div class="fixl"><b>✖ ${esc(d.n)}</b><span class="notr">${esc(d.err)}</span></div>`).join("")}<p style="margin-top:10px">The logs show why: <b>Observe → ${esc(bad[0].n)} (staging)</b>.</p>`, ok: "Open the logs", onOk: () => { openObserve("staging", bad[0].n); } });
      return;
    }
    const sc = secretCheck(to), cur = envState(to), cs = cur ? commitsBetween(cur.ver, src.ver) : commitsBetween(null, src.ver).slice(0, 6), block = sc.miss.length || (to === "production" && sc.empty.length);
    const x = state.envx(), commits = scm.commits(), ver = src.ver || "";
    nav.dlg({
      title: `Promote ${ENVL[from]} → ${ENVL[to]}`, block: !!block,
      body: `<div class="pr-row"><span>Version</span><code class="notr">${esc(ver || "?")}</code><span class="notr">${esc((commits[ver] || {}).m || "")}</span></div><div class="pr-row"><span>Target now runs</span><code class="notr">${cur ? esc(cur.ver || "?") : "nothing"}</code></div>
     <div class="pr-row"><span>Cluster</span><code class="notr">${esc(t.ctx)} / ${esc(t.ns)}</code></div><h3>${cs.length} commit(s) in this promotion</h3>${cs.slice(0, 6).map((c) => `<div class="pr-c notr"><code>${c.h}</code> ${esc(c.m)}</div>`).join("")}
     <h3>Secrets</h3>${sc.miss.length ? `<div class="fixl"><b>✖ ${sc.miss.length} key(s) missing in ${ENVL[to]}</b><span class="notr">${sc.miss.slice(0, 6).join(", ")}</span></div>` : ""}${sc.empty.length ? `<div class="fixl"><b>${to === "production" ? "✖" : "⚠"} ${sc.empty.length} empty value(s)</b><span class="notr">${sc.empty.slice(0, 6).join(", ")}</span></div>` : ""}${!sc.miss.length && !sc.empty.length ? '<p style="color:var(--green)">✓ Every key the design needs is set.</p>' : ""}
     <p class="pr-note">This applies <code>deploy/k8s</code> from your working tree with ${ENVL[to]}'s secrets (<code>kubectl apply</code>); the images must be in a registry that cluster can pull from. Keys are checked here; values are not — a wrong value only shows up when the workload starts. Deploying is always your decision.</p>${to === "production" ? "<p>Type <b>production</b> to confirm.</p>" : ""}`,
      input: to === "production" ? "production" : null, rows: 1, ok: `Approve and promote to ${ENVL[to]}`, validate: (v) => to === "production" && v !== "production" ? "Type production to confirm." : "",
      onOk: () => {
        applyTo(to, ver, (ok) => {
          if (!ok) return;
          x.hist.unshift({ from, to, ver, at: clock.now() }); saveEnvx();
          notifier.log("environments", `promoted ${ver} ${from} → ${to} (approved by you)`);
        });
      },
    });
  }
  function redeployEnv(env: string): void {
    initSecrets();
    const s = envState(env); if (!s) return;
    applyTo(env, s.ver || "", (ok) => { if (ok) notifier.log("environments", `${env} redeployed with updated secrets`); });
  }
  function openEnvs(): void { initSecrets(); nav.openTab({ id: "envs", title: "Environments", kind: "envs" }); void refreshEnvs(); }
  function openObserve(env: string, n: string): void {
    nav.openTab({ id: "obs:" + env + ":" + n, title: n + " · " + ENVL[env], kind: "observe", env, name: n });
  }

  return {
    hydrateEnvs, saveEnv, cli, needRt, rtConnect, k8sConnect, projectContext, devcontainerJson,
    dcAttach, dcDetach, appEnv, k8sInfra, k8sDocs, dxDeploy, k8sScale, k8sDown, runTaskQuiet, ctlLogs,
    hydrateEnvx, saveEnvx, designApps, localSecrets, initSecrets, envDeps, envState, envHealth,
    secretCheck, commitsBetween, promote, redeployEnv, refreshEnvs, setEnvTarget, openEnvs, driftReport, openObserve,
  };
}
