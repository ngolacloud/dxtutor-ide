/* ═══════════ feature `infra` — segredos dos ambientes (ADR-0002, Fase 2) ═══════════
   O núcleo PURO dos segredos: o host de um URL, as apps/bases-de-dados do design,
   os segredos locais (derivados das arestas), as chaves de staging/production por
   preencher e a verificação de chaves em falta/vazias.
   Sem DOM, sem `window`. Byte-fiéis às versões do resíduo. */

import type { Catalog, Design, DesignNode, SecretCheck, SecretSets, Secrets } from "./types";
import { appEnv } from "./kubernetes";

/** Extrai o host de um URL (`postgres://u@host:5432/db`, `host:port`), ou null. */
export function urlHosts(v: unknown): string | null {
  const m = String(v).match(/^[a-z]+:\/\/(?:[^@/]*@)?([^:/]+)/i) || String(v).match(/^([a-z0-9.-]+):\d+$/i);
  return m ? m[1] : null;
}

/** As apps do design (`isApp`). */
export function designApps(D: Design, isApp: (n: DesignNode) => boolean): DesignNode[] {
  return D.nodes.filter(isApp);
}

/** Os segredos do ambiente local: por app, as variáveis derivadas das arestas. */
export function localSecrets(D: Design, cat: Catalog): Secrets {
  const o: Secrets = {};
  designApps(D, cat.isApp).forEach((n) => {
    o[cat.slug(n)] = Object.fromEntries(appEnv(n, D, cat).map((e) => { const [k, ...v] = e.split(": "); return [k, v.join(": ").replace(/^"|"$/g, "")]; }));
  });
  return o;
}

/** Os segredos de staging e production: as MESMAS chaves que o design pede ao ambiente local, com
 *  os valores por preencher (só o `PORT` passa, porque é o do próprio contentor). Os valores reais
 *  de cada ambiente escreve-os quem os conhece (ADR-0006, R5c1: antes, staging recebia credenciais
 *  e um host «torcidos» para fabricar um crash de demonstração). */
export function deriveSecrets(L: Secrets): SecretSets {
  const blank = (): Secrets => Object.fromEntries(Object.entries(L).map(([a, kv]) => [a, Object.fromEntries(Object.entries(kv).map(([k, v]) => [k, /PORT/.test(k) ? v : ""]))]));
  return { staging: blank(), production: blank() };
}

/** Compara os segredos locais com os de um ambiente: chaves em falta e vazias. */
export function secretCheck(L: Secrets, S: Secrets): SecretCheck {
  const miss: string[] = [], empty: string[] = [];
  Object.entries(L).forEach(([a, kv]) => Object.keys(kv).forEach((k) => {
    if (!S[a] || !(k in S[a])) miss.push(`${a}.${k}`);
    else if (S[a][k] === "") empty.push(`${a}.${k}`);
  }));
  return { miss, empty };
}
