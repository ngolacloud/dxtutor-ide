/* ═════════ dxtutor IDE — os escopos da equipa a partir do projecto (ADR-0006, R3c) ═════════
   Regra PURA. Os escopos de cada assistente (onde pode escrever, que comandos pode correr)
   deixam de ser os do projecto de demonstração (`crates/**`, `desktop/src/**`,
   `db/migrations/**`, `apps/APP/…`): derivam-se da estrutura real da pasta aberta (as pastas com
   manifestos de backend, as com package.json, as migrações, os testes, o deploy) e dos comandos
   de testes/lint detectados — e o projecto pode fixá-los em `.dxtutor/team.json`, que manda.
   Sem DOM nem `window`: recebe a lista de ficheiros e os comandos por argumento. */

export interface Scope {
  paths: string[];
  cmds: string[];
  max?: number;
  model?: string;
}

/** Manifestos de backend (Rust, Go, Python, Java, PHP, Ruby). */
const BACKEND = ["Cargo.toml", "go.mod", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "composer.json", "Gemfile"];

const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const ignored = (p: string): boolean => /(^|\/)(node_modules|target|dist|build|vendor|\.git)\//.test(p);

/** As pastas (relativas; "" = a raiz) que têm um dos manifestos. */
function dirsWith(files: string[], names: string[]): string[] {
  const out = new Set<string>();
  for (const f of files) { if (ignored(f)) continue; const base = f.split("/").pop() as string; if (names.includes(base)) out.add(dirOf(f)); }
  return [...out].sort();
}

/** Os padrões de um projecto numa pasta: a pasta inteira, ou — na raiz — o código e o manifesto. */
function projectGlobs(d: string, manifests: string[], rootCode: string[]): string[] {
  return d ? [`${d}/**`] : [...rootCode, ...manifests];
}

/** Os escopos derivados da estrutura da pasta (`files`: caminhos relativos) e dos comandos de
 *  testes/lint detectados (`test`/`lint`, ou null). */
export function deriveScopes(files: string[], test: string | null, lint: string | null): Record<string, Scope> {
  const be = dirsWith(files, BACKEND), fe = dirsWith(files, ["package.json"]);
  const rootBackend = BACKEND.filter((m) => files.includes(m));
  const verify = [test, lint].filter((c): c is string => !!c);
  return {
    lead: { paths: ["**"], cmds: ["*"] },
    arq: { paths: [".dxtutor/**", "docs/**", "README.md"], cmds: [] },
    be: { paths: be.flatMap((d) => projectGlobs(d, rootBackend, ["src/**", "crates/**", "cmd/**", "internal/**", "pkg/**", "app/**"])), cmds: verify },
    fe: { paths: fe.flatMap((d) => projectGlobs(d, ["package.json"], ["src/**", "public/**", "index.html"])), cmds: verify },
    db: { paths: ["migrations/**", "**/migrations/**", "*.sql", "**/*.sql"], cmds: test ? [test] : [] },
    qa: { paths: ["tests/**", "**/tests/**", "test/**", "**/test/**", "**/*_test.*", "**/*.test.*", "**/*.spec.*", "**/test_*.py"], cmds: verify },
    ops: { paths: ["Dockerfile", "**/Dockerfile", "docker-compose*.yml", "compose*.yml", "Makefile", ".github/**", ".gitlab-ci.yml", "deploy/**", "k8s/**", "helm/**", ".env.example"], cmds: ["docker compose", "make", "kubectl"] },
    tutor: { paths: [], cmds: [] },
  };
}

/** `.dxtutor/team.json`: `{ "agents": { "<id>": { "paths": [...], "cmds": [...], "max": n, "model": "…" } } }`.
 *  Devolve só as entradas válidas (o resto do ficheiro ignora-se); null se não for JSON válido. */
export function parseTeamJson(text: string): Record<string, Partial<Scope>> | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  const agents = v && typeof v === "object" ? (v as { agents?: unknown }).agents : null;
  if (!agents || typeof agents !== "object") return null;
  const out: Record<string, Partial<Scope>> = {};
  for (const [k, a] of Object.entries(agents as Record<string, unknown>)) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>, s: Partial<Scope> = {};
    if (Array.isArray(o.paths) && o.paths.every((x) => typeof x === "string")) s.paths = o.paths as string[];
    if (Array.isArray(o.cmds) && o.cmds.every((x) => typeof x === "string")) s.cmds = o.cmds as string[];
    if (typeof o.max === "number") s.max = o.max;
    if (typeof o.model === "string") s.model = o.model;
    out[k] = s;
  }
  return out;
}

/** O conteúdo de `.dxtutor/team.json` para os escopos actuais. */
/** `teamJson`, keeping what else the file had — the `people` and their roles (RF-A06), which the
 *  assistants' editor does not own. */
export function teamJsonKeeping(agents: Record<string, Scope>, previous: string | undefined): string {
  let rest: Record<string, unknown> = {};
  try {
    const v = previous ? JSON.parse(previous) : null;
    if (v && typeof v === "object") rest = { ...(v as Record<string, unknown>) };
  } catch {
    /* not JSON: only the agents */
  }
  delete rest.agents;
  const out = { ...JSON.parse(teamJson(agents)), ...rest };
  return JSON.stringify(out, null, 2) + "\n";
}

export function teamJson(agents: Record<string, Scope>): string {
  return JSON.stringify({ agents: Object.fromEntries(Object.entries(agents).map(([k, a]) => [k, { paths: a.paths, cmds: a.cmds, ...(a.max != null ? { max: a.max } : {}), ...(a.model ? { model: a.model } : {}) }])) }, null, 2) + "\n";
}
