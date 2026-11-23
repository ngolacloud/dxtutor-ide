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
  designApps as domDesignApps, dbSlugs as domDbSlugs,
  localSecrets as domLocalSecrets, deriveSecrets as domDeriveSecrets, secretCheck as domSecretCheck,
} from "../domain/secrets";
import {
  envDeps as domEnvDeps, envStateOf as domEnvStateOf, envHealthOf as domEnvHealthOf,
  driftReport as domDriftReport, commitsBetween as domCommitsBetween,
} from "../domain/environments";
import type { Catalog, Design, DesignNode, EnvDep, EnvState, K8sDoc, SecretSets } from "../domain/types";
import type { InfraDeps, InfraEngine, DeployResult } from "./ports";

export function makeInfraEngine(deps: InfraDeps): InfraEngine {
  const { state, catalog, workspace, scm, persist, terminal, nav, notifier, view, clock } = deps;
  const cat = (): Catalog => ({ tech: catalog.tech(), kind: catalog.kind(), isApp: catalog.isApp, slug: catalog.slug });

  /* ───── hidratação preguiçosa (guard-once) ───── */
  let envsHyd = false, envxHyd = false;
  function hydrateEnvs(): void { if (envsHyd) return; envsHyd = true; Object.assign(state.envs(), persist.get("env5", {})); state.setPDc(workspace.root() + ".devcontainer/devcontainer.json"); }
  function hydrateEnvx(): void { if (envxHyd) return; envxHyd = true; Object.assign(state.envx(), persist.get("envx6", {})); }
  const saveEnv = (): void => persist.set("env5", state.envs());
  const saveEnvx = (): void => persist.set("envx6", state.envx());
  const cli = (): string => state.envs().rt;

  /* ═══════════ motor runtime / dev-container / Kubernetes ═══════════ */
  function needRt(): boolean {
    hydrateEnvs();
    if (state.envs().rtOn) return true;
    nav.goPane("infra"); notifier.toast("Point the container socket first"); return false;
  }
  function rtConnect(): void {
    hydrateEnvs(); const e = state.envs(); e.rtOn = !e.rtOn; saveEnv();
    if (!e.rtOn) { state.setStack(null); state.setDevc(null); view.drawStack(); }
    notifier.log("infra", e.rtOn ? `${RTN[e.rt]} connected at ${e.sock[e.rt]} (simulated)` : "container runtime disconnected");
    view.redraw();
  }
  function k8sConnect(): void {
    hydrateEnvs(); const e = state.envs(); e.k8sOn = !e.k8sOn; saveEnv();
    if (!e.k8sOn) state.setK8s(null);
    notifier.log("infra", e.k8sOn ? `cluster ${e.ctx} reachable via ${e.kube} (simulated)` : "cluster disconnected");
    view.redraw();
  }
  const projectContext = (): Array<[string, string]> => domProjectContext(workspace.files());
  function devcontainerJson(): string {
    const ctx = projectContext().map((x) => x[0]);
    const ports = (workspace.composeServices() || []).filter((s) => s.port).map((s) => +(s.port as number | string));
    return domDevcontainerJson(ctx, ports, state.envs().sock[state.envs().rt]);
  }
  function dcAttach(): void {
    if (!needRt()) return;
    if (!workspace.files()[state.pDc()]) workspace.writeFile(state.pDc(), devcontainerJson());
    terminal.setPanelTab("terminal", true); terminal.echoCmd("devcontainer up --workspace-folder .");
    const e = state.envs();
    terminal.echo(`<span class="dim">[+] ${RTN[e.rt]} via ${esc(e.sock[e.rt])}\n[+] Pulling</span> mcr.microsoft.com/devcontainers/base:bookworm <span class="ok">done</span>\n` + Object.keys(JSON.parse(workspace.files()[state.pDc()].content).features || {}).map((x) => `<span class="dim">[+] Feature</span> ${esc(x.split("/").pop() as string)} <span class="ok">installed</span>`).join("\n") + `\n <span class="ok">✔</span> Container dxtutor-dev  <span class="ok">Started</span>\n<span class="ac">Workspace attached to dxtutor-dev</span> <span class="dim">· simulated in the browser</span>`);
    terminal.newInput(true);
    state.setDevc({ name: "dxtutor-dev", image: "devcontainers/base:bookworm" }); notifier.log("infra", "project attached to dev container dxtutor-dev"); notifier.toast("Project attached to the dev container"); view.redraw();
  }
  function dcDetach(): void { state.setDevc(null); notifier.toast("Detached from the dev container"); view.redraw(); }
  const appEnv = (n: DesignNode, D: Design): string[] => domAppEnv(n, D, cat());
  const k8sInfra = (D: Design): string => domK8sInfra(D, cat());
  const k8sDocs = (): K8sDoc[] => domK8sDocs(workspace.files());

  function dxDeploy(): DeployResult {
    if (!needRt()) return { ok: false };
    const e = state.envs();
    if (!e.k8sOn) { nav.goPane("infra"); notifier.toast("Point KUBECONFIG and connect the cluster first"); return { ok: false }; }
    terminal.setPanelTab("terminal", true);
    const docs = k8sDocs(), kc = `kubectl --context ${e.ctx} -n ${e.ns}`;
    terminal.echoCmd(`dx deploy --context ${e.ctx}`);
    if (!docs.length) { terminal.echo(`<span class="er">error: the path "deploy/k8s" does not exist</span>\n<span class="dim">Generate the backlog from the Studio and validate the platform issue — the manifests arrive with the merge into develop.</span>`); terminal.newInput(true); return { ok: false }; }
    const depsD = docs.filter((d) => d.k === "Deployment"), built = depsD.filter((d) => /registry\.example\.com/.test(d.img || "")), miss = built.filter((d) => !Object.keys(workspace.files()).some((p) => p.endsWith("/" + d.n + "/Dockerfile")));
    if (miss.length) { terminal.echo(miss.map((d) => `<span class="er">unable to prepare context: no Dockerfile for ${d.n}</span>`).join("\n")); terminal.newInput(true); return { ok: false }; }
    const cur = state.k8s();
    terminal.echo(built.map((d) => `<span class="dim">$ ${cli()} build -t ${esc(d.img)}</span> ${d.n} <span class="ok">built</span>`).join("\n") + (/^kind-/.test(e.ctx) ? "\n" + built.map((d) => `<span class="dim">$ kind load docker-image ${esc(d.img)}</span> <span class="ok">loaded</span>`).join("\n") : "") + `\n<span class="dim">$ ${kc} apply -f deploy/k8s/</span>\n` + docs.map((d) => `${d.k.toLowerCase()}${d.k === "Deployment" ? ".apps" : d.k === "Ingress" ? ".networking.k8s.io" : ""}/${d.n} <span class="ok">${cur && cur.docs.some((x) => x.k === d.k && x.n === d.n) ? "configured" : "created"}</span>`).join("\n"));
    state.setK8s({ docs, deps: depsD.map((d) => ({ n: d.n, rep: d.rep, ready: d.rep, img: d.img, port: d.port })) });
    const ing = docs.find((d) => d.k === "Ingress");
    terminal.echo(`\n<span class="ac">${depsD.length} deployments ready in ${esc(e.ctx)}/${esc(e.ns)}</span> <span class="dim">· simulated: the browser has no cluster. The desktop app runs these exact commands.</span>${ing ? `\n  ➜  ingress ${ing.n}  <span class="ac">http://localhost/</span>` : ""}`);
    terminal.newInput(true); notifier.log("infra", `deployed ${depsD.length} workloads to ${e.ctx}/${e.ns}`); notifier.toast(`Deployed to ${e.ctx}`); nav.goPane("infra"); return { ok: true };
  }
  function k8sScale(n: string, d: number): void {
    const cur = state.k8s()!; const x = cur.deps.find((y) => y.n === n)!; x.rep = Math.max(0, x.rep + d); x.ready = x.rep;
    runTaskQuiet(`kubectl -n ${state.envs().ns} scale deploy/${n} --replicas=${x.rep}`, `deployment.apps/${n} scaled`); view.redraw();
  }
  function k8sDown(): void {
    const cur = state.k8s()!;
    runTaskQuiet(`kubectl -n ${state.envs().ns} delete -f deploy/k8s/`, cur.docs.map((d) => `${d.k.toLowerCase()}/${d.n} deleted`).join("\n")); state.setK8s(null); view.redraw();
  }
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
    x.sec = domDeriveSecrets(localSecrets(), domDbSlugs(catalog.design(), cat())); saveEnvx();
  }
  const secretCheck = (to: string) => domSecretCheck(localSecrets(), state.envx().sec![to as keyof SecretSets]);
  function envDeps(env: string): EnvDep[] {
    const sec = env === "local" ? localSecrets() : state.envx().sec![env as keyof SecretSets];
    return domEnvDeps(env, state.k8s(), sec, catalog.design(), catalog.slug);
  }
  function envState(env: string): EnvState | null {
    hydrateEnvx();
    return domEnvStateOf(env, state.k8s(), state.envx().st, env === "local" ? envDeps("local") : []);
  }
  const envHealth = (env: string): string => domEnvHealthOf(envState(env));
  const commitsBetween = (from: string | null | undefined, to: string | undefined) => domCommitsBetween(from, to, scm.commits());
  const driftReport = (env: string) => domDriftReport(envState(env), k8sDocs(), catalog.design(), cat(), scm.refs().develop);

  function promote(to: string): void {
    initSecrets();
    const from = to === "staging" ? "local" : "staging", src = envState(from);
    if (!src) { notifier.toast(`Deploy to ${ENVL[from]} first`); openEnvs(); return; }
    if (to === "production" && envHealth("staging") === "bad") {
      nav.dlg({ title: "Production is blocked", body: `<p>Staging has failing workloads. Fix staging before promoting:</p>${src.deps.filter((d) => d.status === "crash").map((d) => `<div class="fixl"><b>✖ ${esc(d.n)}</b><span class="notr">${esc(d.err)}</span></div>`).join("")}<p style="margin-top:10px">The Debug assistant can investigate: <b>Run and Debug → Attach: ${esc(src.deps.find((d) => d.status === "crash")!.n)} (staging)</b>.</p>`, ok: "Open debugger", onOk: () => { nav.goPane("debug"); } });
      return;
    }
    const sc = secretCheck(to), cur = envState(to), cs = cur ? commitsBetween(cur.ver, src.ver) : commitsBetween(null, src.ver).slice(0, 6), block = sc.miss.length || (to === "production" && sc.empty.length);
    const x = state.envx(), commits = scm.commits();
    nav.dlg({
      title: `Promote ${ENVL[from]} → ${ENVL[to]}`, block: !!block,
      body: `<div class="pr-row"><span>Version</span><code class="notr">${src.ver}</code><span class="notr">${esc((commits[src.ver as string] || {}).m || "")}</span></div><div class="pr-row"><span>Target now runs</span><code class="notr">${cur ? cur.ver : "nothing"}</code></div>
     <div class="pr-row"><span>Cluster</span><code class="notr">${esc(x.ctx[to])} / ${esc(x.ns[to])}</code></div><h3>${cs.length} commit(s) in this promotion</h3>${cs.slice(0, 6).map((c) => `<div class="pr-c notr"><code>${c.h}</code> ${esc(c.m)}</div>`).join("")}
     <h3>Secrets</h3>${sc.miss.length ? `<div class="fixl"><b>✖ ${sc.miss.length} key(s) missing in ${ENVL[to]}</b><span class="notr">${sc.miss.slice(0, 6).join(", ")}</span></div>` : ""}${sc.empty.length ? `<div class="fixl"><b>${to === "production" ? "✖" : "⚠"} ${sc.empty.length} empty value(s)</b><span class="notr">${sc.empty.slice(0, 6).join(", ")}</span></div>` : ""}${!sc.miss.length && !sc.empty.length ? '<p style="color:var(--green)">✓ Every key the design needs is set.</p>' : ""}
     <p class="pr-note">Keys are checked here; values are not — a wrong value only shows up when the workload starts. Deploying is always your decision.</p>${to === "production" ? "<p>Type <b>production</b> to confirm.</p>" : ""}`,
      input: to === "production" ? "production" : null, rows: 1, ok: `Approve and promote to ${ENVL[to]}`, validate: (v) => to === "production" && v !== "production" ? "Type production to confirm." : "",
      onOk: () => {
        x.st[to] = { ver: src.ver, at: clock.now(), deps: [], ingress: true }; x.st[to]!.deps = envDeps(to); x.hist.unshift({ from, to, ver: src.ver, at: clock.now() }); saveEnvx(); const bad = x.st[to]!.deps.filter((d) => d.status === "crash");
        terminal.setPanelTab("terminal", true); terminal.echoCmd(`dx promote ${from} ${to} --version ${src.ver}`); terminal.echo(`<span class="dim">$ kubectl --context ${esc(x.ctx[to])} -n ${esc(x.ns[to])} apply -f deploy/k8s/ (secrets from ${ENVL[to]})</span>\n` + x.st[to]!.deps.map((d) => d.status === "crash" ? `deployment "${d.n}" <span class="er">exceeded its progress deadline — CrashLoopBackOff</span>` : `deployment "${d.n}" <span class="ok">successfully rolled out</span>`).join("\n") + `\n<span class="dim">simulated: no real cluster is reached from the browser.</span>`); terminal.newInput(true);
        notifier.log("environments", `promoted ${src.ver} ${from} → ${to} (approved by you)`); notifier.toast(bad.length ? `${ENVL[to]}: ${bad.length} workload(s) failing` : `${ENVL[to]} is on ${src.ver}`); if (bad.length) notifier.note(`${ENVL[to]}: ${bad[0].n} is crash-looping`); view.rerender("envs"); view.redraw(); view.rerenderDebug();
      },
    });
  }
  function redeployEnv(env: string): void {
    const s = state.envx().st[env]; if (!s) return; s.deps = envDeps(env); s.at = clock.now(); saveEnvx(); const bad = s.deps.filter((d) => d.status === "crash");
    notifier.toast(bad.length ? `${ENVL[env]}: still failing` : `${ENVL[env]}: all workloads ready`); notifier.log("environments", `${env} redeployed with updated secrets`); view.rerender("envs"); view.redraw(); view.rerenderDebug();
  }
  function openEnvs(): void { initSecrets(); nav.openTab({ id: "envs", title: "Environments", kind: "envs" }); }
  function openObserve(env: string, n: string): void {
    nav.openTab({ id: "obs:" + env + ":" + n, title: n + " · " + ENVL[env], kind: "observe", env, name: n });
  }

  return {
    hydrateEnvs, saveEnv, cli, needRt, rtConnect, k8sConnect, projectContext, devcontainerJson,
    dcAttach, dcDetach, appEnv, k8sInfra, k8sDocs, dxDeploy, k8sScale, k8sDown, runTaskQuiet, ctlLogs,
    hydrateEnvx, saveEnvx, designApps, localSecrets, initSecrets, envDeps, envState, envHealth,
    secretCheck, commitsBetween, promote, redeployEnv, openEnvs, driftReport, openObserve,
  };
}
