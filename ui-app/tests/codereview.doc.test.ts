import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMarkdown, parseInline, improvedCode, withoutImproved } from "../src/features/codereview/domain/markdown";
import { explainPrompt, reviewPrompt, numbered } from "../src/features/codereview/domain/prompts";
import { makeDocSession, type DocState } from "../src/features/codereview/application/doc-session";
import { DOC_COPY } from "../src/features/codereview/application/messages";
import { DOC_MESSAGES } from "../src/features/codereview/ui/doc-messages";
import { bootApp } from "./harness";

/* O Explain e o Code review respondem num painel de documento ao lado do código (não no chat):
 * o domínio (markdown, código melhorado, pedidos), o caso de uso (`doc-session`, com portas
 * falsas) e a ligação real (a cadeia do bootApp: o painel `#cr-side` dentro da `.ebody`). */

describe("domínio — markdown do documento", () => {
  it("títulos, parágrafos, listas, citação, regra, tabela e código cercado", () => {
    const b = parseMarkdown("## Summary\nIt **parses** tokens.\n\n- one\n- [x] two\n\n1. a\n2. b\n\n> note\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```rust\nfn x() {}\n```");
    expect(b.map((x) => x.k)).toEqual(["h", "p", "list", "list", "quote", "hr", "table", "code"]);
    expect(b[0]).toMatchObject({ k: "h", level: 2 });
    expect(b[2]).toMatchObject({ ordered: false, items: [{ check: null }, { check: true }] });
    expect(b[3]).toMatchObject({ ordered: true });
    expect(b[7]).toMatchObject({ k: "code", lang: "rust", v: "fn x() {}", open: false });
  });

  it("um bloco ainda a chegar (sem cerca de fecho) conta como bloco aberto", () => {
    const b = parseMarkdown("Intro\n\n```ts\nconst a = 1;");
    expect(b[1]).toMatchObject({ k: "code", open: true, v: "const a = 1;" });
  });

  it("em linha: código, negrito, itálico, ligação e referências de linha (L12, line 3, linha 4)", () => {
    const xs = parseInline("See `x` and **y** and *z* at L12, line 3 and linha 4; [docs](https://a.b)");
    expect(xs.filter((x) => x.k === "line").map((x) => (x as { line: number }).line)).toEqual([12, 3, 4]);
    expect(xs.some((x) => x.k === "code" && x.v === "x")).toBe(true);
    expect(xs.some((x) => x.k === "b")).toBe(true);
    expect(xs.some((x) => x.k === "i")).toBe(true);
    expect(xs.some((x) => x.k === "link" && x.href === "https://a.b")).toBe(true);
  });

  it("código melhorado: o bloco marcado `improved`; sem marca, o maior com metade das linhas; curto demais → null", () => {
    const orig = "a\nb\nc\nd\n";
    expect(improvedCode("x\n```rust improved\nA\nB\n```\n", orig)).toEqual({ lang: "rust", code: "A\nB\n" });
    expect(improvedCode("```rust\nA\nB\nC\n```", orig)).toEqual({ lang: "rust", code: "A\nB\nC\n" });
    expect(improvedCode("```rust\nA\n```", orig)).toBe(null);
    expect(improvedCode("```rust improved\nA\nB", orig)).toBe(null); // ainda a chegar
  });

  it("o documento sem o bloco do código melhorado (o painel mostra-o à parte)", () => {
    expect(withoutImproved("## Findings\nx\n\n## Improved code\n```ts improved\nconst a=1;\nconst b=2;\n```\n\n## How to test\ny")).toBe("## Findings\nx\n\n## Improved code\n\n## How to test\ny");
    expect(withoutImproved("## Improved code\n```ts improved\nconst a=1;\nconst b=2;\n```")).toBe("## Improved code");
  });

  it("os pedidos: linhas numeradas, secções, a etiqueta `<lang> improved` e a língua", () => {
    expect(numbered("a\nb", 7)).toBe("   7| a\n   8| b");
    const e = explainPrompt({ path: "src/lib.rs", ext: "rs", content: "fn a() {}", selection: null, lang: "ptAO" });
    expect(e).toContain("## How it works");
    expect(e).toContain("```rust\n   1| fn a() {}");
    expect(e).toContain("português");
    const s = explainPrompt({ path: "src/lib.rs", ext: "rs", content: "", selection: { text: "let x = 1;", line: 40 }, lang: "en" });
    expect(s).toContain("starts at line 40");
    expect(s).toContain("  40| let x = 1;");
    const r = reviewPrompt({ path: "a.ts", ext: "ts", content: "x", findings: [{ line: 3, sev: "risk", title: "t" }], lang: "en" });
    expect(r).toContain("```ts improved");
    expect(r).toContain("- L3 [risk] t");
  });
});

