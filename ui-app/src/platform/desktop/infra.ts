/* ═════════ dxtutor IDE — desktop: contentores e Kubernetes reais (ADR-0004, U4h1) ═════════
   O runtime de contentores (docker/podman, socket real), o cluster (kubectl, KUBECONFIG), o
   compose up/down/ps, o deploy para o cluster e os logs reais na vista de observabilidade.
   Era a secção «containers and Kubernetes» do bridge.ts, verbatim. O dxRun/dxStop/drawStack e o
   rtConnect/k8sConnect/dxDeploy/VIEW.observe reais são as portas `desktopPorts.stack` e
   `desktopPorts.infra` que os donos consultam (U4h4). */

import type { ExecResult } from "./context";
import type { StackDesktop } from "../../features/stack";
import type { InfraDesktop } from "../../features/infra/application/ports";
import { desktopPorts } from "../../app/desktop";
import { RP } from "../../app/store/registry";
import { devcontainerClient } from "../tauri/devcontainer";
import { parseClusterState, deploymentsIn, ANN_VER, ANN_AT } from "../../features/infra/domain/environments";
import { parseDockerStats, parseKubectlTop, type ObsText } from "../../features/infra/domain/observability";
import type { EnvState, ObsTarget } from "../../features/infra/domain/types";
import type { DesktopContext } from "./context";
import { translator } from "../../app/i18n";
import { DESKTOP_MESSAGES } from "./desktop-messages";
import { echo, echoCmd, newInput } from "../../features/terminal";
import { k8s, setK8s, devc, setDevc, pDc, RTN, KCTX, needRt, infraDraw, k8sDocs, saveEnv, hydrateEnvs, devcontainerJson } from "../../features/infra";
import { stackState, setStackState, drawStack } from "../../features/stack";

const tdk = translator(DESKTOP_MESSAGES);
/** os erros das amostras de observabilidade na língua da interface (o domínio recebe-os por parâmetro) */
const obsText = (): ObsText => ({ noSample: tdk("obsNoSample"), badStats: tdk("obsBadStats"), noCpuMem: tdk("obsNoCpuMem"), noPods: tdk("obsNoPods") });

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
/** O que corre num namespace: Deployments, pods (reinícios e o motivo de um contentor preso) e
 *  Ingresses, lidos pelo kubectl e interpretados pelo domínio (ADR-0006, R5c1). null = não há
 *  Deployments; lança se o cluster não responde. */
async function readNs(ctxName: string, ns: string): Promise<EnvState | null> {
  const get = (what: string) => sh("kubectl", ["--context", ctxName, "-n", ns, "get", what, "-o", "json", "--request-timeout=10s"], { env: envFor(), timeout: 20000 });
  const [dep, pods, ing] = await Promise.all([get("deploy"), get("pods"), get("ingress")]);
  /* a última linha é a mensagem do kubectl (as de cima são o registo do klog) */
  if (dep.code !== 0) throw new Error(String(dep.stderr || "kubectl falhou").trim().split("\n").pop());
  const st = parseClusterState(dep.stdout, pods.code === 0 ? pods.stdout : "", ing.code === 0 ? ing.stdout : "", tdk("lastEnd"));
  if (!st.deps.length) return null;
  return { ver: st.ver, at: st.at, ingress: st.ingress, deps: st.deps.map(d => ({ n: d.n, rep: d.rep, ready: d.ready, status: d.err ? "crash" : "ok", err: d.err ?? null, restarts: d.restarts ?? 0, img: d.img })) };
}
async function readK8s(): Promise<void> {
  if (!ENVS.k8sOn) return;
  const get = (what: string) => sh("kubectl", ["--context", ENVS.ctx, "-n", ENVS.ns, "get", what, "-o", "json"], { env: envFor(), timeout: 20000 });
  const [dep, pods, ing] = await Promise.all([get("deploy"), get("pods"), get("ingress")]);
  if (dep.code !== 0) return;
  const st = parseClusterState(dep.stdout, pods.code === 0 ? pods.stdout : "", ing.code === 0 ? ing.stdout : "", tdk("lastEnd"));
  setK8s(st.deps.length ? { docs: k8sDocs(), deps: st.deps, ver: st.ver, at: st.at, ingress: st.ingress } : null);
}
/* ───── ajudas da observabilidade (R5c2) ───── */
const fail = (e: unknown): ExecResult => ({ code: -1, stdout: "", stderr: String(e) });
/** A mensagem de um erro do kubectl/runtime é a última linha (as de cima são registo). */
const lastLine = (s: string): string => String(s || "").trim().split("\n").pop() || "falhou";
const shq = (s: string): string => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
const kns = (t: Extract<ObsTarget, { via: "kubectl" }>) => ["--context", t.ctx, "-n", t.ns];
const logsCmd = (t: ObsTarget, follow: boolean): string => (t.via === "compose"
  ? `${compose()} logs --timestamps --tail=200 ${shq(t.n)}`
  : `kubectl --context ${shq(t.ctx)} -n ${shq(t.ns)} logs deploy/${shq(t.n)} --all-containers=true --timestamps --tail=200`) + (follow ? " -f" : "");
