// `/backlog` e `/project` (conjunto 11): o domínio da proposta, o cartão no chat (criar o Project e entregar uma
// issue Ready ao Co-Dev) e o pedido do «Generate backlog» do Studio. Sem Tauri: os efeitos são fakes.
import { beforeAll, expect, test, vi } from "vitest";
import { backlogCommand, byEpic, parseBacklogProposal, pointsOf, unplanned } from "../src/features/codev/domain/backlog";
import { bindBacklogActions, createdHtml, proposalHtml, type BacklogActionDeps } from "../src/features/codev/ui/backlog-view";
import { studioBacklogRequest, studioComponents } from "../src/features/board/domain/backlog-context";
import { parseBacklogCreated } from "../src/features/project/domain/backlog";

const draft = {
  title: "Shop",
  summary: "",
  epics: [{ id: "E1", title: "Orders", description: "" }],
  issues: [
    { ref: "B1", title: "Place an order", kind: "story", priority: "high", points: 3, epic: "E1", storyAs: "a customer", storyWant: "to order", storySo: "I get goods", description: "", acceptance: ["Given a cart, when I pay, then it is saved"], scope: ["src/orders/new.rs"], deps: [], component: "" },
    { ref: "B2", title: "List orders", kind: "task", priority: "medium", points: 2, epic: "E1", storyAs: "", storyWant: "", storySo: "", description: "", acceptance: ["Given orders, when I open the list, then I see them"], scope: ["src/orders/list.rs"], deps: ["B1"], component: "" },
    { ref: "B3", title: "Docs <b>", kind: "task", priority: "low", points: null, epic: "", storyAs: "", storyWant: "", storySo: "", description: "", acceptance: ["Given x, when y, then z"], scope: ["README.md"], deps: [], component: "" },
  ],
};
const plan = { method: "scrum", iterDays: 14, keyPrefix: null, dor: null, dod: null, sprints: [{ name: "Sprint 1", goal: "Order", capacity: 5, issues: ["B1", "B2"] }] };
const event = (kind: string, p: unknown = plan) => ({ session: "S1", proposal: { kind, path: ".dxtutor/backlog.json", hash: "abc", draft, plan: kind === "project" ? p : null } });

test("o comando: só /backlog e /project, inteiros", () => {
  expect(backlogCommand("/backlog uma loja")).toBe("backlog");
  expect(backlogCommand("  /project")).toBe("project");
  expect(backlogCommand("/backlogs")).toBeNull();
  expect(backlogCommand("faz o /backlog")).toBeNull();
});

test("a proposta estreita-se; o plano vai tal como veio para o backend", () => {
  const b = parseBacklogProposal(event("backlog"))!;
  expect(b.kind).toBe("backlog");
  expect(b.plan).toBeNull();
  expect(b.draft.issues.map((i) => i.ref)).toEqual(["B1", "B2", "B3"]);
  const p = parseBacklogProposal(event("project"))!;
  expect(p.plan!.sprints[0].issues).toEqual(["B1", "B2"]);
  expect(p.rawPlan).toBe(plan);
  expect(pointsOf(p.draft.issues)).toBe(5);
  expect(byEpic(p.draft).map((g) => [g.epic?.id ?? null, g.issues.length])).toEqual([["E1", 2], [null, 1]]);
  expect(unplanned(p.draft, p.plan!).map((i) => i.ref)).toEqual(["B3"]);
  // what is not a proposal
  expect(parseBacklogProposal({ session: "S1", proposal: { kind: "other", hash: "x", draft } })).toBeNull();
  expect(parseBacklogProposal({ session: "S1", proposal: { kind: "project", hash: "x", draft, plan: null } })).toBeNull();
  expect(parseBacklogProposal({ session: "S1", proposal: { kind: "backlog", hash: "", draft } })).toBeNull();
  expect(parseBacklogProposal(null)).toBeNull();
});

let deps: BacklogActionDeps;
const created = { created: [["B1", "SHOP-1"], ["B2", "SHOP-2"], ["B3", "SHOP-3"]] as Array<[string, string]>, existing: [], sprints: ["S1"], ready: ["SHOP-1", "SHOP-3"], notReady: [{ key: "SHOP-2", missing: ["dependência SHOP-1 em Done"] }] };
beforeAll(() => {
  deps = { openFile: vi.fn(), prefill: vi.fn(), create: vi.fn(async () => created), openProject: vi.fn(), workOn: vi.fn() };
  bindBacklogActions(deps);
});

const mount = (html: string): HTMLElement => {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
};
const click = (el: Element | null) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));

