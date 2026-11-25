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
  const genBacklog: () => void;
  const hoodCmd: () => void;
  const newIssue: () => void;
  const nextLesson: () => [string, string] | null;
  const openBoard: () => void;
  const openGraph: (h?: string) => void;
  const openLesson: (lang: string, id: string) => void;
  const runSprint: (s: number) => unknown;
  const runTask: (c: string) => unknown;
  const selText: () => string;
  const setLocale: (l: string) => void;
  const togglePanel: () => void;
  const toggleSide: () => void;
}
