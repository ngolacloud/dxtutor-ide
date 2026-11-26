/* ═══════════ feature `board` — domínio: persistência do backlog (ADR-0006, R3b) ═══════════
   O mapeamento PURO entre o quadro da UI (`Backlog`/`Issue`) e o modelo do backend
   (`tutor_board::Backlog` — sprints + user stories, `board_load`/`board_save`, um por pasta).
   O título vai para `want`, o tipo para `kind`, os pontos/coluna/sprint/nota/ramo — e a story
   (`role`/`soThat`), os critérios (`acceptance`) e o `prompt`, quando a issue os tem — para os
   campos homónimos; o que o backend não tem coluna (agente, dono humano, merge, componente do
   Studio, revisão, explicação, custo, resultado dos testes…) vai em `meta`, tal-e-qual. Sem DOM,
   sem `window`, sem Tauri. */

import type { Backlog, Issue } from "./types";

/** `tutor_board::Story` (camelCase; `soThat`). */
export interface StoryDto {
  id: string;
  sprint: number;
  role: string;
  want: string;
  soThat: string;
  acceptance: string[];
  points: number;
  stage: string;
  kind: string;
  prompt: string;
  note: string;
  branch: string | null;
  meta?: Record<string, unknown> | null;
}

/** `tutor_board::Backlog`. */
export interface BacklogDto {
  problem: string;
  seq: number;
  sprints: Array<{ index: number; goal: string }>;
  stories: StoryDto[];
}

/** Os campos da issue que vão em `meta` (o resto tem coluna própria). */
const META_KEYS = ["agent", "owner", "merged", "node", "infra", "custom", "reviewed", "explain", "cost", "attempts", "model", "res"] as const;

export function toBacklogDto(b: Backlog): BacklogDto {
  const sprints = [...new Set(b.issues.map((i) => i.sprint))].sort((x, y) => x - y).map((index) => ({ index, goal: "" }));
  const stories = b.issues.map((i): StoryDto => {
    const meta: Record<string, unknown> = {};
    for (const k of META_KEYS) { const v = (i as unknown as Record<string, unknown>)[k]; if (v !== undefined && v !== null && v !== false && v !== 0) meta[k] = v; } /* os defaults (0/false/null) não se guardam: a leitura repõe-nos */
    return {
      id: i.id, sprint: i.sprint, role: i.role || "", want: i.title, soThat: i.soThat || "", acceptance: i.acceptance ? [...i.acceptance] : [], points: i.pts,
      stage: i.stage, kind: i.type, prompt: i.prompt || "", note: i.note || "", branch: i.branch ?? null, meta,
    };
  });
  return { problem: "", seq: b.seq, sprints, stories };
}

/** O maior número `DX-<n>` + 1 (um backlog vindo de fora pode trazer um `seq` atrasado). */
const nextSeq = (stories: StoryDto[], seq: number): number =>
  stories.reduce((m, s) => { const n = Number((s.id.match(/^DX-(\d+)$/) || [])[1]); return Number.isFinite(n) ? Math.max(m, n + 1) : m; }, seq);

export function fromBacklogDto(d: BacklogDto): { issues: Issue[]; seq: number } {
  const issues = d.stories.map((s): Issue => {
    const m = (s.meta || {}) as Record<string, unknown>;
    const it: Issue = {
      id: s.id, title: s.want || s.id, type: s.kind === "fix" ? "fix" : "feature", pts: s.points, stage: s.stage,
      attempts: typeof m.attempts === "number" ? m.attempts : 0, res: (m.res as Issue["res"]) ?? null, note: s.note || "",
      model: (m.model as string) ?? null, branch: s.branch ?? null, agent: typeof m.agent === "string" ? m.agent : "lead", sprint: s.sprint,
    };
    for (const k of ["owner", "merged", "node", "infra", "custom", "reviewed", "explain", "cost"] as const) if (m[k] !== undefined) (it as unknown as Record<string, unknown>)[k] = m[k];
    /* a story e os critérios só entram na issue quando existem (uma issue sem eles fica igual) */
    if (s.role) it.role = s.role;
    if (s.soThat) it.soThat = s.soThat;
    if (s.acceptance && s.acceptance.length) it.acceptance = [...s.acceptance];
    if (s.prompt) it.prompt = s.prompt;
    return it;
  });
  return { issues, seq: nextSeq(d.stories, d.seq) };
}