test("o cartão do backlog: épicos, issues com âmbito e dependências (escapadas), e o passo seguinte", () => {
  const card = mount(proposalHtml(parseBacklogProposal(event("backlog"))!));
  expect(card.textContent).toContain("Backlog «Shop»");
  expect(card.textContent).toContain("1 epics · 3 issues · 5 points");
  expect(card.textContent).toContain("src/orders/list.rs");
  expect(card.textContent).toContain("after B1");
  expect(card.innerHTML).toContain("Docs &lt;b&gt;");
  expect(card.querySelector('[data-action="codev-backlog:create"]')).toBeNull();
  click(card.querySelector('[data-action="codev-backlog:open"]'));
  expect(deps.openFile).toHaveBeenCalledWith(".dxtutor/backlog.json");
  click(card.querySelector('[data-action="codev-backlog:next"]'));
  expect(deps.prefill).toHaveBeenCalledWith("/project ");
});

test("o cartão do plano: criar com Ready mostra as issues prontas, cada uma com o botão do Co-Dev", async () => {
  const card = mount(proposalHtml(parseBacklogProposal(event("project"))!));
  expect(card.textContent).toContain("Method: scrum · 14-day iterations");
  expect(card.textContent).toContain("Sprint 1 — 2 issues, 5 points");
  expect(card.textContent).toContain("Product backlog — 1 issues");
  click(card.querySelector('[data-action="codev-backlog:create-ready"]'));
  await vi.waitFor(() => expect(card.querySelector(".bl-ok")).not.toBeNull());
  expect(deps.create).toHaveBeenCalledWith({ hash: "abc", plan, ready: true, issues: 3, sprints: 1 });
  expect(card.querySelector(".bl-ok")!.textContent).toBe("Project created: 3 issues, 1 sprints.");
  expect(card.textContent).toContain("SHOP-2 waits for: dependência SHOP-1 em Done");
  const work = Array.from(card.querySelectorAll('[data-action="codev-backlog:work"]')).map((b) => b.getAttribute("data-on"));
  expect(work).toEqual(["SHOP-1", "SHOP-3"]);
  click(card.querySelector('[data-action="codev-backlog:work"]'));
  expect(deps.workOn).toHaveBeenCalledWith("SHOP-1");
  click(card.querySelector('[data-action="codev-backlog:project"]'));
  expect(deps.openProject).toHaveBeenCalled();
});

test("recusado (ou falhou): diz que não foi criado e os botões voltam", async () => {
  (deps.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
  const card = mount(proposalHtml(parseBacklogProposal(event("project"))!));
  click(card.querySelector('[data-action="codev-backlog:create"]'));
  await vi.waitFor(() => expect(card.querySelector(".bl-res")!.textContent).toBe("The Project was not created."));
  expect(deps.create).toHaveBeenLastCalledWith(expect.objectContaining({ ready: false }));
  expect(Array.from(card.querySelectorAll<HTMLButtonElement>(".bl-act button")).every((b) => !b.disabled)).toBe(true);
});

test("sem nenhuma Ready, o resultado di-lo", () => {
  const el = mount(`<div>${createdHtml({ created: [["B1", "S-1"]], existing: [["B2", "S-2"]], sprints: [], ready: [], notReady: [] })}</div>`);
  expect(el.textContent).toContain("Project created: 1 issues, 1 already there.");
  expect(el.textContent).toContain("None is Ready yet");
});

test("o que o Project devolveu estreita-se", () => {
  const project = { root: "/w", keyPrefix: "S", method: "scrum", iterDays: 14, wip: {}, dor: [], dod: [], checks: [], issues: [], sprints: [], releases: [], retro: [], inbox: [] };
  const c = parseBacklogCreated({ project, created: [["B1", "S-1"], ["bad"]], existing: [], sprints: ["S1"], ready: ["S-1"], notReady: [{ key: "S-2", missing: ["x"] }, { nokey: 1 }] });
  expect(c).not.toBeNull();
  expect(c!.created).toEqual([["B1", "S-1"]]);
  expect(c!.notReady).toEqual([{ key: "S-2", missing: ["x"] }]);
  expect(parseBacklogCreated({ created: [] })).toBeNull();
});

test("o Studio pede o /backlog com o desenho: um componente por linha, com a pasta, o estado e as ligações", () => {
  const design = {
    nodes: [
      { id: "a", n: "orders-api", tech: "rust", st: "plan", x: 0, y: 0 },
      { id: "b", n: "db", tech: "pg", st: "ok", x: 0, y: 0 },
    ],
    edges: [["a", "b"]] as Array<[string, string]>,
  };
  const names: Record<string, string> = { rust: "Rust (axum)", pg: "PostgreSQL" };
  const c = studioComponents(design as never, (k) => names[k], (n) => `apps/${(n as { n: string }).n}`);
  expect(c).toEqual([
    { name: "orders-api", tech: "Rust (axum)", folder: "apps/orders-api", state: "planned", links: ["db"] },
    { name: "db", tech: "PostgreSQL", folder: "apps/db", state: "done", links: [] },
  ]);
  const q = studioBacklogRequest(c);
  expect(backlogCommand(q)).toBe("backlog");
  expect(q).toContain("- orders-api (Rust (axum), folder apps/orders-api/, planned) → db");
  expect(studioBacklogRequest([])).toBe("/backlog from the code of this folder");
});
