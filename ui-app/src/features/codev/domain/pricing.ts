/* ═══════════ Co-Dev — domínio: custo real de um turno (ADR-0003, F4) ═══════════
   Preço por milhão de tokens (API da Anthropic, primeira parte; tabela de 2026-11).
   As leituras de cache têm preço próprio por modelo; as escritas de cache (TTL de 5 min)
   custam 1,25× a entrada. Modelo desconhecido → sem custo (só tokens). Puro. */

import type { Usage } from "./agent-events";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

export const PRICES: Record<string, Price> = {
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

/** Custo em dólares, ou `null` se o modelo não estiver na tabela. */
export function costUSD(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const M = 1_000_000;
  return (
    (u.input_tokens * p.input +
      u.output_tokens * p.output +
      u.cache_read_input_tokens * p.cacheRead +
      u.cache_creation_input_tokens * p.input * 1.25) /
    M
  );
}

const k = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/** Linha de uso para o rodapé do cartão: `12.3k entrada (8k da cache) · 900 saída · $0.0123`. */
export function formatUsage(model: string, u: Usage): string {
  const inTotal = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens;
  let s = `${k(inTotal)} entrada`;
  if (u.cache_read_input_tokens > 0) s += ` (${k(u.cache_read_input_tokens)} da cache)`;
  s += ` · ${k(u.output_tokens)} saída`;
  const c = costUSD(model, u);
  if (c !== null) s += ` · $${c.toFixed(c < 0.01 ? 4 : c < 1 ? 3 : 2)}`;
  return s;
}
