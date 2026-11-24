/* ═════════ feature `arch` — encaminhamento das setas e colocação dos rótulos ═════════
   Regra do guia visual: uma seta nunca atravessa um cartão que não é a sua origem ou o seu
   destino, e o rótulo fica em espaço livre, nunca em cima de uma linha.

   · Linha recta quando não toca em nenhum outro cartão.
   · Caso contrário, um caminho ortogonal numa grelha esparsa feita das bordas dos cartões
     (alargadas por uma folga) e dos seus centros: Dijkstra com custo = comprimento + uma
     penalização por cada curva + uma pequena penalização por reutilizar um troço já usado
     por outra seta. Sai e entra pelo meio de um lado do cartão (perpendicular à borda), por
     isso o resultado é um L ou um Z sempre que existe um.
   · Rótulos: candidatos ao lado dos troços mais compridos; escolhe-se o primeiro que não
     toca em cartões, linhas ou outros rótulos (ou o que toca em menos).
   PURO: sem DOM, sem window. */

import type { Rect } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Route {
  /** Polilinha da borda da origem à borda do destino. */
  points: Point[];
  /** `true` se é a linha recta (sem obstáculos). */
  straight: boolean;
}

export interface EdgeEnds {
  /** Setas da mesma origem com o mesmo estilo partilham o tronco (feixe). */
  style?: string;
  from: string;
  to: string;
}

/** Folga entre uma seta e um cartão. */
export const CLEARANCE = 10;
const BEND = 40;
const REUSE = 0.6;
/** Um troço já usado por uma seta do mesmo feixe (mesma origem, mesmo estilo) custa menos:
 *  as setas saem juntas e separam-se perto do destino, em vez de correrem em paralelo. */
const BUNDLE = 0.5;
/** Atravessar outra seta (de outro feixe) na perpendicular. */
const CROSS = 30;
const FACE_AWAY = 30;

const EPS = 1e-6;

/** O segmento atravessa o INTERIOR do rectângulo (tocar na borda não conta). */
export function segmentHitsRect(a: Point, b: Point, r: Rect): boolean {
  const x0 = r.x + EPS,
    y0 = r.y + EPS,
    x1 = r.x + r.w - EPS,
    y1 = r.y + r.h - EPS;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  if (!clip(-dx, a.x - x0) || !clip(dx, x1 - a.x) || !clip(-dy, a.y - y0) || !clip(dy, y1 - a.y))
    return false;
  return t1 - t0 > EPS;
}

const grow = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
const mid = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** O ponto da borda de `r` na direcção de `toward`. */
function border(r: Rect, toward: Point): Point {
  const c = mid(r);
  const dx = toward.x - c.x,
    dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const k = Math.min(dx ? r.w / 2 / Math.abs(dx) : Infinity, dy ? r.h / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * k, y: c.y + dy * k };
}

type Side = "top" | "bottom" | "left" | "right";
const SIDES: Side[] = ["top", "bottom", "left", "right"];

/** O meio de um lado (na borda) e o ponto de saída (à folga, fora do cartão). */
/** Onde uma seta pode sair/entrar num lado: o meio, ou a ¼ e ¾ (para passar ao lado de
 *  uma etiqueta-pílula ou de outra seta sem dar a volta). */
const OFFSETS = [0, -0.25, 0.25] as const;
const OFF_CENTER = 12;

/** Um ponto de um lado (na borda) e o ponto de saída (à folga, fora do cartão). */
function port(r: Rect, s: Side, m: number, f = 0): { at: Point; out: Point; axis: 0 | 1 } {
  const c = mid(r);
  const x = c.x + f * r.w, y = c.y + f * r.h;
  switch (s) {
    case "top":
      return { at: { x, y: r.y }, out: { x, y: r.y - m }, axis: 1 };
    case "bottom":
      return { at: { x, y: r.y + r.h }, out: { x, y: r.y + r.h + m }, axis: 1 };
    case "left":
      return { at: { x: r.x, y }, out: { x: r.x - m, y }, axis: 0 };
    default:
      return { at: { x: r.x + r.w, y }, out: { x: r.x + r.w + m, y }, axis: 0 };
  }
}

