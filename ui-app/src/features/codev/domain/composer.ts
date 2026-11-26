/* ═══════════ Co-Dev — domínio: o compositor da conversa ═══════════
   Os dados e as regras do compositor ao estilo do chat do Claude: catálogo de modelos
   por provedor, níveis de esforço, os modos (Manual/Assistido/Plano/Auto), a lista de
   acções do menu «/», e como os anexos entram no pedido. Puro: sem DOM, sem window. */

/* ───── esforço ───── */

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export const EFFORT_LABEL: Record<Effort, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  xhigh: "Muito alto",
  max: "Máximo",
};

/** Valor guardado → nível (desconhecido → `high`, o valor por omissão do harness). */
export const parseEffort = (s: string | null | undefined): Effort =>
  (EFFORTS as readonly string[]).includes(s ?? "") ? (s as Effort) : "high";

/* ───── modelos ───── */

export interface ModelOption {
  id: string;
  label: string;
  desc: string;
  recommended?: boolean;
}

/** Os modelos que o compositor oferece por provedor. O Ollama mostra o configurado. */
export const MODEL_CATALOG: Record<string, ModelOption[]> = {
  claude: [
    { id: "claude-opus-5-5", label: "Opus 5.5", desc: "Para trabalho complexo e o dia-a-dia", recommended: true },
    { id: "claude-fable-5-2", label: "Fable 5.2", desc: "Para os desafios mais difíceis" },
    { id: "claude-sonnet-5-5", label: "Sonnet 5.5", desc: "Mais eficiente para tarefas simples" },
    { id: "claude-haiku-5-5", label: "Haiku 5.5", desc: "O mais rápido, para respostas curtas" },
  ],
  codex: [
    { id: "gpt-4.1", label: "GPT-4.1", desc: "OpenAI — bom equilíbrio para código", recommended: true },
    { id: "gpt-5", label: "GPT-5", desc: "OpenAI — raciocínio mais forte" },
  ],
  gemini: [
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Google — rápido", recommended: true },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", desc: "Google — mais capaz" },
  ],
};

