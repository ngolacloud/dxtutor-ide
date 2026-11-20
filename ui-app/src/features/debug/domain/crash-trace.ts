/* ═══════════ feature `debug` — domain: traço de crash (ADR-0002, Fase 2) ═══════════
   O gerador PURO das sondas da sessão `ops` (um pod em CrashLoopBackOff por host de
   DNS errado nos segredos). Recebe TUDO como dados (`CrashInput`: deps, segredos do
   ambiente e locais, namespace, etiqueta e a função pura `urlHosts`) — não vai ao
   `window`/ENVX. Importa `esc` de `../../../core` (função pura de escape; não toca
   `window` neste ficheiro). Mesmas strings do original. (Antes vivia em
   `features/debug.ts` como `crashTrace`, lendo globais do infra.) */

import { esc } from "../../../core";
import type { CrashInput, CrashTrace, EnvDep } from "./types";

/** Constrói o traço de ops para o serviço `input.n` no ambiente `input.env`. */
export function buildCrashTrace(input: CrashInput): CrashTrace {
  const { env, n, deps, sec: S, local: L, ns, label, urlHosts } = input;
  const bad = (deps.find((d) => d.n === n) || {}) as Partial<EnvDep>, key = (Object.keys(S[n] || {}).find((k) => (S[n][k] || "") !== (L[n] || {})[k] && /URL|HOST|ENDPOINT/.test(k)) || Object.keys(S[n] || {})[0]) as string, badV = (S[n] || {})[key] || "", goodV = (L[n] || {})[key] || "", h = urlHosts(badV), gh = urlHosts(goodV), peer = deps.find((d) => d.n !== n && d.status === "ok" && Object.values(S[d.n] || {}).some((x) => urlHosts(x) === gh)), H = (db: number, cred: number, host: number, code: number) => ({ db, cred, host, code });
  return {
    hk: { db: "Database is down", cred: "Wrong credentials", host: "Wrong host in configuration", code: "Bug in the worker" }, steps: [
      { cmd: `kubectl -n ${ns} get pod -l app=${n}`, out: `NAME                 READY   STATUS             RESTARTS   AGE\n${n}-7d9f-x2lq   0/1     CrashLoopBackOff   ${bad.restarts || 6}          4m\n\nLast State: Terminated · Reason: Error · Exit Code: 1`, focus: "how the process dies", h: H(30, 25, 25, 20), n: "Exit code <b>1</b>, not 137 — the OOM killer is not involved; the process exits on its own, early, every time. That points at startup configuration or a dependency, not load." },
      { cmd: `kubectl -n ${ns} logs ${n}-7d9f-x2lq --previous`, out: `INFO starting ${n} v0.1.0\nINFO reading configuration from environment\nERROR ${bad.err || ""}`, focus: "what it fails on", h: H(22, 6, 58, 14), n: `The failure is a <b>DNS lookup</b>, not an authentication error: the name <code>${esc(h || "")}</code> does not resolve. Wrong credentials would fail later, after connecting — I am dropping that one.` },
      { cmd: `kubectl -n ${ns} get pod -l app=${peer ? peer.n : "orders-api"}`, out: peer ? `NAME                     READY   STATUS    RESTARTS\n${peer.n}-5c8b-k1pz   2/2     Running   0` : "(no other workload uses this service)", focus: "whether the database is actually up", h: peer ? H(3, 4, 86, 7) : H(15, 5, 70, 10), n: peer ? `<code>${esc(peer.n)}</code> talks to the same database through <code>${esc(gh || "")}</code> and is healthy. So the database is up and reachable from this namespace. The difference must be in <code>${esc(n)}</code>'s own configuration.` : "No healthy peer to compare with, so I cannot fully rule out the database yet." },
      { cmd: `dx secrets diff ${n} --env local,${env} --keys-only=false`, out: `${key}\n  local:   ${goodV.replace(/:[^:@/]+@/, ":••••@")}\n  ${env}: ${badV.replace(/:[^:@/]+@/, ":••••@")}`, focus: "what differs between environments", h: H(2, 3, 95, 0), n: `Apart from the password, which is meant to differ, only the host changes: <code>${esc(gh || "")}</code> locally, <code>${esc(h || "")}</code> in ${label.toLowerCase()}. Promotion checked that the key exists, not that the value is right.` },
      { cmd: `kubectl -n ${ns} run dns-check --rm -i --image=busybox -- nslookup ${h}`, out: `** server can't find ${h}: NXDOMAIN\n\n$ nslookup ${gh}\nName: ${gh}.${ns}.svc.cluster.local`, focus: "confirming the root cause", h: H(1, 1, 98, 0), n: `Confirmed: <code>${esc(h || "")}</code> does not exist in the cluster; the service is <code>${esc(gh || "")}</code> (or <code>${esc(gh || "")}.${esc(ns)}.svc.cluster.local</code>).` }],
    end: { ok: false, t: "Root cause found", b: `<code>${esc(n)}</code>'s <code>${esc(key)}</code> in ${label.toLowerCase()} points at <code>${esc(h || "")}</code>, a name that does not exist in the cluster. The code is fine.<br><br><b>Fix (yours — secrets are a human change):</b> set the host to <code>${esc(gh || "")}</code> in the ${label.toLowerCase()} secrets, then redeploy ${label.toLowerCase()}.<br><br><b>To stop this happening again:</b> add a startup check that resolves every service host in the secrets before rollout, or make promotion run a DNS dry-run in the target namespace.`, act: `openEnvs();SHOWSEC=true;rerender('envs')` }
  };
}
