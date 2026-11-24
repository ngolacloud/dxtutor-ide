// Studio de arquitectura (F3): grupos aninhados, painéis, cartões com ícone e código,
// setas por estilo — domínio, geometria, caso de uso e a vista com a tabela de acções real.
import { describe, test, expect, beforeEach } from "vitest";
import {
  addComponent, addGroup, addView, ancestry, connect, descendants, emptyDesign, parseDesign, removeGroup,
  setGroupParent, setGroupView, toArchitecture, viewOfNode,
} from "../src/features/arch/domain/design";
import {
  GROUP_PAD, GROUP_PAD_TOP, NODE_W, PANEL_BAR, borderPoint, codeLines, contains, groupAt, intersects, layout, nameLines, nodeSize,
} from "../src/features/arch/domain/geometry";
import type { Design, Rect } from "../src/features/arch/domain/types";
import { makeArchStudio } from "../src/features/arch/application/studio";
import type { ArchGateway, Repaint } from "../src/features/arch/application/ports";
import { canvasSvg, makeArchView } from "../src/features/arch/ui/view";
import { bindActions } from "../src/features/arch/ui/actions";
import { archActions } from "../src/features/arch/ui/table";

const inside = (inner: Rect, outer: Rect): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe("domínio: ligações, grupos e painéis", () => {
  test("setas de sistema ganham estilo; entre Kind de eventos infere-se a relação", () => {
    const d = emptyDesign();
    for (const [k, n] of [["cli", "cli"], ["daemon", "dockerd"], ["client", "browser"], ["port", "svc"], ["relay", "relay"], ["broker", "mq"]] as const) addComponent(d, k, n);
    connect(d, "cli", "dockerd");
    connect(d, "browser", "svc");
    connect(d, "relay", "mq", "order.placed");
    connect(d, "cli", "mq");
    expect(d.connections).toEqual([
      { from: "cli", to: "dockerd", event: "", style: "control" },
      { from: "browser", to: "svc", event: "", style: "data" },
      { from: "relay", to: "mq", relation: "publishes", event: "order.placed" },
      { from: "cli", to: "mq", event: "", style: "control" },
    ]);
  });

  test("grupos aninhados: descendentes, cadeia e recusa de ciclos", () => {
    const d = emptyDesign();
    const r = { x: 0, y: 0, w: 100, h: 100 };
    const k8s = addGroup(d, "Kubernetes", r);
    const cp = addGroup(d, "Control Plane", r, k8s, "plane");
    const n1 = addGroup(d, "Node 1", r, k8s, "node");
    expect([...descendants(d, k8s)].sort()).toEqual([cp, n1].sort());
    expect(ancestry(d, cp)).toEqual([cp, k8s]);
    expect(setGroupParent(d, k8s, cp)).toBe(false);
    expect(setGroupParent(d, k8s, k8s)).toBe(false);
    expect(setGroupParent(d, n1, cp)).toBe(true);
    expect(ancestry(d, n1)).toEqual([n1, cp, k8s]);
  });

  test("remover um grupo: o conteúdo passa ao pai; filhos de uma raiz de painel viram raízes", () => {
    const d = emptyDesign();
    const r = { x: 0, y: 0, w: 100, h: 100 };
    const v = addView(d, "Kubernetes")!;
    const k8s = addGroup(d, "K8s", r);
    setGroupView(d, k8s, v);
    const cp = addGroup(d, "CP", r, k8s);
    const api = addComponent(d, "process", "API", undefined, cp);
    const loose = addComponent(d, "client", "Client", undefined, k8s);
    removeGroup(d, cp);
    expect(d.components.find((c) => c.id === api)!.group).toBe(k8s);
    removeGroup(d, k8s);
    expect(d.components.find((c) => c.id === loose)!.group).toBeUndefined();
    expect(d.views[0].roots).toEqual([]);

    const e = emptyDesign();
    const v2 = addView(e, "P")!, root = addGroup(e, "Root", r), child = addGroup(e, "Child", r, root);
    setGroupView(e, root, v2);
    removeGroup(e, root);
    expect(e.views[0].roots).toEqual([child]);
  });

  test("no máximo dois painéis, com as duas cores da referência", () => {
    const d = emptyDesign();
    expect(addView(d, "Docker")).toBe("docker");
    expect(addView(d, "Kubernetes")).toBe("kubernetes");
    expect(addView(d, "Third")).toBeNull();
    expect(d.views.map((v) => v.color)).toEqual(["#0f766e", "#6d28d9"]);
  });

  test("o painel de um componente vem do grupo raiz", () => {
    const d = emptyDesign();
    const r = { x: 0, y: 0, w: 100, h: 100 };
    const v = addView(d, "Docker")!;
    const host = addGroup(d, "Host", r);
    setGroupView(d, host, v);
    const inner = addGroup(d, "Inner", r, host);
    const id = addComponent(d, "daemon", "dockerd", undefined, inner);
    expect(viewOfNode(d, d.components.find((c) => c.id === id)!)?.id).toBe(v);
  });

  test("toArchitecture: sem geometria nem campos vazios; ida e volta pelo armazenamento", () => {
    const d = emptyDesign();
    const g = addGroup(d, "Host", { x: 10, y: 10, w: 200, h: 100 }, undefined, "host");
    const id = addComponent(d, "cli", "Docker CLI", { x: 20, y: 40 }, g);
    d.components[0].code = "docker run checkout:v2";
    d.components[0].source = "";
    addComponent(d, "daemon", "dockerd", { x: 20, y: 160 }, g);
    connect(d, id, "dockerd");
    d.connections[0].protocol = "unix-socket";
    const v = addView(d, "Docker")!;
    setGroupView(d, g, v);
    const a = toArchitecture(d);
    expect(a.components[0]).toEqual({ id: "docker-cli", name: "Docker CLI", kind: "cli", outbox: false, group: "host", code: "docker run checkout:v2" });
    expect(a.groups[0]).toEqual({ id: "host", label: "Host", kind: "host", style: "dashed" });
    expect(a.connections[0]).toEqual({ from: "docker-cli", to: "dockerd", event: "", style: "control", protocol: "unix-socket" });
    expect(a.views[0]).toEqual({ id: "docker", title: "Docker", color: "#0f766e", roots: ["host"], daemonless: false, strict: false });
    const back = parseDesign(JSON.parse(JSON.stringify(d)));
    expect(toArchitecture(back)).toEqual(a);
    expect(back.groups[0]).toMatchObject({ x: 10, y: 10, w: 200, h: 100 });
  });
});