/* ───── caso de uso ───── */

function fakes(opts: { ready?: boolean } = {}) {
  const fs: Record<string, string> = { "p/a.rs": "fn a() {}\n" };
  const renders: DocState[] = [];
  let resolveStream: ((t: string) => void) | null = null;
  let rejectStream: ((e: unknown) => void) | null = null;
  let onText: ((t: string) => void) | null = null;
  const prompts: string[] = [];
  const testRuns: Array<{ ran: boolean; passed: boolean; output: string }> = [];
  let testsWhy: string | null = null;
  const s = makeDocSession({
    ai: {
      ready: () => opts.ready ?? true,
      stream: (q, o) => {
        prompts.push(q);
        onText = o.onText;
        return new Promise<string>((res, rej) => {
          resolveStream = res; rejectStream = rej;
          o.signal.addEventListener("abort", () => rej(new Error("aborted")));
        });
      },
    },
    files: { read: (p) => fs[p] ?? null, write: (p, c) => { fs[p] = c; }, ext: () => "rs", short: (p) => p },
    tests: { unavailable: () => testsWhy, run: async () => testRuns.shift() ?? { ran: true, passed: true, output: "ok" } },
    view: { render: (st) => renders.push({ ...st }) },
    lang: () => "en",
    copy: (k, p) => (p ? DOC_COPY.en[k].replace(/\{(\w+)\}/g, (_, n) => String(p[n])) : DOC_COPY.en[k]),
  });
  return {
    s, fs, renders, prompts, testRuns,
    text: (t: string) => onText!(t),
    finish: (t: string) => resolveStream!(t),
    fail: (e: unknown) => rejectStream!(e),
    setWhy: (w: string | null) => { testsWhy = w; },
  };
}
const card = { path: "p/a.rs", lineCount: 2, symbols: [{ n: "a", line: 1 }], firstComment: "Adds.", diagnostics: [{ line: 1, msg: "unused" }], findings: [{ t: "<b>x</b>", l: 1 }] };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("caso de uso — doc-session", () => {
  it("Explain sem modelo: o resumo local em markdown, sem pedir nada", () => {
    const f = fakes({ ready: false });
    f.s.explain({ path: "p/a.rs", selection: null, card });
    const st = f.s.state()!;
    expect(st.status).toBe("local");
    expect(st.text).toContain("## Summary");
    expect(st.text).toContain("`a` (L1)");
    expect(st.text).toContain("- L1: unused");
    expect(st.text).toContain("- x (L1)");
    expect(f.prompts).toEqual([]);
  });

  it("Explain com modelo: mostra o texto a chegar e fica pronto", async () => {
    const f = fakes();
    f.s.explain({ path: "p/a.rs", selection: { text: "fn a", line: 1 }, card });
    expect(f.s.state()!.status).toBe("streaming");
    expect(f.s.state()!.from).toBe(1);
    f.text("## Sum");
    expect(f.renders.at(-1)!.text).toBe("## Sum");
    f.finish("## Summary\nok");
    await flush();
    expect(f.s.state()).toMatchObject({ status: "done", text: "## Summary\nok", improved: null });
  });

  it("Stop pára o pedido; um pedido novo não deixa o antigo pintar por cima", async () => {
    const f = fakes();
    f.s.explain({ path: "p/a.rs", selection: null, card });
    f.s.stop();
    await flush();
    expect(f.s.state()!.status).toBe("stopped");
    f.s.review("p/a.rs", []);
    const id = f.s.state()!.id;
    f.finish("## Verdict\nfine");
    await flush();
    expect(f.s.state()).toMatchObject({ id, kind: "review", status: "done" });
  });

  it("um erro do modelo diz-se", async () => {
    const f = fakes();
    f.s.explain({ path: "p/a.rs", selection: null, card });
    f.fail(new Error("401 bad key"));
    await flush();
    expect(f.s.state()).toMatchObject({ status: "error", error: "401 bad key" });
  });

  it("revisão: extrai o código melhorado; Apply escreve, Revert repõe", async () => {
    const f = fakes();
    f.s.review("p/a.rs", [{ line: 1, sev: "style", title: "t" }]);
    f.finish("## Verdict\nok\n\n```rust improved\nfn a() -> i32 { 1 }\n```");
    await flush();
    expect(f.s.state()!.improved).toEqual({ lang: "rust", code: "fn a() -> i32 { 1 }\n" });
    expect(f.s.apply()).toBe(true);
    expect(f.fs["p/a.rs"]).toBe("fn a() -> i32 { 1 }\n");
    f.s.revert();
    expect(f.fs["p/a.rs"]).toBe("fn a() {}\n");
    expect(f.s.state()!.applied).toBe(null);
  });

  it("Apply & test: aplica e corre os testes; a falhar, pede a correcção com a saída", async () => {
    const f = fakes();
    f.s.review("p/a.rs", []);
    f.finish("```rust improved\nfn b() {}\n```");
    await flush();
    f.testRuns.push({ ran: true, passed: false, output: "test a ... FAILED" });
    await f.s.test();
    expect(f.fs["p/a.rs"]).toBe("fn b() {}\n");
    expect(f.s.state()!.test).toEqual({ status: "failed", output: "test a ... FAILED" });
    f.s.fixTests();
    expect(f.prompts.at(-1)).toContain("test a ... FAILED");
    expect(f.s.state()).toMatchObject({ kind: "fix", status: "streaming" });
    // o ficheiro de antes de tudo continua a poder voltar
    expect(f.s.state()!.applied).toEqual({ prev: "fn a() {}\n" });
  });

  it("sem onde testar, di-lo e não mexe no ficheiro", async () => {
    const f = fakes();
    f.s.review("p/a.rs", []);
    f.finish("```rust improved\nfn b() {}\n```");
    await flush();
    f.setWhy("open a folder");
    await f.s.test();
    expect(f.s.state()!.test).toEqual({ status: "unavailable", output: "open a folder" });
    expect(f.fs["p/a.rs"]).toBe("fn a() {}\n");
  });
});

