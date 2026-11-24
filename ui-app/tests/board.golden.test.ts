import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature backlog/sprints/kanban) para
 * `ui-app/src/features/board.ts`, via o harness que carrega a cadeia real de
 * módulos. Goldens do markup de `renderBoardView` em dois estados — backlog vazio
 * (empty state) e backlog povoado (um cartão por ramo de `cardH`: cada stage, tipo
 * fix/feature, com/sem resultados de teste, nota, ramo, merge e modelo) — e
 * caracterização do MOTOR a extrair: o PRODUTOR `genBacklogIssues` (decompõe o
 * design do Studio em issues/sprints) e a fábrica `mkIssue` (ids/defaults).
 * ANTES de mover qualquer um destes para `features/board/{domain,application}/`.
 *
 * A partir daqui, diff de golden = regressão (corrige o código, nunca o snapshot
 * — ver skill ui-golden-check). A caracterização do produtor fixa a decomposição
 * EXACTA (que issues, que agente/pts/sprint/testes/caminhos por tipo de componente)
 * para que a extracção do domínio/aplicação se prove byte-a-byte idêntica.
 *
 * Determinismo: o relógio é FIXADO (`setSystemTime`) antes de `bootApp` (padrão do
 * scm/debug.golden); embora o markup do board não interpole tempo, o `gitInit()`
 * do harness carimba `Date.now()` no DAG. Timers falsos só para neutralizar o
 * polling de arranque. Tudo o que `board.ts` precisa (BL/STAGES/AGENTS/PROV/RUN,
 * o design-semente `SD`, o catálogo `TECH` e os geradores) vive na cadeia do
 * harness — ao contrário do debug, não são precisos fixtures de v6/boot. */

let w: any;
let TMod: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7h)

/** Projecção serializável de uma issue: os campos que a LÓGICA DO BOARD decide
 *  (agente/pts/sprint/stage/testes) + os caminhos que `gen()` constrói. O CONTEÚDO
 *  dos ficheiros é dos geradores do monólito (fora do âmbito) — pinamos só os
 *  caminhos, que são lógica do produtor. As `tests[].fn` são predicados (corridos
 *  no autoTest), não os invocamos — guardamos só os nomes. */
function projectIssue(it: any): any {
  return {
    id: it.id, agent: it.agent, type: it.type, pts: it.pts, stage: it.stage,
    sprint: it.sprint, node: it.node ?? null, infra: !!it.infra, custom: !!it.custom,
    title: it.title, note: it.note,
  };
}

/** Constrói, por campos explícitos (sem passar por mkIssue, para controlar ids e
 *  cobrir todos os ramos), um backlog que exercita cada caminho de `cardH`. */
function seedRichBoard(): void {
  w.BL.issues = [
    { id: "DX-1", type: "feature", pts: 3, stage: "backlog", attempts: 0, res: null, note: "", model: null, branch: null, agent: "be", sprint: 0 },
    { id: "DX-2", type: "fix", pts: 2, stage: "dev", attempts: 1, res: [{ n: "a::x", ok: false }], note: "reprovado em teste: a::x", model: "claude", branch: "fix/dx-2-corrige", agent: "fe", sprint: 0 },
    { id: "DX-3", type: "feature", pts: 5, stage: "test", attempts: 0, res: null, note: "", model: "gemini", branch: "feature/dx-3-skeleton", agent: "be", sprint: 1 },
    { id: "DX-4", type: "feature", pts: 2, stage: "func", attempts: 0, res: [{ n: "t::a", ok: true }, { n: "t::b", ok: true }], note: "passou à 1.ª tentativa", model: "codex", branch: "feature/dx-4-web", agent: "fe", sprint: 1 },
    { id: "DX-5", type: "feature", pts: 3, stage: "done", attempts: 0, res: [{ n: "t::ok", ok: true }], note: "", model: "claude", branch: "feature/dx-5", merged: "a1b2c3d", agent: "db", sprint: 0 },
  ];
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // O `window` persiste entre testes no jsdom; `board.ts` reutiliza o `window.BL`
  // ao reavaliar. O boot reimporta a cadeia (board.ts re-cria `BL` fresco), mas
  // repomos por segurança para cada teste arrancar com um backlog vazio.
  (window as any).BL = undefined;
  w = await bootApp();
  TMod = await import("../src/features/team");
  w.RUN.active = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — Quadro (renderBoardView)", () => {
  it("backlog vazio: empty state (desenhar no Studio / gerar)", () => {
    expect(w.BL.issues).toEqual([]);
    const host = document.createElement("div");
    w.renderBoardView(null, host);
    expect(golden(host)).toMatchSnapshot("board-empty");
  });

  it("backlog povoado (view=Tudo): um cartão por ramo de cardH", () => {
    seedRichBoard();
    w.BL.view = -1;
    const host = document.createElement("div");
    w.renderBoardView(null, host);
    expect(golden(host)).toMatchSnapshot("board-all");
  });

  it("backlog povoado filtrado por Sprint 1 (view=0)", () => {
    seedRichBoard();
    w.BL.view = 0;
    const host = document.createElement("div");
    w.renderBoardView(null, host);
    expect(golden(host)).toMatchSnapshot("board-sprint0");
  });
});

