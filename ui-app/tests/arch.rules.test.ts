// Studio de arquitectura (F5.2/F5.5, RF-A01/A04): o painel «Rules» — as regras do arquitecto
// (`.dxtutor/architecture.toml`) como formulário, as camadas que nascem do desenho, os ADR e o
// commit do arquitecto. A validação, o papel e a escrita são do Rust (testados lá); aqui ficam
// o domínio, o caso de uso com o gateway falso e o painel pelo despachante real.
import { describe, test, expect, vi } from "vitest";
import { fromArchitecture } from "../src/features/arch/domain/design";
import { layerName, layersFromDesign, parseRules, parseRulesDoc, rulesToWire, splitList, emptyRules, type Adr, type ArchRules, type RulesDoc } from "../src/features/arch/domain/rules";
import { makeRulesEditor } from "../src/features/arch/application/rules";
import { makeArchStudio } from "../src/features/arch/application/studio";
import type { ArchGateway, RulesGateway } from "../src/features/arch/application/ports";
import { makeArchView } from "../src/features/arch/ui/view";
import { bindActions } from "../src/features/arch/ui/actions";
import { archActions } from "../src/features/arch/ui/table";
import { fakeFiles, fakeRenderer, ioGateway } from "./fixtures/arch-fakes";

/** Um desenho com três camadas: UI → Application → Domain, e um componente fora de camadas. */
const layered = () =>
  fromArchitecture({
    components: [
      { id: "web", name: "Web", kind: "service", outbox: false, group: "ui" },
      { id: "orders", name: "Orders", kind: "service", outbox: false, group: "app-inner" },
      { id: "model", name: "Order", kind: "service", outbox: false, group: "dom" },
      { id: "db", name: "Postgres", kind: "store", outbox: false },
    ],
    connections: [
      { from: "web", to: "orders", event: "" },
      { from: "orders", to: "model", event: "" },
      { from: "web", to: "orders", event: "" },
      { from: "orders", to: "db", event: "" },
    ],
    groups: [
      { id: "ui", label: "UI", kind: "layer", style: "dashed" },
      { id: "app", label: "Application Layer", kind: "layer", style: "dashed" },
      { id: "app-inner", label: "Use cases", kind: "module", style: "dashed", parent: "app" },
      { id: "dom", label: "Domínio", kind: "layer", style: "dashed" },
      { id: "host", label: "Host", kind: "host", style: "dashed" },
    ],
    views: [],
  });

describe("domínio", () => {
  test("o que o serde manda: may_use ausente = qualquer camada; vazio = nenhuma", () => {
    const r = parseRules({ layers: [{ name: "domain", paths: ["src/domain/**"], may_use: [] }, { name: "ui", paths: ["src/ui/**"] }], libraries: { forbidden: ["moment"] } });
    expect(r.layers.map((l) => l.mayUse)).toEqual([[], null]);
    expect(r.libraries).toEqual({ forbidden: ["moment"], approved: [] });
    const wire = rulesToWire(r) as { layers: Array<Record<string, unknown>> };
    expect(wire.layers[0].may_use).toEqual([]);
    expect("may_use" in wire.layers[1]).toBe(false);
    expect(parseRules(rulesToWire(r))).toEqual(r);
    expect(parseRulesDoc({ exists: true, rules: {}, error: "", canEdit: true, note: "n" })).toEqual({ exists: true, rules: emptyRules(), error: null, canEdit: true, note: "n" });
    expect(splitList(" a, b ,, c ")).toEqual(["a", "b", "c"]);
    expect(layerName("Application Layer")).toBe("application_layer");
    expect(layerName("Domínio")).toBe("dominio");
  });

  test("as camadas nascem dos grupos «Layer» e as setas entre elas dizem quem pode usar quem", () => {
    const { rules, added, uses } = layersFromDesign(layered(), emptyRules());
    expect(added).toEqual(["ui", "application_layer", "dominio"]);
    expect(rules.layers.map((l) => [l.name, l.paths, l.mayUse])).toEqual([
      ["ui", ["src/ui/**"], ["application_layer"]],
      // «Use cases» é um módulo dentro da camada «Application Layer»: conta como ela
      ["application_layer", ["src/application_layer/**"], ["dominio"]],
      ["dominio", ["src/dominio/**"], []],
    ]);
    expect(uses).toEqual(["ui → application_layer", "application_layer → dominio"]);
    // juntar outra vez não muda nada; o que o arquitecto já escreveu fica
    const mine: ArchRules = { ...emptyRules(), layers: [{ name: "ui", paths: ["web/**"], mayUse: null, imports: [] }] };
    const again = layersFromDesign(layered(), mine);
    expect(again.rules.layers[0]).toEqual({ name: "ui", paths: ["web/**"], mayUse: null, imports: [] });
    expect(again.added).toEqual(["application_layer", "dominio"]);
    expect(mine.layers).toHaveLength(1); // não muda o que recebeu
    expect(layersFromDesign(layered(), rules)).toMatchObject({ added: [], uses: [] });
  });
});

