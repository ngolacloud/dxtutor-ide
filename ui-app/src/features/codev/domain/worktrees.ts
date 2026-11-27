/* ═══════════ Co-Dev — domínio: worktrees e reservas de ficheiros (Multi Co-Dev, fase 3) ═══════════
   Com mais de uma sessão Co-Dev, cada issue trabalha na sua worktree git (no ramo da issue), fora da
   pasta do projecto; as regras vivem no Rust (`tutor_eval::gitwork::codev`, `codev_worktree.rs`) e as
   reservas de ficheiros também (`tutor_board::project::claims`, recusadas na camada de ferramentas do
   agente). Aqui só se estreitam as respostas dos comandos `codev_worktree_*`/`codev_claims` e se
   calcula o que a interface mostra: o rótulo do ramo, o texto proposto por uma revisão de hunks (para
   a ver só de leitura) e as reservas por sessão. PURO. */

/** O que começar uma sessão numa issue faz ao repositório (`codev_worktree_plan`). */
export interface WorktreePlan {
  /** `false`: sem worktrees aqui (pasta sem git, sem commits) — `reason` diz porquê. */
  available: boolean;
  reason: string | null;
  key: string;
  branch: string;
  path: string;
  /** já existe: nada a correr nem a aprovar */
  exists: boolean;
  newBranch: boolean;
  /** os comandos exactos, um por linha (vazio quando existe) */
  command: string;
}

/** Um ficheiro que a worktree mudou desde que o ramo saiu da árvore principal. */
export interface WorktreeChange {
  path: string;
  /** `A`, `M`, `D`, `R`, `?` (novo, ainda por juntar) */
  status: string;
}

/** Uma worktree do Co-Dev (`codev_worktree_create`, `codev_worktrees`). */
export interface WorktreeInfo {
  key: string;
  path: string;
  /** a pasta do projecto dentro dela (onde a sessão trabalha) */
  dir: string;
  branch: string | null;
  head: string;
  /** o git ainda a lista, mas a pasta já não existe */
  prunable: boolean;
  /** alterações por commitar */
  dirty: string[];
  changed: WorktreeChange[];
}

/** Uma worktree listada: a sessão aberta que lá trabalha (nenhuma: guardada, ou deixada por um crash)
 *  e o comando exacto que a limpa. */
export interface ListedWorktree extends WorktreeInfo {
  session: string | null;
  remove: string;
}

/** Um ficheiro de uma worktree, só de leitura (`codev_worktree_file`). */
export interface WorktreeFile {
  path: string;
  abs: string;
  branch: string | null;
  before: string | null;
  now: string | null;
}

/** Um ficheiro reservado por uma sessão (`codev_claims`). */
export interface FileClaim {
  path: string;
  session: string;
  issue: string | null;
  at: number;
}

/** O que a faixa e a revisão de hunks sabem da worktree de uma sessão. */
export interface WorktreeRef {
  key: string;
  branch: string | null;
  path: string;
  dir: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parsePlan(v: unknown): WorktreePlan | null {
  if (!isObj(v) || typeof v.available !== "boolean" || typeof v.key !== "string") return null;
  return {
    available: v.available,
    reason: strOrNull(v.reason),
    key: v.key,
    branch: str(v.branch),
    path: str(v.path),
    exists: v.exists === true,
    newBranch: v.newBranch === true,
    command: str(v.command),
  };
}

export function parseInfo(v: unknown): WorktreeInfo | null {
  if (!isObj(v) || typeof v.key !== "string" || typeof v.path !== "string") return null;
  const changed = Array.isArray(v.changed)
    ? v.changed.filter(isObj).map((c) => ({ path: str(c.path), status: str(c.status) || "M" })).filter((c) => c.path)
    : [];
  return {
    key: v.key,
    path: v.path,
    dir: str(v.dir) || v.path,
    branch: strOrNull(v.branch),
    head: str(v.head),
    prunable: v.prunable === true,
    dirty: strs(v.dirty),
    changed,
  };
}

export function parseListed(v: unknown): ListedWorktree[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((x) => {
    const i = parseInfo(x);
    return i && isObj(x) ? [{ ...i, session: strOrNull(x.session), remove: str(x.remove) }] : [];
  });
}

export function parseFile(v: unknown): WorktreeFile | null {
  if (!isObj(v) || typeof v.path !== "string" || typeof v.abs !== "string") return null;
  return { path: v.path, abs: v.abs, branch: strOrNull(v.branch), before: strOrNull(v.before), now: strOrNull(v.now) };
}

export function parseClaims(v: unknown): FileClaim[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter(isObj)
    .map((c) => ({ path: str(c.path), session: str(c.session), issue: strOrNull(c.issue), at: typeof c.at === "number" ? c.at : 0 }))
    .filter((c) => c.path && c.session);
}

export const refOf = (w: WorktreeInfo): WorktreeRef => ({ key: w.key, branch: w.branch, path: w.path, dir: w.dir });

/** «⎇ feature/dx-2-pay» (ou a cabeça, sem ramo). */
export const branchLabel = (w: { branch: string | null; head?: string }): string => `⎇ ${w.branch ?? (w.head ? w.head.slice(0, 8) : "?")}`;

/** As worktrees sem sessão aberta: guardadas com alterações, ou deixadas por um crash. */
export const kept = (l: ListedWorktree[]): ListedWorktree[] => l.filter((w) => !w.session);

/** Pode limpar-se sem perder nada? (sem alterações por commitar, ou a pasta já desapareceu) */
export const cleanable = (w: ListedWorktree): boolean => w.prunable || w.dirty.length === 0;

/** Os ficheiros que cada sessão reservou, por sessão. */
export function claimsBySession(c: FileClaim[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const x of c) m.set(x.session, [...(m.get(x.session) ?? []), x.path]);
  return m;
}

/** Um bloco de uma revisão de hunks, como o texto proposto o aplica. */
export interface HunkEdit {
  /** linhas `start..=end` do ficheiro (1-based; `end = start - 1` insere) */
  start: number;
  end: number;
  /** o texto novo das linhas */
  text: string;
}

const splitKeep = (t: string): string[] => (t === "" ? [] : t.match(/[^\n]*\n|[^\n]+$/g) ?? []);

/** O ficheiro com os blocos aplicados (de baixo para cima, para as linhas não se moverem): o que a
 *  revisão propõe, para o ver só de leitura ao lado do actual. */
export function applyEdits(real: string, edits: HunkEdit[]): string {
  const lines = splitKeep(real);
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    const from = Math.max(0, e.start - 1);
    const count = Math.max(0, e.end - e.start + 1);
    let text = e.text;
    // a substituição de linhas que acabavam em newline também acaba numa
    if (text && !text.endsWith("\n") && from + count < lines.length) text += "\n";
    lines.splice(from, count, ...splitKeep(text));
  }
  return lines.join("");
}

/** Onde a sessão de uma issue trabalha. `unavailable`: sem worktrees nesta pasta (sem git, sem commits) —
 *  vale a regra da fase 2 (a mesma árvore, sem sobreposições); `refused`: o humano não aprovou, ou falhou. */
export type Placement =
  | { kind: "main" }
  | { kind: "worktree"; ref: WorktreeRef; created: boolean }
  | { kind: "unavailable"; reason: string }
  | { kind: "refused" };