/** Nome curto para o chip: `claude-opus-5-5` → `Opus 5.5`; desconhecido → o próprio id. */
export function modelLabel(provider: string, model: string): string {
  const hit = (MODEL_CATALOG[provider] ?? []).find((m) => m.id === model);
  if (hit) return hit.label;
  const c = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model);
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}${c[3] ? "." + c[3] : ""}`;
  return model || provider;
}

/** Os nomes de exemplo do protótipo que nenhuma API aceita → o modelo por omissão do
 *  provedor (o mesmo que `codev_agent::resolve_model` usa no backend). */
const PLACEHOLDER: Record<string, string> = { "gpt-codex": "gpt-4.1", "gemini-pro": "gemini-2.5-flash" };
export const effectiveModel = (model: string): string => PLACEHOLDER[model] ?? model;

/** O esforço só vai ao Claude (matriz da F8). */
export const supportsEffort = (provider: string): boolean => provider === "claude";

/* ───── modos ───── */

export type ComposerMode = "manual" | "assist" | "plan" | "auto";

export interface ModeOption {
  id: ComposerMode;
  label: string;
  desc: string;
}

export const MODE_OPTIONS: ModeOption[] = [
  { id: "manual", label: "Manual", desc: "Pede a tua aprovação antes de cada alteração e cada comando" },
  { id: "assist", label: "Assistido", desc: "Faz o que é seguro e reversível; pergunta quando há risco ou dúvida" },
  { id: "plan", label: "Plano", desc: "Explora o código só com leitura e apresenta um plano antes de editar" },
  { id: "auto", label: "Auto", desc: "Aprova o que passa a verificação de segurança e pára no que é arriscado" },
];

/** Shift+Tab: o modo seguinte, pela ordem do menu. */
export function nextMode(current: ComposerMode): ComposerMode {
  const i = MODE_OPTIONS.findIndex((m) => m.id === current);
  return MODE_OPTIONS[(i + 1) % MODE_OPTIONS.length].id;
}

/* ───── menu «/» ───── */

export interface SlashAction {
  id: string;
  group: "Contexto" | "Modelo" | "Agente";
  label: string;
  hint?: string;
}

export const SLASH_ACTIONS: SlashAction[] = [
  { id: "attach", group: "Contexto", label: "Anexar ficheiro…" },
  { id: "mention", group: "Contexto", label: "Mencionar ficheiro do projecto…" },
  { id: "clear", group: "Contexto", label: "Limpar conversa" },
  { id: "rewind", group: "Contexto", label: "Reverter ficheiros", hint: "/reverter" },
  { id: "resume", group: "Contexto", label: "Retomar conversa", hint: "/retomar" },
  { id: "export", group: "Contexto", label: "Exportar conversa" },
  { id: "dictlang", group: "Contexto", label: "Língua do ditado…" },
  { id: "model", group: "Modelo", label: "Mudar de modelo…" },
  { id: "effort", group: "Modelo", label: "Esforço" },
  { id: "pace", group: "Agente", label: "Velocidade de escrita no editor…" },
  { id: "mode", group: "Agente", label: "Mudar de modo…", hint: "⇧Tab" },
  { id: "plan", group: "Agente", label: "Planear antes de editar", hint: "/plano" },
  { id: "persona", group: "Agente", label: "Assistente da conversa…" },
  { id: "commands", group: "Agente", label: "Comandos e extensões do projecto", hint: "/comandos" },
  { id: "test", group: "Agente", label: "Correr os testes", hint: "/test" },
  { id: "lint", group: "Agente", label: "Correr o lint", hint: "/lint" },
  { id: "backlog", group: "Agente", label: "Gerar o backlog do projecto", hint: "/backlog" },
  { id: "project", group: "Agente", label: "Criar o Project a partir do backlog", hint: "/project" },
];

const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Filtra as acções pelo texto (sem acentos nem maiúsculas; também pelo atalho). */
export function filterActions(list: SlashAction[], q: string): SlashAction[] {
  const f = fold(q.replace(/^\//, "").trim());
  if (!f) return list;
  return list.filter((a) => fold(a.label).includes(f) || fold(a.hint ?? "").includes(f) || fold(a.group).startsWith(f));
}

/* ───── ditado ───── */

/** As línguas do ditado (whisper `-l`). Português por omissão: a detecção automática
 *  falha muito em frases curtas e trocava português por espanhol/galego. */
export const DICTATION_LANGS: Array<{ id: string; label: string }> = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
  { id: "auto", label: "Automática" },
];

export const parseDictationLang = (s: string | null | undefined): string =>
  DICTATION_LANGS.some((l) => l.id === s) ? (s as string) : "pt";

/* ───── anexos ───── */

export interface Attachment {
  id: string;
  kind: "file" | "mention" | "snippet";
  name: string;
  /** `file`: o texto do ficheiro carregado; `mention`: vazio (o agente lê-o); `snippet`: o
   *  contexto que outra feature mandou com `codev.ask` (selecção, hunk, problema…). */
  content?: string;
  /** `snippet`: de que tipo é o contexto (`selection`, `hunk`, `problem`…). */
  context?: string;
  /** `mention`: o caminho no projecto. */
  path?: string;
  size?: number;
}

/** Tecto por anexo carregado (o resto é cortado com aviso no próprio texto). */
export const MAX_ATTACHMENT = 200 * 1024;

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Só texto: o agente ainda não recebe imagens nem binários. */
export function isTextFile(name: string, mime: string): boolean {
  if (mime.startsWith("text/") || /json|xml|yaml|toml|javascript|typescript|sql|x-sh/.test(mime)) return true;
  if (mime.startsWith("image/") || mime.startsWith("audio/") || mime.startsWith("video/")) return false;
  return /\.(md|txt|rs|ts|tsx|js|jsx|json|ya?ml|toml|py|go|java|kt|c|h|cpp|hpp|cs|rb|php|sh|sql|html|css|scss|csv|log|env|ini|cfg|conf|lock|gradle|xml|svg|vue|svelte|dart|swift|ex|exs|proto|graphql|dockerfile)$/i.test(
    name,
  ) || /^(dockerfile|makefile|readme|license)$/i.test(name);
}

/** O pedido que segue para o agente: o texto + os anexos. Comandos `/…` vão sozinhos. */
export function buildPrompt(text: string, atts: Attachment[]): string {
  const q = text.trim();
  if (!atts.length || q.startsWith("/")) return q;
  const parts = [q];
  const mentions = atts.filter((a) => a.kind === "mention" && a.path).map((a) => a.path as string);
  if (mentions.length) parts.push(`Ficheiros mencionados (lê-os antes de responder): ${mentions.join(", ")}`);
  for (const a of atts.filter((x) => x.kind === "snippet")) {
    const where = a.path ? ` caminho="${a.path.replace(/"/g, "'")}"` : "";
    parts.push(`<contexto tipo="${a.context ?? "selection"}" nome="${a.name.replace(/"/g, "'")}"${where}>\n${a.content ?? ""}\n</contexto>`);
  }
  for (const a of atts.filter((x) => x.kind === "file")) {
    const body = a.content ?? "";
    const cut = body.length > MAX_ATTACHMENT ? body.slice(0, MAX_ATTACHMENT) + "\n… (cortado)" : body;
    parts.push(`<anexo nome="${a.name.replace(/"/g, "'")}">\n${cut}\n</anexo>`);
  }
  return parts.filter(Boolean).join("\n\n");
}

/** A conversa em Markdown para exportar (linhas «tu»/«co-dev» já em texto). */
export function exportMarkdown(title: string, turns: Array<{ who: string; text: string }>, when: string): string {
  const body = turns.map((t) => `### ${t.who}\n\n${t.text.trim()}`).join("\n\n");
  return `# ${title}\n\n_${when}_\n\n${body}\n`;
}

/** How fast Co-Dev's code appears in the editor (RF-S02, docs/v2/RF-DELONIX-PLANO.md F3.1): the
 *  model may answer faster; the editor buffers and types at this pace (characters per second). */
export const WRITE_PACES = [
  { id: "slow", label: "Lento", cps: 20 },
  { id: "normal", label: "Normal", cps: 40 },
  { id: "fast", label: "Rápido", cps: 120 },
  { id: "instant", label: "Instantâneo", cps: 1_000_000 },
] as const;

/** Characters per second of a pace id (unknown → Normal, 40/s). */
export function paceCps(id: string | null | undefined): number {
  return (WRITE_PACES.find((p) => p.id === id) ?? WRITE_PACES[1]).cps;
}
