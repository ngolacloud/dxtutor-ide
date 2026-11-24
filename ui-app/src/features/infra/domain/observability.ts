/* ═══════════ feature `infra` — observabilidade (ADR-0002, Fase 2; ADR-0006, R5c2) ═══════════
   O núcleo PURO das métricas e dos logs REAIS de um workload: de onde vêm (um serviço do compose
   ou um Deployment do cluster), a leitura do `docker`/`podman stats` e do `kubectl top`, as
   linhas de log (com o carimbo de `--timestamps` e o nível) e o sparkline SVG. Sem DOM, sem
   `window`. Já não há séries semeadas nem logs sintéticos (eram o PRNG `seeded`/`buildObs`/
   `obsLine`): sem a app desktop não há métricas nem logs, e a vista di-lo. */

import type { EnvX, Envs, ObsData, ObsLog, ObsSample, ObsTarget } from "./types";

/** Quantas amostras cada série guarda (a ~3 s cada, uns 3 minutos). */
export const OBS_POINTS = 60;
/** Quantas linhas de log se mostram. */
export const OBS_LOGS = 300;

/** Sparkline SVG (área + linha) a partir de uma série numérica. */
export function spark(a: number[], col: string, max?: number): string {
  const W = 220, H = 46, m = max || Math.max(1, ...a);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M0 ${H} ${a.map((v, i) => `L${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(" ")} L${W} ${H}Z" fill="${col}" opacity=".15"/><path d="${a.map((v, i) => `${i ? "L" : "M"}${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
}

/** Um workload observado ainda sem dados. */
export const emptyObs = (env: string, n: string): ObsData => ({ n, env, logs: [], cpu: [], mem: [], sampleErr: "", logErr: "", clearedAt: "", polled: false });

/** De onde se observa `n` em `env`: no local, um serviço do compose a correr ganha a um
 *  Deployment do cluster local; em staging/production, o Deployment no contexto/namespace do
 *  ambiente. null = não se sabe onde está (p.ex. ambiente sem contexto escolhido). */
export function obsTarget(env: string, n: string, stack: string[], envs: Pick<Envs, "ctx" | "ns" | "k8sOn">, envx: Pick<EnvX, "ctx" | "ns">): ObsTarget | null {
  if (env === "local") {
    if (stack.includes(n)) return { via: "compose", env, n };
    return envs.k8sOn ? { via: "kubectl", env, n, ctx: envs.ctx, ns: envs.ns } : null;
  }
  const ctx = envx.ctx[env], ns = envx.ns[env];
  return ctx && ns ? { via: "kubectl", env, n, ctx, ns } : null;
}

/** Bytes de uma quantidade com unidade (`24.68MiB`, `1.2GB`, `512kB`, `45Mi`, `1Gi`), em MiB. */
export function toMiB(q: string): number | undefined {
  const m = String(q).trim().match(/^([\d.]+)\s*([kKMGT]?i?)B?$/);
  if (!m) return undefined;
  const v = parseFloat(m[1]), u = m[2];
  const f: Record<string, number> = { "": 1 / 1048576, k: 1000 / 1048576, K: 1000 / 1048576, Ki: 1 / 1024, ki: 1 / 1024, M: 1e6 / 1048576, Mi: 1, G: 1e9 / 1048576, Gi: 1024, T: 1e12 / 1048576, Ti: 1048576 };
  return f[u] != null ? v * f[u] : undefined;
}

/** Uma linha do `docker stats --no-stream --format json` (ou o array do `podman stats`). */
export function parseDockerStats(out: string): ObsSample {
  const t = out.trim();
  if (!t) return { error: "sem amostra" };
  let row: Record<string, unknown>;
  try { const v = JSON.parse(t.startsWith("[") ? t : t.split("\n")[0]); row = Array.isArray(v) ? v[0] || {} : v; } catch { return { error: "resposta inesperada do stats" }; }
  const cpu = parseFloat(String(row.CPUPerc ?? row.cpu_percent ?? row.CPU ?? "").replace("%", ""));
  const mem = toMiB(String(row.MemUsage ?? row.mem_usage ?? "").split("/")[0]);
  return Number.isFinite(cpu) || mem != null ? { cpu: Number.isFinite(cpu) ? cpu : undefined, mem } : { error: "o stats não trouxe CPU nem memória" };
}

/** O `kubectl top pod --no-headers` (nome, CPU em millicores, memória): a soma dos pods, com a
 *  CPU em % de um núcleo (1000m = 100%). */
export function parseKubectlTop(out: string): ObsSample {
  let cpu = 0, mem = 0, rows = 0;
  out.split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 3).forEach(([, c, m]) => {
    const mc = /m$/.test(c) ? parseFloat(c) : parseFloat(c) * 1000, mi = toMiB(m);
    if (Number.isFinite(mc)) { cpu += mc / 10; rows++; }
    if (mi != null) mem += mi;
  });
  return rows ? { cpu, mem } : { error: "nenhum pod com métricas" };
}

const LEVEL = /\b(FATAL|PANIC|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE|LOG)\b/i;
const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\s?/;

/** As linhas de `logs --timestamps` (kubectl ou compose, com ou sem o prefixo `serviço |`): o
 *  carimbo, o nível que a própria linha diz (ou «LOG») e a mensagem; só as depois de `clearedAt`,
 *  as últimas `OBS_LOGS`. */
export function parseLogLines(out: string, clearedAt = ""): ObsLog[] {
  const logs: ObsLog[] = [];
  out.split("\n").forEach((raw) => {
    const l = raw.replace(/\r$/, "").replace(/^\S+\s+\|\s?/, "");
    if (!l.trim()) return;
    const m = l.match(TS), iso = m ? m[1] : "", msg = m ? l.slice(m[0].length) : l;
    if (clearedAt && iso && iso <= clearedAt) return;
    const lv = (msg.match(LEVEL)?.[1] || "LOG").toUpperCase().replace(/^WARNING$/, "WARN").replace(/^ERR$/, "ERROR").replace(/^PANIC$/, "FATAL");
    logs.push({ ts: iso ? iso.slice(11, 23) : "", lv, m: msg, ...(iso ? { iso } : {}) });
  });
  return logs.slice(-OBS_LOGS);
}

/** Acrescenta uma amostra às séries (janela de `OBS_POINTS`) ou guarda porque não há. */
export function pushSample(o: ObsData, s: ObsSample): void {
  o.sampleErr = s.error || "";
  if (s.error) return;
  const add = (a: number[], v: number | undefined) => { if (v == null) return; a.push(v); if (a.length > OBS_POINTS) a.shift(); };
  add(o.cpu, s.cpu); add(o.mem, s.mem);
}
