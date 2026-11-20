/* ═══════════ feature `debug` (Run and Debug) — domain types (ADR-0002) ═══════════
   Formas puras de TypeScript do domínio da depuração simulada: a sessão (`DBG`), os
   passos de código e de ops, o fim (causa-raiz/veredicto), os itens do feed, os
   lançadores e as entradas da árvore de trabalho.

   Regra de dependências (ADR-0002, verificada por A7/A8): esta pasta não importa
   NADA — sem DOM, sem `window`, sem Tauri, sem `application/`/`ui/`/`infrastructure/`.
   São só dados: o motor (`application/`), os geradores (`domain/scenarios/`) e o
   resíduo de composição (`features/debug.ts`) consomem estas formas. */

/** Uma entrada da árvore de trabalho (`FS[p]`): conteúdo actual + original. */
export interface FileEntry {
  content: string;
  orig: string | null;
}

/** O tipo de sessão: `pre` (ainda não compila — oferta/explicação), `code`
 *  (passo-a-passo sobre o código do lexer) ou `ops` (sondas a um pod em crash). */
export type DbgKind = "pre" | "code" | "ops";

/** Mapa de hipóteses → confiança (0–100). As chaves diferem por tipo de sessão
 *  (code: eof/dig/test; ops: db/cred/host/code) e casam com as etiquetas em `hk`. */
export type Hyp = Record<string, number>;

/** Uma entrada do feed do assistente: categoria (look/think/evidence/cmd/root/ok),
 *  HTML e carimbo de tempo (não renderizado, mas preservado). */
export interface FeedItem {
  k: string;
  h: string;
  t: string;
}

/** O desfecho de uma sessão: veredicto ou causa-raiz, com uma correcção opcional
 *  (`fix`, sobre o fonte) ou uma acção opcional (`act`, código a correr na UI). */
export interface DbgEnd {
  ok: boolean;
  t: string;
  b: string;
  fix?: (src: string) => string;
  act?: string;
}

/** Um passo de sessão `code`: a linha, o foco, o snapshot de variáveis, as
 *  hipóteses, a nota (HTML) e se é evidência decisiva. */
export interface CodeStep {
  l: number;
  focus: string;
  v: Record<string, string>;
  h: Hyp;
  n: string;
  ev?: boolean;
}

/** Um passo de sessão `ops`: o comando-sonda, a saída, o foco, as hipóteses e a nota. */
export interface OpsStep {
  cmd: string;
  out: string;
  focus: string;
  h: Hyp;
  n: string;
}

export type DbgStep = CodeStep | OpsStep;

/** A sessão de depuração viva. Campos comuns + os específicos de cada `kind`
 *  (opcionais): `offer` (pre), `watch` (code). Mutada no sítio pelo motor. */
export interface DbgSession {
  id: string;
  kind: DbgKind;
  i: number;
  steps: DbgStep[];
  feed: FeedItem[];
  h: Hyp;
  hk?: Record<string, string>;
  end?: DbgEnd;
  focus?: string;
  done?: boolean;
  offer?: boolean;
  watch?: string[];
}

/** Um lançador da lista «Launch»: id, etiqueta e descrição. */
export interface LaunchConfig {
  id: string;
  l: string;
  d: string;
}

/** O traço de uma sessão `code` (lexer): passos + desfecho. */
export interface CodeTrace {
  steps: CodeStep[];
  end: DbgEnd;
}

/** O traço de uma sessão `ops` (crash): etiquetas de hipótese + passos + desfecho. */
export interface CrashTrace {
  hk: Record<string, string>;
  steps: OpsStep[];
  end: DbgEnd;
}

/* ───── formas de dados dos ambientes (vêm do infra via bridge; o domínio recebe-as
   como dados, nunca vai ao `window`/ENVX buscá-las) ───── */

/** Uma dependência de um ambiente: serviço, estado (ok/crash/…) e, no crash, nº de
 *  reinícios e a linha de erro. */
export interface EnvDep {
  n: string;
  status: string;
  restarts?: number;
  err?: string;
}

/** O estado de um ambiente: as suas dependências. */
export interface EnvState {
  deps: EnvDep[];
}

/** O lançador de um ambiente para `buildLaunchConfigs`: o id do ambiente e o seu
 *  estado (ou `null` se ainda não hidratado). */
export interface LaunchEnv {
  env: string;
  state: EnvState | null;
}

/** Tudo o que `buildCrashTrace` precisa, como dados puros: o ambiente/serviço, as
 *  dependências, os segredos do ambiente e locais, o namespace, a etiqueta e a
 *  função (pura) de extracção de host de uma URL. */
export interface CrashInput {
  env: string;
  n: string;
  deps: EnvDep[];
  sec: Record<string, Record<string, string>>;
  local: Record<string, Record<string, string>>;
  ns: string;
  label: string;
  urlHosts: (v: string) => string | null;
}
