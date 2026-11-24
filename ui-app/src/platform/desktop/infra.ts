/* ═════════ dxtutor IDE — desktop: contentores e Kubernetes reais (ADR-0004, U4h1) ═════════
   O runtime de contentores (docker/podman, socket real), o cluster (kubectl, KUBECONFIG), o
   compose up/down/ps, o deploy para o cluster e os logs reais na vista de observabilidade.
   Era a secção «containers and Kubernetes» do bridge.ts, verbatim. O dxRun/dxStop/drawStack e o
   rtConnect/k8sConnect/dxDeploy/VIEW.observe reais são as portas `desktopPorts.stack` e
   `desktopPorts.infra` que os donos consultam (U4h4). */

import { jsa } from "../../core";
import type { ExecResult } from "./context";
import type { StackDesktop } from "../../features/stack";
import type { InfraDesktop } from "../../features/infra/application/ports";
import { desktopPorts } from "../../app/desktop";
import type { DesktopContext } from "./context";

export function installInfra(ctx: DesktopContext): void {
const { R, fsx, sh, escH, say, idle } = ctx;
const flushSave = () => ctx.flushSave();
const runInTerm = (line: string, o?: { env?: Record<string, string> }) => ctx.runInTerm(line, o);
/* ───── containers and Kubernetes ───── */
const rtBin = () => ENVS.rt === "podman" ? "podman" : "docker";
function envFor(): Record<string, string> {
  const e: Record<string, string> = {};
  if (ENVS.rtOn && R.sock) { e.DOCKER_HOST = "unix://" + R.sock; if (ENVS.rt === "podman") e.CONTAINER_HOST = "unix://" + R.sock; }
  if (R.kube) e.KUBECONFIG = R.kube;
  return e;
}
const compose = () => rtBin() + " compose";
async function readK8s(): Promise<void> {
  if (!ENVS.k8sOn) return;
  const r = await sh("kubectl", ["--context", ENVS.ctx, "-n", ENVS.ns, "get", "deploy", "-o", "json"], { env: envFor(), timeout: 20000 });
  if (r.code !== 0) return;
  try {
    const items = JSON.parse(r.stdout).items || [];
    K8S = items.length ? { docs: k8sDocs(), deps: items.map((d: any) => { const c = (d.spec.template.spec.containers || [])[0] || {}; return { n: d.metadata.name, rep: d.spec.replicas || 0, ready: (d.status && d.status.readyReplicas) || 0, img: c.image, port: ((c.ports || [])[0] || {}).containerPort }; }) } : null;
  } catch { /* resposta inválida */ }
}
R.readStack = () => readStack();
async function readStack(): Promise<void> {
  const r = await sh(rtBin(), ["compose", "ps", "--format", "json"], { env: envFor(), timeout: 30000 });
  if (r.code !== 0) return;
  let rows: any[] = [];
  const s = r.stdout.trim();
  try { rows = s.startsWith("[") ? JSON.parse(s) : s.split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { /* formato inesperado */ }
  STACK = rows.length ? rows.map(x => { const pub = (x.Publishers || []).find((p: any) => p.PublishedPort); return { name: x.Service || x.Name, src: x.Image || "", url: pub ? `http://localhost:${pub.PublishedPort}` : "internal", state: x.Health || x.State || "" }; }) : null;
  drawStack();
}
/* as portas desktop do stack e da infra (ADR-0004, U4h4): o features/stack.ts consulta
   `desktopPorts.stack` no dxRun/dxStop/drawStack que publica e o features/infra.ts consulta
   `desktopPorts.infra` no rtConnect/k8sConnect/dxDeploy e no VIEW.observe — antes estes eram
   reatribuídos no `window`. Os corpos são os mesmos; a versão simulada chega como último
   argumento (o rtConnect/k8sConnect reais nunca a usaram). */
const stackDesktop: StackDesktop = {
dxRun(term, _dxRun) {
  if (!R.root || !FS[ROOT + "docker-compose.yml"] && !FS[ROOT + "compose.yaml"]) return _dxRun(term);
  if (!needRt()) return { ok: false };
  flushSave();
  void idle().then(async () => { const code = await runInTerm(`${compose()} up --build -d`, { env: envFor() }); if (code === 0) { await readStack(); setPanelTab("services"); toast(`${STACK ? STACK.length : 0} services up`); } });
  return { ok: true, sum: "starting" };
},
dxStop(term, _dxStop) {
  if (!R.root) return _dxStop(term);
  void runInTerm(`${compose()} down`, { env: envFor() }).then(() => { STACK = null; drawStack(); });
},
drawStack(_drawStack) {
  _drawStack();
  if (R.root) { const t = document.querySelector("#pc-services .tag.warn"); if (t) { t.textContent = "live"; t.className = "tag live"; } }
},
};
const infraDesktop: InfraDesktop = {
async rtConnect() {
  hydrateEnvs();
  if (ENVS.rtOn) { ENVS.rtOn = false; saveEnv(); STACK = null; DEVC = null; drawStack(); say("container runtime disconnected"); infraDraw(); return; }
  R.sock = await fsx.expandPath(ENVS.sock[ENVS.rt]);
  const env = { DOCKER_HOST: "unix://" + R.sock, CONTAINER_HOST: "unix://" + R.sock };
  const r = await sh(rtBin(), ["info", "--format", ENVS.rt === "podman" ? "{{.Version.Version}}" : "{{.ServerVersion}}"], { env, timeout: 15000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
  if (r.code === 0) { ENVS.rtOn = true; saveEnv(); say(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected at ${R.sock}`); toast(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected`); }
  else { toast(`${RTN[ENVS.rt]} not reachable at ${R.sock}`); say(String(r.stderr || "").trim().split("\n")[0]); }
  infraDraw();
},
async k8sConnect() {
  hydrateEnvs();
  if (ENVS.k8sOn) { ENVS.k8sOn = false; saveEnv(); K8S = null; say("cluster disconnected"); infraDraw(); return; }
  const kube: string = await fsx.expandPath(ENVS.kube);
  R.kube = kube;
  const env = { KUBECONFIG: kube };
  const ctx = await sh("kubectl", ["config", "get-contexts", "-o", "name"], { env, timeout: 15000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
  if (ctx.code !== 0) { toast("kubectl could not read " + R.kube); say(String(ctx.stderr).trim().split("\n")[0]); return; }
  const names = ctx.stdout.trim().split("\n").filter(Boolean);
  KCTX.length = 0; KCTX.push(...names);
  if (!names.includes(ENVS.ctx)) { const cc = await sh("kubectl", ["config", "current-context"], { env }); ENVS.ctx = cc.stdout.trim() || names[0] || ENVS.ctx; }
  const ok = await sh("kubectl", ["--context", ENVS.ctx, "get", "ns", "-o", "name", "--request-timeout=6s"], { env, timeout: 15000 });
  if (ok.code !== 0) { toast(`cluster ${ENVS.ctx} not reachable`); say(String(ok.stderr).trim().split("\n")[0]); infraDraw(); return; }
  ENVS.k8sOn = true; saveEnv();
  say(`cluster ${ENVS.ctx} reachable via ${R.kube}`);
  await readK8s();
  infraDraw();
},
dxDeploy(_dxDeploy) {
  if (!R.root) return _dxDeploy();
  if (!needRt()) return { ok: false };
  if (!ENVS.k8sOn) { goPane("infra"); toast("Point KUBECONFIG and connect the cluster first"); return { ok: false }; }
  const docs = k8sDocs();
  if (!docs.length) return _dxDeploy();
  flushSave();
  const proj = R.name!.toLowerCase().replace(/[^a-z0-9_-]/g, ""), ctx = ENVS.ctx, ns = ENVS.ns, kc = `kubectl --context ${ctx}`, deps = docs.filter(d => d.k === "Deployment");
  const load = (img: string) => /^kind-/.test(ctx) ? `kind load docker-image ${img} --name ${ctx.slice(5)}` : /^minikube/.test(ctx) ? `minikube image load ${img}` : /^k3d-/.test(ctx) ? `k3d image import ${img} -c ${ctx.slice(4)}` : `echo "push ${img} to a registry the cluster can pull from"`;
  const own = deps.filter(d => /registry\.example\.com/.test(d.img || ""));
  const script = ["set -e", `${compose()} build`, ...own.map(d => `${rtBin()} tag ${proj}-${d.n} ${d.img} && ${load(d.img)}`), `${kc} create namespace ${ns} --dry-run=client -o yaml | ${kc} apply -f -`, `${kc} -n ${ns} apply -f deploy/k8s`, ...deps.map(d => `${kc} -n ${ns} rollout status deploy/${d.n} --timeout=180s`)].join("\n");
  void idle().then(async () => { const code = await runInTerm(script, { env: envFor() }); if (code === 0) { await readK8s(); toast("Deployed to " + ctx); goPane("infra"); } infraDraw(); });
  return { ok: true, sum: "deploying" };
},
observe(t, host, _observe) {
  _observe(t, host);
  if (!R.root) return;
  const pg = host.querySelector(".page") || host;
  const k8s = t.env && t.env !== "local" && ENVS.k8sOn;
  const cmd = k8s ? `kubectl --context ${ENVS.ctx} -n ${ENVS.ns} logs -f --tail=200 deploy/${t.name}` : `${compose()} logs -f --tail=200 ${t.name}`;
  pg.insertAdjacentHTML("afterbegin", `<div class="sec-empty" style="margin:0 0 10px"><b>Real logs:</b> <code>${escH(cmd)}</code> <button class="mini pri" onclick="DXR.logs(${jsa(cmd)})">Stream in terminal</button> <span class="dim">(the charts below are modelled)</span></div>`);
},
};
desktopPorts.stack = stackDesktop;
desktopPorts.infra = infraDesktop;
R.logs = cmd => runInTerm(cmd, { env: envFor() });
ctx.envFor = envFor;
}