/** O selector dos pods de um Deployment (`spec.selector.matchLabels`), lido uma vez; `app=<n>` se falha. */
const selectors: Record<string, string> = {};
async function selectorOf(t: Extract<ObsTarget, { via: "kubectl" }>): Promise<string> {
  const k = `${t.ctx}/${t.ns}/${t.n}`;
  if (selectors[k]) return selectors[k];
  const r = await sh("kubectl", [...kns(t), "get", "deploy", t.n, "-o", "jsonpath={.spec.selector.matchLabels}"], { env: envFor(), timeout: 15000 }).catch(fail);
  let sel = `app=${t.n}`;
  try { const m = JSON.parse(r.stdout || "{}") as Record<string, string>; const kv = Object.entries(m).map(([a, b]) => `${a}=${b}`).join(","); if (r.code === 0 && kv) sel = kv; } catch { /* fica app=<n> */ }
  return (selectors[k] = sel);
}
/** As anotações da versão e da hora do deploy (lidas de volta por `parseClusterState`). */
const annotate = (kc: string, ns: string, ver: string) => `${kc} -n ${ns} annotate deploy --all ${ANN_VER}=${ver} ${ANN_AT}=$(($(date +%s)*1000)) --overwrite`;
/* ───── o pane Containers (ADR-0006, R5a): os contentores e as imagens reais do runtime ligado ─────
   `docker`/`podman ps -a` e `images` em JSON (o docker escreve um objecto por linha; o podman um
   array), com o socket do pane Infra. Sem runtime ligado, di-lo. */
