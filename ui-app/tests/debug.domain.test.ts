import { describe, expect, it } from "vitest";
import { bpKey, bpLine, bpPath } from "../src/features/debug/domain/breakpoints";
import { buildLexTrace } from "../src/features/debug/domain/lexer-trace";
import { buildCrashTrace } from "../src/features/debug/domain/crash-trace";
import { buildLaunchConfigs } from "../src/features/debug/domain/launch";
import type { CrashInput } from "../src/features/debug/domain/types";

/* Testes unitários do domínio PURO da feature Run and Debug (ADR-0002, Fase 2).
 * Exercitam os geradores directamente, sem harness nem `window` — só dados→dados. A
 * caracterização byte-a-byte (igualdade com o original) já está fixada pelos goldens
 * em `debug.golden.test.ts`, que correm estes mesmos geradores pelo resíduo; aqui
 * focamos a semântica de cada peça pura com entradas controladas. */

describe("domain/breakpoints — chaves path:line", () => {
  it("bpKey junta; bpLine/bpPath desfazem (caminho com ':' no meio é raro, mas o nº fica no fim)", () => {
    expect(bpKey("a/b/lib.rs", 10)).toBe("a/b/lib.rs:10");
    expect(bpLine("a/b/lib.rs:10")).toBe("10");
    expect(bpPath("a/b/lib.rs:10")).toBe("a/b/lib.rs");
  });
});

describe("domain/lexer-trace — buildLexTrace", () => {
  // lexLine falso determinista: devolve nºs fixos por regex, como o LXL sobre o seed.
  const lexLine = (re: RegExp): number => {
    const table: [RegExp, number][] = [
      [/let mut tokens/, 3], [/let mut chars/, 4], [/for c in|while let Some\(c\)/, 5],
      [/is_ascii_digit/, 6], [/Token::Num\(c\)/, 7], [/chars\.peek\(\)/, 10],
      [/Token::Eof\)/, 11], [/^\s*tokens\s*$/, 13],
    ];
    const hit = table.find(([r]) => r.source === re.source);
    return hit ? hit[1] : 0;
  };

  it("clone: 9 passos, termina em causa-raiz (sem Eof) e oferece um fix", () => {
    const tr = buildLexTrace("clone", lexLine);
    expect(tr.steps.length).toBe(9);
    expect(tr.end.ok).toBe(false);
    expect(typeof tr.end.fix).toBe("function");
    // o fix troca clone() por by_ref()
    expect(tr.end.fix!("for c in chars.clone() {")).toBe("for c in chars.by_ref() {");
    // o passo da condição Eof é a evidência decisiva, na linha do chars.peek()
    const ev = tr.steps.find((s) => s.ev);
    expect(ev && ev.l).toBe(10);
  });

  it("byref/whilelet: 10 passos e veredicto sem defeito", () => {
    for (const v of ["byref", "whilelet"]) {
      const tr = buildLexTrace(v, lexLine);
      expect(tr.steps.length).toBe(10);
      expect(tr.end.ok).toBe(true);
    }
  });
});

describe("domain/crash-trace — buildCrashTrace", () => {
  const input: CrashInput = {
    env: "staging",
    n: "orders-worker",
    deps: [
      { n: "orders-worker", status: "crash", restarts: 6, err: "lookup db.bad: no such host" },
      { n: "orders-api", status: "ok" },
    ],
    sec: {
      "orders-worker": { DATABASE_URL: "postgres://app:secret@db.bad:5432/orders" },
      "orders-api": { DATABASE_URL: "postgres://app:secret@db.staging:5432/orders" },
    },
    local: { "orders-worker": { DATABASE_URL: "postgres://app:secret@db.staging:5432/orders" } },
    ns: "dxtutor-staging",
    label: "Staging",
    urlHosts: (v: string) => (String(v).match(/^[a-z]+:\/\/(?:[^@/]*@)?([^:/]+)/i) || [])[1] || null,
  };

  it("5 sondas, causa-raiz de host, e encontra o peer saudável (orders-api)", () => {
    const tr = buildCrashTrace(input);
    expect(tr.steps.length).toBe(5);
    expect(tr.end.ok).toBe(false);
    expect(tr.hk.host).toBe("Wrong host in configuration");
    // a 3.ª sonda compara com o peer saudável que fala com db.staging
    expect(tr.steps[2].cmd).toContain("orders-api");
    // a confirmação final faz nslookup ao host mau (db.bad)
    expect(tr.steps[4].cmd).toContain("db.bad");
    // a acção do desfecho abre os segredos de staging
    expect(tr.end.act).toContain("SHOWSEC=true");
  });
});

describe("domain/launch — buildLaunchConfigs", () => {
  it("só lexer quando nenhum ambiente tem crash", () => {
    const c = buildLaunchConfigs([{ env: "staging", state: null }, { env: "production", state: { deps: [{ n: "x", status: "ok" }] } }]);
    expect(c.map((x) => x.id)).toEqual(["lexer"]);
  });

  it("um lançador crash por dep em crash, com id crash:<env>:<serviço>", () => {
    const c = buildLaunchConfigs([
      { env: "staging", state: { deps: [{ n: "orders-worker", status: "crash" }, { n: "ok-svc", status: "ok" }] } },
      { env: "production", state: { deps: [{ n: "billing", status: "crash" }] } },
    ]);
    expect(c.map((x) => x.id)).toEqual(["lexer", "crash:staging:orders-worker", "crash:production:billing"]);
    expect(c[1].l).toBe("Attach: orders-worker (staging)");
  });
});
