import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTestOutput, spotsText } from "../src/features/codereview/domain/test-report";
import { applySuggestionPrompt, fixTestsPrompt } from "../src/features/codereview/domain/prompts";
import { makeDocSession } from "../src/features/codereview/application/doc-session";
import { DOC_COPY } from "../src/features/codereview/application/messages";
import { DOC_MESSAGES } from "../src/features/codereview/ui/doc-messages";
import { copyText } from "../src/app/clipboard";
import { bootApp } from "./harness";

/* Aplicar as sugestões do Explain (diferenças → Aceitar/Recusar → testes), o relatório dos testes que
 * falham (onde quebrou, o tipo, a dica) e a cópia que funciona no WebKitGTK. */

describe("domínio — o que a saída dos testes diz", () => {
  it("cargo: o teste que falhou, a asserção e o sítio", () => {
    const r = parseTestOutput(`running 2 tests
test tests::empty ... ok
test tests::lex_ab ... FAILED

failures:

---- tests::lex_ab stdout ----
thread 'tests::lex_ab' panicked at src/lib.rs:31:9:
assertion \`left == right\` failed
  left: ["a"]
 right: ["a", "b"]
`);
    expect(r.kind).toBe("assert");
    expect(r.failed).toEqual(["tests::lex_ab"]);
    expect(r.spots[0]).toMatchObject({ file: "src/lib.rs", line: 31 });
  });

  it("rustc: não compila — o erro e o sítio do `-->`", () => {
    const r = parseTestOutput(`   Compiling lexer v0.1.0
error[E0308]: mismatched types
  --> src/lib.rs:12:18
   |
12 |     let n: u32 = "x";
`);
    expect(r.kind).toBe("compile");
    expect(r.spots).toEqual([{ file: "src/lib.rs", line: 12, message: "mismatched types" }]);
    expect(r.headline).toContain("E0308");
  });

  it("panic sem asserção é um panic", () => {
    const r = parseTestOutput("thread 'main' panicked at src/main.rs:4:20:\ncalled `Option::unwrap()` on a `None` value\n");
    expect(r.kind).toBe("panic");
    expect(r.spots[0]).toMatchObject({ file: "src/main.rs", line: 4 });
  });

  it("tsc e vitest", () => {
    const t = parseTestOutput("src/app.ts(7,3): error TS2322: Type 'string' is not assignable to type 'number'.\n");
    expect(t.kind).toBe("compile");
    expect(t.spots[0]).toMatchObject({ file: "src/app.ts", line: 7 });
    const v = parseTestOutput(` FAIL  tests/sum.test.ts > sum > adds
AssertionError: expected 3 to be 4
 ❯ tests/sum.test.ts:5:19
`);
    expect(v.kind).toBe("assert");
    expect(v.failed).toEqual(["tests/sum.test.ts > sum > adds"]);
    expect(v.spots[0]).toMatchObject({ file: "tests/sum.test.ts", line: 5 });
  });

  it("python unittest e go test", () => {
    const p = parseTestOutput(`FAIL: test_add (test_calc.CalcTest)
Traceback (most recent call last):
  File "test_calc.py", line 9, in test_add
    self.assertEqual(add(1, 2), 4)
AssertionError: 3 != 4
`);
    expect(p.kind).toBe("assert");
    expect(p.failed).toEqual(["test_calc.CalcTest.test_add"]);
    expect(p.spots[0]).toMatchObject({ file: "test_calc.py", line: 9 });
    const g = parseTestOutput("--- FAIL: TestSum (0.00s)\n    sum_test.go:8: got 3, want 4\nFAIL\n");
    expect(g.kind).toBe("assert");
    expect(g.failed).toEqual(["TestSum"]);
    expect(spotsText(g)).toBe("- sum_test.go:8 — got 3, want 4");
  });

  it("saída sem nada reconhecível: não percebido, sem sítios inventados", () => {
    expect(parseTestOutput("make: *** [test] Error 2\n")).toMatchObject({ kind: "unknown", spots: [], failed: [] });
  });

  it("os pedidos: aplicar uma sugestão e corrigir com os sítios", () => {
    const a = applySuggestionPrompt({ path: "src/lib.rs", ext: "rs", content: "fn a() {}", snippet: "fn a() -> u8 { 1 }", snippetLang: "rust", context: "## Suggestions", lang: "en" });
    expect(a).toContain("`rust improved`");
    expect(a).toContain("fn a() -> u8 { 1 }");
    expect(a).toContain("## What changes");
    expect(fixTestsPrompt("a.rs", "rs", "x", "out", "en", "- src/lib.rs:3 — boom")).toContain("Where it broke:\n- src/lib.rs:3 — boom");
  });
});

