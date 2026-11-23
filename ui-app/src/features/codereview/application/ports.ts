/* ═══════ feature Explain · Code-Review · Under-the-Hood — application ports (ADR-0002, Fase 3) ═══════
   Os casos de uso nesta pasta (`review-engine.ts`) dependem SÓ de `domain/` e das
   interfaces declaradas aqui. Nunca tocam no DOM, em `window`, no Tauri ou no
   legacy-bridge — essas capacidades são fornecidas, no acto da composição
   (`features/codereview.ts`, o resíduo strangler), por adaptadores sobre
   `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe acesso ao
   sistema de ficheiros, aos separadores, ao agente/conversa e aos diagnósticos, e os
   comandos (Explain/Review/Under-the-hood) correm
   sem browser. A regra de dependências aponta para dentro: as portas importam
   `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.)

   O HTML fica TODO do lado da view (o resíduo): o caso de uso `explainCmd` não
   constrói markup — colhe os factos e entrega-os em dados simples à porta de
   apresentação `ExplainView`, que monta e mostra o cartão. */

import type { Finding } from "../domain/types";

/* ───────── formas que atravessam as portas ───────── */

/** Um separador como o monólito o abre/lê (precisa de `.path` além de `.kind`). */
export interface ReviewTab { id?: string; title?: string; kind?: string; path?: string }

/** Uma entrada do sistema de ficheiros virtual (`FS`). */
export interface FileEntry { content: string; orig: string | null }

/* ───────── portas (o que o motor pede ao mundo) ───────── */

/** Sistema de ficheiros virtual + separador activo + abertura de separadores. */
export interface Workspace {
  files(): Record<string, FileEntry>;
  currentTabId(): string | null;
  tabOf(id: string | null): ReviewTab | null;
  short(path: string): string;
  extOf(path: string): string;
  changes(): string[];
  open(tab: ReviewTab & { id: string }): void;
}

/** Agente / conversa / provedor LLM activo. `sample()` é o amostrador do Claude ao
 *  vivo (`null` sem backend ligado); `claudeOn()` é o estado do cartão Claude. */
export interface Agent {
  focus(nofocus?: boolean): void;
  user(msg: string): void;
  liveChat(q: string): void;
  updateUI(): void;
  setActiveProvider(v: string): void;
  sample(): unknown;
  claudeOn(): boolean;
}

/** Diagnósticos do editor (os reais do painel Problems, no desktop). */
export interface Diagnostics {
  all(): { p: string; line: number; sev: string; msg: string }[];
}

/** Símbolos do ficheiro, selecção do editor e sessão de debug (para o Explain). */
export interface Code {
  symbols(p: string): Array<{ k: string; n: string; line: number }>;
  selText(): string;
  dbgState(): { end?: { t: string; b: string }; feed: Array<{ h: string }> } | null;
}

/* ───────── porta de apresentação (a view é dona do HTML) ─────────
   O caso de uso `explainCmd` entrega estes dados simples; a view (resíduo) monta
   o cartão «co-dev · explain» e resolve o conteúdo `KNOW` por caminho. */

/** Dados do cartão de Explain, colhidos pelo caso de uso e formatados pela view.
 *  `dbgEnd` é a conclusão (HTML) da sessão de debug quando `explainCmd(true)` corre
 *  com uma sessão terminada; `null` caso contrário (a view cai para `KNOW`/resumo).
 *  `firstComment` é o 1º comentário de topo do ficheiro (ou `null`). */
export interface ExplainCard {
  path: string;
  dbgEnd: string | null;
  lineCount: number;
  symbols: { n: string }[];
  firstComment: string | null;
  diagnostics: string[];
  findings: { t: string; l: number }[];
}

/** A porta de apresentação do Explain: mostra o cartão a partir de dados simples. */
export interface ExplainView {
  explainCard(card: ExplainCard): void;
}

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface ReviewDeps {
  workspace: Workspace;
  agent: Agent;
  diagnostics: Diagnostics;
  code: Code;
  view: ExplainView;
}

export type { Finding };