function fakeGateway(over: Partial<RulesGateway> = {}) {
  const calls: Array<[string, unknown]> = [];
  let doc: RulesDoc = { exists: false, rules: emptyRules(), error: null, canEdit: true, note: "" };
  let adrs: Adr[] = [{ path: "docs/architecture/ADR-0007-queue.md", id: "ADR-0007", title: "Queue", status: "proposed", accepted: false }];
  const gateway: RulesGateway = {
    available: () => true,
    load: async () => doc,
    adrs: async () => adrs,
    save: async (_r, rules) => {
      calls.push(["save", JSON.parse(JSON.stringify(rules))]);
      if (rules.layers.some((l) => !l.paths.length)) throw "layer «x»: it needs at least one path\nnaming rule 1: the pattern does not compile";
      doc = { ...doc, exists: true, rules };
      return doc;
    },
    acceptAdr: async (_r, path) => {
      calls.push(["accept", path]);
      adrs = adrs.map((a) => (a.path === path ? { ...a, status: "accepted", accepted: true } : a));
      return adrs.find((a) => a.path === path)!;
    },
    commit: async (_r, paths, message) => { calls.push(["commit", { paths, message }]); return "abc1234"; },
    ...over,
  };
  return { gateway, calls, setDoc: (d: Partial<RulesDoc>) => { doc = { ...doc, ...d }; } };
}

function editor(over: Partial<RulesGateway> = {}, answers: { confirm?: boolean; prompt?: string | null } = {}) {
  const g = fakeGateway(over);
  const repaint = vi.fn();
  const prompts: Array<[string, string]> = [];
  const ed = makeRulesEditor({
    gateway: g.gateway,
    workspace: { root: () => "/p", confirm: () => answers.confirm ?? true, prompt: (m, i) => { prompts.push([m, i]); return answers.prompt === undefined ? i : answers.prompt; } },
    design: layered,
    repaint,
  });
  return { ed, ...g, repaint, prompts };
}

