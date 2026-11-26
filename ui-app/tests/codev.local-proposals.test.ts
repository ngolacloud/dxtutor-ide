import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proposalHunks, applyAccepted } from "../src/features/codev/domain/proposal";
import { makeDocSession } from "../src/features/codereview/application/doc-session";
import { DOC_COPY } from "../src/features/codereview/application/messages";
import { bootApp } from "./harness";

/* As propostas de ficheiro inteiro (o chat antigo, o painel Explain / Code review) revistas no editor
 * com as mesmas hunks do agente v2: só as linhas que mudam, no sítio, Aceitar / Rejeitar cada bloco. */

const BASE = "fn a() {\n    1\n}\n\nfn b() {\n    2\n}\n";
const NEW = "fn a() {\n    10\n}\n\nfn b() {\n    2\n}\n\nfn c() {}\n";

describe("domínio — os blocos de uma proposta", () => {
  it("só as linhas que mudam, com as antigas que substituem", () => {
    const hs = proposalHunks(BASE, NEW);
    expect(hs).toEqual([
      { start: 2, old: "    1\n", text: "    10\n", added: 1, removed: 1 },
      { start: 8, old: "", text: "\nfn c() {}\n", added: 2, removed: 0 },
    ]);
  });
  it("aplica só os aceites (de baixo para cima) e diz os que já não cabem", () => {
    const hs = proposalHunks(BASE, NEW);
    expect(applyAccepted(BASE, hs, [true, true]).text).toBe(NEW);
    expect(applyAccepted(BASE, hs, [true, false]).text).toBe(BASE.replace("    1\n", "    10\n"));
    expect(applyAccepted(BASE, hs, [false, true]).text).toBe(BASE + "\nfn c() {}\n");
    expect(applyAccepted("x\n", hs, [true, false]).stale).toEqual([0]);
  });
  it("sem mudanças, nenhum bloco", () => expect(proposalHunks(BASE, BASE)).toEqual([]));
});

describe("propostas locais na cadeia real (harness)", () => {
  let w: any;
  let CI: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp
  const KEY = () => w.ROOT + "src/lib.rs";
  beforeEach(async () => {
    vi.useFakeTimers();
    w = await bootApp();
    CI = await import("../src/features/codev/index");
    w.FS[KEY()] = { content: BASE, orig: BASE };
  });
  afterEach(() => vi.useRealTimers());

  it("abre o ficheiro, mostra os blocos no editor e escreve só o que foi aceite", async () => {
    const p = CI.proposeInEditor(KEY(), NEW, "Code review");
    const st = CI.hunkReview.state();
    expect(st.hunks.map((h: { op: string; status: string }) => [h.op, h.status])).toEqual([["replace", "review"], ["insert", "review"]]);
    expect(w.FS[KEY()].content).toBe(BASE); // nada escrito antes da decisão
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector("#ed-ta")).not.toBe(null); // o ficheiro abriu no editor
    const [h1, h2] = st.hunks;
    CI.hunkReview.decide(h1.id, true);
    CI.hunkReview.decide(h2.id, false);
    await vi.advanceTimersByTimeAsync(10);
    const r = await p;
    expect(r).toMatchObject({ applied: 1, rejected: 1, stale: 0, total: 2, before: BASE });
    expect(w.FS[KEY()].content).toBe(BASE.replace("    1\n", "    10\n"));
    expect(CI.hunkReview.state().hunks.filter((h: { status: string }) => h.status === "review")).toEqual([]);
  });

  it("um ficheiro novo é um bloco «create»; rejeitado, não é criado", async () => {
    const key = w.ROOT + "src/new.rs";
    const p = CI.proposeInEditor(key, "fn n() {}\n", "Co-Dev");
    const h = CI.hunkReview.state().hunks.at(-1);
    expect(h.op).toBe("create");
    CI.hunkReview.decide(h.id, false);
    await vi.advanceTimersByTimeAsync(10);
    expect((await p).applied).toBe(0);
    expect(w.FS[key]).toBeUndefined();
  });
});

describe("painel — «Rever no editor»", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it("aceite no editor: fica aplicado e os testes correm; nada aceite: recusada", async () => {
    const fs: Record<string, string> = { "p/a.rs": "fn a() {}\n" };
    const replies = ["```rust improved\nfn a() -> u8 { 1 }\n```", "```rust improved\nfn b() {}\n```"];
    let editorAnswer = { applied: 1, total: 1, before: "fn a() {}\n" };
    const runs: string[] = [];
    const s = makeDocSession({
      ai: { ready: () => true, stream: async () => replies.shift() ?? "" },
      files: { read: (p) => fs[p] ?? null, write: (p, c) => { fs[p] = c; }, ext: () => "rs", short: (p) => p },
      tests: { unavailable: () => null, run: async () => (runs.push("run"), { ran: true, passed: true, output: "ok" }) },
      view: { render: () => {} },
      editor: { propose: async (_p, content) => { if (editorAnswer.applied) fs["p/a.rs"] = content; return editorAnswer; } },
      lang: () => "en",
      copy: (k) => DOC_COPY.en[k],
    });
    s.review("p/a.rs", []);
    await flush();
    await s.reviewInEditor();
    expect(s.state()).toMatchObject({ inEditor: false, applied: { prev: "fn a() {}\n" }, test: { status: "passed" } });
    expect(runs).toEqual(["run"]);
    expect(fs["p/a.rs"]).toBe("fn a() -> u8 { 1 }\n"); // não foi reescrito por cima: o editor já o escreveu
    editorAnswer = { applied: 0, total: 1, before: fs["p/a.rs"] };
    s.review("p/a.rs", []);
    await flush();
    await s.reviewInEditor();
    expect(s.state()).toMatchObject({ improved: null, denied: true, applied: null });
    expect(runs).toEqual(["run"]);
  });
});
