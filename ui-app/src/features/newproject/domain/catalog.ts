/* ═════════ feature `newproject` — domínio: o catálogo do New Project e o que o backend responde ═════════
   Os templates são os do Delonix (`delonix init -t`), embutidos pelo crate `tutor-scaffold`; as regras (nome,
   versão, tokens, segredos, git) são do Rust. Aqui só se estreitam as respostas, se agrupam os cartões e se
   antecipa a regra do nome (o backend volta a verificá-la). Puro. */

export type Group = "language" | "framework" | "server" | "app" | "other";
export const GROUPS: Group[] = ["language", "framework", "server", "app", "other"];

export interface Template {
  id: string;
  name: string;
  group: Group;
  language: string;
  icon: string;
  summary: string;
  /** a versão por omissão (`""`: o template não tem) */
  version: string;
  /** as versões com que é validado (vazio: qualquer versão simples) */
  versions: string[];
  port: string;
  tlsPort: string | null;
  health: string;
  files: number;
}

export interface Plan {
  dir: string;
  template: string;
  version: string;
  files: number;
  port: string;
  tlsPort: string | null;
  /** o que acontece, em palavras (o diálogo de aprovação mostra-o e o registo guarda-o) */
  command: string;
}

export type LockOutcome =
  | { kind: "none" }
  | { kind: "generated"; file: string }
  | { kind: "missing"; file: string; command: string }
  | { kind: "failed"; file: string; command: string; detail: string };

export type GitOutcome = { kind: "committed" } | { kind: "inside_repository" } | { kind: "needs_author" } | { kind: "failed"; detail: string };

export interface Created {
  dir: string;
  template: string;
  version: string;
  files: number;
  port: string;
  health: string;
  tlsPort: string | null;
  lock: LockOutcome;
  git: GitOutcome;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const optStr = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parseTemplates(v: unknown): Template[] {
  if (!Array.isArray(v)) return [];
  return v.filter(obj).filter((t) => str(t.id)).map((t) => ({
    id: str(t.id),
    name: str(t.name) || str(t.id),
    group: (GROUPS as string[]).includes(str(t.group)) ? (t.group as Group) : "other",
    language: str(t.language),
    icon: str(t.icon) || "📦",
    summary: str(t.summary),
    version: str(t.version),
    versions: Array.isArray(t.versions) ? t.versions.filter((x): x is string => typeof x === "string") : [],
    port: str(t.port),
    tlsPort: optStr(t.tlsPort),
    health: str(t.health),
    files: num(t.files),
  }));
}

/** Os cartões por grupo, pela ordem do diálogo (os grupos vazios não aparecem). */
export function byGroup(ts: Template[]): Array<{ group: Group; items: Template[] }> {
  return GROUPS.map((group) => ({ group, items: ts.filter((t) => t.group === group) })).filter((g) => g.items.length);
}

/** A regra do nome (a do Delonix: uma etiqueta DNS, porque vira nome de contentor, tag de imagem e de pacote). */
export function nameProblem(name: string): "empty" | "shape" | null {
  if (!name) return "empty";
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name) ? null : "shape";
}

/** O nome válido mais próximo. */
export function slug(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63).replace(/-+$/, "");
  return s || "app";
}

/** A pasta-mãe de um caminho (a da pasta aberta é a sugestão para o projecto novo). */
export function parentOf(path: string): string {
  const p = path.replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}

export const joinPath = (parent: string, name: string): string => `${parent.replace(/\/+$/, "")}/${name}`;

export function parsePlan(v: unknown): Plan | null {
  if (!obj(v) || !str(v.dir) || !str(v.command)) return null;
  return { dir: str(v.dir), template: str(v.template), version: str(v.version), files: num(v.files), port: str(v.port), tlsPort: optStr(v.tlsPort), command: str(v.command) };
}

function parseLock(v: unknown): LockOutcome {
  if (!obj(v)) return { kind: "none" };
  if (v.kind === "generated") return { kind: "generated", file: str(v.file) };
  if (v.kind === "missing") return { kind: "missing", file: str(v.file), command: str(v.command) };
  if (v.kind === "failed") return { kind: "failed", file: str(v.file), command: str(v.command), detail: str(v.detail) };
  return { kind: "none" };
}

function parseGit(v: unknown): GitOutcome {
  if (!obj(v)) return { kind: "failed", detail: "" };
  if (v.kind === "committed" || v.kind === "inside_repository" || v.kind === "needs_author") return { kind: v.kind };
  return { kind: "failed", detail: str(v.detail) };
}

export function parseCreated(v: unknown): Created | null {
  if (!obj(v) || !str(v.dir)) return null;
  return { dir: str(v.dir), template: str(v.template), version: str(v.version), files: num(v.files), port: str(v.port), health: str(v.health), tlsPort: optStr(v.tlsPort), lock: parseLock(v.lock), git: parseGit(v.git) };
}