/* ───── caso de uso: Apply de uma sugestão, Aceitar / Recusar / Voltar ───── */

function rig(testsWhy: string | null = null) {
  const fs: Record<string, string> = { "p/a.rs": "fn a() {}\n" };
  const prompts: string[] = [];
  const replies: string[] = [];
  const runs: Array<{ ran: boolean; passed: boolean; output: string }> = [];
  const s = makeDocSession({
    ai: { ready: () => true, stream: async (q) => { prompts.push(q); return replies.shift() ?? ""; } },
    files: { read: (p) => fs[p] ?? null, write: (p, c) => { fs[p] = c; }, ext: () => "rs", short: (p) => p },
    tests: { unavailable: () => testsWhy, run: async () => runs.shift() ?? { ran: true, passed: true, output: "ok" } },
    view: { render: () => {} },
    lang: () => "en",
    copy: (k) => DOC_COPY.en[k],
  });
  return { s, fs, prompts, replies, runs };
}
const card = { path: "p/a.rs", lineCount: 1, symbols: [], firstComment: null, diagnostics: [], findings: [] };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("caso de uso — aplicar uma sugestão do Explain", () => {
  it("Apply → proposta com o código; Aceitar aplica e testa; Voltar regressa à explicação", async () => {
    const r = rig();
    r.replies.push("## Suggestions\n```rust\nfn a() -> u8 { 1 }\n```", "## What changes\n- L1\n\n```rust improved\nfn a() -> u8 { 1 }\n```");
    r.s.explain({ path: "p/a.rs", selection: null, card });
    await flush();
    const explained = r.s.state()!;
    r.s.applySuggestion("fn a() -> u8 { 1 }", "rust");
    await flush();
    expect(r.prompts[1]).toContain("Apply this suggestion");
    expect(r.s.state()).toMatchObject({ kind: "apply", status: "done", improved: { code: "fn a() -> u8 { 1 }\n" } });
    expect(r.s.state()!.back).toBe(explained);
    expect(r.fs["p/a.rs"]).toBe("fn a() {}\n"); // nada muda antes do Aceitar
    await r.s.accept();
    expect(r.fs["p/a.rs"]).toBe("fn a() -> u8 { 1 }\n");
    expect(r.s.state()!.test).toEqual({ status: "passed", output: "ok" });
    r.s.goBack();
    expect(r.s.state()).toBe(explained);
    expect(r.fs["p/a.rs"]).toBe("fn a() -> u8 { 1 }\n"); // voltar não desfaz o que foi aceite
  });

  it("Recusar deita a proposta fora e o ficheiro fica igual", async () => {
    const r = rig();
    r.replies.push("```rust improved\nfn b() {}\n```");
    r.s.review("p/a.rs", []);
    await flush();
    r.s.deny();
    expect(r.s.state()).toMatchObject({ improved: null, denied: true });
    expect(r.fs["p/a.rs"]).toBe("fn a() {}\n");
  });

  it("sem onde testar, Aceitar aplica e diz que os testes correm na app", async () => {
    const r = rig("open a folder");
    r.replies.push("```rust improved\nfn b() {}\n```");
    r.s.review("p/a.rs", []);
    await flush();
    await r.s.accept();
    expect(r.fs["p/a.rs"]).toBe("fn b() {}\n");
    expect(r.s.state()!.test).toEqual({ status: "unavailable", output: "open a folder" });
  });

  it("testes a falhar: a correcção leva os sítios e continua no modo de onde veio", async () => {
    const r = rig();
    r.replies.push("## S\n```rust\nfn b() {}\n```", "```rust improved\nfn b() {}\n```");
    r.s.explain({ path: "p/a.rs", selection: null, card });
    await flush();
    r.s.applySuggestion("fn b() {}", "rust");
    await flush();
    r.runs.push({ ran: true, passed: false, output: "thread 't' panicked at src/lib.rs:3:5:\nassertion failed" });
    await r.s.accept();
    expect(r.s.state()!.test!.status).toBe("failed");
    r.s.fixTests();
    expect(r.prompts.at(-1)).toContain("- src/lib.rs:3 — assertion failed");
    expect(r.s.state()!.back).not.toBe(null);
  });
});

