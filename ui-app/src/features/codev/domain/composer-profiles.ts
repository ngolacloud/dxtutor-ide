/* ═══════════ Co-Dev — domínio: o compositor adapta-se ao harness de cada provedor ═══════════
   Cada provedor tem a sua experiência de referência: o Claude (Claude Code / chat do
   Claude), o Gemini (Antigravity), o Codex (extensão Codex da OpenAI) e o Ollama (local).
   Um perfil diz como o compositor se apresenta — disposição, menu ＋, lista de modelos,
   nomes dos modos, botão de enviar — sem mudar o que está por baixo: o mesmo agente, as
   mesmas permissões e as mesmas acções. Puro: sem DOM, sem window. */

import type { ComposerMode } from "./composer";

export type ProfileId = "claude" | "gemini" | "codex" | "ollama";

/** Entradas do menu ＋ (as que o dxtutor tem; as que não tem não se mostram). */
export type PlusItem = "upload" | "mention" | "folder" | "actions" | "activeFile";

export interface ComposerProfile {
  id: ProfileId;
  /** Nome do harness de referência (para a documentação e os testes). */
  harness: string;
  placeholder: string;
  runningPlaceholder: string;
  /** Linha de cima com a pasta do projecto (Antigravity). */
  folderRow: boolean;
  /** Botão «/» na barra (Claude Code); nos outros as acções estão no ＋ e no «/» do teclado. */
  slashButton: boolean;
  /** Chip dos sub-agentes (Claude Code). */
  agentsChip: boolean;
  /** Chip do assistente da conversa (Co-Dev/Tutor/…), o `#pill-agent`. */
  personaChip: boolean;
  /** Botão do modo na barra; sem ele o modo muda pelo «/» e por Shift+Tab. */
  modeButton: boolean;
  plusTitle: string;
  plus: PlusItem[];
  /** `cards`: nome + descrição, só os modelos do provedor (Claude Code, Codex).
   *  `inline`: nome + nível numa linha, modelos de vários provedores (Antigravity). */
  modelMenu: "cards" | "inline";
  /** Onde fica o chip do modelo: junto ao ＋ (Antigravity, Codex) ou à direita (Claude Code). */
  modelPosition: "left" | "right";
  modelTitle: string;
  /** Nomes dos modos neste harness (o significado é o mesmo em todos). */
  modes: Record<ComposerMode, { label: string; desc: string }>;
  send: { icon: "up" | "right"; shape: "square" | "circle" };
}

const MODES_DEFAULT: ComposerProfile["modes"] = {
  manual: { label: "Manual", desc: "Pede a tua aprovação antes de cada alteração e cada comando" },
  assist: { label: "Assistido", desc: "Faz o que é seguro e reversível; pergunta quando há risco ou dúvida" },
  plan: { label: "Plano", desc: "Explora o código só com leitura e apresenta um plano antes de editar" },
  auto: { label: "Auto", desc: "Aprova o que passa a verificação de segurança e pára no que é arriscado" },
};

