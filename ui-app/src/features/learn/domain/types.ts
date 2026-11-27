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

/** O que um curso ensina: uma linguagem, um framework ou uma ferramenta. */
export type Category = "language" | "framework" | "tool";

/** Um framework ou uma ferramenta que o Learning Track conhece (do catálogo oficial ou de um
 *  plugin). Categoria SEPARADA das linguagens: o tecto de 10 é só das linguagens. */
export interface Subject {
  id: string;
  name: string;
  icon: string;
  category: Exclude<Category, "language">;
  /** URL da documentação oficial (vazio quando o plugin não a dá). */
  docs: string;
  /** O que instalar para praticar (texto curto). Vazio quando não se sabe. */
  install: string;
  /** Repositório do plugin oficial (`ngolacloud/dxtutor-course-<id>`); vazio na comunidade. */
  repo: string;
}

/** Um passo de projecto: vários ficheiros (os testes ocultos e a solução ficam no backend). */
export interface StepProject {
  /** O ficheiro aberto primeiro. */
  main: string;
  /** caminho relativo → conteúdo inicial */
  files: Record<string, string>;
  /** Os que o aluno vê mas não muda. */
  readonly: string[];
  /** Verifica-se AO VIVO no cluster de prática do curso (Learn P3b). */
  live?: boolean;
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
  /** Só nos passos de projecto (vários ficheiros). */
  project?: StepProject;
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
  /** A linguagem em que os passos se escrevem e se avaliam. */
  language: string;
  category: Category;
  /** O framework/ferramenta ensinado; vazio num curso de linguagem. */
  subject: string;
  title: string;
  summary: string;
  /** Texto que apresenta a linguagem (markdown). Pode ser vazio. */
  overview: string;
  units: Unit[];
  /** De onde veio: embutido na UI ou servido pelo backend (plugin/curso do binário). */
  origin: "embedded" | "backend";
  /** O curso compila contra dependências preparadas uma vez (só no backend): antes de avaliar,
   *  «Prepare course». Falso/ausente nos outros. */
  prepare?: boolean;
}

/** O estado da preparação de um curso que se avalia offline contra uma cache. */
/** Um pacote que a preparação de um curso descarrega (vem do backend). */
export interface CoursePackage {
  name: string;
  /** A versão exacta (pip), o requisito (cargo `1`, `=1.2.3`) ou a referência git (`tag v0.2.0`). */
  version: string;
  /** De onde vem: `PyPI`, `crates.io`, o URL do repositório git… */
  source: string;
  pinned: boolean;
}

export interface PrepareStatus {
  needed: boolean;
  state: "not-needed" | "missing" | "stale" | "ready";
  /** Os comandos exactos a aprovar (vêm do backend). */
  command: string;
  /** O gestor da cache: `cargo` (compila), `pip` (venv do curso), `images` (imagens base no sandbox
   *  de contentores, Learn P3a) ou `cluster` (o kind, a imagem do nó e as imagens dos passos ao vivo,
   *  Learn P3b). */
  kind: "cargo" | "pip" | "images" | "cluster" | "";
  /** Os pacotes que a preparação descarrega, para o diálogo de aprovação. */
  packages: CoursePackage[];
  /** A pasta da cache do curso. */
  dir: string;
  timeoutSecs: number;
  fetchSecs: number | null;
  warmSecs: number | null;
}

/** Se esta máquina corre o cluster de prática (Podman, cgroup v2, delegação, user namespaces). */
export interface ClusterSupport {
  ok: boolean;
  podman: string | null;
  reason: string | null;
  fix: string | null;
}

/** O cluster de prática de um curso de Kubernetes (kind sobre Podman sem root, Learn P3b). */
export interface ClusterState {
  /** O curso tem passos ao vivo. */
  live: boolean;
  /** O curso está preparado (kind, imagem do nó e imagens descarregados). */
  prepared: boolean;
  support: ClusterSupport;
  /** O cluster agora (só preparado e suportado). */
  status: {
    name: string;
    exists: boolean;
    running: boolean;
    createdAt: number | null;
    lastUsed: number | null;
    createSecs: number | null;
    memoryBytes: number | null;
    idleDeadline: number | null;
  } | null;
  /** Os comandos exactos que o diálogo de aprovação mostra. */
  startCommand: string;
  deleteCommand: string;
  /** A pasta da caixa do cluster (âmbito da aprovação). */
  dir: string;
  idleMinutes: number;
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

/** Um cartão de framework/ferramenta no selector (mesmos estados das linguagens). */
export interface SubjectCard {
  subject: Subject;
  state: CardState;
  summary: string;
  community: boolean;
}

/** Um plugin instalado, como o selector o mostra. */
export interface PluginRow {
  id: string;
  name: string;
  version: string;
  source: string;
  language: Language | null;
  /** O framework/ferramenta, num plugin dessa categoria. */
  subject: Subject | null;
  error: string | null;
}