/** Um lado «vira as costas» ao outro cartão (sair por cima quando o destino está em baixo). */
function facesAway(r: Rect, s: Side, other: Rect): boolean {
  const c = mid(r),
    o = mid(other);
  if (s === "top") return o.y > c.y + r.h / 2;
  if (s === "bottom") return o.y < c.y - r.h / 2;
  if (s === "left") return o.x > c.x + r.w / 2;
  return o.x < c.x - r.w / 2;
}

/** Tira pontos colineares e repetidos. */
function simplify(p: Point[]): Point[] {
  const out: Point[] = [];
  for (const q of p) {
    if (
      out.length &&
      Math.abs(out[out.length - 1].x - q.x) < EPS &&
      Math.abs(out[out.length - 1].y - q.y) < EPS
    )
      continue;
    while (out.length >= 2) {
      const a = out[out.length - 2],
        b = out[out.length - 1];
      const collinear =
        (Math.abs(a.x - b.x) < EPS && Math.abs(b.x - q.x) < EPS) ||
        (Math.abs(a.y - b.y) < EPS && Math.abs(b.y - q.y) < EPS);
      if (!collinear) break;
      out.pop();
    }
    out.push(q);
  }
  return out;
}

/** Fila de prioridade mínima (heap binário). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size(): number {
    return this.k.length;
  }
  push(key: number, val: number): void {
    const k = this.k,
      v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k,
      v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!,
      lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/** A grelha esparsa partilhada por todas as setas de um desenho. */
class Grid {
  xs: number[];
  ys: number[];
  /** Ponto (i,j) livre? */
  free: Uint8Array;
  /** Troço (i,j)→(i+1,j) livre? / (i,j)→(i,j+1) livre? */
  hFree: Uint8Array;
  vFree: Uint8Array;
  /** Que feixes usam cada troço, e que feixes passam em cada ponto na horizontal/vertical. */
  used = new Map<number, Set<string>>();
  hUse = new Map<number, Set<string>>();
  vUse = new Map<number, Set<string>>();

