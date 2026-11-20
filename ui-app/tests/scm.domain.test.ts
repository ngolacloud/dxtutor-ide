import { describe, expect, it } from "vitest";
import { computeGraphLayout } from "../src/features/scm/domain/graph";
import { statusOf, listChanges } from "../src/features/scm/domain/status";
import { resolveAuthor } from "../src/features/scm/domain/author";
import { isFlow, slug } from "../src/features/scm/domain/gitflow";
import type { Commit, GitState, FileEntry } from "../src/features/scm/domain/types";

/* Testes unitários do domínio puro da feature `scm` (ADR-0002, Fase 2). As funções
 * extraídas de `features/scm.ts` não tocam DOM/`window`: recebem o estado por
 * argumento. A caracterização byte-a-byte (grafo/pane) vive em `scm.golden.test.ts`;
 * aqui fixa-se a REGRA de cada função isolada, com entradas sintéticas. */

/** Constrói um `Commit` mínimo (só os campos que o layout lê: h, p). */
function c(h: string, p: string[], b = "main"): Commit {
  return { h, m: h, p, b, a: "w", t: 0, files: [] };
}
/** Monta um `GitState` só com `order` (topológico, mais novo primeiro) e `c`. */
function git(commits: Commit[]): Pick<GitState, "order" | "c"> {
  const map: Record<string, Commit> = {};
  commits.forEach((x) => (map[x.h] = x));
  return { order: commits.map((x) => x.h), c: map };
}
function file(content: string, orig: string | null): FileEntry {
  return { content, orig };
}

describe("computeGraphLayout — atribuição de lanes", () => {
  it("cadeia linear c<-b<-a fica toda na coluna 0", () => {
    const lay = computeGraphLayout(git([c("c", ["b"]), c("b", ["a"]), c("a", [])]));
    expect(lay.rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(lay.rows.map((r) => r.pl)).toEqual([[0], [0], []]);
    expect(lay.max).toBe(1);
    expect(lay.idx).toEqual({ c: 0, b: 1, a: 2 });
  });

  it("ramo paralelo abre uma segunda lane e o merge volta a fechá-la", () => {
    // m (merge de b e f) <- b <- a ; f é um ramo lateral a partir de a
    const lay = computeGraphLayout(git([c("m", ["b", "f"]), c("b", ["a"]), c("f", ["a"]), c("a", [])]));
    expect(lay.rows[0].h).toBe("m");
    expect(lay.rows[0].col).toBe(0);
    expect(lay.rows[0].pl.length).toBe(2); // dois pais → duas colunas
    expect(lay.max).toBeGreaterThanOrEqual(2); // o ramo lateral usou uma segunda lane
    expect(Object.keys(lay.idx).length).toBe(4);
  });

  it("DAG vazio: sem rows, max permanece 1", () => {
    const lay = computeGraphLayout(git([]));
    expect(lay.rows).toEqual([]);
    expect(lay.max).toBe(1);
  });
});

describe("statusOf — estado de um ficheiro", () => {
  it("sem entrada → '' (não versionado)", () => {
    expect(statusOf(undefined, "a.ts")).toBe("");
  });
  it("orig === content → '' (limpo)", () => {
    expect(statusOf(file("x", "x"), "a.ts")).toBe("");
  });
  it("orig null → 'U' (novo)", () => {
    expect(statusOf(file("x", null), "a.ts")).toBe("U");
  });
  it("content !== orig → 'M' (modificado)", () => {
    expect(statusOf(file("y", "x"), "a.ts")).toBe("M");
  });
  it("caminho sob /learn/ → '' mesmo que modificado", () => {
    expect(statusOf(file("y", "x"), "p/learn/a.ts")).toBe("");
  });
});

describe("listChanges — alterações ordenadas", () => {
  it("só caminhos com estado, por ordem alfabética, excluindo /learn/", () => {
    const files: Record<string, FileEntry> = {
      "z.ts": file("b", "a"), // M
      "a.ts": file("n", null), // U
      "clean.ts": file("x", "x"), // limpo → fora
      "p/learn/x.ts": file("n", null), // /learn/ → fora
    };
    expect(listChanges(files)).toEqual(["a.ts", "z.ts"]);
  });
  it("workspace limpo → lista vazia", () => {
    expect(listChanges({ "a.ts": file("x", "x") })).toEqual([]);
  });
});

describe("resolveAuthor — autor para apresentação", () => {
  const agents = { al: { n: "Alice", col: "#111" } };
  it("'w' e vazio são «You» com cor neutra", () => {
    expect(resolveAuthor("w", agents)).toEqual({ n: "You", col: "#8a8f9c" });
    expect(resolveAuthor("", agents)).toEqual({ n: "You", col: "#8a8f9c" });
  });
  it("agente conhecido vem do catálogo", () => {
    expect(resolveAuthor("al", agents)).toEqual({ n: "Alice", col: "#111" });
  });
  it("id desconhecido é o próprio nome, cor neutra", () => {
    expect(resolveAuthor("bob", agents)).toEqual({ n: "bob", col: "#8a8f9c" });
  });
});

describe("isFlow / slug — política gitflow", () => {
  it("isFlow só para feature/fix/hotfix/release com barra", () => {
    expect(isFlow("feature/x")).toBe(true);
    expect(isFlow("fix/y")).toBe(true);
    expect(isFlow("hotfix/z")).toBe(true);
    expect(isFlow("release/0.3.0")).toBe(true);
    expect(isFlow("develop")).toBe(false);
    expect(isFlow("main")).toBe(false);
    expect(isFlow("feat/learning-paths")).toBe(false);
    expect(isFlow("feature")).toBe(false); // sem barra
  });
  it("slug: minúsculas, sem acentos, só [a-z0-9]+hífen, sem hífenes nas pontas", () => {
    expect(slug("Exportar Relatório")).toBe("exportar-relatorio");
    expect(slug("  Olá, Mundo!  ")).toBe("ola-mundo");
    expect(slug("0.3.0")).toBe("0-3-0");
    expect(slug("Ação/Acção")).toBe("acao-accao");
  });
});
