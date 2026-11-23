import { describe, expect, it } from "vitest";
import { approvalFor, type CommandRules } from "../src/features/codev/domain/policy";
import { RUBRIC, RETRY_LIMIT, candidateTotal, scoreChecks, passesThreshold } from "../src/features/codev/domain/scoring";
import { buildScenarios, scenarioForPrompt } from "../src/features/codev/domain/scenarios";
import { buildLexerE0382 } from "../src/features/codev/domain/scenarios/lexer-e0382";
import { buildChatHistory } from "../src/features/codev/domain/scenarios/chat-history";
import type { Mode, ScenarioEnv, FileEntry } from "../src/features/codev/domain/types";

/* Testes unitários do DOMÍNIO puro do Co-Dev (ADR-0002, Fase 2). Sem DOM, sem
 * window, sem bootApp: importam directamente os módulos extraídos e exercitam-nos
 * com fakes. A rede de segurança de comportamento (golden + caracterização) vive
 * nos outros ficheiros; aqui prova-se que cada função extraída decide o que devia. */

const MODES: Mode[] = ["manual", "assist", "auto"];

/* Os mesmos regexes SAFE/DANGER do monólito (app.ts), aqui como `CommandRules`
 * fake — é o que o `legacy-bridge` embrulha em produção. */
const SAFE = /^(cargo (test|build|clippy)|dx lint|npm run lint)/;
const DANGER = /git push|rm -rf|drop table|--force/i;
const rules: CommandRules = { isSafe: (c) => SAFE.test(c), isDestructive: (c) => DANGER.test(c) };

describe("policy.approvalFor — a única fonte da regra de aprovação", () => {
  it("read nunca pede aprovação, em qualquer modo", () => {
    for (const mode of MODES) expect(approvalFor(mode, { kind: "read" }, rules)).toBe("auto");
  });

  it("edit só pede em manual; assist/auto aplicam automaticamente", () => {
    expect(approvalFor("manual", { kind: "edit" }, rules)).toBe("ask");
    expect(approvalFor("assist", { kind: "edit" }, rules)).toBe("auto");
    expect(approvalFor("auto", { kind: "edit" }, rules)).toBe("auto");
  });

  it.each([
    ["manual", "cargo test", "ask"],
    ["assist", "cargo test", "auto"],
    ["auto", "cargo test", "auto"],
    ["manual", "curl example.org", "ask"],
    ["assist", "curl example.org", "ask"],
    ["auto", "curl example.org", "auto"],
    ["manual", "git push --force", "ask"],
    ["assist", "git push --force", "ask"],
    ["auto", "git push --force", "ask"],
  ] as const)("run %s + %s -> %s", (mode, cmd, expected) => {
    expect(approvalFor(mode, { kind: "run", cmd }, rules)).toBe(expected);
  });

  it("comando destrutivo pede aprovação mesmo em auto (defesa que não depende do modo)", () => {
    for (const mode of MODES) expect(approvalFor(mode, { kind: "run", cmd: "rm -rf /" }, rules)).toBe("ask");
  });

  it("run sem cmd trata como comando vazio (não-seguro) — manual/assist pedem, auto não", () => {
    expect(approvalFor("manual", { kind: "run" }, rules)).toBe("ask");
    expect(approvalFor("assist", { kind: "run" }, rules)).toBe("ask");
    expect(approvalFor("auto", { kind: "run" }, rules)).toBe("auto");
  });

  /* A tabela POLICY das Definições (codev.ts) descreve a MESMA regra em prosa.
   * Em vez de a reescrever às cegas, fixa-se aqui as 4 linhas governadas por
   * `approvalFor` (verbatim do const POLICY) e prova-se que a política concorda:
   * uma célula "aprovas…" == ask; "automático…" == auto. */
  const POLICY_TOOL_ROWS: Array<{ row: [string, string, string, string]; call: () => Parameters<typeof approvalFor>[1] }> = [
    { row: ["Editar ficheiros", "aprovas cada edição", "automático, com diff", "automático, com diff"], call: () => ({ kind: "edit" }) },
    { row: ["Terminal: testes, build, lint", "aprovas", "automático", "automático"], call: () => ({ kind: "run", cmd: "cargo test" }) },
    { row: ["Terminal: outros comandos", "aprovas", "aprovas", "automático"], call: () => ({ kind: "run", cmd: "curl example.org" }) },
    { row: ["Push e acções destrutivas", "aprovas", "aprovas", "aprovas — sempre"], call: () => ({ kind: "run", cmd: "git push" }) },
  ];

  it("concorda com a tabela POLICY das Definições nas linhas de ferramentas", () => {
    const cellApproval = (cell: string) => (cell.startsWith("aprovas") ? "ask" : "auto");
    for (const { row, call } of POLICY_TOOL_ROWS) {
      MODES.forEach((mode, i) => {
        expect(approvalFor(mode, call(), rules), `${row[0]} / ${mode}`).toBe(cellApproval(row[i + 1]));
      });
    }
  });
});