const jsonRows = (s: string): any[] => { const t = s.trim(); if (!t) return []; try { return t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
const human = (n: unknown): string => { if (typeof n !== "number") return String(n ?? ""); const u = ["B", "KB", "MB", "GB"]; let v = n, i = 0; while (v >= 1000 && i < 3) { v /= 1000; i++; } return v.toFixed(v < 10 && i ? 1 : 0) + " " + u[i]; };
async function drawContainers(): Promise<void> {
  const host = document.getElementById("dk-containers"), imgs = document.getElementById("dk-images");
  if (!host || !imgs) return;
  if (!ENVS.rtOn) { host.innerHTML = `<div class="sec-empty">${tdk("noRuntime")}</div>`; imgs.innerHTML = ""; return; }
  host.innerHTML = '<div class="sec-empty">A ler os contentores…</div>';
  const [ps, im] = await Promise.all([
    sh(rtBin(), ["ps", "-a", "--format", "json"], { env: envFor(), timeout: 20000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) })),
    sh(rtBin(), ["images", "--format", "json"], { env: envFor(), timeout: 20000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) })),
  ]);
  if (ps.code !== 0) { host.innerHTML = `<div class="sec-empty" style="color:var(--red)">${escH(String(ps.stderr || "o runtime não respondeu").trim().split("\n")[0])}</div>`; imgs.innerHTML = ""; return; }
  const rows = jsonRows(ps.stdout).map((c: any) => ({ name: Array.isArray(c.Names) ? c.Names[0] : String(c.Names || c.Name || c.ID || ""), image: String(c.Image || ""), state: String(c.State || "").toLowerCase(), status: String(c.Status || c.State || "") }));
  host.innerHTML = rows.length
    ? rows.map(c => `<div class="row dk-row sub" title="${escH(c.image)}"><span class="ct-dot" style="background:${c.state === "running" ? "var(--green)" : "var(--fg-muted)"}"></span><span class="nm dk-fixed notr">${escH(c.name)}</span><span class="pth dk-path notr">${escH(c.image)} · ${escH(c.status)}</span></div>`).join("")
    : `<div class="sec-empty">${tdk("noContainers")}</div>`;
  const irows = im.code === 0 ? jsonRows(im.stdout).map((x: any) => ({ name: x.Repository ? `${x.Repository}:${x.Tag}` : Array.isArray(x.Names) && x.Names[0] ? x.Names[0] : String(x.Id || x.ID || "").slice(0, 19), size: human(x.Size) })) : [];
  imgs.innerHTML = irows.length
    ? irows.map(x => `<div class="row dk-row"><span class="nm notr">${escH(x.name)}</span><span class="pth notr">${escH(x.size)}</span></div>`).join("")
    : `<div class="sec-empty">${tdk("noImages")}</div>`;
}
RP.containers = () => { void drawContainers(); };
R.drawContainers = () => drawContainers();
R.readStack = () => readStack();
async function readStack(): Promise<void> {
  const r = await sh(rtBin(), ["compose", "ps", "--format", "json"], { env: envFor(), timeout: 30000 });
  if (r.code !== 0) return;
  let rows: any[] = [];
  const s = r.stdout.trim();
  try { rows = s.startsWith("[") ? JSON.parse(s) : s.split("\n").filter(Boolean).map(l => JSON.parse(l)); } catch { /* formato inesperado */ }
  setStackState(rows.length ? rows.map(x => { const pub = (x.Publishers || []).find((p: any) => p.PublishedPort); return { name: x.Service || x.Name, src: x.Image || "", url: pub ? `http://localhost:${pub.PublishedPort}` : "internal", state: x.Health || x.State || "" }; }) : null);
  drawStack(); void drawContainers();
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
  void idle().then(async () => { const code = await runInTerm(`${compose()} up --build -d`, { env: envFor() }); if (code === 0) { await readStack(); setPanelTab("services"); toast(`${stackState() ? stackState()!.length : 0} services up`); } });
  return { ok: true, sum: "starting" };
},
dxStop(term, _dxStop) {
  if (!R.root) return _dxStop(term);
  void runInTerm(`${compose()} down`, { env: envFor() }).then(() => { setStackState(null); drawStack(); });
},
drawStack(_drawStack) {
  _drawStack();
  if (R.root) { const t = document.querySelector("#pc-services .tag.warn"); if (t) { t.textContent = "live"; t.className = "tag live"; } }
},
};
const infraDesktop: InfraDesktop = {
async rtConnect() {
  hydrateEnvs();
  if (ENVS.rtOn) { ENVS.rtOn = false; saveEnv(); setStackState(null); setDevc(null); drawStack(); say("container runtime disconnected"); infraDraw(); void drawContainers(); return; }
  R.sock = await fsx.expandPath(ENVS.sock[ENVS.rt]);
  const env = { DOCKER_HOST: "unix://" + R.sock, CONTAINER_HOST: "unix://" + R.sock };
  const r = await sh(rtBin(), ["info", "--format", ENVS.rt === "podman" ? "{{.Version.Version}}" : "{{.ServerVersion}}"], { env, timeout: 15000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
  if (r.code === 0) { ENVS.rtOn = true; saveEnv(); say(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected at ${R.sock}`); toast(`${RTN[ENVS.rt]} ${r.stdout.trim()} connected`); }
  else { toast(`${RTN[ENVS.rt]} not reachable at ${R.sock}`); say(String(r.stderr || "").trim().split("\n")[0]); }
  infraDraw(); void drawContainers();
},
async k8sConnect() {
  hydrateEnvs();
  if (ENVS.k8sOn) { ENVS.k8sOn = false; saveEnv(); setK8s(null); say("cluster disconnected"); infraDraw(); return; }
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
  const script = ["set -e", `${compose()} build`, ...own.map(d => `${rtBin()} tag ${proj}-${d.n} ${d.img} && ${load(d.img as string)}`), `${kc} create namespace ${ns} --dry-run=client -o yaml | ${kc} apply -f -`, `${kc} -n ${ns} apply -f deploy/k8s`, annotate(kc, ns, "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"), ...deps.map(d => `${kc} -n ${ns} rollout status deploy/${d.n} --timeout=180s`)].join("\n");
  void idle().then(async () => { const code = await runInTerm(script, { env: envFor() }); if (code === 0) { await readK8s(); toast("Deployed to " + ctx); goPane("infra"); } infraDraw(); });
  return { ok: true, sum: "deploying" };
},
/* ───── o dev-container real (ADR-0006, R5b): a sessão do backend sobre o devcontainer.json ───── */
dcAttach(_dcAttach) {
  if (!R.root) return _dcAttach();
  if (!needRt()) return;
  const root = R.root, pdcPath = pDc();
  if (!FS[pdcPath]) writeFile(pdcPath, devcontainerJson());
  flushSave();
  setPanelTab("terminal", true); echoCmd(tdk("dcUpCmd"));
  void idle().then(async () => {
    try {
      const up = await devcontainerClient().sessionUp(root);
      const out = [up.ran ? `$ ${up.ran}` : "", up.stdout.trim(), up.stderr.trim()].filter(Boolean).join("\n");
      if (out) echo(`<span class="dim">${escH(out.slice(-4000))}</span>`);
      if (!up.ok) { echo(`<span class="er">${tdk("dcNotStarted")}</span>`); toast(tdk("dcNotStartedToast")); newInput(true); return; }
      const st = await devcontainerClient().sessionStatus(root).catch(() => ({ running: true, name: "" }));
      /* a sessão corre no motor de sandbox do backend (o mesmo da Learning Track), que pode não ser o
         runtime escolhido acima: diz-se qual, em vez de o trocar às escondidas */
      const engine = await devcontainerClient().engine().catch(() => "");
      const dv = { name: st.name || "dev container", image: up.image, engine };
      setDevc(dv);
      echo(`<span class="ok">${tdk("dcRunning", { name: escH(dv.name), engine: escH(engine || "?"), image: escH(up.image), built: up.built ? tdk("dcBuilt") : "" })}</span>`); newInput(true);
      say(`dev container ${dv.name} up`); toast("Projecto ligado ao dev container");
    } catch (e) { echo(`<span class="er">${escH(String(e))}</span>`); newInput(true); toast("O dev container não arrancou"); }
    infraDraw();
  });
},
dcDetach(_dcDetach) {
  if (!R.root) return _dcDetach();
  const root = R.root;
  void devcontainerClient().sessionDown(root).then(() => { setDevc(null); say("dev container parado"); toast("Dev container parado"); infraDraw(); }, (e) => { toast(tdk("dcStopFail", { error: String(e) })); });
},
/* ───── o scale e o delete do Kubernetes com o kubectl real (ADR-0006, R5b) ───── */
k8sScale(n, d, _k8sScale) {
  if (!ENVS.k8sOn || !k8s()) return _k8sScale(n, d);
  const x = (k8s() as { deps: Array<{ n: string; rep: number }> }).deps.find(y => y.n === n); if (!x) return;
  const rep = Math.max(0, x.rep + d);
  void runInTerm(`kubectl --context ${ENVS.ctx} -n ${ENVS.ns} scale deploy/${n} --replicas=${rep}`, { env: envFor() }).then(async () => { await readK8s(); infraDraw(); });
},
k8sDown(_k8sDown) {
  if (!ENVS.k8sOn || !R.root) return _k8sDown();
  void runInTerm(`kubectl --context ${ENVS.ctx} -n ${ENVS.ns} delete -f deploy/k8s`, { env: envFor() }).then(async () => { setK8s(null); await readK8s(); infraDraw(); });
},
/* ───── staging e production no cluster real (ADR-0006, R5c1) ─────
   O manifesto (com os segredos do ambiente) entra pela entrada padrão do `kubectl apply -f -`:
   nunca toca no disco nem na linha de comandos. */
cluster: {
  async apply(t, manifest, ver) {
    setPanelTab("terminal", true);
    const kc = ["--context", t.ctx], show = (r: ExecResult) => { const o = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join("\n"); if (o) echo(`<span class="${r.code === 0 ? "dim" : "er"}">${escH(o.slice(-4000))}</span>`); return r.code === 0; };
    const run = (args: string[], stdin?: string) => sh("kubectl", [...kc, ...args], { env: envFor(), stdin: stdin ?? null, timeout: 200000 }).catch((e): ExecResult => ({ code: -1, stdout: "", stderr: String(e) }));
    echoCmd(`kubectl --context ${t.ctx} -n ${t.ns} apply -f deploy/k8s   # segredos de ${t.env}, versão ${ver || "?"}`);
    const nsY = await run(["create", "namespace", t.ns, "--dry-run=client", "-o", "yaml"]);
    let ok = show(nsY) && show(await run(["apply", "-f", "-"], nsY.stdout));
    if (ok) ok = show(await run(["-n", t.ns, "apply", "-f", "-"], manifest));
    if (ok && ver) ok = show(await run(["-n", t.ns, "annotate", "deploy", "--all", `${ANN_VER}=${ver}`, `${ANN_AT}=${Date.now()}`, "--overwrite"]));
    if (ok) {
      for (const n of deploymentsIn(manifest)) if (!show(await run(["-n", t.ns, "rollout", "status", `deploy/${n}`, "--timeout=180s"]))) { ok = false; break; }
    }
    echo(ok ? `<span class="ok">${escH(t.env)}: aplicado em ${escH(t.ctx)}/${escH(t.ns)}</span>` : `<span class="er">${escH(t.env)}: o deploy falhou</span>`); newInput(true);
    return ok;
  },
  read: (t) => readNs(t.ctx, t.ns),
},
/* ───── as métricas e os logs reais da observabilidade (ADR-0006, R5c2) ─────
   Um serviço do compose: `stats --no-stream` do contentor e `compose logs`; um Deployment:
   `kubectl top pod -l <selector>` e `kubectl logs deploy/…`, no contexto/namespace do ambiente
   (antes, os logs de staging/production iam ao contexto do local). */
obs: {
  async sample(t) {
    if (t.via === "compose") {
      const ps = await sh(rtBin(), ["compose", "ps", "-q", t.n], { env: envFor(), timeout: 15000 }).catch(fail);
      const id = ps.stdout.trim().split("\n")[0];
      if (ps.code !== 0 || !id) return { error: ps.code !== 0 ? lastLine(ps.stderr) : tdk("notRunning", { name: t.n }) };
      const r = await sh(rtBin(), ["stats", "--no-stream", "--format", "json", id], { env: envFor(), timeout: 15000 }).catch(fail);
      return r.code === 0 ? parseDockerStats(r.stdout, obsText()) : { error: lastLine(r.stderr) };
    }
    const r = await sh("kubectl", [...kns(t), "top", "pod", "-l", await selectorOf(t), "--no-headers"], { env: envFor(), timeout: 15000 }).catch(fail);
    return r.code === 0 ? parseKubectlTop(r.stdout, obsText()) : { error: lastLine(r.stderr) };
  },
  async logs(t) {
    const r = t.via === "compose"
      ? await sh(rtBin(), ["compose", "logs", "--no-color", "--timestamps", "--tail=200", t.n], { env: envFor(), timeout: 15000 }).catch(fail)
      : await sh("kubectl", [...kns(t), "logs", `deploy/${t.n}`, "--all-containers=true", "--timestamps", "--tail=200"], { env: envFor(), timeout: 15000 }).catch(fail);
    if (r.code !== 0) throw new Error(lastLine(r.stderr));
    return r.stdout;
  },
  follow(t) { setPanelTab("terminal", true); void runInTerm(logsCmd(t, true), { env: envFor() }); },
  command: (t) => logsCmd(t, false),
},
};
/* ao abrir uma pasta, um dev container já a correr para ela volta a aparecer ligado */
document.addEventListener("dx:workspace", () => {
  const root = R.root; if (!root) { setDevc(null); return; }
  void devcontainerClient().sessionStatus(root).then((st) => { setDevc(st.running ? { name: st.name, image: (devc() as { image?: string } | null)?.image || "" } : null); infraDraw(); }, () => undefined);
});
desktopPorts.stack = stackDesktop;
desktopPorts.infra = infraDesktop;
ctx.envFor = envFor;
}

