import { describe, expect, it } from "vitest";
import { makeBoardEngine } from "../src/features/board/application/board-engine";
import type { BoardDeps } from "../src/features/board/application/ports";
import type { Backlog, Design } from "../src/features/board/domain/types";

/* Backlog fase 1 (docs/v2/QUESTIONS.md, Q3): cada issue pertence a um projecto. As entradas da
 * interface que criam issues (nova issue, gerar backlog do Studio) recusam sem pasta aberta e
 * dizem-no; com pasta, criam como antes. O `mkIssue` (a fábrica) fica sem guarda. */

function engineWith(project: string | null) {
  const BL: Backlog = { issues: [], seq: 11, mig: 3, adr: 4, view: -1 };
  const D: Design = { nodes: [{ id: "n1", n: "orders", tech: "rust", st: "plan" }], edges: [] } as unknown as Design;
  const toasts: string[] = [], palettes: string[] = [];
  const deps = {
    copy: (k: string) => k,
    store: { backlog: () => BL, design: () => D, saveDesign: () => {}, project: () => project },
    catalog: { tech: () => ({ rust: { n: "Rust", kind: "app" } }), isApp: () => true, appDir: () => "orders" },
    generators: { validateDesign: () => [] },
    directory: { agents: () => ({ lead: { n: "Lead" }, arq: { n: "Arq" }, be: { n: "Be" }, ops: { n: "Ops" }, qa: { n: "Qa" } }) },
    runctl: { active: () => false },
    chat: { focusAgent: () => {}, card: () => ({ tools: null, bd: null }) },
    notifier: { toast: (m: string) => toasts.push(m), log: () => {} },
    view: { rerender: () => {} },
    nav: { openTab: () => {}, palette: (_pre: string, cfg: { verb?: string }) => palettes.push(cfg.verb || "") },
  } as unknown as BoardDeps;
  return { engine: makeBoardEngine(deps), BL, toasts, palettes };
}

describe("o quadro não cria issues soltas", () => {
  it("sem pasta de projecto, «Nova issue» e «Gerar backlog» recusam e dizem porquê", () => {
    const { engine, BL, toasts, palettes } = engineWith(null);
    engine.newIssue();
    engine.genBacklog();
    expect(palettes).toEqual([]);
    expect(BL.issues).toEqual([]);
    expect(toasts).toEqual(["needsProject", "needsProject"]);
  });

  it("com a pasta aberta, criam como antes", () => {
    const { engine, BL, toasts, palettes } = engineWith("/w/shop");
    engine.newIssue();
    expect(palettes).toEqual(["Criar issue"]);
    engine.genBacklog();
    expect(BL.issues.map((i) => i.title)).toEqual(["ADR: orders", "orders: serviço (Rust)", "Artefactos de execução: compose, variáveis de ambiente e Kubernetes", "Teste de fumo da stack a correr"]);
    expect(toasts).toEqual([]);
  });

  it("a fábrica não tem guarda (o harness e o auto-teste usam-na directamente)", () => {
    const { engine, BL } = engineWith(null);
    engine.mkIssue({ title: "x", agent: "be" });
    expect(BL.issues.length).toBe(1);
  });
});