describe("caso de uso", () => {
  test("abre e lê; as camadas do desenho; grava e o commit leva só o ficheiro das regras", async () => {
    const { ed, calls, prompts } = editor();
    await ed.toggle();
    expect(ed.state().open).toBe(true);
    expect(ed.state().adrs).toHaveLength(1);
    ed.fromDesign();
    expect(ed.state().draft.layers.map((l) => l.name)).toEqual(["ui", "application_layer", "dominio"]);
    expect(ed.state().message).toContain("New layers: ui, application_layer, dominio");
    expect(ed.state().dirty).toBe(true);
    ed.setLayerPaths(2, ["src/domain/**"]);
    ed.setLibraries("forbidden", ["moment"]);
    expect(await ed.save()).toBe(true);
    expect(calls[0][0]).toBe("save");
    expect((calls[0][1] as ArchRules).layers[2].paths).toEqual(["src/domain/**"]);
    expect(ed.state().dirty).toBe(false);
    expect(ed.state().changed).toEqual([".dxtutor/architecture.toml"]);
    expect(await ed.commit()).toBe("abc1234");
    expect(prompts[0][1]).toBe("docs(arch): update the architect's rules");
    expect(calls.at(-1)).toEqual(["commit", { paths: [".dxtutor/architecture.toml"], message: "docs(arch): update the architect's rules" }]);
    expect(ed.state().changed).toEqual([]);
    expect(ed.state().message).toBe("Committed abc1234.");
  });

  test("o backend recusa: cada problema aparece, nada fica dado como gravado", async () => {
    const { ed } = editor();
    await ed.toggle();
    ed.addLayer();
    expect(await ed.save()).toBe(false);
    expect(ed.state().error.split("\n")).toEqual(["layer «x»: it needs at least one path", "naming rule 1: the pattern does not compile"]);
    expect(ed.state().changed).toEqual([]);
    expect(ed.state().dirty).toBe(true);
  });

  test("aceitar um ADR pede confirmação; o commit propõe a mensagem com o id", async () => {
    const no = editor({}, { confirm: false });
    await no.ed.toggle();
    await no.ed.acceptAdr("docs/architecture/ADR-0007-queue.md");
    expect(no.calls).toEqual([]);
    const { ed, calls, prompts } = editor();
    await ed.toggle();
    await ed.acceptAdr("docs/architecture/ADR-0007-queue.md");
    expect(calls).toEqual([["accept", "docs/architecture/ADR-0007-queue.md"]]);
    expect(ed.state().adrs[0].accepted).toBe(true);
    await ed.commit();
    expect(prompts[0][1]).toBe("docs(adr): accept ADR-0007");
    // cancelar o commit não commita
    const c = editor({}, { prompt: null });
    await c.ed.toggle();
    await c.ed.acceptAdr("docs/architecture/ADR-0007-queue.md");
    expect(await c.ed.commit()).toBeNull();
    expect(c.calls.some(([k]) => k === "commit")).toBe(false);
  });

  test("«May depend on any layer» tira e repõe o may_use; sem nada novo no desenho, diz como", async () => {
    const { ed } = editor();
    await ed.toggle();
    ed.addLayer();
    ed.setLayerFree(0, true);
    expect(ed.state().draft.layers[0].mayUse).toBeNull();
    ed.setLayerUses(0, ["x"]); // sem efeito enquanto é livre
    expect(ed.state().draft.layers[0].mayUse).toBeNull();
    ed.setLayerFree(0, false);
    expect(ed.state().draft.layers[0].mayUse).toEqual([]);
    const none = makeRulesEditor({ gateway: fakeGateway().gateway, workspace: { root: () => "/p", confirm: () => true, prompt: () => null }, design: () => fromArchitecture({ components: [], connections: [], groups: [], views: [] }), repaint: () => undefined });
    none.fromDesign();
    expect(none.state().message).toContain("make a group of kind «Layer»");
  });
});

