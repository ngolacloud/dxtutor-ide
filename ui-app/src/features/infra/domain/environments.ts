/* ═══════════ feature `infra` — environments e drift (ADR-0002, Fase 2) ═══════════
   O núcleo PURO dos environments: os workloads de um ambiente (com os segredos a
   validar), o estado deployado, a saúde, o relatório de drift (design vs realidade)
   e os commits entre duas versões. Sem DOM, sem `window`. Byte-fiéis ao resíduo. */

import type {
  Catalog, Commit, Design, DriftEntry, DriftReport, EnvDep, EnvState, K8sState, Secrets,
} from "./types";
import { urlHosts } from "./secrets";

/** Os workloads de um ambiente: valida cada segredo (vazio → crash; host
 *  desconhecido → crash de DNS) e devolve o estado de cada Deployment. */
export function envDeps(env: string, k8s: K8sState | null, sec: Secrets, D: Design, slug: (n: Design["nodes"][number]) => string): EnvDep[] {
  if (!k8s) return [];
  const svcs = new Set(D.nodes.map(slug));
  return k8s.docs.filter((d) => d.k === "Deployment").map((d) => {
    const base = k8s.deps.find((x) => x.n === d.n) || { rep: d.rep }, s = sec[d.n];
    let err: string | null = null;
    if (s) for (const [k, v] of Object.entries(s)) {
      if (v === "") err = `${k} is required`;
      else { const h = urlHosts(v); if (h && !svcs.has(h) && !/\.svc\.cluster\.local$/.test(h)) err = `${k}: failed to lookup address information: Name or service not known (${h})`; }
      if (err) break;
    }
    return { n: d.n, rep: env === "local" ? base.rep : d.rep, ready: err ? 0 : (env === "local" ? base.rep : d.rep), status: err ? "crash" : "ok", err, restarts: err ? 6 : 0, img: d.img };
  });
}

/** O estado deployado de um ambiente: `local` lê o cluster `K8S` (com os deps já
 *  calculados); os restantes lêem o seu `ENVX.st[env]`. */
export function envStateOf(env: string, k8s: K8sState | null, envxSt: Record<string, EnvState | null>, localDeps: EnvDep[]): EnvState | null {
  if (env === "local") return k8s ? { ver: k8s.ver, at: k8s.at, deps: localDeps, ingress: k8s.docs.some((d) => d.k === "Ingress") } : null;
  return envxSt[env] ?? null;
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
