/* ═══════════ Co-Dev — domínio: `/backlog` e `/project` (conjunto 11) ═══════════
   `/backlog <contexto>` abre uma sessão de backlog: o Co-Dev investiga a pasta e propõe o backlog com a
   ferramenta `backlog_propose` (o anfitrião valida-o com as regras do Project e grava-o em
   `.dxtutor/backlog.json`). `/project <contexto>` propõe o Project a partir desse ficheiro
   (`project_propose`, só leitura); o humano confirma no chat e só então o Project é criado. A proposta chega
   pelo evento `backlog://proposal`; aqui estreita-se e resume-se. Puro. */

export type BacklogCommand = "backlog" | "project";

/** `/backlog …` ou `/project …`? (só o comando inteiro, seguido de espaço ou do fim). */
export function backlogCommand(text: string): BacklogCommand | null {
  const m = /^\/(backlog|project)(\s|$)/.exec(text.trim());
  return m ? (m[1] as BacklogCommand) : null;
}

export interface DraftEpic {
  id: string;
  title: string;
  description: string;
}

export interface DraftIssue {
  ref: string;
  title: string;
  kind: string;
  priority: string;
  points: number | null;
  epic: string;
  storyAs: string;
  storyWant: string;
  storySo: string;
  description: string;
  acceptance: string[];
  scope: string[];
  deps: string[];
  component: string;
}

export interface Draft {
  title: string;
  summary: string;
  epics: DraftEpic[];
  issues: DraftIssue[];
}

export interface PlanSprint {
  name: string;
  goal: string;
  capacity: number | null;
  issues: string[];
}

export interface Plan {
  method: string | null;
  iterDays: number | null;
  sprints: PlanSprint[];
}

export interface BacklogProposal {
  /** A sessão do agente que a fez (`null` se o anfitrião ainda não a conhecia). */
  session: string | null;
  kind: BacklogCommand;
  path: string;
  /** A versão do ficheiro do rascunho (o backend confere-a ao criar). */
  hash: string;
  draft: Draft;
  plan: Plan | null;
  /** O plano tal como veio, para devolver ao backend sem perder campos (DoR, DoD, prefixo). */
  rawPlan: unknown;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseIssue(v: unknown): DraftIssue | null {
  if (!obj(v) || !str(v.ref) || !str(v.title)) return null;
  return {
    ref: str(v.ref),
    title: str(v.title),
    kind: str(v.kind) || "story",
    priority: str(v.priority) || "medium",
    points: num(v.points),
    epic: str(v.epic),
    storyAs: str(v.storyAs),
    storyWant: str(v.storyWant),
    storySo: str(v.storySo),
    description: str(v.description),
    acceptance: strs(v.acceptance),
    scope: strs(v.scope),
    deps: strs(v.deps),
    component: str(v.component),
  };
}

function parseDraft(v: unknown): Draft | null {
  if (!obj(v) || !Array.isArray(v.issues)) return null;
  const issues = v.issues.map(parseIssue).filter((i): i is DraftIssue => !!i);
  const epics = Array.isArray(v.epics)
    ? v.epics.filter(obj).map((e) => ({ id: str(e.id), title: str(e.title), description: str(e.description) })).filter((e) => e.id)
    : [];
  return { title: str(v.title), summary: str(v.summary), epics, issues };
}

function parsePlan(v: unknown): Plan | null {
  if (!obj(v)) return null;
  const sprints = Array.isArray(v.sprints)
    ? v.sprints.filter(obj).map((s) => ({ name: str(s.name), goal: str(s.goal), capacity: num(s.capacity), issues: strs(s.issues) }))
    : [];
  return { method: str(v.method) || null, iterDays: num(v.iterDays), sprints };
}

/** Estreita o evento `backlog://proposal` (`{session, proposal}`). */
export function parseBacklogProposal(v: unknown): BacklogProposal | null {
  if (!obj(v) || !obj(v.proposal)) return null;
  const p = v.proposal;
  const kind = p.kind === "backlog" || p.kind === "project" ? p.kind : null;
  const draft = parseDraft(p.draft);
  if (!kind || !draft || !str(p.hash)) return null;
  const plan = kind === "project" ? parsePlan(p.plan) : null;
  if (kind === "project" && !plan) return null;
  return { session: str(v.session) || null, kind, path: str(p.path) || ".dxtutor/backlog.json", hash: str(p.hash), draft, plan, rawPlan: kind === "project" ? p.plan : null };
}

/** Os pontos de um conjunto de issues (as sem estimativa contam 0). */
export const pointsOf = (issues: DraftIssue[]): number => issues.reduce((n, i) => n + (i.points ?? 0), 0);

/** As issues de cada épico, pela ordem dos épicos; as sem épico no fim (`epic: null`). */
export function byEpic(d: Draft): Array<{ epic: DraftEpic | null; issues: DraftIssue[] }> {
  const known = new Set(d.epics.map((e) => e.id));
  const out: Array<{ epic: DraftEpic | null; issues: DraftIssue[] }> = d.epics
    .map((e) => ({ epic: e, issues: d.issues.filter((i) => i.epic === e.id) }))
    .filter((g) => g.issues.length);
  const loose = d.issues.filter((i) => !known.has(i.epic));
  if (loose.length) out.push({ epic: null, issues: loose });
  return out;
}

/** As issues que nenhuma sprint do plano leva (ficam no product backlog). */
export function unplanned(d: Draft, plan: Plan): DraftIssue[] {
  const planned = new Set(plan.sprints.flatMap((s) => s.issues));
  return d.issues.filter((i) => !planned.has(i.ref));
}
