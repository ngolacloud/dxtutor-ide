// Studio de arquitectura (F4): encaminhamento das setas (nunca atravessam cartões),
// rótulos em espaço livre e auto-layout por camadas — sobre o desenho de referência
// «Docker vs Kubernetes» e sobre um desenho do tamanho do diagrama de crates do Delonix.
import { describe, test, expect } from "vitest";
import { addComponent, addGroup, connect, emptyDesign } from "../src/features/arch/domain/design";
import { groupPills, intersects, layout } from "../src/features/arch/domain/geometry";
import { autoLayout } from "../src/features/arch/domain/autolayout";
import { crossings, labelRect, placeLabels, routeAll, segmentHitsRect, type Route } from "../src/features/arch/domain/routing";
import type { Design, Rect } from "../src/features/arch/domain/types";
import { edgeLook } from "../src/features/arch/ui/view";
import { makeArchStudio } from "../src/features/arch/application/studio";
import { reference } from "./fixtures/arch-reference";

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

const card = (x: number, y: number): Rect => ({ x, y, w: 150, h: 60 });

/** Encaminha um desenho como o canvas o faz e devolve tudo o que é preciso verificar. */
function routed(d: Design) {
  const l = layout(d);
  const pills = groupPills(d, l);
  const routes = routeAll(l.nodes, d.connections, pills);
  const labels = placeLabels([...l.nodes.values(), ...pills], routes, d.connections.map((c) => edgeLook(d, c).label || null));
  return { l, routes, labels, pills };
}

/** Cada troço de uma rota ortogonal é horizontal ou vertical. */
const orthogonal = (r: Route): boolean =>
  r.points.slice(1).every((p, k) => p.x === r.points[k].x || p.y === r.points[k].y);

describe("encaminhamento", () => {
  test("tocar na borda não é atravessar; passar por dentro é", () => {
    const r = card(0, 0);
    expect(segmentHitsRect({ x: -10, y: 0 }, { x: 200, y: 0 }, r)).toBe(false);
    expect(segmentHitsRect({ x: -10, y: 30 }, { x: 200, y: 30 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 75, y: -50 }, { x: 75, y: 5 }, r)).toBe(true);
    expect(segmentHitsRect({ x: 300, y: 300 }, { x: 400, y: 400 }, r)).toBe(false);
  });

  test("linha recta quando não há nada no caminho", () => {
    const cards = new Map([["a", card(0, 0)], ["b", card(0, 200)]]);
    const [r] = routeAll(cards, [{ from: "a", to: "b" }]);
    expect(r.straight).toBe(true);
    expect(r.points).toEqual([{ x: 75, y: 60 }, { x: 75, y: 200 }]);
  });

  test("um cartão no meio: a seta contorna-o em L/Z, sai e entra pelo meio de um lado", () => {
    const cards = new Map([["a", card(0, 0)], ["c", card(0, 160)], ["b", card(0, 320)]]);
    const edges = [{ from: "a", to: "b" }];
    const routes = routeAll(cards, edges);
    expect(routes[0].straight).toBe(false);
    expect(orthogonal(routes[0])).toBe(true);
    expect(crossings(cards, edges, routes)).toEqual([]);
    const first = routes[0].points[0], last = routes[0].points.at(-1)!;
    // sai e entra na borda (a meio de um lado, ou a ¼/¾), perpendicular a ela
    const onBorder = (p: { x: number; y: number }, r: Rect) =>
      ((p.x === r.x || p.x === r.x + r.w) && p.y > r.y && p.y < r.y + r.h) || ((p.y === r.y || p.y === r.y + r.h) && p.x > r.x && p.x < r.x + r.w);
    expect(onBorder(first, card(0, 0))).toBe(true);
    expect(onBorder(last, card(0, 320))).toBe(true);
    expect(routes[0].points.length).toBeLessThanOrEqual(6); // no máximo 3 curvas
  });

  test("crossings acusa uma linha recta por cima de um cartão", () => {
    const cards = new Map([["a", card(0, 0)], ["c", card(0, 160)], ["b", card(0, 320)]]);
    const straight: Route = { points: [{ x: 75, y: 60 }, { x: 75, y: 320 }], straight: true };
    expect(crossings(cards, [{ from: "a", to: "b" }], [straight])).toEqual([{ edge: 0, card: "c" }]);
  });

  test("o rótulo fica ao lado da linha, sem tocar em cartões nem em linhas", () => {
    const cards = new Map([["a", card(0, 0)], ["b", card(0, 300)], ["c", card(300, 0)]]);
    const edges = [{ from: "a", to: "b" }, { from: "a", to: "c" }];
    const routes = routeAll(cards, edges);
    const [l1, l2] = placeLabels([...cards.values()], routes, ["kubectl apply", "gRPC CRI"]);
    for (const [text, at] of [["kubectl apply", l1], ["gRPC CRI", l2]] as const) {
      const box = labelRect(text, at!);
      for (const c of cards.values()) expect(intersects(box, c)).toBe(false);
      for (const r of routes) for (let k = 0; k + 1 < r.points.length; k++) expect(segmentHitsRect(r.points[k], r.points[k + 1], box)).toBe(false);
    }
    expect(intersects(labelRect("kubectl apply", l1!), labelRect("gRPC CRI", l2!))).toBe(false);
  });
});

