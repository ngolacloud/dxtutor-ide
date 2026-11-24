/* ═════════ feature `panel`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/panel/` autorizado a ler ou escrever
   `window.*` (A8 do arch-check). Lê o workspace aberto pelo `bridge.ts` (DXR: raiz,
   nome, SO, HOME, envFor), o `FS` em memória, o estado do compose (STACK) e do PairCode;
   chama as acções do monólito (openPath, setPanelTab, togglePanel, focusAgent, dxRun…);
   e PUBLICA o que o resto da IDE resolve por global:
     • `DXR.term` — tarefas num PTY real (o `runInTerm` do bridge delega aqui);
     • `termOwnsKey` — os atalhos globais de app.ts/v6.ts deixam as teclas à shell;
     • `diagnostics`/`drawProblems` — com uma pasta real aberta, o Problems verdadeiro.
   Acessores lêem `window` NO ACTO (o bridge.ts abre a pasta de forma assíncrona). */

import { codevAsk } from "../../../app/codev-ask";
import { esc, svg, toast } from "../../../core";
import type { Problem } from "../domain/types";

export { esc, svg, toast };

const G = window as unknown as Record<string, any>;

interface Dxr {
  root: string | null;
  name: string | null;
  info: { os?: string; home?: string };
  envFor?: () => Record<string, string>;
  readStack?: () => Promise<void>;
  term?: TermApi;
}

/** O contrato que o `bridge.ts` consome em `DXR.term`. */
export interface TermApi {
  runTask(line: string, o?: { env?: Record<string, string>; cwd?: string; label?: string }): Promise<number>;
  log(channel: string, text: string, err?: boolean): void;
  /** Inspecção para o selftest do bridge (estado real, sem DOM). */
  inspect(): TermInspect;
}

export interface TermInspect {
  terminals: { id: string; kind: string; label: string | null; shell: string; process: string | null; cwd: string | null; exited: number | null }[];
  failures: { command: string; exitCode: number; output: string }[];
  problems: number;
  scanning: boolean;
  scanned: boolean;
  create(cwd?: string): string;
  write(id: string, data: string): void;
  kill(id: string): void;
  text(id: string): string;
}

const dxr = (): Dxr | null => (G.DXR as Dxr | undefined) ?? null;

export const root = (): string | null => dxr()?.root ?? null;
export const rootName = (): string | null => dxr()?.name ?? null;
export const os = (): string => dxr()?.info?.os ?? "linux";
export const home = (): string | null => dxr()?.info?.home ?? null;
export const extraEnv = (): Record<string, string> => {
  try {
    return dxr()?.envFor?.() ?? {};
  } catch {
    return {};
  }
};

const fsKey = (rel: string): string => String(G.ROOT ?? "") + rel;
export const hasFile = (rel: string): boolean => !!G.FS && !!G.FS[fsKey(rel)];
export const openFile = (rel: string, line?: number): void => {
  try {
    G.openPath(fsKey(rel), line);
  } catch {
    toast(`Cannot open ${rel}`);
  }
};

export const setPanelTab = (pt: string, nofocus = true): void => G.setPanelTab(pt, nofocus);
export const togglePanel = (): void => G.togglePanel();
export const panelHidden = (): boolean =>
  getComputedStyle(document.body).getPropertyValue("--panel-h").trim() === "0px" ||
  getComputedStyle(document.documentElement).getPropertyValue("--panel-h").trim() === "0px";

/** Envia `text` ao Co-Dev como se o humano o tivesse escrito e carregado Enter: passa
 *  pelo compositor (`agSend` → submit), que respeita a fila quando já há uma execução. */
export function askCodev(text: string): void {
  // codev.ask (A2.4): the one entry point; the old path stays for builds without it
  if (codevAsk.available()) {
    void codevAsk.ask({ intent: "fix", text, context: [], send: true });
    return;
  }
  try {
    G.focusAgent(true);
  } catch {
    /* sem Co-Dev */
  }
  const ta = document.getElementById("ag-input") as HTMLTextAreaElement | null;
  if (ta && typeof G.agSend === "function") {
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    G.agSend();
  } else if (typeof G.handlePrompt === "function") G.handlePrompt(text);
  else toast("Co-Dev is not available");
}

/* ───── compose (o estado STACK é do resíduo features/stack.ts, decorado pelo bridge) ───── */
export interface StackRow {
  name: string;
  src: string;
  url: string;
  state: string;
}
export const stack = (): StackRow[] | null => (G.STACK as StackRow[] | null) ?? null;
export const composeFile = (): string | null =>
  ["docker-compose.yml", "docker-compose.yaml", "compose.yaml", "compose.yml"].find((f) => hasFile(f)) ?? null;
export const readStack = async (): Promise<void> => {
  await dxr()?.readStack?.();
};
export const composeUp = (): void => void G.dxRun();
export const composeDown = (): void => void G.dxStop();

/** Há uma sessão do «Run and Debug» (motor de cenários) a correr? */
export const dbgSession = (): boolean => {
  try {
    return !!G.dbgState?.();
  } catch {
    return false;
  }
};

/** Regista uma falha do painel onde o selftest do bridge a vê (DXR.errors). */
export const reportError = (where: string, e: unknown): void => {
  const msg = `panel ${where}: ${e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e)}`;
  const errs = (G.DXR as { errors?: string[] } | undefined)?.errors;
  if (errs) errs.push(msg);
  console.error(msg);
};

export const pairLive = (): boolean => (G.PAIR as { state?: string } | undefined)?.state === "connected";

/* ───── publicação ───── */

export interface Published {
  term: TermApi;
  ownsKey: (e: KeyboardEvent) => boolean;
  problems: () => Problem[];
  drawProblems: () => void;
  /** O Services real é dono do #pc-services (o drawStack do resíduo escrevia lá a demo). */
  drawServices: () => void;
}

/** Instala as fachadas reais. As versões do monólito continuam a servir quando não há
 *  pasta real aberta (workspace de exemplo / browser). */
export function publish(p: Published): void {
  const R = dxr();
  if (R) R.term = p.term;
  G.termOwnsKey = p.ownsKey;
  const baseDiagnostics = G.diagnostics as () => unknown[];
  const baseDraw = G.drawProblems as () => void;
  G.diagnostics = function () {
    if (!root()) return baseDiagnostics();
    return p.problems().map((x) => ({ p: fsKey(x.file), line: x.line, sev: x.severity === "error" ? "e" : "w", msg: x.message }));
  };
  G.drawProblems = function () {
    if (!root()) return baseDraw();
    p.drawProblems();
  };
  G.drawStack = function () {
    const rows = stack();
    const st = document.getElementById("st-stack");
    if (st) {
      st.textContent = rows ? `▶ ${rows.length} services` : "";
      st.style.display = rows ? "" : "none";
    }
    p.drawServices();
  };
}
