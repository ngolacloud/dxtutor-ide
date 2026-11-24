/* ═══════════ Studio de arquitectura: recriar a imagem de referência PELA UI (F7) ═══════════
   O critério de «pronto» do Studio: recriar no Studio a imagem «Docker vs Kubernetes» e
   exportá-la em SVG sem setas a atravessar cartões. Aqui tudo é feito como um humano faria,
   pela UI real: ＋ Panel, ＋ Group, o catálogo (com o grupo seleccionado), ⤳ Connect, o
   inspector (código, rótulo, estilo), ⇅ Arrange e ⇄ Import / Export → SVG. No fim, o
   desenho que o Studio guardou é verificado com o próprio domínio: nenhuma seta atravessa
   um cartão ou uma pílula. As capturas (SVG e PNG exportados) ficam em test-results. */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { parseDesign } from "../src/features/arch/domain/design";
import { groupPills, layout } from "../src/features/arch/domain/geometry";
import { crossings, routeAll } from "../src/features/arch/domain/routing";

test("recria «Docker vs Kubernetes» pela UI e exporta-o sem setas a atravessar cartões", async ({ page }) => {
  test.setTimeout(180_000);
  const answers: string[] = [];
  page.on("dialog", (d) => void (d.type() === "prompt" ? d.accept(answers.shift() ?? "") : d.accept()));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#pal input")).toBeFocused();
  await page.keyboard.type("System architecture");
  await page.keyboard.press("Enter");
  const svg = page.locator(".arch-studio svg[data-arch-svg]");
  await expect(svg).toBeVisible();

  const bar = (action: string, answer?: string) => {
    if (answer !== undefined) answers.push(answer);
    return page.locator(`.arch-studio [data-action="${action}"]`).click();
  };
  const add = async (kind: string, name: string) => {
    answers.push(name);
    await page.locator(`.arch-studio [data-action="arch-add"][data-on="${kind}"]`).click();
  };
  /** Selecciona um grupo: pela pílula, ou (corpo de painel, sem pílula) pelo canto do rectângulo. */
  const selectGroup = async (id: string, body = false) => {
    if (body) await svg.locator(`[data-g="${id}"] rect`).first().click({ position: { x: 6, y: 6 } });
    else await svg.locator(`[data-g="${id}"] text`).click();
  };
  const addIn = async (group: string, body: boolean, items: [string, string][]) => {
    for (const [kind, name] of items) {
      await selectGroup(group, body);
      await add(kind, name);
    }
  };
  const inspector = (action: string) => page.locator(`.arch-studio [data-arch-insp] [data-action="${action}"]`);
  const setText = async (action: string, text: string) => {
    await inspector(action).fill(text);
    await inspector(action).press("Tab"); // o change dispara ao sair do campo
  };

  // ── Docker ──
  await bar("arch-add-view", "Docker");
  await add("cli", "Docker CLI");
  await setText("arch-code", "docker run checkout:v2");
  await selectGroup("docker-2", true); // o corpo do painel: o id «docker» é o do painel
  await bar("arch-add-group", "Host");
  await addIn("host", false, [["daemon", "dockerd"], ["runtime", "containerd"], ["runtime", "runc"], ["process", "Container"], ["kernel", "Linux kernel"]]);

  // ── Kubernetes ──
  await bar("arch-add-view", "Kubernetes");
  await add("state", "Deployment");
  await setText("arch-code", "replicas: 3\nimage: checkout:v2");
  for (const [g, items] of [
    ["Control Plane", [["process", "API Server"], ["state", "etcd"], ["process", "Controller Manager"], ["process", "Scheduler"]]],
    ["Node 1", [["daemon", "kubelet"], ["runtime", "CRI runtime"], ["worker", "Pod A"], ["worker", "Pod B"]]],
    ["Node 2", [["daemon", "kubelet"], ["runtime", "CRI runtime"], ["worker", "Pod C"]]],
  ] as [string, [string, string][]][]) {
    await selectGroup("kubernetes-2", true);
    await bar("arch-add-group", g);
    const id = g.toLowerCase().replace(/ /g, "-");
    await addIn(id, false, items);
  }
  await addIn("kubernetes-2", true, [["client", "Client"], ["adapter", "Ingress"], ["port", "Service"]]);
  await expect(svg.locator("[data-n]")).toHaveCount(21);

  // ── setas (⤳ Connect: origem, destino) ──
  await bar("arch-arrange"); // arruma antes de ligar: os cartões ficam visíveis e sem sobreposições
  const connect = async (from: string, to: string, opts: { label?: string; data?: boolean } = {}) => {
    await bar("arch-link");
    await svg.locator(`[data-n="${from}"]`).click();
    await svg.locator(`[data-n="${to}"]`).click();
    if (opts.label) await setText("arch-edge-label", opts.label);
    if (opts.data) await inspector("arch-edge-style").selectOption("data");
  };
  for (const [a, b] of [["docker-cli", "dockerd"], ["dockerd", "containerd"], ["containerd", "runc"], ["runc", "container"]]) await connect(a, b);
  await connect("deployment", "api-server", { label: "kubectl apply" });
  for (const b of ["etcd", "controller-manager", "scheduler", "kubelet", "kubelet-2"]) await connect("api-server", b);
  await connect("kubelet", "cri-runtime", { label: "gRPC CRI" });
  await connect("cri-runtime", "pod-a");
  await connect("cri-runtime", "pod-b");
  await connect("kubelet-2", "cri-runtime-2");
  await connect("cri-runtime-2", "pod-c");
  for (const [a, b] of [["client", "ingress"], ["ingress", "service"], ["service", "pod-a"], ["service", "pod-c"]]) await connect(a, b, { data: true });
  await expect(svg.locator("[data-e]")).toHaveCount(19);
  await bar("arch-arrange"); // arruma de novo, agora com as setas (camadas de cima para baixo)

  // ── o que o Studio guardou: o modelo certo e nenhuma seta por cima de um cartão ──
  const design = parseDesign(JSON.parse((await page.evaluate(() => localStorage.getItem("dxnext-studio:default")))!));
  expect(design.views.map((v) => v.title)).toEqual(["Docker", "Kubernetes"]);
  expect(design.groups.map((g) => g.label).sort()).toEqual(["Control Plane", "Docker", "Host", "Kubernetes", "Node 1", "Node 2"]);
  expect(design.components.find((c) => c.id === "docker-cli")!.code).toBe("docker run checkout:v2");
  expect(design.connections.filter((c) => c.style === "data")).toHaveLength(4);
  expect(design.connections.find((c) => c.from === "kubelet")!.label).toBe("gRPC CRI");
  const l = layout(design);
  const routes = routeAll(l.nodes, design.connections, groupPills(design, l));
  expect(crossings(l.nodes, design.connections, routes)).toEqual([]);

  // ── ⇄ Import / Export → SVG e PNG ──
  await bar("arch-io");
  const exportAs = async (format: string, file: string) => {
    const [dl] = await Promise.all([page.waitForEvent("download"), page.locator(`[data-action="arch-export"][data-on="${format}"]`).click()]);
    expect(dl.suggestedFilename()).toBe(`docker-vs-kubernetes.${format}`);
    await dl.saveAs(test.info().outputPath(file));
  };
  await exportAs("svg", "docker-vs-kubernetes.svg");
  await exportAs("png", "docker-vs-kubernetes.png");
  const exported = readFileSync(test.info().outputPath("docker-vs-kubernetes.svg"), "utf8");
  expect(exported).toContain(">Docker</text>");
  expect(exported).toContain(">kubectl apply</text>");
  expect(exported).not.toContain("var(--");
  expect(errors).toEqual([]);
  void (page as Page);
});