describe("o desenho de referência «Docker vs Kubernetes»", () => {
  function assertClean(d: Design): void {
    const { l, routes, labels, pills } = routed(d);
    expect(crossings(l.nodes, d.connections, routes)).toEqual([]);
    // nem por cima das etiquetas-pílula dos grupos
    expect(crossings(new Map(pills.map((p, i) => [`pill-${i}`, p])), d.connections, routes)).toEqual([]);
    const cards = [...l.nodes.values(), ...pills];
    d.connections.forEach((c, i) => {
      const text = edgeLook(d, c).label;
      if (!text) return;
      const box = labelRect(text, labels[i]!);
      for (const r of cards) expect(intersects(box, r), `rótulo «${text}» em cima de um cartão`).toBe(false);
      for (const r of routes) for (let k = 0; k + 1 < r.points.length; k++) expect(segmentHitsRect(r.points[k], r.points[k + 1], box), `rótulo «${text}» em cima de uma linha`).toBe(false);
    });
  }

  test("com as posições à mão: nenhuma seta atravessa um cartão; rótulos em espaço livre", () => {
    assertClean(reference());
  });

  test("auto-layout: de cima para baixo, sem sobreposições, cada cartão no seu grupo, painéis lado a lado", () => {
    const d = autoLayout(reference());
    const l = layout(d);
    const cards = d.components.filter((c) => c.kind !== "kernel").map((c) => l.nodes.get(c.id)!);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(intersects(cards[i], cards[j])).toBe(false);
    for (const n of d.components) expect(inside(l.nodes.get(n.id)!, l.groups.get(n.group!)!)).toBe(true);
    // os grupos irmãos não se sobrepõem (Control Plane, Node 1 e Node 2)
    const sib = ["control-plane", "node-1", "node-2"].map((g) => l.groups.get(g)!);
    expect(intersects(sib[0], sib[1]) || intersects(sib[0], sib[2]) || intersects(sib[1], sib[2])).toBe(false);
    const [docker, k8s] = [l.panels.get("docker")!, l.panels.get("kubernetes")!];
    expect(intersects(docker, k8s)).toBe(false);
    expect(docker.y).toBe(k8s.y);
    // o fluxo lê-se de cima para baixo: CLI → dockerd → containerd → runc → Container
    const y = (id: string) => l.nodes.get(id)!.y;
    expect(y("docker-cli")).toBeLessThan(y("dockerd"));
    expect(y("dockerd")).toBeLessThan(y("containerd"));
    expect(y("containerd")).toBeLessThan(y("runc"));
    expect(y("runc")).toBeLessThan(y("container"));
    // o kernel é a faixa do fundo do Host
    const kernel = l.nodes.get("linux-kernel")!, host = l.groups.get("host")!;
    for (const c of d.components.filter((c) => c.group === "host" && c.kind !== "kernel")) expect(l.nodes.get(c.id)!.y).toBeLessThan(kernel.y);
    expect(kernel.y + kernel.h).toBeLessThanOrEqual(host.y + host.h);
    assertClean(d);
  });

  test("o auto-layout não muda o modelo, só a geometria", () => {
    const before = reference();
    const after = autoLayout(before);
    const strip = (d: Design) => JSON.stringify({
      c: d.components.map(({ x, y, ...r }) => (void x, void y, r)),
      g: d.groups.map(({ x, y, w, h, ...r }) => (void x, void y, void w, void h, r)),
      e: d.connections, v: d.views,
    });
    expect(strip(after)).toBe(strip(before));
    expect(JSON.stringify(before)).toBe(JSON.stringify(reference())); // o original fica intacto
  });
});