  constructor(cards: Rect[], m: number) {
    const xs = new Set<number>(),
      ys = new Set<number>();
    for (const r of cards) {
      const c = mid(r);
      xs.add(r.x + r.w * 0.25);
      xs.add(r.x + r.w * 0.75);
      ys.add(r.y + r.h * 0.25);
      ys.add(r.y + r.h * 0.75);
      xs.add(r.x - m);
      xs.add(r.x + r.w + m);
      xs.add(c.x);
      ys.add(r.y - m);
      ys.add(r.y + r.h + m);
      ys.add(c.y);
    }
    this.xs = [...xs].sort((a, b) => a - b);
    this.ys = [...ys].sort((a, b) => a - b);
    const nx = this.xs.length,
      ny = this.ys.length;
    const block = cards.map((r) => grow(r, m - 1));
    this.free = new Uint8Array(nx * ny);
    this.hFree = new Uint8Array(nx * ny);
    this.vFree = new Uint8Array(nx * ny);
    const inside = (p: Point): boolean =>
      block.some((b) => p.x > b.x && p.x < b.x + b.w && p.y > b.y && p.y < b.y + b.h);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        this.free[this.id(i, j)] = inside({ x: this.xs[i], y: this.ys[j] }) ? 0 : 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = { x: this.xs[i], y: this.ys[j] };
        if (i + 1 < nx) {
          const b = { x: this.xs[i + 1], y: this.ys[j] };
          this.hFree[this.id(i, j)] = block.some((r) => segmentHitsRect(a, b, r)) ? 0 : 1;
        }
        if (j + 1 < ny) {
          const b = { x: this.xs[i], y: this.ys[j + 1] };
          this.vFree[this.id(i, j)] = block.some((r) => segmentHitsRect(a, b, r)) ? 0 : 1;
        }
      }
    }
  }

  id(i: number, j: number): number {
    return j * this.xs.length + i;
  }

  index(p: Point): number {
    const i = this.xs.findIndex((x) => Math.abs(x - p.x) < EPS),
      j = this.ys.findIndex((y) => Math.abs(y - p.y) < EPS);
    return i < 0 || j < 0 ? -1 : this.id(i, j);
  }

  /** Dijkstra de qualquer porta de saída a qualquer porta de entrada. Estado = (ponto, eixo). */
  search(
    starts: { id: number; axis: 0 | 1; cost: number }[],
    ends: Map<number, { axis: 0 | 1; cost: number }>,
    key = "",
  ): number[] | null {
    const others = (set: Set<string> | undefined): number => (set ? set.size - (set.has(key) ? 1 : 0) : 0);
    const nx = this.xs.length,
      n = this.free.length;
    const dist = new Float64Array(2 * n).fill(Infinity),
      prev = new Int32Array(2 * n).fill(-1);
    const heap = new Heap();
    for (const s of starts) {
      const st = s.id * 2 + s.axis;
      if (s.cost < dist[st]) {
        dist[st] = s.cost;
        heap.push(s.cost, st);
      }
    }
    let best = Infinity,
      bestState = -1;
    while (heap.size) {
      const [d, st] = heap.pop();
      if (d > dist[st] || d >= best) continue;
      const id = st >> 1,
        axis = (st & 1) as 0 | 1;
      const end = ends.get(id);
      if (end) {
        const total = d + end.cost + (axis !== end.axis ? BEND : 0);
        if (total < best) {
          best = total;
          bestState = st;
        }
      }
      const i = id % nx,
        j = (id / nx) | 0;
      const step = (nid: number, nAxis: 0 | 1, len: number, seg: number): void => {
        if (!this.free[nid]) return;
        const users = this.used.get(seg);
        const mine = users?.has(key) ? BUNDLE : 1;
        const crossing = others(nAxis === 1 ? this.hUse.get(nid) : this.vUse.get(nid)) ? CROSS : 0;
        const cost = d + len * mine + (nAxis !== axis ? BEND : 0) + others(users) * len * REUSE + crossing;
        const ns = nid * 2 + nAxis;
        if (cost < dist[ns]) {
          dist[ns] = cost;
          prev[ns] = st;
          heap.push(cost, ns);
        }
      };
      if (i + 1 < nx && this.hFree[id]) step(this.id(i + 1, j), 0, this.xs[i + 1] - this.xs[i], id * 2);
      if (i > 0 && this.hFree[this.id(i - 1, j)])
        step(this.id(i - 1, j), 0, this.xs[i] - this.xs[i - 1], this.id(i - 1, j) * 2);
      if (j + 1 < this.ys.length && this.vFree[id])
        step(this.id(i, j + 1), 1, this.ys[j + 1] - this.ys[j], id * 2 + 1);
      if (j > 0 && this.vFree[this.id(i, j - 1)])
        step(this.id(i, j - 1), 1, this.ys[j] - this.ys[j - 1], this.id(i, j - 1) * 2 + 1);
    }
    if (bestState < 0) return null;
    const path: number[] = [];
    for (let s = bestState; s >= 0; s = prev[s]) path.push(s >> 1);
    path.reverse();
    // marca os troços e os pontos usados por este feixe (as setas seguintes evitam
    // sobrepor-se e cruzá-lo; as do mesmo feixe juntam-se a ele)
    const mark = (m: Map<number, Set<string>>, k: number): void => {
      const set = m.get(k) ?? new Set<string>();
      set.add(key);
      m.set(k, set);
    };
    for (let k = 0; k + 1 < path.length; k++) {
      const a = path[k],
        b = path[k + 1];
      const horizontal = Math.abs(a - b) === 1;
      mark(this.used, horizontal ? Math.min(a, b) * 2 : Math.min(a, b) * 2 + 1);
      mark(horizontal ? this.hUse : this.vUse, a);
      mark(horizontal ? this.hUse : this.vUse, b);
    }
    return path;
  }

  point(id: number): Point {
    const nx = this.xs.length;
    return { x: this.xs[id % nx], y: this.ys[(id / nx) | 0] };
  }
}

/** Encaminha todas as setas. `extra` são obstáculos que não são pontas de setas (as
 *  etiquetas-pílula dos grupos: um rótulo nunca fica debaixo de uma linha). */
