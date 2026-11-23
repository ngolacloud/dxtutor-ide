/* ═════════ domínio: router de modelos (perfis + pontuação) ═════════
   Puro: que provedor serve melhor um tipo de tarefa, dada a matriz de capacidades.
   O lado com efeitos (provedores ligados, harness do assistente, pergunta ao LLM,
   cache) fica em features/router.ts e consome isto. */

export type Capability = "reason" | "code" | "speed" | "cost" | "priv" | "ctx";
export type TaskKind = "arch" | "code" | "db" | "ui" | "test" | "ops" | "teach" | "sens";

export interface TaskProfile {
  /** Rótulo para a UI. */
  l: string;
  /** Peso de cada capacidade nesta tarefa. */
  w: Partial<Record<Capability, number>>;
}

/** Rótulos das capacidades. */
export const CAPL: Record<Capability, string> = {
  reason: "Raciocínio",
  code: "Código",
  speed: "Rapidez",
  cost: "Economia",
  priv: "Privacidade",
  ctx: "Contexto",
};

/** Matriz provedor × capacidade (0–10). */
export const CAP: Record<string, Record<Capability, number>> = {
  claude: { reason: 10, code: 9, speed: 6, cost: 4, priv: 3, ctx: 9 },
  gemini: { reason: 8, code: 8, speed: 8, cost: 7, priv: 3, ctx: 10 },
  codex: { reason: 8, code: 10, speed: 7, cost: 6, priv: 3, ctx: 7 },
  ollama: { reason: 5, code: 6, speed: 5, cost: 10, priv: 10, ctx: 4 },
};

/** Pesos por tipo de tarefa. */
export const TASKP: Record<TaskKind, TaskProfile> = {
  arch: { l: "Arquitectura e decomposição", w: { reason: 5, ctx: 3, code: 1 } },
  code: { l: "Implementação", w: { code: 5, reason: 2, speed: 1 } },
  db: { l: "Modelação de dados", w: { reason: 4, code: 3, ctx: 1 } },
  ui: { l: "Interface", w: { code: 3, speed: 3, cost: 2 } },
  test: { l: "Testes", w: { code: 3, speed: 3, cost: 3 } },
  ops: { l: "Infra e pipelines", w: { reason: 3, code: 3, cost: 2 } },
  teach: { l: "Explicação e tutoria", w: { reason: 5, speed: 2 } },
  sens: { l: "Dados sensíveis", w: { priv: 10, cost: 1 } },
};

export interface Ranked {
  p: string;
  s: number;
}

/** Ordena `providers` (só os que existem na matriz) pela pontuação ponderada da tarefa,
 *  do melhor para o pior. Tarefa desconhecida → lista vazia. */
export function rankProviders(
  task: string,
  providers: readonly string[],
  cap: Record<string, Record<Capability, number>> = CAP,
  taskp: Record<string, TaskProfile> = TASKP,
): Ranked[] {
  const prof = taskp[task];
  if (!prof) return [];
  return providers
    .filter((p) => cap[p])
    .map((p) => ({
      p,
      s: Object.entries(prof.w).reduce((s, [c, x]) => s + cap[p][c as Capability] * (x ?? 0), 0),
    }))
    .sort((a, b) => b.s - a.s);
}

/** As `n` capacidades que mais pesam na tarefa, em minúsculas ("raciocínio e contexto"). */
export function topCapabilities(task: string, n = 2, taskp: Record<string, TaskProfile> = TASKP): string {
  const prof = taskp[task];
  if (!prof) return "";
  return Object.entries(prof.w)
    .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
    .slice(0, n)
    .map((x) => CAPL[x[0] as Capability].toLowerCase())
    .join(" e ");
}
