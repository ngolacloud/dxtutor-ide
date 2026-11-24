/* ═══════════ feature `board` — tipos de domínio (ADR-0002, Fase 2) ═══════════
   Formas PURAS da feature backlog/sprints/kanban: a issue e o seu ciclo, o backlog
   em memória, as colunas do quadro, e o design do Studio que o produtor decompõe.
   Sem DOM, sem `window`, sem Tauri — só dados. O domínio e a aplicação importam
   destes tipos; o bridge re-exporta os que o resíduo precisa. */

/** Um teste automático de uma issue: nome (ex. `rs::exposes_healthz`) e o predicado
 *  que o avalia (corre no autoTest; lê o FS vivo por closure). */
export interface IssueTest {
  n: string;
  fn: () => boolean;
}

/** Um ficheiro que o gerador de uma issue produz: caminho + conteúdo, e o material
 *  opcional para a correcção (quando o teste falha) e os seus testes. */
export interface IssueFile {
  p: string;
  content: string;
  fix?: string;
  fixNote?: string;
  tests?: IssueTest[];
}

/** Tipo de issue (feature nova ou correcção). */
export type IssueType = "feature" | "fix";

/** Fase no quadro kanban (chave da coluna): backlog|todo|dev|test|func|done. */
export type IssueStage = string;

/** Resultado de uma corrida de testes automáticos (preenche `issue.res`). */
export interface TestResult {
  n: string;
  ok: boolean;
}

/** Uma issue do backlog, mutada no sítio ao longo do ciclo (stage/res/note/…). Os
 *  campos `gen`/`fix` são produtores de ficheiros (closures sobre os geradores do
 *  monólito); as issues `custom` (criadas à mão) não os têm. */
export interface Issue {
  id: string;
  title: string;
  type: IssueType;
  pts: number;
  stage: IssueStage;
  attempts: number;
  tests: IssueTest[];
  res: TestResult[] | null;
  note: string;
  model: string | null;
  branch: string | null;
  agent: string;
  sprint: number;
  node?: string | null;
  custom?: boolean;
  infra?: boolean;
  merged?: string | null;
  gen?: () => IssueFile[];
  fix?: (() => IssueFile[]) | null;
  fixNote?: string;
  /** A revisão do diff já foi feita (harness «review the diff before validating»). */
  reviewed?: boolean;
  /** A explicação, nas palavras de quem valida (harness «explain before validating»). */
  explain?: string;
  /** Dono humano da issue (`"you"`): não se delega, programa-a quem a tem. */
  owner?: string;
  /** Custo medido das corridas do runner (tokens, dólares, segundos, por provedor). */
  cost?: IssueCost;
}

/** O custo acumulado das corridas de uma issue. */
export interface IssueCost {
  tok: number;
  usd: number;
  sec: number;
  runs: number;
  by: Record<string, number>;
}

/** O backlog em memória (sessão, não vem de LS): issues + contadores (seq de ids,
 *  nº da próxima migração/ADR) + a vista activa (-1 = Tudo, 0/1 = Sprint). */
export interface Backlog {
  issues: Issue[];
  seq: number;
  mig: number;
  adr: number;
  view: number;
}

/** Uma coluna do quadro: [chave, rótulo]. */
export type Stage = [string, string];

/* ───── design do Studio (o produtor decompõe-no em issues) ───── */

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

/** Especificação de uma tecnologia do catálogo (`TECH[tech]`): rótulo, família
 *  (`kind`: app|web|sql|mssql|gateway|…), runtime, porta, nome local, nuvem. */
export interface TechSpec {
  n: string;
  kind: string;
  rt?: string;
  port?: number;
  local?: string;
  cloud: string;
}
