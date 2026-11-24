/* ═════════ feature `arch` — auto-layout por camadas (de cima para baixo) ═════════
   Arruma o desenho como no guia visual: o fluxo principal lê-se de cima para baixo e a
   camada mais baixa (o kernel) fica no fundo.

   Composto e recursivo: cada grupo é arrumado por dentro primeiro e depois entra como uma
   caixa no nível de cima. Em cada nível, as setas sobem até aos itens desse nível (um
   cartão, ou o subgrupo que o contém); quebram-se os ciclos (a seta que fecha o ciclo não
   conta), atribui-se a camada pelo caminho mais longo das setas PRINCIPAIS (as opcionais
   só penduram o que alcançam logo abaixo da origem), ordena-se cada camada pelo
   baricentro das camadas de cima (partindo da ordem actual da esquerda para a direita;
   em empate, o fluxo principal primeiro), parte-se uma camada larga demais em várias
   linhas (grupos perto de quadrados, painéis equilibrados), e cada item puxa-se para
   debaixo dos seus pais sem sobreposições. Os painéis ficam lado a
   lado; o que está fora de painéis vai à direita. PURO: sem DOM, sem window. */

import { ancestry } from "./design";
import { GROUP_PAD, GROUP_PAD_TOP, NODE_W, PANEL_BAR, PANEL_PAD, nodeSize } from "./geometry";
import type { Design } from "./types";

const HGAP = 40, VGAP = 60, PANEL_GAP = 80, ORIGIN = 24, MIN_GROUP_W = 170, MIN_GROUP_H = 70;
/** Uma linha nunca se parte com menos de três cartões; e os grupos preferem ser um pouco
 *  mais largos do que altos. */
const MIN_LINE_W = 3 * NODE_W + 2 * HGAP, ASPECT = 1.6;

interface Item {
  key: string; // "n:<id>" ou "g:<id>"
  w: number;
  h: number;
  /** Posição actual (para partir da ordem que o humano deu). */
  x0: number;
  kernel: boolean;
  /** Posiciona o item com o canto superior esquerdo em (x, y). */
  place(x: number, y: number): void;
}

interface Box {
  w: number;
  h: number;
  place(x: number, y: number): void;
}

/** Arruma um conjunto de itens por camadas. Devolve a caixa do conteúdo. */
/** Uma seta subida a este nível: de, para, e se é do fluxo principal (controlo/dados) ou
 *  opcional (as opcionais não empurram o fluxo principal para baixo). */
type LevelEdge = [string, string, boolean];

