/* ═════════ feature `testing` — domínio: a corrida ao vivo (o painel «Tests») ═════════
   O runner do painel lê a saída da suite LINHA A LINHA, à medida que chega, e mantém o estado da
   corrida: a fase (a compilar, a correr, acabada), o que está a acontecer agora, quantos testes há
   (quando a ferramenta o diz), cada teste com PASS/FAIL/SKIP e a duração, e o detalhe de cada falha
   com o sítio `ficheiro:linha` (via `test-report`). Ferramentas: cargo test (libtest), go test -v,
   pytest -v, unittest -v, vitest e jest. PURO — sem DOM, sem `window`; `feed` muta o estado que
   recebe (a vista redesenha a partir dele). */

import { parseTestOutput, type FailureSpot } from "./test-report";

export type CaseStatus = "pass" | "fail" | "skip";
export type LivePhase = "starting" | "building" | "running" | "passed" | "failed" | "stopped" | "error";

export interface LiveCase {
  name: string;
  /** o ficheiro/módulo/suite onde está, quando a ferramenta o diz */
  suite: string | null;
  status: CaseStatus;
  ms: number | null;
  /** as linhas do detalhe da falha (stdout do teste, a asserção, o traceback) */
  detail: string[];
  spot: FailureSpot | null;
}

export interface LiveRun {
  command: string;
  /** quem pediu (o Code review, o Testing, o Co-Dev, a paleta) */
  source: string;
  phase: LivePhase;
  /** a última coisa que aconteceu, em texto da ferramenta («Compiling lexer v0.1.0», «tests/test_x.py») */
  now: string;
  /** quantos testes a ferramenta anunciou (soma dos «running N tests»); `null` se não diz */
  total: number | null;
  /** a percentagem que a ferramenta anuncia (pytest `[ 50%]`) */
  percent: number | null;
  cases: LiveCase[];
  log: string[];
  exit: number | null;
  error: string | null;
  /** quando começou e acabou (ms desde a época; o relógio é de quem corre) */
  startedAt: number;
  endedAt: number | null;
  /** onde estamos dentro da saída: o bloco de detalhe que se está a ler */
  block: { name: string; lines: string[] } | null;
  /** go: o teste em curso (as linhas indentadas são dele) e as linhas de cada um até ao «--- FAIL» */
  goRunning: string | null;
  pending: Record<string, string[]>;
}

const MAX_LOG = 4000;
/* as sequências ANSI (cores, cursor) que as ferramentas escrevem: ESC [ … letra */
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;?]*[A-Za-z]", "g");
const strip = (s: string): string => s.replace(ANSI, "").replace(/\r/g, "");

export function newRun(command: string, source: string, startedAt = 0): LiveRun {
  return { command, source, phase: "starting", now: "", total: null, percent: null, cases: [], log: [], exit: null, error: null, startedAt, endedAt: null, block: null, goRunning: null, pending: {} };
}

/** O comando com a saída que o runner sabe ler ao vivo: o go precisa de `-v` para dizer cada teste,
 *  o pytest de `-v` em vez de `-q`. O resto corre tal e qual. */
export function liveCommand(cmd: string): string {
  let c = cmd.trim();
  if (/^go test\b/.test(c) && !/\s-v\b/.test(c)) c = c.replace(/^go test\b/, "go test -v");
  if (/\bpytest\b/.test(c)) c = /\s-q\b/.test(c) ? c.replace(/\s-q\b/, " -v") : /\s-v\b/.test(c) ? c : c + " -v";
  if (/\bunittest\b/.test(c) && !/\s-v\b/.test(c)) c += " -v";
  return c;
}

function upsert(r: LiveRun, name: string, status: CaseStatus, suite: string | null = null, ms: number | null = null): LiveCase {
  let c = r.cases.find((x) => x.name === name && (x.suite === suite || !suite || !x.suite));
  if (!c) { c = { name, suite, status, ms, detail: [], spot: null }; r.cases.push(c); }
  else { c.status = status; if (ms !== null) c.ms = ms; if (suite && !c.suite) c.suite = suite; }
  if (r.phase === "starting" || r.phase === "building") r.phase = "running";
  return c;
}

/** Fecha o bloco de detalhe em curso: guarda as linhas e o primeiro sítio no teste dele. */
function closeBlock(r: LiveRun): void {
  const b = r.block;
  r.block = null;
  if (!b) return;
  const c = r.cases.find((x) => x.name === b.name || x.name.endsWith(b.name) || b.name.endsWith(x.name));
  const lines = b.lines.filter((l, i, a) => l.trim() || (i > 0 && i < a.length - 1));
  if (c) {
    c.detail = lines.slice(0, 80);
    c.spot = parseTestOutput(lines.join("\n")).spots[0] ?? c.spot;
  } else if (lines.length) {
    // um teste que ainda não apareceu na lista (vitest/jest escrevem os detalhes no fim)
    r.cases.push({ name: b.name, suite: null, status: "fail", ms: null, detail: lines.slice(0, 80), spot: parseTestOutput(lines.join("\n")).spots[0] ?? null });
  }
}

