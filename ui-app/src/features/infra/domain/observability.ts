/* ═══════════ feature `infra` — observabilidade (ADR-0002, Fase 2) ═══════════
   O núcleo PURO das métricas/logs seedados: um PRNG determinista por chave, o
   sparkline SVG, uma linha de log sintética, e o construtor das séries+logs de um
   workload. Sem DOM, sem `window`. O relógio é injectado (`isoTime`) para o domínio
   ficar determinista; o cache `OBS` e o polling vivo ficam no resíduo. */

import type { ObsData } from "./types";

/** PRNG determinista (LCG) seedado por string: mesma chave → mesma sequência. */
export function seeded(s: string): () => number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return () => { h = (h * 1103515245 + 12345) | 0; return ((h >>> 8) & 0xffff) / 0xffff; };
}

/** Sparkline SVG (área + linha) a partir de uma série numérica. */
export function spark(a: number[], col: string, max?: number): string {
  const W = 220, H = 46, m = max || Math.max(1, ...a);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M0 ${H} ${a.map((v, i) => `L${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(" ")} L${W} ${H}Z" fill="${col}" opacity=".15"/><path d="${a.map((v, i) => `${i ? "L" : "M"}${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
}

/** Acrescenta uma linha de log sintética a `o.logs` (varia por kind/crash; `ts` vem
 *  do relógio injectado). Mantém a janela de 300 linhas. */
export function obsLine(o: ObsData, isoTime: () => string): void {
  const r = o.r, ts = isoTime(), L = (lv: string, m: string): number => o.logs.push({ ts, lv, m });
  if (o.crash) { const s = o.logs.length % 4; if (s === 0) L("INFO", `starting ${o.n} v0.1.0`); else if (s === 1) L("INFO", "reading configuration from environment"); else if (s === 2) L("ERROR", `${o.err}`); else L("WARN", "Back-off restarting failed container (exit code 1)"); }
  else if (o.kind === "sql") L(r() < .8 ? "LOG" : "WARN", r() < .8 ? `checkpoint complete: wrote ${1 + (r() * 40 | 0)} buffers` : `duration: ${120 + (r() * 200 | 0)} ms  statement: SELECT … ORDER BY created_at DESC`);
  else if (["sqs", "amqp", "kafka", "nats", "pubsub"].includes(o.kind)) L("INFO", `message ${r() < .5 ? "received" : "acknowledged"} · queue=${o.n} · depth=${r() * 20 | 0}`);
  else if (["cache"].includes(o.kind)) L("INFO", `${r() * 900 | 0} keys · hit ratio ${(0.8 + r() * .19).toFixed(2)}`);
  else { const m = r(); L(m < .08 ? "WARN" : "INFO", m < .08 ? `slow request POST /orders ${300 + (r() * 400 | 0)}ms` : m < .5 ? `GET /healthz 200 ${(r() * .9).toFixed(1)}ms` : `${m < .75 ? "GET /orders" : "POST /orders"} ${m < .75 ? 200 : 201} ${4 + (r() * 30 | 0)}ms`); }
  if (o.logs.length > 300) o.logs.shift();
}

/** Constrói as séries (cpu/mem/rps/p95) + 14 linhas de log iniciais de um workload,
 *  seedadas por `seedKey` (= `env:n`). `info` traz o estado resolvido do workload. */
export function buildObs(env: string, n: string, info: { crash: boolean; err: string | null; kind: string; appLike: boolean }, seedKey: string, isoTime: () => string): ObsData {
  const { crash, err, kind, appLike } = info;
  const r = seeded(seedKey);
  const ser = (b: number, v: number): number[] => Array.from({ length: 60 }, (_, i) => Math.max(0, b + (r() - .5) * v + (crash && i % 10 > 7 ? b * 1.5 : 0)));
  const o: ObsData = { n, env, crash, err, kind, logs: [], cpu: ser(crash ? 35 : kind === "sql" ? 12 : 6, crash ? 40 : 8), mem: ser(crash ? 48 : kind === "sql" ? 180 : 42, crash ? 30 : 6), rps: ser(crash ? 0 : appLike ? 24 : 0, crash ? 0 : 10), p95: ser(crash ? 0 : kind === "sql" ? 4 : 18, crash ? 0 : 12), r };
  for (let i = 0; i < 14; i++) obsLine(o, isoTime);
  return o;
}
