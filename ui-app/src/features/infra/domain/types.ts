/* ═══════════ feature `infra` — tipos de domínio (ADR-0002, Fase 2) ═══════════
   Formas PURAS da feature Infra (runtime de contentores / dev-container /
   Kubernetes + environments / drift / observabilidade). Sem DOM, sem `window`,
   sem Tauri — só dados. O domínio e a aplicação importam destes tipos; o bridge
   re-exporta os que o resíduo e o motor precisam.

   Decisão do dono (2026-11-21): o domínio é TIPADO (nenhum `@ts-nocheck` novo no
   subtree). As estruturas do monólito ainda por tipar (o design do Studio, o
   catálogo TECH/KIND) recebem aqui interfaces LOCAIS com os campos que a feature
   Infra lê; os `any`/casts para as formas opacas do monólito confinam-se ao
   legacy-bridge. */

/* ───── design do Studio (o gerador de manifestos/segredos decompõe-no) ───── */

/** Um componente desenhado no Studio. `st` = 'plan'|'wip'|'ok'. */
export interface DesignNode {
  id: string;
  tech: string;
  n: string;
  x: number;
  y: number;
  st: string;
}

/** O design: componentes + ligações (arestas [origem, destino]). */
export interface Design {
  nodes: DesignNode[];
  edges: Array<[string, string]>;
}

/** Especificação de uma tecnologia do catálogo (`TECH[tech]`), nos campos que a
 *  feature Infra lê: família (`kind`), porta, imagem do contentor. */
export interface TechSpec {
  n?: string;
  kind: string;
  port: number;
  img: string;
}

/** Família de uma tecnologia (`KIND[kind]`), nos campos que a Infra lê: a wiring
 *  de variáveis de ambiente do serviço, o comando/args, o env estático. */
export interface KindSpec {
  wire?: (slug: string) => string[];
  cmd?: string;
  env?: string[];
  hc?: boolean;
}

/** O catálogo + predicados do Studio que os geradores do domínio consomem (todos
 *  injectados como dados puros; nenhum toca `window`). */
export interface Catalog {
  tech: Record<string, TechSpec>;
  kind: Record<string, KindSpec>;
  isApp: (n: DesignNode) => boolean;
  slug: (n: DesignNode) => string;
}

/* ───── sistema de ficheiros virtual ───── */

/** Uma entrada do FS virtual (os parsers lêem `content`). */
export interface FileEntry {
  content: string;
}

/** O FS virtual, por caminho. */
export type Files = Record<string, FileEntry>;

/** Uma tecnologia detectada no projecto: [id, rótulo]. */
export type ProjectTech = [string, string];

/* ───── Kubernetes ───── */

/** Um recurso parseado de `deploy/k8s/*.yaml` (`k8sDocs`). */
export interface K8sDoc {
  k: string;
  n: string;
  file: string;
  rep: number;
  img?: string;
  port?: string;
}

/** Um workload deployado (`K8S.deps`). */
export interface K8sDep {
  n: string;
  rep: number;
  ready: number;
  img?: string;
  port?: string;
}

/** O estado do cluster local (`window.K8S`). `ver`/`at` são postos pela
 *  decoração v6 de `dxDeploy`. */
export interface K8sState {
  docs: K8sDoc[];
  deps: K8sDep[];
  ver?: string;
  at?: number;
}

/* ───── environments / secrets / drift ───── */

/** Segredos de um ambiente: por app, pares chave→valor. */
export type Secrets = Record<string, Record<string, string>>;

/** Os conjuntos de segredos derivados (`ENVX.sec`). */
export interface SecretSets {
  staging: Secrets;
  production: Secrets;
}

/** Resultado da verificação de segredos antes de uma promoção. */
export interface SecretCheck {
  miss: string[];
  empty: string[];
}

/** Um workload de um ambiente (saída de `envDeps`). */
export interface EnvDep {
  n: string;
  rep: number;
  ready: number;
  status: "ok" | "crash";
  err: string | null;
  restarts: number;
  img?: string;
}

/** O estado deployado de um ambiente (`envState`). */
export interface EnvState {
  ver?: string;
  at?: number;
  deps: EnvDep[];
  ingress: boolean;
}

/** Uma entrada do relatório de drift: estado + porquê. */
export interface DriftEntry {
  st: "sync" | "drift" | "behind" | "missing" | "bad" | "off";
  why: string;
}

/** O relatório de drift (design vs realidade): por nó + workloads extra + estado. */
export interface DriftReport {
  out: Record<string, DriftEntry>;
  extra: string[];
  s: EnvState | null;
}

/* ───── estado window-backed (owned pelo resíduo; shapes aqui para o domínio
   e o motor as tiparem) ───── */

/** Estado do runtime de contentores + cluster (`window.ENVS`). */
export interface Envs {
  rt: string;
  sock: Record<string, string>;
  rtOn: boolean;
  kube: string;
  ctx: string;
  ns: string;
  k8sOn: boolean;
  ssh: string[];
}

/** Um registo do histórico de promoções. */
export interface PromotionRecord {
  from: string;
  to: string;
  ver?: string;
  at: number;
}

/** Estado dos environments (`window.ENVX`): ambiente corrente, contexto/namespace
 *  por ambiente, segredos derivados, estado deployado por ambiente, histórico. */
export interface EnvX {
  cur: string;
  ctx: Record<string, string>;
  ns: Record<string, string>;
  sec: SecretSets | null;
  st: Record<string, EnvState | null>;
  hist: PromotionRecord[];
}

/* ───── git (promoções lêem o grafo de commits) ───── */

/** Um commit (`GIT.c[h]`), nos campos que a Infra lê. */
export interface Commit {
  h: string;
  m: string;
  p: string[];
}

/* ───── observabilidade (séries + logs seedados) ───── */

/** Uma linha de log de um workload. */
export interface ObsLog {
  ts: string;
  lv: string;
  m: string;
}

/** As séries + logs de um workload observado (`OBS[env:n]`). */
export interface ObsData {
  n: string;
  env: string;
  crash: boolean;
  err: string | null;
  kind: string;
  logs: ObsLog[];
  cpu: number[];
  mem: number[];
  rps: number[];
  p95: number[];
  r: () => number;
}
