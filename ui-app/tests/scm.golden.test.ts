import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature Source Control + motor git)
 * para `ui-app/src/features/scm.ts`, via o harness que carrega a cadeia real de
 * módulos. Goldens do markup de `renderScmPane` (#pane-scm) em quatro estados —
 * develop semeado, com ficheiro em stage, ramo feature/, ramo main — +
 * caracterização do MOTOR puro a extrair: `graphLayout` (atribuição de lanes do
 * DAG), `changes`/`stOf` (estado da árvore de trabalho), `isFlow` (política
 * gitflow) e `authorOf`. ANTES de mover qualquer um destes para
 * `features/scm/{domain,application}/`.
 *
 * A partir daqui, diff de golden = regressão (corrige o código, nunca o snapshot
 * — ver skill ui-golden-check). As caracterizações do motor fixam a saída EXACTA
 * (lanes, colunas, pais, estado por ficheiro, ordem) para que a extracção do
 * domínio/aplicação se prove byte-a-byte idêntica.
 *
 * Determinismo: o relógio é FIXADO (`setSystemTime`) antes de `bootApp`, porque
 * o harness chama `gitInit()` (que carimba `Date.now()` em cada commit do DAG
 * semeado) e `renderScmPane` mostra `rel(c.t)` (tempo relativo) no `title` dos
 * commits — ambos passam a ser estáveis. O workspace é a fixture `sample-workspace`,
 * que deixa três ficheiros sujos deterministas
 * (styles.css M, assistant.ts M, theme.css U). Timers falsos só para neutralizar
 * o polling de arranque (não há relógio a caracterizar).
 *
 * Chamamos `renderScmPane`/`graphLayout`/`changes`/`stOf`/`isFlow`/`authorOf`/
 * `checkout`/`gfStart` DIRECTAMENTE por global: o motor vive em scm.ts (inversão
 * de direcção já feita), o harness exclui v5/v6, logo não há shims a interferir —
 * são as funções a extrair. `gitInit` corre no `bootApp`, depois da fixture,
 * pelo que o DAG está semeado e `BRANCH === 'develop'` à entrada. */

let w: any;
let SCMM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7p3)

/** Carimba o pane recém-renderizado e devolve o golden strippado. */
function paneGolden(): string {
  return golden(document.getElementById("pane-scm")!);
}

beforeEach(async () => {
  vi.useFakeTimers();
  // Relógio fixo ANTES do boot: gitInit() e rel() ficam deterministas.
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
  SCMM = await import("../src/features/scm");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — Source Control (renderScmPane)", () => {
  it("develop semeado (gitflow em develop, ficheiros sujos do seed)", () => {
    expect(w.BRANCH).toBe("develop");
    w.renderScmPane();
    expect(paneGolden()).toMatchSnapshot();
  });

  it("com ficheiro em stage (grupo Staged + botão «staged»)", () => {
    const first = w.changes()[0];
    expect(first).toBeTruthy();
    SCMM.stage(first); // alterna STAGED e re-renderiza o pane
    expect(paneGolden()).toMatchSnapshot();
  });

  it("ramo feature/ (próximo passo gitflow = finalizar feature)", () => {
    w.gfStart("feature", "demo");
    expect(w.BRANCH).toBe("feature/demo");
    w.renderScmPane();
    expect(paneGolden()).toMatchSnapshot();
  });

  it("ramo main (próximo passo gitflow = só releases/hotfixes)", () => {
    w.checkout("main");
    expect(w.BRANCH).toBe("main");
    w.renderScmPane();
    expect(paneGolden()).toMatchSnapshot();
  });
});

describe("caracterização do motor — graphLayout (atribuição de lanes a extrair)", () => {
  it("layout do DAG semeado: rows/col/pl/idx/max fixos", () => {
    const lay = SCMM.graphLayout();
    expect(lay.rows.length).toBe(w.GIT.order.length);
    expect(lay).toMatchSnapshot();
  });

  it("primeira row tem coluna 0 e cada row referencia um commit do DAG", () => {
    const lay = SCMM.graphLayout();
    for (const r of lay.rows) {
      expect(w.GIT.c[r.h]).toBeTruthy();
      expect(typeof r.col).toBe("number");
      expect(Array.isArray(r.pl)).toBe(true);
    }
    expect(lay.max).toBeGreaterThanOrEqual(1);
  });
});

describe("caracterização do motor — árvore de trabalho (changes/stOf)", () => {
  it("changes() do workspace semeado: lista ordenada e estável", () => {
    expect(w.changes()).toMatchSnapshot();
  });

  it("stOf: '' limpo, 'M' modificado, 'U' novo, '' para /learn/ e ausente", () => {
    w.FS["x/limpo.ts"] = { content: "a", orig: "a" };
    w.FS["x/mod.ts"] = { content: "b", orig: "a" };
    w.FS["x/novo.ts"] = { content: "c", orig: null };
    w.FS["x/learn/p.ts"] = { content: "d", orig: null }; // guarda /learn/
    expect(w.stOf("x/limpo.ts")).toBe("");
    expect(w.stOf("x/mod.ts")).toBe("M");
    expect(w.stOf("x/novo.ts")).toBe("U");
    expect(w.stOf("x/learn/p.ts")).toBe("");
    expect(w.stOf("x/ausente.ts")).toBe("");
  });

  it("changes() só inclui caminhos com estado e exclui /learn/", () => {
    w.FS["x/mod.ts"] = { content: "b", orig: "a" };
    w.FS["x/learn/p.ts"] = { content: "d", orig: null };
    const ch = w.changes();
    expect(ch).toContain("x/mod.ts");
    expect(ch).not.toContain("x/learn/p.ts");
  });
});

describe("caracterização do motor — política gitflow (isFlow) e autores (authorOf)", () => {
  it("isFlow: feature/fix/hotfix/release são gitflow; develop/main/feat não", () => {
    expect(SCMM.isFlow("feature/x")).toBe(true);
    expect(SCMM.isFlow("fix/x")).toBe(true);
    expect(SCMM.isFlow("hotfix/x")).toBe(true);
    expect(SCMM.isFlow("release/0.3.0")).toBe(true);
    expect(SCMM.isFlow("develop")).toBe(false);
    expect(SCMM.isFlow("main")).toBe(false);
    expect(SCMM.isFlow("feat/learning-paths")).toBe(false); // feat/ não é feature/
  });

  it("authorOf: 'w' é You; desconhecido devolve o próprio nome; agente conhecido vem de AGENTS", () => {
    expect(SCMM.authorOf("w")).toEqual({ n: "You", col: "#8a8f9c" });
    expect(SCMM.authorOf("")).toEqual({ n: "You", col: "#8a8f9c" });
    expect(SCMM.authorOf("convidado")).toEqual({ n: "convidado", col: "#8a8f9c" });
    const agentKey = Object.keys(w.AGENTS)[0];
    expect(SCMM.authorOf(agentKey)).toEqual({ n: w.AGENTS[agentKey].n, col: w.AGENTS[agentKey].col });
  });
});