describe("auto-layout", () => {
  test("uma cadeia fica em coluna, de cima para baixo", () => {
    const d = emptyDesign();
    for (const n of ["a", "b", "c"]) addComponent(d, "process", n, { x: 500, y: 0 });
    connect(d, "a", "b");
    connect(d, "b", "c");
    const l = layout(autoLayout(d));
    const [a, b, c] = ["a", "b", "c"].map((id) => l.nodes.get(id)!);
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);
  });

  test("um ciclo não pendura o layout", () => {
    const d = emptyDesign();
    for (const n of ["a", "b", "c"]) addComponent(d, "process", n);
    connect(d, "a", "b");
    connect(d, "b", "c");
    connect(d, "c", "a");
    const l = layout(autoLayout(d));
    expect(new Set(["a", "b", "c"].map((id) => l.nodes.get(id)!.y)).size).toBe(3);
  });

  test("grupos aninhados: o pai contém o filho e o filho os seus cartões", () => {
    const d = emptyDesign();
    const outer = addGroup(d, "Host", { x: 0, y: 0, w: 10, h: 10 });
    const inner = addGroup(d, "Infra", { x: 0, y: 0, w: 10, h: 10 }, outer);
    addComponent(d, "cli", "cli", undefined, outer);
    addComponent(d, "process", "holder", undefined, inner);
    addComponent(d, "process", "slirp", undefined, inner);
    connect(d, "cli", "holder");
    connect(d, "holder", "slirp");
    const a = autoLayout(d), l = layout(a);
    const go = a.groups.find((g) => g.id === outer)!, gi = a.groups.find((g) => g.id === inner)!;
    // o rectângulo guardado já é o desenhado (não precisa de crescer)
    expect(l.groups.get(outer)).toEqual({ x: go.x, y: go.y, w: go.w, h: go.h });
    expect(inside(l.groups.get(inner)!, l.groups.get(outer)!)).toBe(true);
    expect(inside(l.nodes.get("holder")!, { x: gi.x, y: gi.y, w: gi.w, h: gi.h })).toBe(true);
    expect(l.nodes.get("cli")!.y).toBeLessThan(l.groups.get(inner)!.y);
  });

  test("um desenho do tamanho do diagrama de crates do Delonix (41 × 147): arrumado e encaminhado sem cruzar cartões", () => {
    // grafo acíclico determinístico (sem Math.random): cada nó liga a alguns dos seguintes
    const d = emptyDesign();
    const ids: string[] = [];
    for (let i = 0; i < 41; i++) ids.push(addComponent(d, "process", `crate-${i}`));
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    while (d.connections.length < 147) {
      const i = Math.floor(rnd() * 40), j = i + 1 + Math.floor(rnd() * Math.min(12, 40 - i));
      connect(d, ids[i], ids[j]);
    }
    const t0 = performance.now();
    const a = autoLayout(d);
    const { l, routes } = routed(a);
    const ms = performance.now() - t0;
    expect(crossings(l.nodes, a.connections, routes)).toEqual([]);
    const cards = [...l.nodes.values()];
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(intersects(cards[i], cards[j])).toBe(false);
    expect(ms).toBeLessThan(4000);
  });
});

describe("caso de uso: ⇅ Arrange", () => {
  function studio(confirm: boolean) {
    const saved: Record<string, unknown> = {};
    const st = makeArchStudio({
      gateway: { available: () => false, validate: async () => [], preview: async () => [], scaffold: async () => [] },
      store: { load: () => reference(), save: (k, d) => { saved[k] = d; } },
      workspace: { root: () => null, confirm: () => confirm, prompt: () => null },
      repaint: () => {},
    });
    st.ensureLoaded();
    return st;
  }

  test("sem confirmação não mexe em nada", () => {
    const st = studio(false);
    const before = JSON.stringify(st.state().design);
    expect(st.arrange()).toBe(false);
    expect(JSON.stringify(st.state().design)).toBe(before);
  });

  test("com confirmação arruma (o mesmo que autoLayout) e guarda", () => {
    const st = studio(true);
    expect(st.arrange()).toBe(true);
    expect(JSON.stringify(st.state().design)).toBe(JSON.stringify(autoLayout(reference())));
  });
});