describe("dispatch delegado (data-action) — Fase 4", () => {
  // O golden strippa onclick E data-action/data-on, logo NÃO prova que o listener
  // delegado dispara. Estes testes disparam cliques reais (via document, onde o
  // listener vive) e observam o efeito. Evitam o caminho que chama autoTest, porque
  // `sleep` nunca é publicado no window (BUG pré-existente — ver handoff): só o runner
  // completo lhe toca; delegate-custom/approve/view/reject não.
  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  function renderInto(): HTMLElement {
    const host = document.createElement("div"); host.id = "board-host"; document.body.appendChild(host);
    w.renderBoardView(null, host); return host;
  }

  it("view: clicar «Sprint 1» muda BL.view e re-renderiza", () => {
    seedRichBoard(); w.BL.view = -1; const host = renderInto();
    const btn = host.querySelector('[data-action="view"][data-on="0"]')!;
    expect(btn).toBeTruthy();
    click(btn);
    expect(w.BL.view).toBe(0);
  });

  /* ADR-0006, R3a: «Delegar» corre a issue com o agente real (aqui, falso): ramo gitflow →
     o agente escreve → commit do que mudou → testes do projecto → validação funcional. */
  it("delegate: com agente, cria o ramo, o agente implementa, commita e passa nos testes do projecto → func", async () => {
    const it = w.mkIssue({ title: "Lista de encomendas", agent: "be", sprint: 0, stage: "todo" });
    const story = vi.fn(async () => { w.writeFile(w.ROOT + "src/orders.rs", "pub fn list() {}\n"); });
    w.codevAgentAvailable = () => true;
    w.codevAgentStory = story;
    w.DXR = { root: "/proj", git: true, projectCmd: (k: string) => (k === "test" ? { cmd: "cargo test" } : null), exec: vi.fn(async () => ({ ok: true })) };
    try {
      w.BL.view = -1; const host = renderInto();
      click(host.querySelector(`[data-action="delegate"][data-on="${it.id}"]`)!);
      await vi.waitFor(() => expect(it.stage).toBe("func"));
      expect(story).toHaveBeenCalledWith({ id: it.id, title: "Lista de encomendas", type: "feature", pts: it.pts, note: "" });
      expect(it.branch).toMatch(/^feature\/dx-\d+-lista-de-encomendas/);
      expect(w.GIT.c[w.GIT.order[0]].m).toBe(`feat: Lista de encomendas (${it.id})`);
      expect(w.GIT.c[w.GIT.order[0]].files).toEqual([w.ROOT + "src/orders.rs"]);
      expect(w.DXR.exec).toHaveBeenCalledWith("cargo test");
      expect(w.BRANCH).toBe("develop"); // volta a develop no fim
    } finally { delete w.codevAgentAvailable; delete w.codevAgentStory; delete w.DXR; }
  });

  it("delegate: o agente não mudou nada → fica em dev com a nota, sem commit", async () => {
    const it = w.mkIssue({ title: "nada", agent: "be", sprint: 0, stage: "todo" });
    w.codevAgentAvailable = () => true;
    w.codevAgentStory = async () => {};
    const before = w.GIT.order.length;
    try {
      await w.delegate(it.id);
      expect(it.stage).toBe("dev");
      expect(it.note).toBe("o agente não alterou ficheiros");
      expect(w.GIT.order.length).toBe(before);
    } finally { delete w.codevAgentAvailable; delete w.codevAgentStory; }
  });

  it("delegate: sem agente (browser), di-lo e não mexe na issue", async () => {
    const it = w.mkIssue({ title: "sem agente", agent: "be", sprint: 0, stage: "todo" });
    await w.delegate(it.id);
    expect(it.stage).toBe("todo");
    expect(document.getElementById("ag-msgs")!.textContent).toMatch(/There is no agent available/);
  });

  it("approve: clicar «Validar» numa issue func já revista → done (gfFinish + setStage)", () => {
    const it = w.mkIssue({ title: "val", agent: "be", sprint: 0, stage: "func", res: [{ n: "t", ok: true }] });
    // O harness por omissão pede a revisão do diff antes de validar (HARN.review). Desde a
    // U4g3 do ADR-0004 essa política é composta pelo board.ts e entra no harness de testes
    // (antes vivia no v5.ts, fora dele) — a issue tem de estar revista, como na app real.
    it.reviewed = true;
    w.BL.view = -1; const host = renderInto();
    const btn = host.querySelector(`[data-action="approve"][data-on="${it.id}"]`)!;
    expect(btn).toBeTruthy();
    click(btn);
    expect(it.stage).toBe("done");
  });
});

