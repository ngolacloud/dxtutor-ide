/* ═════════ feature `arch` — geometria do canvas ═════════
   O tamanho de cada cartão (ícone + nome + mini-bloco de código), os rectângulos dos grupos
   (o guardado, crescido para conter o que lá está dentro), os painéis (à volta dos grupos
   raiz, com barra de título), o alvo de uma largada (o grupo mais fundo debaixo do ponto)
   e o sítio livre para um elemento novo. PURO: sem DOM, sem window. */

import { ancestry, depth, findGroup, isPanelBody, viewOfGroup } from "./design";
import type { Design, DesignNode, Rect } from "./types";

export const NODE_W = 150;
export const KERNEL_H = 40;
/** Folga interior de um grupo; o topo tem mais por causa da etiqueta-pílula. */
export const GROUP_PAD = 16;
export const GROUP_PAD_TOP = 26;
export const PANEL_PAD = 16;
export const PANEL_BAR = 30;
export const MIN_W = 760, MIN_H = 440;

/* 150 px: o nome a 12 px leva ~19 caracteres; o código (mono 9,5 px) ~22 */
const NAME_CHARS = 19, NAME_LINES = 3, CODE_CHARS = 22, CODE_LINES = 4;

const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** As linhas do nome de um cartão: quebra nas mudanças de linha e nos espaços, no máximo 3. */
export function nameLines(name: string): string[] {
  const out: string[] = [];
  for (const para of name.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + " " + word).length <= NAME_CHARS) line += " " + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  const lines = out.filter((l, i) => l || i === 0).map((l) => clip(l, NAME_CHARS));
  if (lines.length > NAME_LINES) return [...lines.slice(0, NAME_LINES - 1), clip(lines[NAME_LINES - 1] + " …", NAME_CHARS)];
  return lines.length ? lines : [""];
}

/** As linhas do mini-bloco de código (no máximo 4, cada uma cortada). */
export function codeLines(code: string | undefined): string[] {
  if (!code || !code.trim()) return [];
  const lines = code.replace(/\s+$/, "").split("\n").map((l) => clip(l, CODE_CHARS));
  return lines.length > CODE_LINES ? [...lines.slice(0, CODE_LINES - 1), "…"] : lines;
}

/** Medidas internas de um cartão normal (usadas também pela vista). */
export const CARD = { padTop: 10, icon: 22, gap: 6, line: 14, codePad: 6, codeLine: 12, padBottom: 10 } as const;

export function nodeSize(n: DesignNode): { w: number; h: number } {
  if (n.kind === "kernel") return { w: NODE_W, h: KERNEL_H };
  const code = codeLines(n.code).length;
  const h = CARD.padTop + CARD.icon + CARD.gap + nameLines(n.name).length * CARD.line +
    (code ? CARD.codePad + code * CARD.codeLine + CARD.codePad + 4 : 0) + CARD.padBottom;
  return { w: NODE_W, h };
}

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export const contains = (r: Rect, p: { x: number; y: number }): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export const center = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export interface Layout {
  nodes: Map<string, Rect>;
  groups: Map<string, Rect>;
  panels: Map<string, Rect>;
  /** Tudo o que está desenhado (para o viewBox). */
  bounds: Rect;
}

/** Os rectângulos desenhados. Um grupo cresce para conter os seus nós e os grupos filhos
 *  (dos mais fundos para cima); um nó `kernel` estica-se à largura interior do seu grupo
 *  (a faixa de base); um painel envolve os seus grupos raiz e ganha a barra de título. */
export function layout(d: Design, opts: { excludeRoot?: string } = {}): Layout {
  const nodes = new Map<string, Rect>();
  for (const n of d.components) nodes.set(n.id, { x: n.x, y: n.y, ...nodeSize(n) });

  const groups = new Map<string, Rect>();
  const order = [...d.groups].sort((a, b) => depth(d, b.id) - depth(d, a.id));
  for (const g of order) {
    let r: Rect = { x: g.x, y: g.y, w: g.w, h: g.h };
    const pad = (c: Rect): Rect => ({ x: c.x - GROUP_PAD, y: c.y - GROUP_PAD_TOP, w: c.w + 2 * GROUP_PAD, h: c.h + GROUP_PAD_TOP + GROUP_PAD });
    for (const n of d.components) if (n.group === g.id) r = union(r, pad(nodes.get(n.id)!));
    for (const c of d.groups) if (c.parent === g.id && c.id !== g.id && groups.has(c.id)) r = union(r, pad(groups.get(c.id)!));
    groups.set(g.id, r);
  }
  for (const n of d.components) {
    if (n.kind !== "kernel" || !n.group || !groups.has(n.group)) continue;
    const g = groups.get(n.group)!, r = nodes.get(n.id)!;
    nodes.set(n.id, { x: g.x + GROUP_PAD, y: r.y, w: g.w - 2 * GROUP_PAD, h: r.h });
  }

  const panels = new Map<string, Rect>();
  for (const v of d.views) {
    let r: Rect | null = null;
    for (const root of v.roots) {
      if (root === opts.excludeRoot) continue;
      const g = groups.get(root);
      if (g) r = r ? union(r, g) : g;
    }
    if (r) panels.set(v.id, { x: r.x - PANEL_PAD, y: r.y - PANEL_PAD - PANEL_BAR, w: r.w + 2 * PANEL_PAD, h: r.h + 2 * PANEL_PAD + PANEL_BAR });
  }

  let bounds: Rect = { x: 0, y: 0, w: MIN_W, h: MIN_H };
  for (const m of [nodes, groups, panels]) for (const r of m.values()) bounds = union(bounds, { x: r.x - 20, y: r.y - 20, w: r.w + 40, h: r.h + 40 });
  return { nodes, groups, panels, bounds };
}

