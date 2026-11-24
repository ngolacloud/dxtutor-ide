import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* ADR-0006, R1d — sem git simulado. O harness liga o espelho com o histórico da fixture
 * (tests/fixtures/sample-history.ts, `REPO = true`); aqui desliga-se para provar o que a
 * app faz SEM repositório git real (o browser, ou o desktop sem pasta / com pasta sem git):
 * o modelo nasce vazio, o pane diz-o, e nada muda o git em memória. E prova-se a ligação do
 * gitflow às versões publicadas (no desktop, as decoradas com git real pelo bridge.ts). */

let w: any;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
});

afterEach(() => {
  delete w.DXR;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Sem repositório: desliga o espelho e repõe o modelo vazio (o que a app tem ao arrancar). */
function noRepo(): void {
  w.REPO = false;
  w.gitInit();
}

const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

describe("sem repositório git", () => {
  it("gitInit deixa o modelo vazio: sem commits, ramos, tags nem ramo actual", () => {
    noRepo();
    expect(w.GIT.order).toEqual([]);
    expect(w.GIT.refs).toEqual({});
    expect(w.GIT.tags).toEqual({});
    expect(w.BRANCH).toBe("");
    expect(w.COMMITS).toEqual([]);
    expect(w.BRANCHES).toBeUndefined(); // a lista fixa de ramos saiu
  });

  it("golden: no browser, o pane diz que não há repositório (sem lista de ramos/commits)", () => {
    noRepo();
    w.renderScmPane();
    expect(golden(document.getElementById("pane-scm")!)).toMatchSnapshot("pane-no-repo-browser");
  });

  it("golden + dispatch: no desktop com pasta sem git, o pane oferece `git init`", () => {
    noRepo();
    const gitInit = vi.fn();
    w.DXR = { root: "/tmp/proj", git: false, gitInit };
    w.renderScmPane();
    expect(golden(document.getElementById("pane-scm")!)).toMatchSnapshot("pane-no-repo-folder");
    click(document.querySelector('#pane-scm [data-action="git-init"]')!);
    expect(gitInit).toHaveBeenCalledTimes(1);
  });

  it("commit/checkout/merge/gitflow recusam com aviso e não inventam commits nem ramos", () => {
    noRepo();
    const toast = vi.spyOn(w, "toast");
    expect(w.commitGit("feat: x")).toBe(null);
    expect(w.commit("feat: x")).toBe(null);
    expect(w.checkout("develop")).toBe(false);
    expect(w.checkout("feature/x", true)).toBe(false);
    expect(w.gitMerge("develop")).toBe(null);
    expect(w.gfStart("feature", "x")).toBe("");
    expect(w.gfFinish("feature/x")).toBe(null);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Sem repositório git/));
    expect(w.GIT.order).toEqual([]);
    expect(w.GIT.refs).toEqual({});
    expect(w.BRANCH).toBe("");
  });

  it("no desktop, quem diz se há repo é DXR.git (o REPO dos testes não conta)", () => {
    w.REPO = true;
    w.DXR = { root: "/tmp/proj", git: false };
    expect(w.checkout("main")).toBe(false); // pasta sem git: recusa, apesar do REPO
    w.DXR.git = true;
    w.REPO = false;
    expect(w.checkout("main")).toBe(true); // repo real aberto: o espelho muda de ramo
  });

  it("terminal emulado: `git` responde como o git real fora de um repositório", () => {
    noRepo();
    const before = document.querySelectorAll("#term .line").length;
    expect(w.gitCmd(["status"], "git status")).toEqual({ ok: false });
    const lines = [...document.querySelectorAll("#term .line")].slice(before).map((d) => d.textContent || "");
    expect(lines.join("\n")).toMatch(/fatal: not a git repository/);
  });

  it("o changelog do browser não inventa commits (o desktop usa git_log)", async () => {
    expect(await w.clLog()).toEqual([]);
    expect(await w.clShow("1a2b3c4")).toBe("");
  });
});

describe("com repositório (espelho da fixture)", () => {
  it("terminal emulado: `git push` já não finge um push", () => {
    expect(w.gitCmd(["push"], "git push")).toEqual({ ok: false });
  });

  it("gfStart muda de ramo pelo checkout PUBLICADO (no desktop, o decorado com git real)", () => {
    const decorated = vi.fn(() => true);
    w.checkout = decorated;
    expect(w.gfStart("feature", "Exportar relatório")).toBe("feature/exportar-relatorio");
    expect(decorated).toHaveBeenCalledWith("feature/exportar-relatorio", true);
  });

  it("gfFinish faz checkout e merge pelas versões PUBLICADAS", () => {
    const b = w.gfStart("feature", "fim");
    const co = vi.fn(() => true), merge = vi.fn(() => ({ h: "abc1234", m: "Merge" }));
    w.checkout = co; w.gitMerge = merge;
    expect(w.gfFinish(b)).toEqual({ h: "abc1234", m: "Merge" });
    expect(co).toHaveBeenCalledWith("develop", undefined);
    expect(merge).toHaveBeenCalledWith(b, undefined);
  });
});