describe("geometria", () => {
  test("o cartão cresce com o nome e o código; o kernel é uma faixa", () => {
    expect(nameLines("Controller Manager")).toEqual(["Controller Manager"]);
    expect(nameLines("Delonix Engine\nmotor de containers e microVMs")).toEqual(["Delonix Engine", "motor de containers", "e microVMs"]);
    expect(nameLines("Delonix Engine\nmotor de containers e microVMs\ndaemonless")).toEqual(["Delonix Engine", "motor de containers", "e microVMs …"]);
    expect(nameLines("a\nb\nc\nd").length).toBe(3);
    expect(codeLines("replicas: 3\nimage: checkout:v2")).toEqual(["replicas: 3", "image: checkout:v2"]);
    expect(codeLines("docker run checkout:v2")).toEqual(["docker run checkout:v2"]);
    expect(codeLines("1\n2\n3\n4\n5")).toEqual(["1", "2", "3", "…"]);
    expect(codeLines("   ")).toEqual([]);
    const base = { id: "a", name: "dockerd", kind: "daemon" as const, outbox: false, x: 0, y: 0 };
    const plain = nodeSize(base), withCode = nodeSize({ ...base, code: "a\nb" }), tall = nodeSize({ ...base, name: "one\ntwo" });
    expect(plain.w).toBe(NODE_W);
    expect(withCode.h).toBeGreaterThan(plain.h);
    expect(tall.h).toBeGreaterThan(plain.h);
    expect(nodeSize({ ...base, kind: "kernel" }).h).toBe(40);
  });

  test("um grupo cresce para conter os cartões e os subgrupos; o painel envolve as raízes", () => {
    const d = emptyDesign();
    const outer = addGroup(d, "Host", { x: 20, y: 60, w: 100, h: 60 }, undefined, "host");
    const innerG = addGroup(d, "Infra", { x: 40, y: 100, w: 50, h: 40 }, outer);
    addComponent(d, "daemon", "a", { x: 300, y: 300 }, innerG);
    addComponent(d, "kernel", "Linux kernel", { x: 30, y: 500 }, outer);
    const v = addView(d, "Delonix")!;
    setGroupView(d, outer, v);
    const l = layout(d);
    const nodeA = l.nodes.get("a")!, gi = l.groups.get(innerG)!, go = l.groups.get(outer)!, p = l.panels.get(v)!;
    expect(inside(nodeA, gi)).toBe(true);
    expect(gi.x + gi.w).toBe(nodeA.x + nodeA.w + GROUP_PAD);
    expect(nodeA.y - gi.y).toBeGreaterThanOrEqual(GROUP_PAD_TOP);
    expect(inside(gi, go)).toBe(true);
    expect(inside(go, p)).toBe(true);
    expect(go.y - p.y).toBeGreaterThanOrEqual(PANEL_BAR);
    // a faixa do kernel estica à largura interior do grupo
    const k = l.nodes.get("linux-kernel")!;
    expect(k.x).toBe(go.x + GROUP_PAD);
    expect(k.w).toBe(go.w - 2 * GROUP_PAD);
    expect(contains(l.bounds, { x: p.x, y: p.y })).toBe(true);
  });

  test("o alvo de uma largada é o grupo mais fundo; a borda de um rectângulo", () => {
    const d = emptyDesign();
    const a = addGroup(d, "A", { x: 0, y: 0, w: 400, h: 400 });
    const b = addGroup(d, "B", { x: 50, y: 50, w: 100, h: 100 }, a);
    const l = layout(d);
    expect(groupAt(d, l, { x: 80, y: 80 })).toBe(b);
    expect(groupAt(d, l, { x: 300, y: 300 })).toBe(a);
    expect(groupAt(d, l, { x: 80, y: 80 }, new Set([b]))).toBe(a);
    expect(groupAt(d, l, { x: 900, y: 900 })).toBeUndefined();
    expect(borderPoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 300, y: 25 })).toEqual({ x: 100, y: 25 });
    expect(borderPoint({ x: 0, y: 0, w: 100, h: 50 }, { x: 50, y: -100 })).toEqual({ x: 50, y: 0 });
  });
});