describe("catálogo do painel: as mesmas chaves em en e ptAO", () => {
  it("doc-messages", () => expect(Object.keys(DOC_MESSAGES.ptAO).sort()).toEqual(Object.keys(DOC_MESSAGES.en).sort()));
});

describe("cópia (app/clipboard)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("usa o caminho síncrono primeiro (o WebKitGTK recusa a API assíncrona)", async () => {
    const exec = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText("abc")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea[readonly]")).toBe(null); // a textarea temporária saiu
  });
  it("sem o síncrono, tenta a API; sem nenhuma, diz que não copiou", async () => {
    (document as unknown as { execCommand: unknown }).execCommand = () => false;
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    expect(await copyText("x")).toBe(true);
    expect(write).toHaveBeenCalledWith("x");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => { throw new Error("denied"); } }, configurable: true });
    expect(await copyText("x")).toBe(false);
  });
});

/* ───── no harness: o «Aplicar» de um bloco, o diff, Aceitar no browser, Recusar e Voltar ───── */

let w: any;
let CRM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp
const P = "svc/apply.rs";
const RS = "fn total(v: &[u32]) -> u32 {\n    let mut s = 0;\n    for x in v { s += x; }\n    s\n}\n";
const wait = () => new Promise((r) => setTimeout(r, 25));

describe("o painel (harness): aplicar uma sugestão do Explain", () => {
  beforeEach(async () => {
    w = await bootApp();
    CRM = await import("../src/features/codereview");
    w.FS[P] = { content: RS, orig: RS };
    w.openPath(P);
    w.PROV.claude.on = true;
    const replies = [
      "## Suggestions\nUse an iterator:\n\n```rust\nfn total(v: &[u32]) -> u32 {\n    v.iter().sum()\n}\n```\n\n```bash\ncargo test\n```",
      "## What changes\n- L1-L5 use `iter().sum()`\n\n```rust improved\nfn total(v: &[u32]) -> u32 {\n    v.iter().sum()\n}\n```",
    ];
    w.SAMPLE = async () => ({ text: replies.shift() ?? "" });
  });
  afterEach(() => { CRM.closePanel(); w.SAMPLE = null; });

  it("«Aplicar» só nos blocos de código; abre nas diferenças; Recusar; Voltar; Aceitar aplica", async () => {
    CRM.explainCmd();
    await wait();
    const side = () => document.querySelector("#cr-side")!;
    const applies = side().querySelectorAll('[data-action="cr:apply-block"]');
    expect(applies.length).toBe(1); // o bloco bash não tem «Aplicar»
    expect(side().querySelectorAll('[data-action="cr:copy-block"]').length).toBe(2);
    (applies[0] as HTMLElement).click();
    await wait();
    expect(side().querySelector(".cr-diff")).not.toBe(null);
    expect(side().querySelectorAll(".cr-diff .cr-cl.add").length).toBeGreaterThan(0);
    expect(side().querySelector('[data-action="cr:accept"]')!.textContent).toBe("Accept"); // no browser não há testes
    side().querySelector<HTMLElement>('[data-action="cr:deny"]')!.click();
    await wait();
    expect(side().querySelector(".cr-imp")).toBe(null);
    expect(side().textContent).toContain("Proposal discarded");
    expect(w.FS[P].content).toBe(RS);
    side().querySelector<HTMLElement>('[data-action="cr:back"]')!.click();
    await wait();
    expect(side().querySelector('[data-action="cr:apply-block"]')).not.toBe(null);
  });
});