describe("catálogos novos: as mesmas chaves em en e ptAO", () => {
  it.each([["doc-messages", DOC_MESSAGES], ["doc-copy", DOC_COPY]])("%s", (_, m) => {
    expect(Object.keys(m.ptAO).sort()).toEqual(Object.keys(m.en).sort());
  });
});

/* ───── a ligação real (cadeia do bootApp) ───── */

let w: any;
let CRM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp
const P = "svc/load.rs";
const RS = `fn load() {\n    let v = parse().unwrap();\n    v\n}\n`;

describe("o painel ao lado do código (harness)", () => {
  beforeEach(async () => {
    w = await bootApp();
    CRM = await import("../src/features/codereview");
    w.FS[P] = { content: RS, orig: RS };
    w.openPath(P);
  });
  afterEach(() => {
    CRM.closePanel();
    w.SAMPLE = null;
    vi.restoreAllMocks();
  });

  it("Explain sem modelo abre o painel com o documento e não escreve no chat", async () => {
    const msgs = document.querySelectorAll("#msgs > *").length;
    CRM.explainCmd();
    await new Promise((r) => setTimeout(r, 20));
    const side = document.querySelector("#cr-side")!;
    expect(side).not.toBe(null);
    expect(side.parentElement!.classList.contains("cr-split")).toBe(true);
    expect(side.querySelector(".cr-ttl")!.textContent).toContain("load.rs");
    expect(side.querySelector(".cr-md h3")!.textContent).toBe("Summary");
    expect(side.querySelector(".cr-md blockquote")!.textContent).toMatch(/Connect a model/);
    expect(document.querySelectorAll("#msgs > *").length).toBe(msgs);
  });

  it("Explain com modelo: o texto chega ao painel como documento com realce e linhas clicáveis", async () => {
    w.PROV.claude.on = true;
    let push!: (t: string) => void, end!: (t: string) => void;
    w.SAMPLE = (_q: string, o: { onText: (e: { text: string }) => void }) => new Promise((res) => { push = (t) => o.onText({ text: t }); end = (t) => res({ text: t }); });
    CRM.explainCmd();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector("#cr-side .cr-st")!.textContent).toMatch(/Writing/);
    const doc = "## Summary\nLoads at L2.\n\n```rust\nfn x() {}\n```";
    push(doc);
    end(doc);
    await new Promise((r) => setTimeout(r, 20));
    const side = document.querySelector("#cr-side")!;
    expect(side.querySelector(".cr-md h3")!.textContent).toBe("Summary");
    expect(side.querySelector(".cr-code .kw")!.textContent).toBe("fn");
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    side.querySelector<HTMLElement>(".cr-ln")!.click();
    expect(open).toHaveBeenCalledWith(P, 2);
    side.querySelector<HTMLElement>('[data-action="cr:view"][data-on="markdown"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(side.querySelector(".cr-raw")!.textContent).toBe(doc);
  });

  it("Code review abre a revisão interactiva no painel: filtros, descartar, repor", async () => {
    CRM.reviewCmd();
    await new Promise((r) => setTimeout(r, 20));
    const side = document.querySelector("#cr-side")!;
    expect(side.getAttribute("data-mode")).toBe("review");
    expect(side.querySelectorAll(".crf").length).toBe(1);
    expect(side.querySelector(".crf .cr-cl.mark .ln")!.textContent).toBe("2");
    side.querySelector<HTMLElement>('[data-action="cr:dismiss"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(side.querySelectorAll(".crf:not(.gone)").length).toBe(0);
    expect(side.querySelector(".cr-gone")!.textContent).toMatch(/1 dismissed/);
    side.querySelector<HTMLElement>('[data-action="cr:show-dismissed"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    side.querySelector<HTMLElement>('[data-action="cr:restore"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(side.querySelectorAll(".crf:not(.gone)").length).toBe(1);
    // o separador «AI review» sem modelo diz como ligar um
    side.querySelector<HTMLElement>('[data-action="cr:tab"][data-on="ai"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(side.querySelector(".cr-cta")!.textContent).toMatch(/Connect a model/);
  });

  it("revisão com IA: o código melhorado com diferenças e Apply; Close fecha o painel", async () => {
    w.PROV.claude.on = true;
    const reply = "## Verdict\n80\n\n```rust improved\nfn load() -> Result<V, E> {\n    let v = parse()?;\n    Ok(v)\n}\n```";
    w.SAMPLE = async () => ({ text: reply });
    CRM.reviewCmd();
    await new Promise((r) => setTimeout(r, 20));
    document.querySelector<HTMLElement>('#cr-side [data-action="cr:tab"][data-on="ai"]')!.click();
    document.querySelector<HTMLElement>('#cr-side [data-action="cr:ai-review"]')!.click();
    await new Promise((r) => setTimeout(r, 30));
    const side = document.querySelector("#cr-side")!;
    expect(side.querySelector(".cr-imp")).not.toBe(null);
    expect(side.querySelector(".cr-md")!.textContent).not.toContain("parse()?"); // o bloco melhorado está à parte
    side.querySelector<HTMLElement>('[data-action="cr:code-view"][data-on="diff"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(side.querySelectorAll(".cr-diff .cr-cl.add").length).toBeGreaterThan(0);
    side.querySelector<HTMLElement>('[data-action="cr:accept"]')!.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(w.FS[P].content).toContain("parse()?");
    side.querySelector<HTMLElement>('[data-action="cr:revert"]')!.click();
    expect(w.FS[P].content).toBe(RS);
    side.querySelector<HTMLElement>('[data-action="cr:close"]')!.click();
    expect(document.querySelector("#cr-side")).toBe(null);
    expect(document.querySelector(".ebody.cr-split")).toBe(null);
  });
});
