/* ═══════ feature Explain · Code-Review · Under-the-Hood — application ports (ADR-0002, Fase 3) ═══════
   Os casos de uso nesta pasta (`review-engine.ts`) dependem SÓ de `domain/` e das
   interfaces declaradas aqui. Nunca tocam no DOM, em `window`, no Tauri ou no
   legacy-bridge — essas capacidades são fornecidas, no acto da composição
   (`features/codereview.ts`, o resíduo strangler), por adaptadores sobre
   `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe acesso ao
   sistema de ficheiros, aos separadores, ao painel de documento e aos diagnósticos, e os
   comandos (Explain/Review/Under-the-hood) correm
   sem browser. A regra de dependências aponta para dentro: as portas importam
   `domain/`, nunca o contrário. (Verificado por A7/A8 do `arch-check`.)

   O HTML fica TODO do lado da view: o caso de uso `explainCmd` não constrói markup —
   colhe os factos e entrega-os à porta `DocPort`, o painel de documento ao lado do
   código (a resposta já não vai para o chat do Co-Dev). */

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

/** Diagnósticos do editor (os reais do painel Problems, no desktop). */
export interface Diagnostics {
  all(): { p: string; line: number; sev: string; msg: string }[];
}

/** Símbolos do ficheiro e selecção do editor (para o Explain). */
export interface Code {
  symbols(p: string): Array<{ k: string; n: string; line: number }>;
  selText(): string;
  /** a linha (1-based) onde começa a selecção do editor */
  selLine(): number;
}

/* ───────── o painel de documento ao lado do código ─────────
   O Explain e a revisão com IA não respondem no chat: a resposta abre num painel à direita
   do editor (`doc-session.ts`), como documento markdown. O motor entrega os factos; o painel
   (a view, no resíduo) desenha. */

/** Dados do Explain sem modelo (o resumo local), colhidos pelo caso de uso.
 *  `firstComment` é o 1º comentário de topo do ficheiro (ou `null`). */
export interface ExplainCard {
  path: string;
  lineCount: number;
  symbols: { n: string; line?: number }[];
  firstComment: string | null;
  diagnostics: { line: number; msg: string }[];
  findings: { t: string; l: number }[];
}

/** O pedido de Explain que o motor entrega ao painel. */
export interface ExplainStart {
  path: string;
  selection: { text: string; line: number } | null;
  card: ExplainCard;
}

/** O pedido de revisão que o motor entrega ao painel (abre a revisão interactiva). */
export interface ReviewStart {
  path: string;
}

/** O painel de documento (implementado pelo resíduo sobre `doc-session.ts`). */
export interface DocPort {
  explain(req: ExplainStart): void;
  review(req: ReviewStart): void;
}

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface ReviewDeps {
  workspace: Workspace;
  diagnostics: Diagnostics;
  code: Code;
  doc: DocPort;
}

export type { Finding };
