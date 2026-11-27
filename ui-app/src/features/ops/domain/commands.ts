/* ═══════════ feature `ops` — domain: the exact commands the human approves (A9, OPS-05/06) ═══════════
   Every change to a cluster or to infrastructure is a command shown in full, approved, and run in a
   terminal — never a hidden call. These build them, quoted for a POSIX shell, always with the
   kubeconfig (when set), context and namespace explicit. Also: what a pod's trouble is, and a plan as
   text for Co-Dev. PURE: no DOM, no window. */

import type { IacFinding, IacPlan, KubeEvent, KubeTarget, Pod, PipelineRun } from "./types";

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

/* r23 F4b: applying is no longer built here — the backend gives the command that applies the REVIEWED
   plan file (`iac_apply_command`), and refuses it when the pipeline failed. Removed: `iacApply`, which
   planned again (`plan -out=tfplan && apply tfplan`) instead of applying what the human had read. */

const cdTo = (dir: string): string => (dir && dir !== "." ? `cd ${q(dir)} && ` : "");

/** Releases a stuck state lock (from the project root). */
export const forceUnlock = (tool: string, dir: string, lockId: string): string => `${cdTo(dir)}${tool} force-unlock -force ${q(lockId)}`;

/** An `import` block that brings an existing object under the code (Co-Dev writes it into a `.tf`). */
export const importDraft = (address: string, id: string): string => `import {\n  to = ${address}\n  id = ${JSON.stringify(id)}\n}\n`;

/** A `moved` block: renames an address without destroying what it manages. */
export const movedDraft = (from: string, to: string): string => `moved {\n  from = ${from}\n  to   = ${to}\n}\n`;

/** A resource address as the IaC tool takes it (`type.name`, modules and indexes). */
export const isAddress = (a: string): boolean => /^(module\.[A-Za-z0-9_-]+(\[[^\]]+\])?\.)*(data\.)?[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(\[[^\]]+\])?$/.test(a.trim());

/** The pipeline's stages in order (the backend runs them so). */
export const STAGES = ["init", "fmt", "validate", "rules", "tflint", "checkov", "trivy", "state", "plan", "drift", "conftest", "infracost"] as const;

/** The sources the «Security & policy» tab lists. */
const SECURITY = new Set(["built-in", "tflint", "checkov", "trivy", "state", "conftest"]);

/** The findings of a run that are about security and policy, blocking ones first. */
export function securityFindings(run: PipelineRun | null): IacFinding[] {
  if (!run) return [];
  const all = run.stages.flatMap((s) => s.findings).filter((f) => SECURITY.has(f.source));
  const rank = (f: IacFinding): number => (f.severity === "error" && !f.accepted ? 0 : f.severity === "error" ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b));
}

/** How a finding is named in the acceptance and the audit log. */
export const findingLabel = (f: IacFinding): string => `${f.source} ${f.rule} · ${f.file}${f.line ? `:${f.line}` : ""}${f.resource && f.source !== "fmt" ? ` · ${f.resource}` : ""}`;

/** The key an ignored drift is stored under (as `tutor_eval::iac::drift_key`). */
export const driftKey = (dir: string, address: string): string => `drift:${dir}:${address}`;

/** Drift is checked again every 6 hours while a folder is open. */
export const DRIFT_EVERY_MS = 6 * 3600 * 1000;
export const driftDue = (last: number | null, now: number): boolean => last === null || now - last >= DRIFT_EVERY_MS;

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
    lines.push(`${c.action} ${c.address}${c.reason ? ` (${c.reason})` : ""}`);
    if (c.dependents?.length) lines.push(`  blast radius: ${c.dependents.join(", ")}`);
    if (c.writeOnly?.length) lines.push(`  write-only: ${c.writeOnly.join(", ")}`);
    for (const a of c.attrs.slice(0, 30)) lines.push(`  ${a.name}: ${a.before ?? "∅"} → ${a.unknown ? "(known after apply)" : a.after ?? "∅"}`);
  }
  return lines.join("\n");
}
