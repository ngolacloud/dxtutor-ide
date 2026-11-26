/* ═══════════ feature Explain · Code-Review — domínio (o que a saída dos testes diz) ═══════════
   Depois de «Accept» o painel corre a suite do projecto. Quando falha, não basta despejar a saída:
   o humano quer saber ONDE quebrou e o que fazer. Aqui lê-se a saída das ferramentas habituais —
   cargo/rustc, tsc, vitest/jest/node, pytest/unittest, go test — e tira-se: os testes que falharam,
   os sítios (ficheiro:linha, com a mensagem) e o tipo de falha (não compila, uma asserção, um
   panic/excepção, ou não percebido), que decide a dica. PURO — sem DOM, sem `window`. */

export type FailureKind = "compile" | "assert" | "panic" | "unknown";

export interface FailureSpot {
  /** caminho como a ferramenta o escreveu (relativo à pasta, normalmente) */
  file: string;
  line: number;
  message: string;
}

export interface TestReport {
  kind: FailureKind;
  /** os testes que falharam (nomes como a ferramenta os escreve) */
  failed: string[];
  /** os sítios, sem repetidos, pela ordem em que aparecem (o primeiro costuma ser a causa) */
  spots: FailureSpot[];
  /** a linha que melhor resume a falha (o primeiro erro ou asserção) */
  headline: string | null;
}

/* as cores ANSI que as ferramentas escrevem (ESC [ … m) */
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");
const strip = (s: string): string => s.replace(ANSI, "");
const SRC = String.raw`[\w./@+-]+\.(?:rs|ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|cs|cpp|cc|c|h|swift|sql)`;
/** ficheiros que não interessam: bibliotecas, o runtime, node_modules */
const noise = (f: string): boolean => /(^|\/)(node_modules|\.cargo|rustc|library\/(core|std|alloc)|site-packages|go\/src|internal\/)\//.test(f) || f.startsWith("node:");

export function parseTestOutput(output: string): TestReport {
  const ls = strip(output).split("\n");
  const failed: string[] = [];
  const spots: FailureSpot[] = [];
  let kind: FailureKind = "unknown";
  let headline: string | null = null;
  const rank: Record<FailureKind, number> = { unknown: 0, assert: 1, panic: 2, compile: 3 };
  let kindOfHeadline: FailureKind = "unknown";
  const mark = (k: FailureKind, line: string) => {
    if (rank[k] > rank[kind]) kind = k;
    if (!headline || rank[k] > rank[kindOfHeadline]) { headline = line.trim(); kindOfHeadline = k; }
  };
  const spot = (file: string, line: number, message: string) => {
    file = file.replace(/^\.\//, "");
    if (noise(file) || !line) return;
    if (!spots.some((s) => s.file === file && s.line === line)) spots.push({ file, line, message: message.trim().slice(0, 240) });
  };
  let lastError = "";

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    let m: RegExpMatchArray | null;
    /* nomes de testes que falharam */
    if ((m = l.match(/^test (\S+) \.\.\. FAILED/))) failed.push(m[1]);                         // cargo
    else if ((m = l.match(/^\s*--- FAIL: (\S+)/))) failed.push(m[1]);                          // go
    else if ((m = l.match(/^(?:FAIL|ERROR): (\w+) \(([\w.]+)\)/))) failed.push(`${m[2]}.${m[1]}`); // unittest
    else if ((m = l.match(/^FAILED (\S+::\S+)/))) failed.push(m[1]);                            // pytest -q
    else if ((m = l.match(/^\s*(?:FAIL|×|✗)\s+(\S+\.(?:test|spec)\.\w+)\s*>\s*(.+?)(?:\s+\d+ms)?$/))) failed.push(`${m[1]} > ${m[2]}`); // vitest/jest

    /* erros de compilação */
    if ((m = l.match(/^(error(?:\[E\d+\])?): (.+)$/))) { lastError = m[2]; mark("compile", l); }
    if ((m = l.match(new RegExp(String.raw`^\s*-->\s*(${SRC}):(\d+):\d+`)))) spot(m[1], +m[2], lastError || "compile error");
    if ((m = l.match(new RegExp(String.raw`^(${SRC})\((\d+),\d+\): error (TS\d+: .+)$`)))) { mark("compile", l); spot(m[1], +m[2], m[3]); }
    if ((m = l.match(new RegExp(String.raw`^(${SRC}):(\d+):\d+ - error (TS\d+: .+)$`)))) { mark("compile", l); spot(m[1], +m[2], m[3]); }
    if ((m = l.match(new RegExp(String.raw`^(?:#\s*\S+\s*)?\.?\/?(${SRC}):(\d+):\d+: (.+)$`))) && /\.go$/.test(m[1]) && !/_test\.go$/.test(m[1])) { mark("compile", l); spot(m[1], +m[2], m[3]); }
    if (/^\s*(SyntaxError|IndentationError|ModuleNotFoundError|ImportError)\b/.test(l)) mark("compile", l);

    /* panics e excepções */
    if ((m = l.match(new RegExp(String.raw`panicked at (${SRC}):(\d+):\d+:?\s*(.*)$`)))) {
      const msg = m[3] || ls[i + 1] || "panicked";
      if (/assert/.test(msg)) mark("assert", msg); else mark("panic", l);
      spot(m[1], +m[2], msg);
    }
    if ((m = l.match(new RegExp(String.raw`panicked at '(.+)', (${SRC}):(\d+)`)))) { if (/assert/.test(m[1])) mark("assert", m[1]); else mark("panic", l); spot(m[2], +m[3], m[1]); }
    if ((m = l.match(new RegExp(String.raw`^\s*File "(${SRC})", line (\d+)`)))) spot(m[1], +m[2], ls[i + 1] || "");
    if (/^\s*(AssertionError|AssertionFailedError)\b:?\s*(.*)$/.test(l)) mark("assert", l);
    if ((m = l.match(/^\s*(\w*Error|\w*Exception)\b: (.+)$/)) && !/^(AssertionError)/.test(m[1]) && !/^\s*error/.test(l)) mark("panic", l);
    if (/^\s*(?:AssertionError: )?expected .+ to (?:be|equal|deeply equal|contain|match|have)/i.test(l)) mark("assert", l);

    /* sítios de stack traces JS e do vitest («❯ src/x.ts:12:5») e asserções do go («x_test.go:12: …») */
    if ((m = l.match(new RegExp(String.raw`(?:❯|at .*?\(|at )\s*(?:file:\/\/)?(${SRC}):(\d+):\d+\)?`)))) spot(m[1], +m[2], lastError || l.trim());
    if ((m = l.match(/^\s+([\w./-]+_test\.go):(\d+): (.+)$/))) { mark("assert", m[3]); spot(m[1], +m[2], m[3]); }
  }
  if (kind === "unknown" && failed.length) kind = "assert";
  return { kind, failed: [...new Set(failed)], spots: spots.slice(0, 12), headline };
}

/** Os sítios em texto, para o pedido de correcção ao modelo. */
export function spotsText(r: TestReport): string {
  return r.spots.map((s) => `- ${s.file}:${s.line} — ${s.message}`).join("\n");
}
