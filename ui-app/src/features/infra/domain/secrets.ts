/* ═══════════ feature `infra` — segredos dos ambientes (ADR-0002, Fase 2) ═══════════
   O núcleo PURO dos segredos: o host de um URL, as apps/bases-de-dados do design,
   os segredos locais (derivados das arestas), a derivação staging/production (a
   promoção que o humano aprova) e a verificação de chaves em falta/vazias.
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

/** Os slugs das bases-de-dados do design (sql/mssql) — a promoção torce o primeiro. */
export function dbSlugs(D: Design, cat: Catalog): string[] {
  return D.nodes.filter((n) => ["sql", "mssql"].includes(cat.tech[n.tech].kind)).map(cat.slug);
}

/** Os segredos do ambiente local: por app, as variáveis derivadas das arestas. */
export function localSecrets(D: Design, cat: Catalog): Secrets {
  const o: Secrets = {};
  designApps(D, cat.isApp).forEach((n) => {
    o[cat.slug(n)] = Object.fromEntries(appEnv(n, D, cat).map((e) => { const [k, ...v] = e.split(": "); return [k, v.join(": ").replace(/^"|"$/g, "")]; }));
  });
  return o;
}

/** Deriva os segredos de staging (valores torcidos) e production (vazios, excepto
 *  PORT) a partir dos locais. `dbs` = slugs de base-de-dados (torce o 1º host). */
export function deriveSecrets(L: Secrets, dbs: string[]): SecretSets {
  const st: Secrets = {}, pr: Secrets = {};
  let bent = false;
  const apps = Object.keys(L);
  apps.forEach((a) => {
    st[a] = {}; pr[a] = {};
    Object.entries(L[a]).forEach(([k, v]) => {
      let sv = v.replace(/app:app@/, "app:st4g1ng@").replace(/minio12345/, "st4g1ng-minio");
      if (!bent && k === "DATABASE_URL" && a !== apps.find((x) => L[x].DATABASE_URL) && dbs.length) { sv = sv.replace(new RegExp("@" + dbs[0] + ":"), "@" + dbs[0] + ".staging:"); bent = true; }
      st[a][k] = sv; pr[a][k] = /PORT/.test(k) ? v : "";
    });
  });
  return { staging: st, production: pr };
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
