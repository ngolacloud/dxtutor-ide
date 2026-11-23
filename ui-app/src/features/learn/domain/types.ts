/* Tipos do domínio do Learning Track. PURO: sem DOM, sem window, sem Tauri. */

/** Uma linguagem que o Learning Track conhece (do catálogo oficial ou de um plugin). */
export interface Language {
  id: string;
  name: string;
  /** Emoji/glifo do cartão. */
  icon: string;
  /** Extensão dos ficheiros de exercício, sem ponto. */
  extension: string;
  /** Texto inserido pela tecla Tab. */
  indent: string;
}

/** Um passo, na forma que o motor (features/learn.ts) lê — a mesma dos JSON embutidos. */
export interface Step {
  kind: "concept" | "drill" | "challenge";
  id: string;
  title: string;
  points: number;
  intro: string;
  difficulty: number;
  body: string;
  prompt: string;
  target: string;
  explanation: string;
  line_comments: string[];
  placeholder_policy: string;
  instructions: string;
  entry: string;
  starter: string;
  /** Só nos cursos embutidos (protótipo de browser); os de plugin são avaliados no backend. */
  tests?: string;
  gabarito?: { solution: string; time: string; space: string; justification: string };
}

export interface Unit {
  id: string;
  title: string;
  intro: string;
  /** Texto de leitura do tópico (markdown). Vazio quando o curso ainda não o traz. */
  concepts: string;
  difficulty: number;
  level: string;
  steps: Step[];
}

export interface Course {
  id: string;
  title: string;
  summary: string;
  /** Texto que apresenta a linguagem (markdown). Pode ser vazio. */
  overview: string;
  units: Unit[];
  /** De onde veio: embutido na UI ou servido pelo backend (plugin/curso do binário). */
  origin: "embedded" | "backend";
}

/** Estado de um cartão no selector de linguagens. */
export type CardState = "available" | "soon";

export interface LanguageCard {
  language: Language;
  state: CardState;
  /** Resumo do curso, quando há um. */
  summary: string;
  /** Verdadeiro quando a linguagem não é do catálogo oficial (veio de um plugin da comunidade). */
  community: boolean;
}

/** Um plugin instalado, como o selector o mostra. */
export interface PluginRow {
  id: string;
  name: string;
  version: string;
  source: string;
  language: Language | null;
  error: string | null;
}