const msOf = (n: string | undefined, unit: string | undefined): number | null => (n === undefined ? null : Math.round(parseFloat(n) * (unit === "s" ? 1000 : 1)));

/** Uma linha nova da saída. */
export function feed(r: LiveRun, raw: string): void {
  const l = strip(raw);
  r.log.push(l);
  if (r.log.length > MAX_LOG) r.log.splice(0, r.log.length - MAX_LOG);
  let m: RegExpMatchArray | null;

  /* ── blocos de detalhe (o que vem antes de um cabeçalho novo pertence ao bloco aberto) ── */
  if ((m = l.match(/^---- (\S+) std(?:out|err) ----$/))) { closeBlock(r); r.block = { name: m[1], lines: [] }; return; }       // cargo
  if ((m = l.match(/^_{3,} (\S.*?) _{3,}$/))) { closeBlock(r); r.block = { name: m[1].replace(/^\w+\./, "").trim(), lines: [] }; return; } // pytest
  if ((m = l.match(/^(?:FAIL|ERROR): (\w+) \(([\w.]+)\)/))) { closeBlock(r); r.block = { name: `${m[1]} (${m[2]})`, lines: [] }; return; } // unittest
  if ((m = l.match(/^\s*(?:FAIL|×|✗)\s+(\S+\.(?:test|spec)\.\w+)\s*>\s*(.+?)\s*$/)) && r.phase !== "starting" && /^\s*FAIL\s/.test(l)) { closeBlock(r); r.block = { name: m[2].split(" > ").pop()!.trim(), lines: [] }; return; } // vitest, no fim
  if (r.block) {
    if (/^(failures:|test result:|={5,}|-{20,}$|short test summary info|FAILED \S+::|\s*Test Files\s)/.test(l.trim()) || /^={3,} .* ={3,}$/.test(l)) closeBlock(r);
    else { r.block.lines.push(l); return; }
  }

  /* ── fases e o que está a acontecer ── */
  if ((m = l.match(/^\s*(Compiling|Building|Checking|Downloading|Downloaded|Updating|Locking)\s+(.+)$/))) { if (r.phase === "starting") r.phase = "building"; r.now = `${m[1]} ${m[2]}`; return; }
  if ((m = l.match(/^\s*Running\s+(.+?)(?:\s+\(.+\))?$/)) && /unittests|tests\/|\.rs|target/.test(l)) { r.now = `Running ${m[1]}`; r.phase = "running"; return; }
  if ((m = l.match(/^\s*Doc-tests\s+(\S+)/))) { r.now = `Doc-tests ${m[1]}`; return; }
  if ((m = l.match(/^running (\d+) tests?$/))) { r.total = (r.total ?? 0) + +m[1]; r.phase = "running"; return; }
  if ((m = l.match(/^collected (\d+) items?/))) { r.total = +m[1]; r.phase = "running"; r.now = l.trim(); return; }
  if (/^\s*(?:RUN|>)\s+v?\d[\d.]*\s+(.+)$/.test(l)) { r.now = l.trim(); r.phase = "running"; return; } // vitest «RUN v1.6.0 /path»

  /* ── cargo / libtest ── */
  if ((m = l.match(/^test (\S+)(?: - \S+)? \.\.\. (ok|FAILED|ignored)(?:, finished in ([\d.]+)s)?/))) {
    upsert(r, m[1], m[2] === "ok" ? "pass" : m[2] === "FAILED" ? "fail" : "skip", null, msOf(m[3], "s"));
    r.now = m[1];
    return;
  }

  /* ── go test -v ── */
  if ((m = l.match(/^=== RUN\s+(\S+)/))) { r.goRunning = m[1]; r.now = m[1]; r.phase = "running"; return; }
  if ((m = l.match(/^\s*--- (PASS|FAIL|SKIP): (\S+) \(([\d.]+)s\)/))) {
    const c = upsert(r, m[2], m[1] === "PASS" ? "pass" : m[1] === "FAIL" ? "fail" : "skip", null, msOf(m[3], "s"));
    const lines = r.pending[m[2]] ?? [];
    delete r.pending[m[2]];
    if (c.status === "fail" && lines.length) { c.detail = lines; c.spot = parseTestOutput(lines.join("\n")).spots[0] ?? null; }
    if (r.goRunning === m[2]) r.goRunning = null;
    return;
  }
  if (r.goRunning && /^\s{4,}\S/.test(l)) {
    (r.pending[r.goRunning] ??= []).push(l);
    return;
  }
  if ((m = l.match(/^(ok|FAIL)\s+(\S+)\s+([\d.]+s|\(cached\))/))) { r.now = `${m[1]} ${m[2]}`; return; }

  /* ── pytest -v ── */
  if ((m = l.match(/^(\S+?)::(\S+(?:\[.*?\])?)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)(?:\s+\[\s*(\d+)%\])?/))) {
    upsert(r, m[2], m[3] === "PASSED" || m[3] === "XPASS" ? "pass" : m[3] === "SKIPPED" || m[3] === "XFAIL" ? "skip" : "fail", m[1]);
    if (m[4]) r.percent = +m[4];
    r.now = `${m[1]}::${m[2]}`;
    return;
  }

  /* ── unittest -v ── */
  if ((m = l.match(/^(\w+) \(([\w.]+)\)(?: \.\.\.|\n)?\s*(?:\.\.\.\s*)?(ok|FAIL|ERROR|skipped.*)$/))) {
    upsert(r, `${m[1]} (${m[2]})`, m[3] === "ok" ? "pass" : m[3].startsWith("skipped") ? "skip" : "fail");
    r.now = `${m[2]}.${m[1]}`;
    return;
  }
  if ((m = l.match(/^Ran (\d+) tests? in ([\d.]+)s/))) { r.total = +m[1]; return; }

  /* ── jest / vitest ── */
  if ((m = l.match(/^\s*(PASS|FAIL)\s+(\S+\.(?:test|spec)\.\w+)/))) { r.now = `${m[1]} ${m[2]}`; r.phase = "running"; return; }
  if ((m = l.match(/^\s*(✓|✔|√)\s+(.+?)(?:\s+\((\d+)\s*tests?\))?(?:\s+\(?(\d+(?:\.\d+)?)\s*(ms|s)\)?)?\s*$/))) {
    if (m[3]) { r.now = m[2]; return; } // vitest: a linha do ficheiro inteiro («✓ tests/a.test.ts (3 tests) 5ms»)
    upsert(r, m[2].split(" > ").pop()!.trim(), "pass", m[2].includes(" > ") ? m[2].split(" > ")[0] : null, msOf(m[4], m[5]));
    return;
  }
  if ((m = l.match(/^\s*(×|✕|✗|✖)\s+(.+?)(?:\s+\(?(\d+(?:\.\d+)?)\s*(ms|s)\)?)?\s*$/))) {
    const parts = m[2].split(" > ");
    upsert(r, parts.pop()!.trim(), "fail", parts.length ? parts[0] : null, msOf(m[3], m[4]));
    return;
  }
  if ((m = l.match(/^\s*[↓○]\s+(.+?)(?:\s+\[skipped\])?\s*$/))) { upsert(r, m[1].split(" > ").pop()!.trim(), "skip"); return; }
}

