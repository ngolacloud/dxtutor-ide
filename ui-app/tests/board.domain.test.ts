import { describe, expect, it } from "vitest";
import { slug } from "../src/features/board/domain/slug";
import { STAGES, makeIssue } from "../src/features/board/domain/issue";
import { inView, points, nodeStatus, autoSprint, sprintCounts } from "../src/features/board/domain/kanban";
import type { Issue } from "../src/features/board/domain/types";

/* Testes unitários do domínio PURO da feature backlog/sprints/kanban (ADR-0002,
 * Fase 2). Cobrem o slug, a fábrica de issues, as colunas e os selectores do
 * quadro — tudo sem DOM/window. A caracterização do PRODUTOR (genBacklogIssues) e
 * o golden do pane vivem em board.golden.test.ts; aqui prova-se a semântica pura
 * que esses dois dependem. */

/** Issue mínima para os selectores (só os campos que eles lêem). */
const mk = (o: Partial<Issue>): Issue => makeIssue(0, { title: "t", agent: "be", sprint: 0, ...o });

describe("slug", () => {
  it("minúsculas, acentos removidos, separadores colapsados", () => {
    expect(slug("Exportar Relatório")).toBe("exportar-relatorio");
    expect(slug("Órders API — v2")).toBe("orders-api-v2");
  });
  it("apara traços nas pontas e colapsa símbolos", () => {
    expect(slug("  ##Olá, Mundo!!  ")).toBe("ola-mundo");
    expect(slug("a___b   c")).toBe("a-b-c");
  });
  it("tudo não-alfanumérico → string vazia", () => {
    expect(slug("—/—")).toBe("");
  });
});

describe("makeIssue (fábrica pura)", () => {
  it("defaults + id a partir do seq", () => {
    const it = makeIssue(11, { title: "x", agent: "arq", sprint: 1 });
    expect(it.id).toBe("DX-11");
    expect(it.type).toBe("feature");
    expect(it.pts).toBe(3);
    expect(it.stage).toBe("backlog");
    expect(it).toMatchObject({ attempts: 0, tests: [], res: null, note: "", model: null, branch: null });
  });
  it("as sobreposições ganham aos defaults", () => {
    const it = makeIssue(12, { title: "fix", agent: "fe", type: "fix", pts: 8, stage: "todo", custom: true });
    expect(it).toMatchObject({ id: "DX-12", type: "fix", pts: 8, stage: "todo", custom: true });
  });
  it("não muta estado partilhado (chamadas independentes)", () => {
    const a = makeIssue(1, { title: "a", agent: "be", sprint: 0 });
    const b = makeIssue(2, { title: "b", agent: "be", sprint: 0 });
    expect(a.tests).not.toBe(b.tests); // arrays distintos por issue
  });
});

describe("STAGES", () => {
  it("as 6 colunas por ordem", () => {
    expect(STAGES.map(([k]) => k)).toEqual(["backlog", "todo", "dev", "test", "func", "done"]);
  });
});

describe("selectores do quadro", () => {
  const issues: Issue[] = [
    mk({ sprint: 0, stage: "done", pts: 3, node: "api" }),
    mk({ sprint: 0, stage: "dev", pts: 2, node: "api" }),
    mk({ sprint: 0, stage: "func", pts: 5, node: "web" }),
    mk({ sprint: 1, stage: "backlog", pts: 8, node: "db" }),
    mk({ sprint: 1, stage: "done", pts: 1, node: "db" }),
  ];

  it("inView: Tudo (-1) devolve todas; por sprint filtra", () => {
    expect(inView(issues, -1)).toHaveLength(5);
    expect(inView(issues, 0)).toHaveLength(3);
    expect(inView(issues, 1)).toHaveLength(2);
  });

  it("points: total e concluído da lista", () => {
    expect(points(issues)).toEqual({ total: 19, done: 4 });
    expect(points(inView(issues, 0))).toEqual({ total: 10, done: 3 });
  });

  it("nodeStatus: ok só quando TODAS as issues do nó estão done", () => {
    expect(nodeStatus(issues, "api")).toBe("wip"); // uma em dev
    expect(nodeStatus(issues, "db")).toBe("wip"); // uma em backlog
    expect(nodeStatus(issues, "web")).toBe("wip"); // func
    expect(nodeStatus([mk({ node: "x", stage: "done" }), mk({ node: "x", stage: "done" })], "x")).toBe("ok");
    expect(nodeStatus([], "x")).toBe("ok"); // every() de vazio = true
  });

  it("autoSprint: 0 enquanto há todo/backlog no Sprint 1, senão 1", () => {
    expect(autoSprint(issues)).toBe(1); // sprint 0 não tem todo/backlog
    expect(autoSprint([mk({ sprint: 0, stage: "todo" })])).toBe(0);
    expect(autoSprint([mk({ sprint: 0, stage: "backlog" })])).toBe(0);
    expect(autoSprint([mk({ sprint: 0, stage: "dev" })])).toBe(1);
  });

  it("sprintCounts: func vs dev por sprint", () => {
    expect(sprintCounts(issues, 0)).toEqual({ func: 1, dev: 1 });
    expect(sprintCounts(issues, 1)).toEqual({ func: 0, dev: 0 });
  });
});