describe("políticas compostas pelo board (ADR-0004, U4g3)", () => {
  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  function renderInto(): HTMLElement {
    const host = document.createElement("div"); host.id = "board-host"; document.body.appendChild(host);
    w.renderBoardView(null, host); return host;
  }

  it("revisão antes de validar: «Validar» sem revisão abre a revisão e a issue fica em func", () => {
    const it = w.mkIssue({ title: "rev", agent: "be", sprint: 0, stage: "func", res: [{ n: "t", ok: true }] });
    expect(TMod.HARN.review).toBe(true);
    w.BL.view = -1; const host = renderInto();
    click(host.querySelector(`[data-action="approve"][data-on="${it.id}"]`)!);
    expect(it.stage).toBe("func");
    expect(it.reviewed).toBe(true);
    expect(w.TB.some((t: any) => t.id === "review" && t.issue === it.id)).toBe(true);
  });

  it("dono humano: delegar uma issue tua não a move", () => {
    const it = w.mkIssue({ title: "mine", agent: "lead", sprint: 0, stage: "todo", custom: true });
    it.owner = "you";
    w.openIssue = () => {}; // a vista de issue não interessa aqui
    w.BL.view = -1; const host = renderInto();
    click(host.querySelector(`[data-action="delegate"][data-on="${it.id}"]`)!);
    expect(it.stage).toBe("todo");
  });
});

describe("caracterização do motor — produtor Studio→backlog (a extrair)", () => {
  it("genBacklogIssues: uma issue por componente planeado (sem código: o contexto vai na nota)", () => {
    // O seed deixa os 8 componentes do design em estado `plan`. Decompomos todos.
    const plan = w.SD.nodes.filter((n: any) => n.st === "plan");
    expect(plan.length).toBe(8);
    const made = w.genBacklogIssues(plan);
    expect(made.map(projectIssue)).toMatchSnapshot("genBacklogIssues-seed");
  });

  it("mkIssue: ids sequenciais (DX-seq) e defaults da fábrica", () => {
    const a = w.mkIssue({ title: "primeira", agent: "be" });
    const b = w.mkIssue({ title: "segunda", agent: "fe", type: "fix", pts: 8, stage: "todo" });
    expect(projectIssue(a)).toMatchSnapshot("mkIssue-default");
    expect(projectIssue(b)).toMatchSnapshot("mkIssue-override");
    expect(a.id).toBe("DX-11");
    expect(b.id).toBe("DX-12");
    expect(w.BL.issues.length).toBe(2);
  });
});