/** A saída acabou: fecha o último bloco, decide a fase pelo código de saída e completa os sítios. */
export function finish(r: LiveRun, exit: number, at: number | null = null): void {
  closeBlock(r);
  r.exit = exit;
  if (r.endedAt === null) r.endedAt = at;
  if (r.phase === "stopped") return;
  r.phase = exit === 0 ? "passed" : "failed";
  if (exit !== 0) {
    const all = parseTestOutput(r.log.join("\n"));
    const fails = r.cases.filter((c) => c.status === "fail");
    // a ferramenta não disse que teste falhou (não compilou, p.ex.): o sítio da saída fica na corrida
    if (!fails.length && all.spots.length) r.error = all.headline ?? null;
    for (const c of fails) if (!c.spot) c.spot = all.spots.find((s) => c.detail.some((d) => d.includes(`${s.file}:${s.line}`))) ?? null;
  }
  r.now = "";
}

export interface LiveCounts { pass: number; fail: number; skip: number; done: number }

export function liveCounts(r: LiveRun): LiveCounts {
  const pass = r.cases.filter((c) => c.status === "pass").length;
  const fail = r.cases.filter((c) => c.status === "fail").length;
  const skip = r.cases.filter((c) => c.status === "skip").length;
  return { pass, fail, skip, done: pass + fail + skip };
}

/** A fracção feita (0..1), ou `null` se a ferramenta não diz quantos há (barra indeterminada). */
export function progress(r: LiveRun): number | null {
  if (r.phase === "passed" || r.phase === "failed") return 1;
  if (r.percent !== null) return r.percent / 100;
  if (r.total) return Math.min(1, liveCounts(r).done / r.total);
  return null;
}

/** O nome curto de um teste para procurar a definição (`tests::lex_ab` → `lex_ab`; `test_add (m.C)` → `test_add`). */
export function testFnName(name: string): string {
  return name.replace(/\s*\(.*\)$/, "").replace(/\[.*\]$/, "").split(/::|\.|\//).pop()!.trim();
}

/** Onde está definido o teste: o primeiro ficheiro com `fn nome`, `def nome`, `func nome` ou `it/test("nome"`. */
export function findTestDef(files: Record<string, string>, name: string): { key: string; line: number } | null {
  const fn = testFnName(name);
  if (!fn) return null;
  const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:\\bfn\\s+${esc}\\b|\\bdef\\s+${esc}\\b|\\bfunc\\s+${esc}\\b|\\b(?:it|test)\\(\\s*["'\`]${esc}["'\`])`);
  for (const [key, text] of Object.entries(files)) {
    const i = text.search(re);
    if (i >= 0) return { key, line: text.slice(0, i).split("\n").length };
  }
  return null;
}
