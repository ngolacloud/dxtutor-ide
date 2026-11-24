/* ═════════ tipos dos globais lidos pelos comandos e pelo arranque (ADR-0004, U4j5c) ═════════
   Eram declarados no topo do app.ts (U4j5b), que se dividiu em app/commands.ts e app/boot-steps.ts.
   Os nomes livres continuam a resolver o global NO ACTO (a versão publicada, eventualmente decorada):
   declaram-se aqui os que ainda não tinham tipo global, sem importar — um import trocaria a resolução
   tardia pela função local do módulo. Só tipos: não há código a correr. */
export interface AppAct { ic: string; pane?: string; title: string; run?: () => void; overflow?: number; spacer?: number; sep?: number; acc?: number; badge?: string; accBadge?: number }
export interface AppMenuItem { l?: string; k?: string; act?: () => unknown; sub?: AppMenuItem[]; sep?: number; on?: boolean }
export type AppCmd = [string, string, () => unknown];
export interface AppMenu { t: string; items?: AppMenuItem[] }
declare global {
  interface Window { claude?: { use: (k: string) => Promise<typeof SAMPLE> }; vsxCmds: () => void }
  const $$: (s: string) => HTMLElement[];
  const ACTS: AppAct[];
  const OVERFLOW: { l: string; pane?: string; sep?: number }[];
  const HARN: { ceiling: string };
  const HT: Record<string, { n: string }>;
  const MORD: string[];
  const THEMES: Record<string, unknown>;
  var THEME: string;
  var TB: { id: string; title: string; kind: string; path?: string }[];
  var DRIFT: string | null;
  const applyTemplate: (k: string) => void;
  const assistantCenter: () => void;
  const badges: () => void;
  const buildActivity: () => void;
  const buildDocker: () => void;
  const dbgStep: () => void;
  const dbgStepInto: () => void;
  const dbgStop: () => void;
  const drawDbg: () => void;
  const edCmd: (c: string) => void;
  const genBacklog: () => void;
  const gfPrompt: (kind: string) => void;
  const hoodCmd: () => void;
  const loadCfg: () => void;
  const loadSD: () => typeof SD;
  const loadTeam: () => void;
  const ltOnboard: (step?: number) => void;
  const ltResume: () => void;
  const mkRz: (el: HTMLElement, v: string, base: number, min: number, max: number, inv?: boolean) => void;
  const newChat: () => void;
  const newFile: () => void;
  const newFolder: () => void;
  const newIssue: () => void;
  const nextLesson: () => [string, string] | null;
  const nextProblem: () => void;
  const openAnalysis: () => void;
  const openBoard: () => void;
  const openEnvs: () => void;
  const openGraph: (h?: string) => void;
  const openLesson: (lang: string, id: string) => void;
  const openManager: () => void;
  const openSettings: () => void;
  const openStudio: () => void;
  const openTeam: () => void;
  const pickAgent: () => void;
  const pickBranch: () => void;
  const pickModel: () => void;
  const promote: (to: string) => void;
  const reviewCmd: () => void;
  const runLabel: () => void;
  const runSprint: (s: number) => unknown;
  const runTask: (c: string) => unknown;
  const resetWorkspace: () => void;
  const selText: () => string;
  const setLocale: (l: string) => void;
  const setTheme: (n: string) => void;
  const sideOpen: () => boolean;
  const startDebug: (id?: string) => void;
  const stepTab: (d: number) => void;
  const termClear: () => void;
  const toggleAgent: () => void;
  const toggleBp: (p: string, line: number) => void;
  const togglePanel: () => void;
  const toggleSide: () => void;
}
