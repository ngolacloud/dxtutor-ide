/* ═══════════ feature `infra` — environments e drift (ADR-0002, Fase 2) ═══════════
   O núcleo PURO dos environments: os workloads de um ambiente, o estado deployado, a
   saúde, a leitura do JSON do kubectl, o manifesto de cada ambiente, o relatório de drift
   (design vs realidade) e os commits entre duas versões. Sem DOM, sem `window`. */

import type {
  Catalog, ClusterState, Commit, Design, DriftEntry, DriftReport, EnvDep, EnvState, Files, K8sDep, K8sState, Secrets,
} from "./types";

/** As anotações que o deploy e a promoção põem nos Deployments: a versão (o commit) e quando
 *  (epoch em ms). É por elas que a leitura do cluster sabe que versão corre num ambiente. */
export const ANN_VER = "dxtutor.io/version";
export const ANN_AT = "dxtutor.io/deployed-at";

/** Os workloads de um ambiente, tal como o cluster os reporta (`K8sState.deps`, lidos pela app
 *  desktop): um contentor que não arranca (`err`) é um crash. Sem leitura, não há workloads
 *  (ADR-0006, R5c1: o crash já não se fabrica a partir dos segredos, nem os 6 reinícios). */
export function envDeps(k8s: K8sState | null): EnvDep[] {
  if (!k8s) return [];
  return k8s.deps.map((d) => {
    const err = d.err ?? null;
    return { n: d.n, rep: d.rep, ready: d.ready, status: err ? "crash" : "ok", err, restarts: d.restarts ?? 0, img: d.img };
  });
}

/** O estado deployado de um ambiente: `local` lê o cluster `K8S`; os restantes, a última leitura
 *  do seu namespace (`ENVX.st[env]`). */
export function envStateOf(env: string, k8s: K8sState | null, envxSt: Record<string, EnvState | null>): EnvState | null {
  if (env === "local") return k8s ? { ver: k8s.ver, at: k8s.at, deps: envDeps(k8s), ingress: k8s.ingress ?? k8s.docs.some((d) => d.k === "Ingress") } : null;
  return envxSt[env] ?? null;
}

/* ───── leitura do cluster: o JSON de `kubectl get deploy|pods|ingress -o json` ───── */

interface KList<T> { items?: T[] }
interface KDeploy {
  metadata?: { name?: string; annotations?: Record<string, string> };
  spec?: { replicas?: number; template?: { spec?: { containers?: Array<{ image?: string; ports?: Array<{ containerPort?: number }> }> } } };
  status?: { readyReplicas?: number };
}
interface KContainerStatus {
  restartCount?: number;
  state?: { waiting?: { reason?: string; message?: string } };
  lastState?: { terminated?: { reason?: string; exitCode?: number } };
}
interface KPod {
  metadata?: { ownerReferences?: Array<{ kind?: string; name?: string }> };
  status?: { containerStatuses?: KContainerStatus[] };
}

/** Os motivos de espera de um contentor que querem dizer «não arranca». */
const STUCK = /^(CrashLoopBackOff|Error|ImagePullBackOff|ErrImagePull|InvalidImageName|CreateContainerConfigError|CreateContainerError|RunContainerError)$/;

const parseList = <T>(json: string): T[] => {
  try { const v = JSON.parse(json || "{}") as KList<T>; return Array.isArray(v.items) ? v.items : []; } catch { return []; }
};

/** O Deployment dono de um pod: o ReplicaSet chama-se `<deploy>-<hash>`. */
const podDeploy = (p: KPod): string | null => {
  const rs = (p.metadata?.ownerReferences || []).find((o) => o.kind === "ReplicaSet");
  return rs?.name ? rs.name.replace(/-[a-z0-9]+$/, "") : null;
};

/** O estado de um namespace a partir do JSON do kubectl (Deployments, pods e Ingresses). Os
 *  reinícios e o motivo de um contentor preso vêm dos pods; a versão e a hora, das anotações. */
export function parseClusterState(deployJson: string, podsJson: string, ingressJson = ""): ClusterState {
  const pods = parseList<KPod>(podsJson);
  let ver: string | undefined, at: number | undefined;
  const deps: K8sDep[] = parseList<KDeploy>(deployJson).filter((d) => d.metadata?.name).map((d) => {
    const n = d.metadata!.name as string, a = d.metadata!.annotations || {};
    if (!ver && a[ANN_VER]) { ver = a[ANN_VER]; at = a[ANN_AT] ? +a[ANN_AT] || undefined : undefined; }
    const c = d.spec?.template?.spec?.containers?.[0] || {};
    let restarts = 0, err: string | null = null;
    pods.filter((p) => podDeploy(p) === n).forEach((p) => (p.status?.containerStatuses || []).forEach((cs) => {
      restarts += cs.restartCount || 0;
      const w = cs.state?.waiting;
      if (!err && w?.reason && STUCK.test(w.reason)) {
        const last = cs.lastState?.terminated;
        err = w.reason + (last ? ` (último fim: ${last.reason || "exit"} ${last.exitCode ?? ""})`.replace(/ \)$/, ")") : "") + (w.message ? `: ${w.message}` : "");
      }
    }));
    const port = c.ports?.[0]?.containerPort;
    return { n, rep: d.spec?.replicas ?? 0, ready: d.status?.readyReplicas || 0, img: c.image, port: port != null ? String(port) : undefined, restarts, err };
  });
  return { deps, ver, at, ingress: parseList<unknown>(ingressJson).length > 0 };
}

