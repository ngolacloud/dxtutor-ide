// Studio de arquitectura (F6): propostas do agente do Co-Dev (ferramenta `arch_propose`).
// A proposta aparece por cima do desenho actual, que não muda até «Accept»; enquanto está
// à espera, o Studio não edita nada; nada vai para o disco do projecto.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { fromArchitecture } from "../src/features/arch/domain/design";
import { makeArchStudio } from "../src/features/arch/application/studio";
import type { ArchGateway, Proposal } from "../src/features/arch/application/ports";
import type { Design } from "../src/features/arch/domain/types";
import { makeArchView } from "../src/features/arch/ui/view";
import { bindActions } from "../src/features/arch/ui/actions";
import { archActions } from "../src/features/arch/ui/table";
import { tauriProposals } from "../src/features/arch/infrastructure/tauri";
import { reference } from "./fixtures/arch-reference";
import { fakeFiles, fakeRenderer, ioGateway } from "./fixtures/arch-fakes";

function proposal(): Proposal {
  return {
    title: "Delonix vs Docker",
    design: fromArchitecture({
      components: [
        { id: "cli", name: "delonix", kind: "cli", outbox: false, group: "host", code: "delonix run nginx" },
        { id: "state", name: "Estado JSON", kind: "state", outbox: false, group: "host" },
        { id: "kernel", name: "Linux kernel", kind: "kernel", outbox: false, group: "host" },
      ],
      connections: [{ from: "cli", to: "state", event: "", style: "data", label: "lê e escreve" }],
      groups: [{ id: "host", label: "Host", kind: "host", style: "dashed" }],
      views: [{ id: "delonix", title: "Delonix", color: "#6d28d9", roots: ["host"], daemonless: true, strict: false }],
    }),
    findings: [{ severity: "warning", rule: "unconfirmed-element", message: "`delonix` has no source", component: "cli" }],
  };
}

function setup(initial: Design | null = reference()) {
  const saves: unknown[] = [];
  const prompts: string[] = [];
  const gateway: ArchGateway = { available: () => true, validate: async () => [], preview: async () => [], scaffold: async () => [], ...ioGateway };
  let view: ReturnType<typeof makeArchView> | null = null;
  const st = makeArchStudio({
    gateway, renderer: fakeRenderer, files: fakeFiles(),
    store: { load: () => initial, save: (_k, d) => { saves.push(JSON.parse(JSON.stringify(d))); } },
    workspace: { root: () => "/p", confirm: () => true, prompt: (m) => { prompts.push(m); return "x"; } },
    repaint: (s) => view?.repaint(s),
  });
  document.body.innerHTML = "<div id=h></div>";
  const host = document.getElementById("h")!;
  view = makeArchView({ studio: st, root: () => "/p", savesToProject: () => true });
  bindActions(archActions(st, (m) => { prompts.push(m); return "x"; }));
  view.mount(host);
  return { st, host, saves, prompts };
}

const click = (host: HTMLElement, sel: string): void => (host.querySelector(sel) as HTMLElement).click();

describe("caso de uso", () => {
  test("a proposta aparece por cima: o desenho actual não muda nem se guarda", () => {
    const { st, saves } = setup();
    const before = JSON.stringify(st.state().design);
    const n = saves.length;
    st.receiveProposal(proposal());
    expect(JSON.stringify(st.state().design)).toBe(before);
    expect(saves.length).toBe(n);
    const p = st.state().proposal!;
    expect(p.title).toBe("Delonix vs Docker");
    // chega sem posições e é arrumada (auto-layout): o cartão do CLI fica acima do estado
    const y = (id: string) => p.design.components.find((c) => c.id === id)!.y;
    expect(y("cli")).toBeLessThan(y("state"));
    expect(y("state")).toBeLessThan(y("kernel"));
  });

  test("Accept: a proposta passa a ser o desenho (e guarda-se no cliente)", () => {
    const { st, saves } = setup();
    st.receiveProposal(proposal());
    st.acceptProposal();
    expect(st.state().proposal).toBeNull();
    expect(st.state().design.components.map((c) => c.id)).toEqual(["cli", "state", "kernel"]);
    expect((saves.at(-1) as Design).components.map((c) => c.id)).toEqual(["cli", "state", "kernel"]);
  });

  test("Discard: o desenho actual fica; uma proposta nova substitui a anterior", () => {
    const { st } = setup();
    st.receiveProposal(proposal());
    st.receiveProposal({ ...proposal(), title: "v2" });
    expect(st.state().proposal!.title).toBe("v2");
    st.discardProposal();
    expect(st.state().proposal).toBeNull();
    expect(st.state().design.components).toHaveLength(21);
  });

  test("uma proposta num Studio que ainda não abriu carrega primeiro o desenho da pasta", () => {
    const saves: unknown[] = [];
    const st = makeArchStudio({
      gateway: { available: () => true, validate: async () => [], preview: async () => [], scaffold: async () => [], ...ioGateway },
      renderer: fakeRenderer, files: fakeFiles(), repaint: () => {},
      store: { load: () => reference(), save: (_k, d) => saves.push(d) },
      workspace: { root: () => "/p", confirm: () => true, prompt: () => null },
    });
    st.receiveProposal(proposal());
    expect(st.state().design.components).toHaveLength(21); // não começou vazio
    st.discardProposal();
    expect(st.state().design.components).toHaveLength(21);
  });
});