export function routeAll(cards: Map<string, Rect>, edges: EdgeEnds[], extra: Rect[] = [], m = CLEARANCE): Route[] {
  const all = [...cards.values(), ...extra];
  let grid: Grid | null = null;
  return edges.map((e) => {
    const A = cards.get(e.from),
      B = cards.get(e.to);
    if (!A || !B) return { points: [], straight: true };
    const a = border(A, mid(B)),
      b = border(B, mid(A));
    const others = all.filter((r) => r !== A && r !== B);
    if (!others.some((r) => segmentHitsRect(a, b, grow(r, 4)))) return { points: [a, b], straight: true };
    grid ??= new Grid(all, m);
    const starts: { id: number; axis: 0 | 1; cost: number; p: { at: Point; out: Point } }[] = [];
    const ends = new Map<number, { axis: 0 | 1; cost: number }>();
    const endPorts = new Map<number, { at: Point; out: Point }>();
    for (const s of SIDES) {
      for (const f of OFFSETS) {
        const pa = port(A, s, m, f), ia = grid.index(pa.out);
        if (ia >= 0) starts.push({ id: ia, axis: pa.axis, cost: (facesAway(A, s, B) ? FACE_AWAY : 0) + (f ? OFF_CENTER : 0), p: pa });
        const pb = port(B, s, m, f), ib = grid.index(pb.out);
        if (ib >= 0 && !ends.has(ib)) {
          ends.set(ib, { axis: pb.axis, cost: (facesAway(B, s, A) ? FACE_AWAY : 0) + (f ? OFF_CENTER : 0) });
          endPorts.set(ib, pb);
        }
      }
    }
    const path = grid.search(starts, ends, `${e.from}|${e.style ?? ""}`);
    if (!path) return { points: [a, b], straight: true };
    const first = starts.find((s) => s.id === path[0])!.p,
      last = endPorts.get(path[path.length - 1])!;
    return { points: simplify([first.at, ...path.map((id) => grid!.point(id)), last.at]), straight: false };
  });
}

/** Rectas de borda a borda, sem encaminhar (para redesenhar a meio de um arrasto). */
export function straightRoutes(cards: Map<string, Rect>, edges: EdgeEnds[]): Route[] {
  return edges.map((e) => {
    const A = cards.get(e.from), B = cards.get(e.to);
    return A && B ? { points: [border(A, mid(B)), border(B, mid(A))], straight: true } : { points: [], straight: true };
  });
}

/** Quantos cruzamentos de setas se VÊEM: pontos distintos onde troços de setas diferentes
 *  se atravessam no interior (um feixe que passa junto por uma linha é um cruzamento só;
 *  troços sobrepostos e pontas partilhadas não contam). */