/** Os nomes dos Deployments de um manifesto (para esperar pelo rollout de cada um). */
export function deploymentsIn(manifest: string): string[] {
  return manifest.split(/^---$/m).filter((d) => /^kind:\s*Deployment\s*$/m.test(d)).map((d) => (d.match(/^ {2}name:\s*(\S+)/m) || [])[1]).filter((n): n is string => !!n);
}

/** O que se aplica num ambiente: os manifestos de `deploy/k8s` com os Secrets `<app>-env`
 *  reescritos com os segredos DESSE ambiente (os manifestos trazem os valores locais). Vai para o
 *  `kubectl apply -f -` pela entrada padrão — os segredos não tocam no disco nem na linha de
 *  comandos. */
export function envManifest(files: Files, sec: Secrets): string {
  const docs: string[] = [];
  Object.keys(files).filter((p) => /deploy\/k8s\/.*\.yaml$/.test(p)).sort().forEach((p) => files[p].content.split(/^---$/m).forEach((d) => {
    const k = (d.match(/^kind:\s*(\w+)/m) || [])[1], n = (d.match(/^ {2}name:\s*(\S+)/m) || [])[1];
    if (!k || !n) return;
    const app = k === "Secret" && n.endsWith("-env") ? n.slice(0, -4) : null;
    if (app && sec[app]) docs.push(`apiVersion: v1\nkind: Secret\nmetadata:\n  name: ${n}\nstringData:\n` + Object.entries(sec[app]).map(([key, v]) => `  ${key}: ${JSON.stringify(v)}`).join("\n"));
    else docs.push(d.trim());
  }));
  return docs.map((d) => d + "\n").join("---\n");
}

/** A saúde de um ambiente: `off` sem estado, `bad` com algum crash, senão `ok`. */
export function envHealthOf(s: EnvState | null): string {
  if (!s) return "off";
  return s.deps.some((d) => d.status === "crash") ? "bad" : "ok";
}

/** O relatório de drift: por nó do design, compara o manifesto e a versão corrente
 *  com o que está a correr (sync/drift/behind/missing/bad/off) + workloads extra. */
export function driftReport(s: EnvState | null, docs: K8sState["docs"], D: Design, cat: Catalog, developRef: string): DriftReport {
  const man: Record<string, number> = Object.fromEntries(docs.filter((d) => d.k === "Deployment").map((d) => [d.n, d.rep]));
  const out: Record<string, DriftEntry> = {}, names = new Set<string>();
  D.nodes.forEach((n) => {
    const k = cat.slug(n); names.add(k);
    if (!s) { out[n.id] = { st: "off", why: "not deployed" }; return; }
    if (cat.tech[n.tech].kind === "gateway") { out[n.id] = s.ingress ? { st: "sync", why: "ingress present" } : { st: "missing", why: "no ingress" }; return; }
    const d = s.deps.find((x) => x.n === k);
    if (!d) { out[n.id] = { st: "missing", why: "in the design, not in the cluster" }; return; }
    if (d.status === "crash") { out[n.id] = { st: "bad", why: d.err as string }; return; }
    if (man[k] != null && d.rep !== man[k]) { out[n.id] = { st: "drift", why: `${d.rep} replicas running, manifest says ${man[k]}` }; return; }
    if (s.ver !== developRef) { out[n.id] = { st: "behind", why: `runs ${s.ver}, develop is at ${developRef}` }; return; }
    out[n.id] = { st: "sync", why: "matches the design" };
  });
  const extra = s ? s.deps.filter((d) => !names.has(d.n)).map((d) => d.n) : [];
  return { out, extra, s };
}

/** Os commits entre `from` (exclusivo) e `to` (BFS pelo grafo, cap de 40). */
export function commitsBetween(from: string | null | undefined, to: string | undefined, commits: Record<string, Commit>): Commit[] {
  const out: Commit[] = [], seen = new Set<string>(), st: Array<string | undefined> = [to];
  while (st.length && out.length < 40) {
    const h = st.shift();
    if (!h || seen.has(h) || h === from) continue;
    seen.add(h);
    const c = commits[h];
    if (!c) continue;
    out.push(c); st.push(...c.p);
  }
  return out;
}