export const PROFILES: Record<ProfileId, ComposerProfile> = {
  claude: {
    id: "claude",
    harness: "Claude Code",
    placeholder: "Pede ao Co-Dev…",
    runningPlaceholder: "Põe outra mensagem na fila…",
    folderRow: false,
    slashButton: true,
    agentsChip: true,
    personaChip: true,
    modeButton: true,
    plusTitle: "",
    plus: ["upload", "mention", "activeFile"],
    modelMenu: "cards",
    modelPosition: "right",
    modelTitle: "Escolhe um modelo",
    modes: MODES_DEFAULT,
    send: { icon: "up", shape: "square" },
  },
  gemini: {
    id: "gemini",
    harness: "Antigravity",
    placeholder: "Pergunta o que quiseres, @ para mencionar, / para acções",
    runningPlaceholder: "Põe outra mensagem na fila…",
    folderRow: true,
    slashButton: false,
    agentsChip: false,
    personaChip: false,
    modeButton: false,
    plusTitle: "Adicionar contexto",
    plus: ["upload", "folder", "mention", "actions", "activeFile"],
    modelMenu: "inline",
    modelPosition: "left",
    modelTitle: "Modelo",
    modes: {
      manual: { label: "Revisão sempre", desc: "O agente pede revisão antes de cada passo" },
      assist: { label: "Revisão quando preciso", desc: "O agente decide quando pedir a tua revisão" },
      plan: { label: "Planeamento", desc: "Planeia e pesquisa antes de executar" },
      auto: { label: "Rápido", desc: "Executa directamente; pára só no que é arriscado" },
    },
    send: { icon: "right", shape: "circle" },
  },
  codex: {
    id: "codex",
    harness: "Codex",
    placeholder: "Pede ao Codex para fazer qualquer coisa",
    runningPlaceholder: "Põe outra mensagem na fila…",
    folderRow: false,
    slashButton: false,
    agentsChip: false,
    personaChip: false,
    modeButton: true,
    plusTitle: "",
    plus: ["upload", "mention", "activeFile"],
    modelMenu: "cards",
    modelPosition: "left",
    modelTitle: "Modelo",
    modes: {
      manual: { label: "Pedir sempre", desc: "Pede aprovação para cada edição e cada comando" },
      assist: { label: "Agente", desc: "Lê, edita e corre comandos no projecto; pede aprovação para o que é arriscado" },
      plan: { label: "Chat", desc: "Conversa e planeia sem editar ficheiros" },
      auto: { label: "Agente (acesso total)", desc: "Edita e corre comandos sem pedir; pára só no que é destrutivo" },
    },
    send: { icon: "up", shape: "circle" },
  },
  ollama: {
    id: "ollama",
    harness: "Ollama (local)",
    placeholder: "Pergunta ao modelo local…",
    runningPlaceholder: "Põe outra mensagem na fila…",
    folderRow: false,
    slashButton: true,
    agentsChip: false,
    personaChip: true,
    modeButton: true,
    plusTitle: "",
    plus: ["upload", "mention", "activeFile"],
    modelMenu: "cards",
    modelPosition: "right",
    modelTitle: "Modelo local",
    modes: MODES_DEFAULT,
    send: { icon: "up", shape: "circle" },
  },
};

/** O perfil do provedor activo (desconhecido → Claude). */
export const profileFor = (provider: string): ComposerProfile =>
  PROFILES[(provider in PROFILES ? provider : "claude") as ProfileId];

/* ───── menu ＋ ───── */

export interface PlusEntry {
  id: PlusItem;
  label: string;
  desc?: string;
  icon: string;
}

/** As entradas do menu ＋ deste perfil. O Antigravity usa rótulos curtos sem descrição. */
export function plusEntries(p: ComposerProfile): PlusEntry[] {
  const short = p.id === "gemini";
  const all: Record<PlusItem, PlusEntry> = {
    upload: short
      ? { id: "upload", label: "Ficheiros", icon: "clip" }
      : { id: "upload", label: "Carregar do computador", desc: "Ficheiros de texto ou código", icon: "upload" },
    folder: { id: "folder", label: "Pasta", icon: "folder" },
    mention: short
      ? { id: "mention", label: "Menções", icon: "at" }
      : { id: "mention", label: "Mencionar ficheiro do projecto", desc: "O agente lê-o antes de responder", icon: "at" },
    actions: { id: "actions", label: "Acções", icon: "slash" },
    activeFile: short
      ? { id: "activeFile", label: "Ficheiro activo", icon: "file" }
      : { id: "activeFile", label: "Incluir o ficheiro activo", desc: "Contexto do editor", icon: "file" },
  };
  return p.plus.map((k) => all[k]);
}

/* ───── estado vazio da conversa ───── */

/** O título e a frase do ecrã inicial deste perfil (`null` = o do Co-Dev, como está). */
export function introFor(p: ComposerProfile): { title: string; sub: string } | null {
  switch (p.id) {
    case "gemini":
      return { title: "O que vamos construir hoje?", sub: "Pergunta o que quiseres, menciona ficheiros com @ ou escolhe uma acção com /." };
    case "codex":
      return { title: "Em que vamos trabalhar?", sub: "O Codex lê, edita e corre comandos no projecto — escolhe o modo na barra." };
    case "ollama":
      return { title: "Co-Dev local", sub: "O modelo corre na tua máquina: nada do projecto sai do computador." };
    default:
      return null;
  }
}

/** As pastas de uma lista de ficheiros (para «＋ → Pasta»), da mais curta para a mais longa. */
export function foldersOf(files: string[]): string[] {
  const set = new Set<string>();
  for (const f of files) {
    const parts = f.split("/").slice(0, -1);
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}