export function lineCrossings(routes: Route[]): number {
  const cross = (o: number): number => (o > EPS ? 1 : o < -EPS ? -1 : 0);
  const orient = (a: Point, b: Point, c: Point): number => cross((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const segs = routes.map((r) => r.points.slice(1).map((p, k) => [r.points[k], p] as const));
  const points = new Set<string>();
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      for (const [a, b] of segs[i])
        for (const [c, d] of segs[j]) {
          const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
          if (!(o1 && o2 && o3 && o4 && o1 !== o2 && o3 !== o4)) continue;
          // o ponto de cruzamento (arredondado): o mesmo ponto conta uma vez
          const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
          const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
          points.add(`${Math.round(a.x + t * (b.x - a.x))},${Math.round(a.y + t * (b.y - a.y))}`);
        }
  return points.size;
}

/** As setas que atravessam um cartão que não é o seu (deve ser vazio). */
export function crossings(
  cards: Map<string, Rect>,
  edges: EdgeEnds[],
  routes: Route[],
): { edge: number; card: string }[] {
  const out: { edge: number; card: string }[] = [];
  routes.forEach((r, i) => {
    for (const [id, rect] of cards) {
      if (id === edges[i].from || id === edges[i].to) continue;
      for (let k = 0; k + 1 < r.points.length; k++) {
        if (segmentHitsRect(r.points[k], r.points[k + 1], rect)) {
          out.push({ edge: i, card: id });
          break;
        }
      }
    }
  });
  return out;
}

// ───── rótulos ─────

export const LABEL_PX = 9.5;
export const labelSize = (text: string): { w: number; h: number } => ({
  w: text.length * LABEL_PX * 0.6 + 6,
  h: 13,
});

/** Dois troços sobrepostos (colineares, com um pedaço em comum): o tronco de um feixe. */
function overlaps(a: Point, b: Point, c: Point, d: Point): boolean {
  const vert = (p: Point, q: Point) => Math.abs(p.x - q.x) < EPS;
  const horiz = (p: Point, q: Point) => Math.abs(p.y - q.y) < EPS;
  const span = (u0: number, u1: number, v0: number, v1: number) =>
    Math.min(Math.max(u0, u1), Math.max(v0, v1)) - Math.max(Math.min(u0, u1), Math.min(v0, v1)) > 1;
  if (vert(a, b) && vert(c, d) && Math.abs(a.x - c.x) < EPS) return span(a.y, b.y, c.y, d.y);
  if (horiz(a, b) && horiz(c, d) && Math.abs(a.y - c.y) < EPS) return span(a.x, b.x, c.x, d.x);
  return false;
}

/** O rectângulo de um rótulo centrado em `c`. */
export const labelRect = (text: string, c: Point): Rect => {
  const s = labelSize(text);
  return { x: c.x - s.w / 2, y: c.y - s.h / 2, w: s.w, h: s.h };
};

const insideRect = (a: Rect, b: Rect): boolean =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

const rectsOverlap = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Coloca os rótulos (centro de cada um) em espaço livre. `null` para setas sem rótulo. */
/** `frames`: os rectângulos dos painéis e dos grupos — um rótulo que fica a meio de uma
 *  borda (metade dentro, metade fora) perde para um que fica todo de um lado. */
export function placeLabels(cards: Rect[], routes: Route[], labels: (string | null)[], frames: Rect[] = []): (Point | null)[] {
  const placed: Rect[] = [];
  const segs: [Point, Point][] = [];
  for (const r of routes)
    for (let k = 0; k + 1 < r.points.length; k++) segs.push([r.points[k], r.points[k + 1]]);
  return routes.map((r, i) => {
    const text = labels[i];
    if (!text || r.points.length < 2) return null;
    const { w, h } = labelSize(text);
    // troços partilhados com outra seta (um feixe): o rótulo prefere o troço que é só seu,
    // perto do destino, para se saber a que seta pertence
    const shared = (a: Point, b: Point): boolean =>
      routes.some((o, k) => k !== i && o.points.slice(1).some((q, m) => overlaps(a, b, o.points[m], q)));
    const pieces = r.points
      .slice(0, -1)
      .map((p, k) => ({
        a: p,
        b: r.points[k + 1],
        len: Math.hypot(r.points[k + 1].x - p.x, r.points[k + 1].y - p.y),
        own: !shared(p, r.points[k + 1]),
      }))
      .sort((p, q) => Number(q.own) - Number(p.own) || q.len - p.len);
    let best: Point | null = null,
      bestScore = Infinity;
    // primeiro encostado à linha; se não há espaço (ex.: dois cartões a 40 px), cada vez
    // mais afastado na perpendicular, até sair da faixa dos cartões
    for (const extra of [0, 18, 36, 54]) {
      for (const { a, b, len } of pieces) {
        if (len < 1) continue;
        const ux = (b.x - a.x) / len,
          uy = (b.y - a.y) / len,
          nx = -uy,
          ny = ux;
        // distância à linha: metade da caixa na direcção da normal + 5 px
        const off = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + 5 + extra;
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          for (const side of [1, -1]) {
            const c = {
              x: a.x + (b.x - a.x) * t + nx * off * side,
              y: a.y + (b.y - a.y) * t + ny * off * side,
            };
            const box = labelRect(text, c);
            const pad = { x: box.x - 2, y: box.y - 2, w: box.w + 4, h: box.h + 4 };
            let score = 0;
            for (const card of cards) if (rectsOverlap(pad, card)) score += 100;
            for (const s of segs) if (segmentHitsRect(s[0], s[1], pad)) score += 10;
            for (const p of placed) if (rectsOverlap(pad, p)) score += 50;
            for (const f of frames) if (rectsOverlap(pad, f) && !insideRect(pad, f)) score += 20;
            if (score < bestScore) {
              bestScore = score;
              best = c;
            }
            if (score === 0) break;
          }
          if (bestScore === 0) break;
        }
        if (bestScore === 0) break;
      }
      if (bestScore === 0) break;
    }
    if (best) placed.push(labelRect(text, best));
    return best;
  });
}