describe("vista", () => {
  test("barra com a proposta, canvas com a proposta, inspector com a validação do backend", () => {
    const { st, host } = setup();
    st.receiveProposal(proposal());
    const bar = host.querySelector("[data-arch-bar]")!.textContent!;
    expect(bar).toMatch(/Co-Dev proposes: Delonix vs Docker/);
    expect(host.querySelector('[data-action="arch-accept"]')).not.toBeNull();
    expect(host.querySelector('[data-action="arch-add-group"]')).toBeNull();
    expect(host.querySelectorAll("[data-n]")).toHaveLength(3);
    expect(host.querySelector("[data-arch-svg]")!.innerHTML).toContain(">delonix run nginx</text>");
    const ins = host.querySelector("[data-arch-insp]")!.textContent!;
    expect(ins).toMatch(/does not change until you press Accept/);
    expect(ins).toMatch(/has no source/);
    // espreitar o desenho actual e voltar
    click(host, '[data-action="arch-peek"]');
    expect(host.querySelectorAll("[data-n]")).toHaveLength(21);
    click(host, '[data-action="arch-peek"]');
    expect(host.querySelectorAll("[data-n]")).toHaveLength(3);
  });

  test("enquanto há uma proposta, nada se edita: catálogo e canvas parados", () => {
    const { st, host, prompts } = setup();
    st.receiveProposal(proposal());
    click(host, '[data-action="arch-add"][data-on="daemon"]');
    expect(prompts).toEqual([]);
    expect(st.state().design.components).toHaveLength(21);
    host.querySelector('[data-n="cli"] rect')!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    expect(st.state().sel).toBeNull();
  });

  test("Accept e Discard pela barra", () => {
    const a = setup();
    a.st.receiveProposal(proposal());
    click(a.host, '[data-action="arch-accept"]');
    expect(a.st.state().design.components).toHaveLength(3);
    expect(a.host.querySelector('[data-action="arch-add-group"]')).not.toBeNull(); // barra normal
    const b = setup();
    b.st.receiveProposal(proposal());
    click(b.host, '[data-action="arch-discard"]');
    expect(b.st.state().design.components).toHaveLength(21);
    expect(b.host.querySelectorAll("[data-n]")).toHaveLength(21);
  });
});

describe("adaptador: o evento arch://proposal", () => {
  const G = globalThis as unknown as { __TAURI__?: unknown };
  let handlers: Record<string, (e: { payload: unknown }) => void> = {};
  beforeEach(() => {
    handlers = {};
    G.__TAURI__ = {
      core: { invoke: async () => null },
      event: { listen: async (name: string, h: (e: { payload: unknown }) => void) => { handlers[name] = h; return () => {}; } },
    };
  });
  afterEach(() => { delete G.__TAURI__; });

  test("subscreve o evento e traduz o JSON do Rust (sem os campos opcionais vazios)", async () => {
    const got: Proposal[] = [];
    tauriProposals.subscribe((p) => got.push(p));
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(handlers)).toEqual(["arch://proposal"]);
    handlers["arch://proposal"]({
      payload: {
        title: "Delonix vs Docker",
        arch: {
          components: [{ id: "cli", name: "delonix", kind: "cli", outbox: false, group: "host" }, { id: "d", name: "dockerd", kind: "daemon", outbox: false }],
          connections: [{ from: "cli", to: "d", event: "", protocol: "unix-socket" }],
          groups: [{ id: "host", label: "Host", kind: "host", style: "dashed" }],
          views: [{ id: "delonix", title: "Delonix", color: "", roots: ["host"], daemonless: true }],
        },
        findings: [{ severity: "warning", rule: "daemonless-claim", message: "m", component: "d" }],
      },
    });
    expect(got).toHaveLength(1);
    expect(got[0].title).toBe("Delonix vs Docker");
    expect(got[0].design.components[0]).toMatchObject({ id: "cli", kind: "cli", group: "host" });
    expect(got[0].design.connections[0].protocol).toBe("unix-socket");
    expect(got[0].design.views[0]).toMatchObject({ id: "delonix", daemonless: true, strict: false, roots: ["host"] });
    expect(got[0].findings[0].rule).toBe("daemonless-claim");
  });

  test("fora do desktop não subscreve nada", () => {
    delete G.__TAURI__;
    expect(() => tauriProposals.subscribe(() => {})).not.toThrow();
  });
});