function studioWith(prompts: string[] = []) {
  const saved: Record<string, unknown> = {};
  const gateway: ArchGateway = { available: () => false, validate: async () => [], preview: async () => [], scaffold: async () => [] };
  const queue = [...prompts];
  const workspace = { root: () => "/p", confirm: () => true, prompt: () => queue.shift() ?? null };
  let view: ReturnType<typeof makeArchView> | null = null;
  const st = makeArchStudio({
    gateway, workspace, repaint: (s: Repaint) => view?.repaint(s),
    store: { load: (k) => saved[k] ?? null, save: (k, d) => { saved[k] = JSON.parse(JSON.stringify(d)); } },
  });
  st.ensureLoaded();
  return { st, saved, workspace, setView: (v: ReturnType<typeof makeArchView>) => { view = v; } };
}

describe("caso de uso: grupos, painéis e largadas", () => {
  test("com um grupo seleccionado, o componente novo nasce lá dentro", () => {
    const { st } = studioWith();
    const g = st.addGroup("Host");
    const id = st.add("daemon", "dockerd");
    const d = st.state().design;
    expect(d.components[0].group).toBe(g);
    const l = layout(d);
    expect(inside(l.nodes.get(id)!, l.groups.get(g)!)).toBe(true);
    expect(st.state().sel).toEqual({ t: "node", id });
  });

  test("arrastar um cartão para dentro e para fora de um grupo muda a pertença", () => {
    const { st } = studioWith();
    st.select(null);
    const id = st.add("cli", "docker");
    const g = st.addGroup("Host");
    const gr = layout(st.state().design).groups.get(g)!;
    st.move(id, gr.x + 30, gr.y + 40);
    st.endMove(id);
    expect(st.state().design.components[0].group).toBe(g);
    // para fora: o grupo crescia com o cartão, mas a largada calcula-se sem a pertença
    st.move(id, gr.x + gr.w + 300, gr.y);
    st.endMove(id);
    expect(st.state().design.components[0].group).toBeUndefined();
  });

  test("arrastar um grupo para dentro de outro e para dentro de um painel", () => {
    const { st } = studioWith();
    const v = st.addView("Kubernetes")!;
    const root = st.state().design.views[0].roots[0];
    st.select(null);
    const node = st.addGroup("Node 1");
    expect(st.state().design.groups.find((g) => g.id === node)!.parent).toBeUndefined();
    const rr = layout(st.state().design).groups.get(root)!;
    const nr = layout(st.state().design).groups.get(node)!;
    st.moveGroup(node, rr.x + 20 - nr.x, rr.y + 30 - nr.y);
    st.endGroupMove(node);
    expect(st.state().design.groups.find((g) => g.id === node)!.parent).toBe(root);
    // para fora de tudo
    st.moveGroup(node, 2000, 0);
    st.endGroupMove(node);
    const g = st.state().design.groups.find((x) => x.id === node)!;
    expect(g.parent).toBeUndefined();
    expect(st.state().design.views.find((x) => x.id === v)!.roots).not.toContain(node);
  });

  test("um terceiro painel é recusado com aviso; o painel nasce com um grupo raiz", () => {
    const { st } = studioWith();
    st.addView("Docker");
    st.addView("Kubernetes");
    expect(st.addView("Nomad")).toBeNull();
    expect(st.state().notice).toMatch(/at most two panels/);
    const d = st.state().design;
    expect(d.views.map((v) => v.roots.length)).toEqual([1, 1]);
    const l = layout(d);
    expect(intersects(l.panels.get("docker")!, l.panels.get("kubernetes")!)).toBe(false);
  });

  test("editar uma ligação: estilo, protocolo, rótulo; vazio limpa", () => {
    const { st } = studioWith();
    st.add("daemon", "kubelet");
    st.select(null);
    st.add("runtime", "cri");
    st.connect("kubelet", "cri");
    st.updateConnection(0, { protocol: "grpc", label: "gRPC CRI", style: "control" });
    expect(st.state().design.connections[0]).toMatchObject({ protocol: "grpc", label: "gRPC CRI", style: "control" });
    st.updateConnection(0, { label: "  ", protocol: undefined });
    expect(st.state().design.connections[0].label).toBeUndefined();
    expect(st.state().design.connections[0].protocol).toBeUndefined();
  });
});