describe("scoring — rubrica, total, limiar, limite de tentativas", () => {
  it("a rubrica soma 100 e tem as 5 chaves esperadas", () => {
    expect(RUBRIC.reduce((s, k) => s + k.w, 0)).toBe(100);
    expect(RUBRIC.map((k) => k.k)).toEqual(["c", "a", "t", "r", "k"]);
  });

  it("candidateTotal = soma ponderada / 10 (escala 0–100)", () => {
    expect(candidateTotal({ c: 10, a: 10, t: 10, r: 10, k: 10 })).toBe(100);
    expect(candidateTotal({ c: 0, a: 0, t: 0, r: 0, k: 0 })).toBe(0);
    // claude no cenário a: (10·30 + 9·25 + 9·20 + 9·15 + 10·10) / 10 = 94
    expect(candidateTotal({ c: 10, a: 9, t: 9, r: 9, k: 10 })).toBe(94);
  });

  it("scoreChecks soma só os pesos dos checks que passaram", () => {
    expect(scoreChecks([{ w: 40, ok: true }, { w: 40, ok: false }, { w: 20, ok: true }])).toBe(60);
    expect(scoreChecks([])).toBe(0);
  });

  it("passesThreshold é >= (igual ao limiar passa)", () => {
    expect(passesThreshold(80, 80)).toBe(true);
    expect(passesThreshold(79, 80)).toBe(false);
    expect(passesThreshold(100, 80)).toBe(true);
  });

  it("o limite de tentativas é 2 (um só sítio)", () => {
    expect(RETRY_LIMIT).toBe(2);
  });
});

/* ───── fake ScenarioEnv para os cenários ───── */
function fakeEnv(over: Partial<ScenarioEnv> = {}): ScenarioEnv {
  const paths = { root: "/ws/", lx: "crates/lexer/src/lib.rs", repo: "crates/store/src/conversations.rs", mig: "db/migrations/0002.sql", test: "crates/store/tests/it.rs", hist: "desktop/src/history.ts", adr: "docs/ADR-003.md", store: "crates/store/src/lib.rs" };
  const base: ScenarioEnv = {
    paths,
    seed: { base: { "crates/lexer/src/lib.rs": "orig" }, gen: {} },
    files: () => ({} as Record<string, FileEntry>),
    has: () => false,
    fileDiffStat: () => ({ add: 0, del: 0 }),
    runTests: () => ({ build: false, err: "", ok: false, tests: [] }),
    dsLint: () => [],
    lexBug: () => true,
  };
  return { ...base, ...over };
}