/** O grupo mais fundo cujo rectângulo contém o ponto, fora dos excluídos. */
export function groupAt(d: Design, l: Layout, p: { x: number; y: number }, exclude: Set<string> = new Set()): string | undefined {
  let best: string | undefined, bestDepth = -1;
  for (const g of d.groups) {
    if (exclude.has(g.id)) continue;
    const r = l.groups.get(g.id);
    if (!r || !contains(r, p)) continue;
    const k = depth(d, g.id);
    if (k > bestDepth) { best = g.id; bestDepth = k; }
  }
  return best;
}

/** O painel cujo rectângulo contém o ponto. */
export function panelAt(l: Layout, p: { x: number; y: number }): string | undefined {
  for (const [id, r] of l.panels) if (contains(r, p)) return id;
  return undefined;
}

/** A cor do painel de um grupo (ou `undefined` fora de painéis). */
export const groupColor = (d: Design, id: string): string | undefined => viewOfGroup(d, id)?.color;

/** Um sítio livre para um cartão: dentro do grupo dado (a seguir ao que lá está), ou na
 *  primeira célula livre de uma grelha sobre o canvas. */
export function freeSpot(d: Design, l: Layout, group?: string): { x: number; y: number } {
  const taken = [...l.nodes.values(), ...(group ? [] : [...l.groups.values(), ...l.panels.values()])];
  const g = group ? findGroup(d, group) : undefined;
  if (g) {
    const r = l.groups.get(g.id)!;
    const x0 = r.x + GROUP_PAD, y0 = r.y + GROUP_PAD_TOP;
    for (let y = y0; y < y0 + 2000; y += 30) {
      for (let x = x0; x + NODE_W <= Math.max(r.x + r.w - GROUP_PAD, x0 + NODE_W); x += NODE_W + 24) {
        const cand: Rect = { x, y, w: NODE_W, h: 90 };
        if (!taken.some((t) => intersects(t, { x: cand.x - 8, y: cand.y - 8, w: cand.w + 16, h: cand.h + 16 }))) return { x, y };
      }
    }
    return { x: x0, y: r.y + r.h };
  }
  for (let y = 24; y < 4000; y += 30) {
    for (let x = 24; x + NODE_W <= MIN_W - 24; x += NODE_W + 40) {
      const cand: Rect = { x, y, w: NODE_W, h: 90 };
      if (!taken.some((t) => intersects(t, { x: cand.x - 12, y: cand.y - 12, w: cand.w + 24, h: cand.h + 24 }))) return { x, y };
    }
  }
  return { x: 24, y: l.bounds.y + l.bounds.h };
}

/** Um sítio livre para um grupo novo de `w`×`h`: dentro do pai, ou à direita do que existe. */
export function freeGroupSpot(l: Layout, w: number, h: number, parent?: string): Rect {
  if (parent && l.groups.has(parent)) {
    const r = l.groups.get(parent)!;
    return { x: r.x + GROUP_PAD, y: r.y + r.h - GROUP_PAD + 8, w, h };
  }
  let right = 24 - 40;
  for (const m of [l.nodes, l.groups, l.panels]) for (const r of m.values()) right = Math.max(right, r.x + r.w);
  return { x: right + 40 + PANEL_PAD, y: 24 + PANEL_BAR + PANEL_PAD, w, h };
}

/** A cadeia de grupos de um nó (o seu grupo e os de cima). */
export const nodeChain = (d: Design, n: DesignNode): string[] => (n.group ? ancestry(d, n.group) : []);

/** O ponto da borda de `r` na direcção de `toward` (a partir do centro). */
export function borderPoint(r: Rect, toward: { x: number; y: number }): { x: number; y: number } {
  const c = center(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const k = Math.min(dx ? (r.w / 2) / Math.abs(dx) : Infinity, dy ? (r.h / 2) / Math.abs(dy) : Infinity);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/** A etiqueta-pílula de um grupo: centrada sobre a linha de topo do rectângulo desenhado. */
export function pillRect(label: string, r: Rect): Rect {
  const w = Math.max(44, label.length * 10.5 * 0.6 + 22);
  return { x: r.x + r.w / 2 - w / 2, y: r.y - 10, w, h: 20 };
}

/** As pílulas desenhadas (os corpos de painel não têm). */
export const groupPills = (d: Design, l: Layout): Rect[] =>
  d.groups.filter((g) => !isPanelBody(d, g) && l.groups.has(g.id)).map((g) => pillRect(g.label, l.groups.get(g.id)!));