/** Arruma um conjunto de itens por camadas. Devolve a caixa do conteúdo. */
function arrange(items: Item[], edges: LevelEdge[]): Box {
  if (!items.length) return { w: 0, h: 0, place: () => {} };
  const keys = items.map((i) => i.key);
  const at = new Map(keys.map((k, i) => [k, i]));
  const out: { j: number; primary: boolean }[][] = items.map(() => []);
  const seen = new Map<string, { j: number; primary: boolean }>();
  for (const [a, b, primary] of edges) {
    const i = at.get(a), j = at.get(b);
    if (i === undefined || j === undefined || i === j) continue;
    const prev = seen.get(`${i}>${j}`);
    if (prev) { prev.primary ||= primary; continue; }
    const e = { j, primary };
    seen.set(`${i}>${j}`, e);
    out[i].push(e);
  }
  // quebra de ciclos: DFS pela ordem actual; uma seta para um nó na pilha é ignorada
  const state = new Uint8Array(items.length); // 0 novo, 1 na pilha, 2 feito
  const dag: { j: number; primary: boolean }[][] = items.map(() => []);
  const order = items.map((_, i) => i).sort((a, b) => items[a].x0 - items[b].x0);
  const visit = (i: number): void => {
    state[i] = 1;
    for (const e of out[i]) {
      if (state[e.j] === 1) continue;
      dag[i].push(e);
      if (state[e.j] === 0) visit(e.j);
    }
    state[i] = 2;
  };
  for (const i of order) if (!state[i]) visit(i);

  // camadas pelo caminho mais longo, só pelas setas principais; o que só se alcança por
  // setas opcionais fica logo abaixo da origem (sem empurrar ninguém); o kernel vai sempre
  // para a última camada
  const layer = new Int32Array(items.length);
  const inPrimary = new Uint8Array(items.length), inOptional = new Uint8Array(items.length);
  const indeg = new Int32Array(items.length);
  for (const es of dag) for (const e of es) { indeg[e.j]++; if (e.primary) inPrimary[e.j] = 1; else inOptional[e.j] = 1; }
  const queue = order.filter((i) => indeg[i] === 0);
  while (queue.length) {
    const i = queue.shift()!;
    for (const e of dag[i]) {
      if (e.primary || !inPrimary[e.j]) layer[e.j] = Math.max(layer[e.j], layer[i] + 1);
      if (--indeg[e.j] === 0) queue.push(e.j);
    }
  }
  const optionalOnly = (i: number): boolean => !inPrimary[i] && !!inOptional[i];
  let last = 0;
  items.forEach((it, i) => { if (!it.kernel) last = Math.max(last, layer[i]); });
  const hasKernel = items.some((it) => it.kernel);
  items.forEach((it, i) => { if (it.kernel) layer[i] = last + 1; });
  const nLayers = Math.max(...layer) + 1;

  // ordem em cada camada: a actual, depois baricentro dos pais (4 passagens); em empate,
  // os filhos do fluxo principal primeiro (ficam debaixo da origem)
  const rows: number[][] = Array.from({ length: nLayers }, () => []);
  for (const i of order) rows[layer[i]].push(i);
  const parents: number[][] = items.map(() => []);
  dag.forEach((es, i) => es.forEach((e) => parents[e.j].push(i)));
  const pos = new Float64Array(items.length);
  const index = (): void => rows.forEach((r) => r.forEach((i, k) => { pos[i] = k; }));
  index();
  for (let pass = 0; pass < 4; pass++) {
    for (let l = 1; l < nLayers; l++) {
      const bary = new Map<number, number>();
      for (const i of rows[l]) {
        const ps = parents[i].filter((p) => layer[p] < l);
        bary.set(i, ps.length ? ps.reduce((s, p) => s + pos[p], 0) / ps.length : pos[i]);
      }
      rows[l].sort((a, b) => bary.get(a)! - bary.get(b)! || Number(optionalOnly(a)) - Number(optionalOnly(b)));
      index();
    }
  }
  // dois itens ligados entre si na mesma camada ficam lado a lado (ex.: o supervisor ao
  // lado do Container que clona), em vez de uma seta a voltar para trás por cima de tudo.
  // Mexe-se o que só tem setas opcionais, e fica logo a seguir ao do fluxo principal (que
  // não sai de debaixo da sua origem)
  for (const r of rows) {
    for (const u of [...r]) {
      for (const e of dag[u]) {
        if (layer[e.j] !== layer[u] || Math.abs(r.indexOf(u) - r.indexOf(e.j)) <= 1) continue;
        const [mover, anchor] = optionalOnly(u) && !optionalOnly(e.j) ? [u, e.j] : [e.j, u];
        r.splice(r.indexOf(mover), 1);
        r.splice(r.indexOf(anchor) + 1, 0, mover);
      }
    }
  }

  // uma camada larga demais parte-se em várias linhas: o grupo fica perto de quadrado, em
  // vez de uma fila sem fim (painéis equilibrados)
  const area = items.reduce((s, it) => s + (it.w + HGAP) * (it.h + VGAP), 0);
  const cap = Math.max(...items.map((it) => it.w), Math.sqrt(area * ASPECT), MIN_LINE_W);
  const lines: { items: number[]; layer: number }[] = [];
  rows.forEach((r, l) => {
    let cur: number[] = [], w = -HGAP;
    for (const i of r) {
      if (cur.length && w + HGAP + items[i].w > cap) { lines.push({ items: cur, layer: l }); cur = []; w = -HGAP; }
      cur.push(i);
      w += HGAP + items[i].w;
    }
    if (cur.length) lines.push({ items: cur, layer: l });
  });

  // coordenadas: cada linha da esquerda para a direita, cada item puxado para debaixo dos
  // pais já colocados
  const x = new Float64Array(items.length), y = new Float64Array(items.length);
  const placed = new Uint8Array(items.length);
  let top = 0, width = 0;
  lines.forEach((line, k) => {
    const rowH = Math.max(0, ...line.items.map((i) => items[i].h));
    let right = -HGAP;
    for (const i of line.items) {
      const ps = parents[i].filter((p) => placed[p]);
      const want = ps.length ? ps.reduce((s, p) => s + x[p] + items[p].w / 2, 0) / ps.length - items[i].w / 2 : right + HGAP;
      x[i] = Math.max(want, right + HGAP);
      y[i] = top;
      right = x[i] + items[i].w;
    }
    for (const i of line.items) placed[i] = 1;
    width = Math.max(width, right);
    const beforeKernel = hasKernel && k + 1 < lines.length && items[lines[k + 1].items[0]].kernel;
    top += rowH + (beforeKernel ? VGAP / 2 : VGAP);
  });
  const minX = Math.min(...items.map((_, i) => x[i]));
  const height = top - VGAP;
  return {
    w: width - minX,
    h: Math.max(0, height),
    place(ox: number, oy: number) {
      items.forEach((it, i) => it.place(ox + x[i] - minX, oy + y[i]));
    },
  };
}