describe("scenarios — dados puros parametrizados pelo ScenarioEnv", () => {
  it("scenarioForPrompt: texto livre só cai num cenário na simulação do browser", () => {
    const scn = buildScenarios(fakeEnv());
    const real = "This command failed in my terminal.\nerror[E0382]: use of moved value: `chars`";
    expect(scenarioForPrompt(real, scn, true)?.id).toBe("a");
    expect(scenarioForPrompt(real, scn, false)).toBeUndefined();
    expect(scenarioForPrompt("mostra o histórico de conversas", scn, false)).toBeUndefined();
    expect(scenarioForPrompt("olá", scn, true)).toBeUndefined();
  });

  it("buildScenarios devolve [a, b] por essa ordem", () => {
    const scn = buildScenarios(fakeEnv());
    expect(scn.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("o ramo git-flow é agora um campo do cenário (ex-ternário S.id==='a')", () => {
    const [a, b] = buildScenarios(fakeEnv());
    expect(a.flow).toEqual({ kind: "fix", branch: "e0382-lexer" });
    expect(b.flow).toEqual({ kind: "feature", branch: "historico-conversas" });
  });

  it("cenário a: metadados estáveis (pkg, verify, commit, best)", () => {
    const a = buildLexerE0382(fakeEnv());
    expect(a.pkg).toBe("lexer");
    expect(a.verify).toEqual(["cargo test -p lexer"]);
    expect(a.commit).toBe("fix(lexer): borrow the iterator in the loop (E0382)");
    expect(a.best).toBe(0);
    expect(a.fix.strategy).toBe("switch");
    expect(a.cands).toHaveLength(3);
  });

  it("cenário a: ready() depende de env.lexBug()", () => {
    expect(buildLexerE0382(fakeEnv({ lexBug: () => true })).ready()).toBeNull();
    expect(buildLexerE0382(fakeEnv({ lexBug: () => false })).ready()).toContain("já não existe");
  });

  it("cenário a: o passo 'by_ref()' é uma transformação pura do texto", () => {
    const a = buildLexerE0382(fakeEnv());
    const editStep = a.cands[0].steps![1];
    const make = editStep.tools[0].make!;
    expect(make("for c in chars {\n")).toBe("for c in chars.by_ref() {\n");
  });

  it("cenário a: o check 'build' lê env.runTests('lexer').build", () => {
    const passing = buildLexerE0382(fakeEnv({ runTests: (p) => ({ build: p === "lexer", err: "", ok: false, tests: [] }) }));
    expect(!!passing.checks.find((k) => k.id === "build")!.fn()).toBe(true);
    const failing = buildLexerE0382(fakeEnv({ runTests: () => ({ build: false, err: "", ok: false, tests: [] }) }));
    expect(!!failing.checks.find((k) => k.id === "build")!.fn()).toBe(false);
  });

  it("cenário a: o check 'min' cruza files/fileDiffStat/has do env", () => {
    const env = fakeEnv({
      files: () => ({ "crates/lexer/src/lib.rs": { content: "nova", orig: "orig" } }),
      fileDiffStat: () => ({ add: 1, del: 0 }),
      has: () => true,
    });
    const a = buildLexerE0382(env);
    expect(!!a.checks.find((k) => k.id === "min")!.fn()).toBe(true);
    // add > 2 reprova o "mínimo"
    const big = buildLexerE0382(fakeEnv({ files: () => ({ "crates/lexer/src/lib.rs": { content: "x", orig: null } }), fileDiffStat: () => ({ add: 9, del: 0 }), has: () => true }));
    expect(!!big.checks.find((k) => k.id === "min")!.fn()).toBe(false);
  });

  it("cenário b: metadados e os 7 checks por id", () => {
    const b = buildChatHistory(fakeEnv());
    expect(b.pkg).toBe("store");
    expect(b.verify).toEqual(["cargo test -p store", "dx lint"]);
    expect(b.commit).toBe("feat(store): persistent chat history (RF-03, ADR-003)");
    expect(b.checks.map((k) => k.id)).toEqual(["tests", "reqs", "arch", "repo", "fk", "ds", "idx"]);
    expect(b.checks.reduce((s, k) => s + k.w, 0)).toBe(100);
  });

  it("cenário b: ready() pede todos os checks a passar (e o repo presente)", () => {
    const notReady = buildChatHistory(fakeEnv({ files: () => ({}), runTests: () => ({ build: false, err: "", ok: false, tests: [] }) }));
    expect(notReady.ready()).toBeNull();
    const repoPath = "crates/store/src/conversations.rs";
    const allPass = buildChatHistory(fakeEnv({
      files: () => ({ [repoPath]: { content: "x", orig: null }, "db/migrations/0002.sql": { content: "x", orig: null }, "desktop/src/history.ts": { content: "x", orig: null } }),
      // tudo presente, EXCEPTO o SQL na UI (check 'arch' é negativo: !has(SELECT|INSERT))
      has: (_p, re) => re.source !== "SELECT |INSERT ",
      dsLint: () => [],
      runTests: () => ({ build: true, err: "", ok: true, tests: [{ n: "a", ok: true }, { n: "b", ok: true }, { n: "c", ok: true }, { n: "d", ok: true }] }),
    }));
    expect(allPass.ready()).toContain("já está implementado");
  });

  it("cenário b: o fix 'tests' injecta ORDER BY (transformação pura)", () => {
    const b = buildChatHistory(fakeEnv());
    const fixTests = b.fix.steps!.find((s) => s.for === "tests")!;
    const make = fixTests.tools[0].make!;
    expect(make("WHERE workspace_id = ?1 LIMIT ?2")).toBe("WHERE workspace_id = ?1 ORDER BY created_at DESC LIMIT ?2");
  });
});
