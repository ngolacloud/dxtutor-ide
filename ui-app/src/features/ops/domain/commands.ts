/* ═══════════ feature `ops` — domain: the exact commands the human approves (A9, OPS-05/06) ═══════════
   Every change to a cluster or to infrastructure is a command shown in full, approved, and run in a
   terminal — never a hidden call. These build them, quoted for a POSIX shell, always with the
   kubeconfig (when set), context and namespace explicit. Also: what a pod's trouble is, and a plan as
   text for Co-Dev. PURE: no DOM, no window. */

import type { IacPlan, KubeEvent, KubeTarget, Pod } from "./types";

/** POSIX single-quoting (only when needed). */
export function q(s: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

const kube = (t: KubeTarget): string =>
  ["kubectl", ...(t.kubeconfig ? ["--kubeconfig", q(t.kubeconfig)] : []), ...(t.context ? ["--context", q(t.context)] : []), ...(t.namespace ? ["-n", q(t.namespace)] : [])].join(" ");

export const kubeCmd = {
  logs: (t: KubeTarget, kind: "deploy" | "pod", name: string): string => `${kube(t)} logs -f ${kind === "deploy" ? "deploy/" : ""}${q(name)} --tail=200`,
  exec: (t: KubeTarget, pod: string): string => `${kube(t)} exec -it ${q(pod)} -- sh`,
  portForward: (t: KubeTarget, svc: string, local: number, remote: string): string => `${kube(t)} port-forward svc/${q(svc)} ${local}:${q(remote)}`,
  scale: (t: KubeTarget, deploy: string, replicas: number): string => `${kube(t)} scale deploy/${q(deploy)} --replicas=${replicas}`,
  restart: (t: KubeTarget, deploy: string): string => `${kube(t)} rollout restart deploy/${q(deploy)}`,
  undo: (t: KubeTarget, deploy: string, revision: number): string => `${kube(t)} rollout undo deploy/${q(deploy)} --to-revision=${revision}`,
  deletePod: (t: KubeTarget, pod: string): string => `${kube(t)} delete pod ${q(pod)}`,
};

/** The command that applies an IaC plan from the project root (the folder in the command). */
export function iacApply(plan: Pick<IacPlan, "tool" | "dir" | "refreshOnly">): string {
  const cd = plan.dir && plan.dir !== "." ? `cd ${q(plan.dir)} && ` : "";
  return plan.refreshOnly ? `${cd}${plan.tool} apply -refresh-only` : `${cd}${plan.tool} plan -out=tfplan && ${plan.tool} apply tfplan`;
}

/** The first port of a service as `kubectl port-forward` takes it (`80→8080/TCP` → `80`). */
export const servicePort = (ports: string[]): string => (ports[0] ?? "").split("→")[0] || "80";

/** A pod in trouble: not ready, restarting, or stuck with a reason. */
export const podTrouble = (p: Pod): boolean => !!p.reason || p.restarts > 0 || (p.phase !== "Running" && p.phase !== "Succeeded") || /^0\//.test(p.ready);

/** The events about one object (`pod/web-1`), warnings first (as the backend sorts them). */
export const eventsFor = (events: KubeEvent[], object: string): KubeEvent[] => events.filter((e) => e.object === object);

/** A plan as text: what Co-Dev reads to explain it. */
export function planText(p: IacPlan): string {
  const lines = [`${p.tool} ${p.refreshOnly ? "plan -refresh-only" : "plan"} in ${p.dir}: +${p.add} ~${p.change} -${p.destroy}`];
  for (const c of [...p.changes, ...p.drift.map((d) => ({ ...d, address: `${d.address} (drift)` }))]) {
    lines.push(`${c.action} ${c.address}`);
    for (const a of c.attrs.slice(0, 30)) lines.push(`  ${a.name}: ${a.before ?? "∅"} → ${a.unknown ? "(known after apply)" : a.after ?? "∅"}`);
  }
  return lines.join("\n");
}
