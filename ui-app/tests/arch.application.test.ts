// Studio de arquitectura (F0): caso de uso com portas falsas, e a vista com o despacho
// delegado real (eventos DOM verdadeiros sobre data-action).
import { describe, test, expect, beforeEach } from "vitest";
import { makeArchStudio, NEEDS_DESKTOP, storageKey } from "../src/features/arch/application/studio";
import type { ArchGateway, DesignStore, Repaint, Workspace } from "../src/features/arch/application/ports";
import type { Architecture, ArchFinding } from "../src/features/arch/domain/types";
import { makeArchView } from "../src/features/arch/ui/view";
import { bindActions } from "../src/features/arch/ui/actions";
import { fakeFiles, fakeRenderer, ioGateway } from "./fixtures/arch-fakes";

function fakes(o: { desktop?: boolean; root?: string | null; findings?: ArchFinding[]; confirm?: boolean; prompts?: string[]; saved?: Record<string, unknown> } = {}) {
  const calls: { validate: Architecture[]; preview: number; scaffold: [string, Architecture][] } = { validate: [], preview: 0, scaffold: [] };
  const saved: Record<string, unknown> = o.saved ?? {};
  const prompts = [...(o.prompts ?? [])];
  const confirms: string[] = [];
  const repaints: Repaint[] = [];
  const gateway: ArchGateway = {
    available: () => o.desktop ?? true,
    validate: async (a) => { calls.validate.push(JSON.parse(JSON.stringify(a))); return o.findings ?? []; },
    preview: async () => { calls.preview++; return [["services/svc/main.rs", "//"], ["ARCHITECTURE.md", "#"]]; },
    scaffold: async (root, a) => { calls.scaffold.push([root, a]); return ["services/svc/main.rs"]; },
    ...ioGateway,
  };
  const store: DesignStore = { load: (k) => saved[k] ?? null, save: (k, d) => { saved[k] = JSON.parse(JSON.stringify(d)); } };
  const workspace: Workspace = {
    root: () => (o.root === undefined ? "/proj" : o.root),
    confirm: (m) => { confirms.push(m); return o.confirm ?? true; },
    prompt: () => prompts.shift() ?? null,
  };
  return { gateway, store, workspace, calls, saved, confirms, repaints, renderer: fakeRenderer, files: fakeFiles(), repaint: (s: Repaint) => { repaints.push(s); } };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("caso de uso", () => {
  test("nasce vazio e guarda por raiz, na chave do Studio original", async () => {
    const f = fakes();
    const st = makeArchStudio(f);
    st.ensureLoaded();
    expect(st.state().design).toEqual({ components: [], connections: [], groups: [], views: [] });
    st.add("service", "Orders");
    await flush();
    expect(storageKey("/proj")).toBe("dxnext-studio:/proj");
    expect((f.saved["dxnext-studio:/proj"] as { components: unknown[] }).components.length).toBe(1);
    expect(f.calls.validate.at(-1)!.components[0]).toEqual({ id: "orders", name: "Orders", kind: "service", outbox: false });
  });

  test("um desenho antigo guardado abre e é validado pelo backend", async () => {
    const saved = { "dxnext-studio:/proj": { components: [{ id: "svc", name: "svc", kind: "service", outbox: false, x: 1, y: 2 }], connections: [] } };
    const f = fakes({ saved, findings: [{ severity: "warning", rule: "orphan-event", message: "m", component: "" }] });
    const st = makeArchStudio(f);
    st.ensureLoaded();
    expect(st.state().design.components[0].x).toBe(1);
    await st.validate();
    expect(st.state().findings.map((x) => x.rule)).toEqual(["orphan-event"]);
  });

  test("trocar de pasta carrega o desenho dessa pasta", () => {
    let root = "/a";
    const f = fakes({ saved: { "dxnext-studio:/b": { components: [{ id: "x", name: "x", kind: "store", outbox: false, x: 0, y: 0 }], connections: [] } } });
    const st = makeArchStudio({ ...f, workspace: { ...f.workspace, root: () => root } });
    expect(st.ensureLoaded()).toBe(true);
    expect(st.ensureLoaded()).toBe(false);
    root = "/b";
    expect(st.ensureLoaded()).toBe(true);
    expect(st.state().design.components.map((c) => c.id)).toEqual(["x"]);
  });

  test("ligar a um broker pede o nome do evento", () => {
    const f = fakes({ prompts: ["order.placed"] });
    const st = makeArchStudio(f);
    st.ensureLoaded();
    st.add("relay", "relay");
    st.add("broker", "mq");
    st.toggleLinking();
    st.linkClick("relay");
    st.linkClick("mq");
    expect(st.state().linking).toBeNull();
    expect(st.state().design.connections).toEqual([{ from: "relay", to: "mq", relation: "publishes", event: "order.placed" }]);
  });

  test("fora do desktop: diz que precisa do backend (sem validar no cliente)", async () => {
    const f = fakes({ desktop: false });
    const st = makeArchStudio(f);
    st.ensureLoaded();
    st.add("service", "svc");
    await flush();
    expect(st.state().valError).toBe(NEEDS_DESKTOP);
    expect(f.calls.validate.length).toBe(0);
    expect(await st.scaffold()).toBeNull();
    expect(f.calls.scaffold.length).toBe(0);
  });

  test("scaffold: sem pasta não escreve", async () => {
    const f = fakes({ root: null });
    const st = makeArchStudio(f);
    st.ensureLoaded();
    expect(await st.scaffold()).toBeNull();
    expect(st.state().opError).toMatch(/Open a folder/);
  });

  test("scaffold: com erros de validação não escreve", async () => {
    const f = fakes({ findings: [{ severity: "error", rule: "outbox-without-relay", message: "m", component: "db" }] });
    const st = makeArchStudio(f);
    st.ensureLoaded();
    expect(await st.scaffold()).toBeNull();
    expect(f.confirms.length).toBe(0);
    expect(f.calls.scaffold.length).toBe(0);
  });

  test("scaffold: sem confirmação não escreve; com confirmação escreve na pasta", async () => {
    const no = fakes({ confirm: false });
    const a = makeArchStudio(no);
    a.ensureLoaded();
    expect(await a.scaffold()).toBeNull();
    expect(no.confirms[0]).toMatch(/Write 2 files under \/proj/);
    expect(no.calls.scaffold.length).toBe(0);

    const yes = fakes();
    const b = makeArchStudio(yes);
    b.ensureLoaded();
    b.add("service", "svc");
    expect(await b.scaffold()).toEqual(["services/svc/main.rs"]);
    expect(yes.calls.scaffold[0][0]).toBe("/proj");
  });

  test("mudar o desenho apaga a pré-visualização obsoleta", async () => {
    const f = fakes();
    const st = makeArchStudio(f);
    st.ensureLoaded();
    await st.preview();
    expect(st.state().preview!.length).toBe(2);
    st.add("store", "db");
    expect(st.state().preview).toBeNull();
  });

  test("arrastar só guarda no fim", () => {
    const f = fakes();
    const st = makeArchStudio(f);
    st.ensureLoaded();
    st.add("service", "svc");
    const before = JSON.stringify(f.saved);
    st.move("svc", 300, 200);
    expect(JSON.stringify(f.saved)).toBe(before);
    st.endMove();
    expect((f.saved["dxnext-studio:/proj"] as { components: { x: number }[] }).components[0].x).toBe(300);
  });
});

describe("vista + despacho delegado", () => {
  let host: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  function mount(f = fakes({ prompts: ["Orders"] })) {
    let view: ReturnType<typeof makeArchView> | null = null;
    const st = makeArchStudio({ ...f, repaint: (s) => view?.repaint(s) });
    view = makeArchView({ studio: st, root: f.workspace.root, savesToProject: () => false });
    bindActions({
      "arch-link": { on: "click", run: () => st.toggleLinking() },
      "arch-add": { on: "click", run: ({ on }) => { const n = f.workspace.prompt("", ""); if (n) st.add(on as "service", n); } },
      "arch-name": { on: "change", run: ({ on, value }) => st.rename(on, value) },
      "arch-del": { on: "click", run: ({ on }) => st.remove(on) },
    });
    view.mount(host);
    return { st, f };
  }

  test("abre vazio, com a mensagem de desenho vazio e sem nós", () => {
    mount();
    expect(host.querySelectorAll("[data-n]").length).toBe(0);
    expect(host.querySelector("[data-arch-insp]")!.textContent).toMatch(/The design is empty/);
    expect(host.querySelectorAll('[data-action="arch-add"]').length).toBe(18);
  });

  test("acrescentar, renomear e apagar por data-action", async () => {
    const { st } = mount();
    (host.querySelector('[data-action="arch-add"][data-on="service"]') as HTMLElement).click();
    expect(host.querySelectorAll("[data-n]").length).toBe(1);
    const inp = host.querySelector('[data-action="arch-name"]') as HTMLInputElement;
    inp.value = "Billing";
    inp.dispatchEvent(new Event("change", { bubbles: true }));
    expect(st.state().design.components[0].name).toBe("Billing");
    expect(host.querySelector("[data-n] text:last-child")!.textContent).toBe("Billing");
    (host.querySelector('[data-action="arch-del"]') as HTMLElement).click();
    expect(host.querySelectorAll("[data-n]").length).toBe(0);
    await flush();
  });

  test("o botão Connect liga o modo de ligação", () => {
    mount();
    (host.querySelector('[data-action="arch-link"]') as HTMLElement).click();
    expect(host.querySelector('[data-action="arch-link"]')!.classList.contains("pri")).toBe(true);
    expect(host.querySelector("[data-arch-insp]")!.textContent).toMatch(/starts from/);
  });

  test("o nome do componente é escapado no markup", () => {
    mount(fakes({ prompts: ['<img src=x onerror="alert(1)">'] }));
    (host.querySelector('[data-action="arch-add"]') as HTMLElement).click();
    expect(host.querySelector("img")).toBeNull();
  });
});