describe("vista", () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  function mounted(prompts: string[] = []) {
    const t = studioWith(prompts);
    const view = makeArchView({ studio: t.st, root: t.workspace.root });
    t.setView(view);
    bindActions(archActions(t.st, t.workspace.prompt));
    view.mount(host);
    return t;
  }

  /** O desenho de referência «Docker vs Kubernetes», feito pela API do Studio. */
  function reference(): Design {
    const { st } = studioWith();
    st.addView("Docker");
    const host = st.state().design.views[0].roots[0];
    st.select({ t: "group", id: host });
    st.updateGroup(host, { label: "Host", kind: "host" });
    const cli = st.add("cli", "Docker CLI");
    st.setCode(cli, "docker run checkout:v2");
    st.select({ t: "group", id: host });
    for (const [k, n] of [["daemon", "dockerd"], ["runtime", "containerd"], ["runtime", "runc"], ["process", "Container"], ["kernel", "Linux kernel"]] as const) {
      st.add(k, n);
      st.select({ t: "group", id: host });
    }
    st.addView("Kubernetes");
    const k8s = st.state().design.views[1].roots[0];
    st.select({ t: "group", id: k8s });
    const cp = st.addGroup("Control Plane", "plane");
    for (const n of ["API Server", "etcd", "Controller Manager", "Scheduler"]) { st.add(n === "etcd" ? "state" : "process", n); st.select({ t: "group", id: cp }); }
    st.connect("docker-cli", "dockerd");
    st.connect("dockerd", "containerd");
    st.connect("api-server", "etcd");
    return st.state().design;
  }

  test("o desenho de referência: painéis lado a lado, cartões dentro dos seus grupos, sem sobreposições", () => {
    const d = reference();
    const l = layout(d);
    expect(d.views.map((v) => v.title)).toEqual(["Docker", "Kubernetes"]);
    expect(intersects(l.panels.get("docker")!, l.panels.get("kubernetes")!)).toBe(false);
    for (const n of d.components) expect(inside(l.nodes.get(n.id)!, l.groups.get(n.group!)!)).toBe(true);
    const cards = d.components.filter((c) => c.kind !== "kernel").map((c) => l.nodes.get(c.id)!);
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) expect(intersects(cards[i], cards[j])).toBe(false);
    const { svg } = canvasSvg(d, {}, null);
    expect(svg).toContain(">Docker</text>");
    expect(svg).toContain(">Control Plane</text>");
    expect(svg).toContain(">docker run checkout:v2</text>");
    expect(svg).toContain('stroke="#0f766e" stroke-width="1.5" stroke-dasharray="6 4"'); // seta de controlo na cor do painel
  });

  test("o canvas desenha painel, grupo tracejado com pílula, ícone e setas por estilo", () => {
    const { st } = mounted();
    st.addView("Delonix");
    st.add("cli", "delonix");
    st.select({ t: "group", id: st.state().design.views[0].roots[0] });
    st.add("state", "Estado JSON");
    st.select(null);
    st.add("client", "Browser");
    st.select(null);
    st.add("port", "Service");
    st.connect("browser", "service");
    const svg = host.querySelector("[data-arch-svg]")!;
    expect(svg.querySelectorAll("[data-g]").length).toBe(1);
    // o grupo raiz com o nome do painel é o corpo do painel: sem contorno nem pílula
    const root = st.state().design.views[0].roots[0];
    expect(svg.querySelector("[data-g] rect")!.hasAttribute("stroke-dasharray")).toBe(false);
    expect(svg.querySelector("[data-g] text")).toBeNull();
    st.updateGroup(root, { label: "Host" });
    expect(svg.querySelector("[data-g] rect")!.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(svg.querySelector("[data-g] text")!.textContent).toBe("Host");
    expect(svg.querySelectorAll("[data-n]").length).toBe(4);
    expect(svg.querySelector('[data-n="estado-json"] g path')).not.toBeNull(); // o ícone
    const data = svg.querySelector('[data-e="0"] line:nth-of-type(2)')!;
    expect(data.getAttribute("stroke")).toBe("var(--green)");
    expect(Number(svg.getAttribute("width"))).toBeGreaterThanOrEqual(760);
  });

  test("seleccionar uma seta (mousedown) abre o inspector da ligação; mudar o estilo por data-action", () => {
    const { st } = mounted();
    st.add("daemon", "kubelet");
    st.select(null);
    st.add("runtime", "cri");
    st.connect("kubelet", "cri");
    st.select(null);
    host.querySelector('[data-e="0"] line')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(st.state().sel).toEqual({ t: "edge", i: 0 });
    const style = host.querySelector('[data-action="arch-edge-style"]') as HTMLSelectElement;
    style.value = "data";
    style.dispatchEvent(new Event("change", { bubbles: true }));
    expect(st.state().design.connections[0].style).toBe("data");
    const label = host.querySelector('[data-action="arch-edge-label"]') as HTMLInputElement;
    label.value = "gRPC CRI";
    label.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelector('[data-e="0"] text')!.textContent).toBe("gRPC CRI");
  });

  test("+ Group e + Panel pela barra; o inspector do grupo muda o rótulo e o contorno", () => {
    const { st } = mounted(["Host", "Docker"]);
    (host.querySelector('[data-action="arch-add-group"]') as HTMLElement).click();
    const g = st.state().design.groups[0].id;
    expect(st.state().sel).toEqual({ t: "group", id: g });
    const lab = host.querySelector('[data-action="arch-group-label"]') as HTMLInputElement;
    lab.value = "Host Linux";
    lab.dispatchEvent(new Event("change", { bubbles: true }));
    const border = host.querySelector('[data-action="arch-group-style"]') as HTMLSelectElement;
    border.value = "solid";
    border.dispatchEvent(new Event("change", { bubbles: true }));
    expect(st.state().design.groups[0]).toMatchObject({ label: "Host Linux", style: "solid" });
    expect(host.querySelector("[data-g] rect")!.hasAttribute("stroke-dasharray")).toBe(false);
    (host.querySelector('[data-action="arch-add-view"]') as HTMLElement).click();
    expect(st.state().design.views.map((v) => v.title)).toEqual(["Docker"]);
  });

  test("um desenho só de sistema esconde o scaffold; um de eventos mostra-o", () => {
    const { st } = mounted();
    expect(host.querySelector('[data-action="arch-scaffold"]')).not.toBeNull();
    st.add("daemon", "dockerd");
    expect(host.querySelector('[data-action="arch-scaffold"]')).toBeNull();
    st.select(null);
    st.add("service", "Orders");
    expect(host.querySelector('[data-action="arch-scaffold"]')).not.toBeNull();
  });

  test("os textos do utilizador são escapados no SVG e no inspector", () => {
    const { st } = mounted();
    const id = st.add("cli", '<img src=x onerror="alert(1)">');
    st.setCode(id, "</text><script>alert(1)</script>");
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
  });
});