/** Arruma o desenho inteiro e devolve um desenho NOVO (o original não muda). */
export function autoLayout(src: Design): Design {
  const d: Design = JSON.parse(JSON.stringify(src));
  const groupIds = new Set(d.groups.map((g) => g.id));
  const chain = new Map(d.components.map((n) => [n.id, n.group && groupIds.has(n.group) ? ancestry(d, n.group) : []]));
  const done = new Set<string>();

  /** A chave do item, neste nível, que contém o cartão `nodeId` (ou `undefined`). */
  const itemOf = (nodeId: string, nodes: Set<string>, groups: Set<string>): string | undefined => {
    if (nodes.has(nodeId)) return `n:${nodeId}`;
    const g = (chain.get(nodeId) ?? []).find((x) => groups.has(x));
    return g ? `g:${g}` : undefined;
  };

  const level = (nodeIds: string[], groupIdsHere: string[]): Box => {
    const nodes = new Set(nodeIds), groups = new Set(groupIdsHere);
    const items: Item[] = [];
    for (const id of nodeIds) {
      const n = d.components.find((c) => c.id === id)!;
      const s = nodeSize(n);
      items.push({ key: `n:${id}`, w: s.w, h: s.h, x0: n.x, kernel: n.kind === "kernel", place: (x, y) => { n.x = x; n.y = y; } });
    }
    for (const gid of groupIdsHere) {
      const box = groupBox(gid);
      const g = d.groups.find((x) => x.id === gid)!;
      items.push({ key: `g:${gid}`, w: box.w, h: box.h, x0: g.x, kernel: false, place: box.place });
    }
    const edges: LevelEdge[] = [];
    for (const c of d.connections) {
      const a = itemOf(c.from, nodes, groups), b = itemOf(c.to, nodes, groups);
      if (a && b && a !== b) edges.push([a, b, c.style !== "optional"]);
    }
    return arrange(items, edges);
  };

  /** A caixa de um grupo: o seu conteúdo arrumado, com as folgas (o topo tem a pílula). */
  function groupBox(gid: string): Box {
    done.add(gid);
    const g = d.groups.find((x) => x.id === gid)!;
    const childNodes = d.components.filter((n) => n.group === gid).map((n) => n.id);
    const childGroups = d.groups.filter((x) => x.parent === gid && !done.has(x.id)).map((x) => x.id);
    const inner = level(childNodes, childGroups);
    const w = Math.max(MIN_GROUP_W, inner.w + 2 * GROUP_PAD), h = Math.max(MIN_GROUP_H, inner.h + GROUP_PAD_TOP + GROUP_PAD);
    return {
      w, h,
      place(x, y) {
        g.x = x; g.y = y; g.w = w; g.h = h;
        inner.place(x + (w - inner.w) / 2, y + GROUP_PAD_TOP);
      },
    };
  }

  // painéis lado a lado
  let x = ORIGIN;
  const inView = new Set<string>();
  for (const v of d.views) {
    const roots = v.roots.filter((r) => groupIds.has(r) && !done.has(r));
    roots.forEach((r) => inView.add(r));
    const box = level([], roots);
    if (!roots.length) continue;
    box.place(x + PANEL_PAD, ORIGIN + PANEL_BAR + PANEL_PAD);
    x += box.w + 2 * PANEL_PAD + PANEL_GAP;
  }
  // o resto: grupos raiz (ou cujo pai não existe), cartões soltos, e o que um ciclo deixou de fora
  const looseGroups = d.groups.filter((g) => !done.has(g.id) && (!g.parent || !groupIds.has(g.parent))).map((g) => g.id);
  const looseNodes = d.components.filter((n) => !n.group || !groupIds.has(n.group)).map((n) => n.id);
  const box = level(looseNodes, looseGroups);
  box.place(x, ORIGIN + (d.views.length ? PANEL_BAR + PANEL_PAD : 0));
  const left = d.groups.filter((g) => !done.has(g.id)).map((g) => g.id);
  if (left.length) {
    const rest = level([], left);
    rest.place(x + box.w + PANEL_GAP, ORIGIN);
  }
  return d;
}