describe("o painel no Studio", () => {
  function mounted(over: Partial<RulesGateway> = {}, doc: Partial<RulesDoc> = {}) {
    const g = fakeGateway(over);
    g.setDoc(doc);
    const gateway: ArchGateway = { available: () => true, validate: async () => [], preview: async () => [], scaffold: async () => [], ...ioGateway };
    let view: ReturnType<typeof makeArchView> | null = null;
    const st = makeArchStudio({
      gateway, renderer: fakeRenderer, files: fakeFiles(),
      store: { load: () => layered(), save: () => undefined },
      workspace: { root: () => "/p", confirm: () => true, prompt: () => "x" },
      repaint: (s) => view?.repaint(s),
    });
    const rules = makeRulesEditor({ gateway: g.gateway, workspace: { root: () => "/p", confirm: () => true, prompt: (_m, i) => i }, design: () => st.state().design, repaint: () => view?.repaint("all") });
    document.body.innerHTML = "<div id=h></div>";
    const host = document.getElementById("h")!;
    view = makeArchView({ studio: st, rules, root: () => "/p", savesToProject: () => true });
    bindActions(archActions(st, () => "x", rules));
    view.mount(host);
    return { host, st, rules, ...g };
  }
  const click = (host: HTMLElement, sel: string): void => (host.querySelector(sel) as HTMLElement).click();

  test("«§ Rules» abre o painel; as camadas do desenho; gravar; aceitar o ADR; commitar", async () => {
    const { host, rules, calls, st } = mounted();
    click(host, '[data-action="arch-io"]');
    expect(st.state().io).toBe(true);
    click(host, '[data-action="arch-rules"]');
    expect(st.state().io).toBe(false); // um de cada vez
    // the title shows while loading; the form once the rules came
    await vi.waitFor(() => expect(host.querySelector('[data-action="arch-rl-save"]')).not.toBeNull());
    expect(host.querySelector("[data-arch-insp]")!.textContent).toContain("Architect's rules");
    expect(host.querySelector('[data-action="arch-rules"]')!.className).toContain("pri");
    click(host, '[data-action="arch-rl-from"]');
    expect(host.querySelectorAll(".arch-rl")).toHaveLength(3);
    const paths = host.querySelector('[data-action="arch-rl-paths"][data-on="0"]') as HTMLInputElement;
    expect(paths.value).toBe("src/ui/**");
    paths.value = "web/**, ui/**";
    paths.dispatchEvent(new Event("change", { bubbles: true }));
    expect(rules.state().draft.layers[0].paths).toEqual(["web/**", "ui/**"]);
    click(host, '[data-action="arch-rl-save"]');
    await vi.waitFor(() => expect(host.textContent).toContain("Saved .dxtutor/architecture.toml"));
    click(host, '[data-action="arch-adr-accept"]');
    await vi.waitFor(() => expect(host.querySelector('[data-action="arch-adr-accept"]')).toBeNull());
    click(host, '[data-action="arch-rl-commit"]');
    await vi.waitFor(() => expect(host.textContent).toContain("Committed abc1234."));
    expect(calls.at(-1)).toEqual(["commit", { paths: [".dxtutor/architecture.toml", "docs/architecture/ADR-0007-queue.md"], message: "docs(arch): update the architect's rules; accept ADR-0007" }]);
    // o Import/Export volta a fechar o painel
    click(host, '[data-action="arch-io"]');
    expect(rules.state().open).toBe(false);
  });

  test("quem não é arquitecto vê as regras só para ler e porquê; fora do desktop, onde estão", async () => {
    const { host } = mounted({}, { exists: true, canEdit: false, note: "Only the architect changes the rules and accepts ADRs (.dxtutor/team.json).", rules: { ...emptyRules(), layers: [{ name: "domain", paths: ["src/domain/**"], mayUse: [], imports: [] }] } });
    click(host, '[data-action="arch-rules"]');
    await vi.waitFor(() => expect(host.textContent).toContain("Only the architect changes the rules"));
    expect((host.querySelector('[data-action="arch-rl-name"]') as HTMLInputElement).disabled).toBe(true);
    expect((host.querySelector('[data-action="arch-rl-save"]') as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('[data-action="arch-rl-add"]')).toBeNull();
    expect(host.querySelector('[data-action="arch-adr-accept"]')).toBeNull();
  });

  test("fora do desktop (ou sem pasta) o painel abre na mesma e diz onde vivem as regras", async () => {
    const off = mounted({ available: () => false });
    const insp = (): string => off.host.querySelector("[data-arch-insp]")!.textContent ?? "";
    expect(insp()).not.toContain("Architect's rules");
    click(off.host, '[data-action="arch-rules"]');
    await vi.waitFor(() => expect(insp()).toContain("open a folder in the desktop app"));
    expect(off.host.querySelector('[data-action="arch-rules"]')!.className).toContain("pri");
  });
});
