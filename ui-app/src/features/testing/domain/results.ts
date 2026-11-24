/* ═══════════ feature `testing` — domain: resultados (ADR-0005, R2a) ═══════════
   Regras PURAS sobre os testes e os resultados: a chave de um teste, o agrupamento por
   ficheiro, a leitura do estado de cada teste na saída de «Run all» (o backend devolve só
   o veredicto da suíte e a saída combinada) e o texto da barra de estado. */

import type { Counts, FileGroup, TestItem, TestRun, TestState, TestStatus } from "./types";

/** Chave estável de um teste (o mesmo `path` pode existir em ficheiros diferentes). */
export const testKey = (t: TestItem): string => `${t.file}::${t.path}`;

/** Agrupa por ficheiro, mantendo a ordem da descoberta (o backend ordena por ficheiro/linha). */
export function groupByFile(items: TestItem[]): FileGroup[] {
  const out: FileGroup[] = [];
  for (const t of items) {
    const last = out[out.length - 1];
    if (last && last.file === t.file) last.items.push(t);
    else out.push({ file: t.file, items: [t] });
  }
  return out;
}

type Verdict = "passed" | "failed" | "ignored";

/** Um caminho de teste do cargo (`crate::tests::x` ou só `x`) corresponde ao `path` descoberto? */
const rustMatch = (printed: string, path: string): boolean =>
  printed === path || printed.endsWith("::" + path) || path.endsWith("::" + printed);

/** Lê o estado de cada teste na saída combinada de «Run all»:
 *  - Rust (`cargo test`): `test caminho ... ok|FAILED|ignored`;
 *  - Go (`go test`): `--- PASS|FAIL|SKIP: TestX` (subtestes `TestX/y` contam para `TestX`);
 *  - Python (`unittest -v`): `test_x (modulo.Classe.test_x) ... ok|FAIL|ERROR|skipped`.
 *  Devolve só os testes que a saída nomeia (os outros ficam por decidir). */
export function parseSuiteOutput(output: string, items: TestItem[]): Map<string, Verdict> {
  const out = new Map<string, Verdict>();
  const set = (pred: (t: TestItem) => boolean, v: Verdict): void => {
    for (const t of items) if (pred(t)) out.set(testKey(t), v);
  };
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    let m = line.match(/^test (\S+) \.\.\. (ok|FAILED|ignored)\b/);
    if (m) {
      const [, printed, r] = m;
      set((t) => t.lang === "rust" && rustMatch(printed, t.path), r === "ok" ? "passed" : r === "FAILED" ? "failed" : "ignored");
      continue;
    }
    m = line.match(/^\s*--- (PASS|FAIL|SKIP): (\S+)/);
    if (m) {
      const [, r, name] = m, top = name.split("/")[0];
      if (top !== name) continue; // subteste: o veredicto do pai decide
      set((t) => t.lang === "go" && t.path === top, r === "PASS" ? "passed" : r === "FAIL" ? "failed" : "ignored");
      continue;
    }
    m = line.match(/^(\w+) \(([^)]*)\) \.\.\. (ok|FAIL|ERROR|skipped|expected failure|unexpected success)/);
    if (m) {
      const [, name, , r] = m;
      set((t) => t.lang === "python" && t.path === name, r === "ok" || r === "expected failure" ? "passed" : r === "skipped" ? "ignored" : "failed");
    }
  }
  return out;
}

/** O estado de cada teste depois de «Run all»: o que a saída diz; senão, `#[ignore]` fica
 *  ignorado; senão, uma suíte que passou inteira passou-o; senão fica por decidir (`idle`)
 *  — p.ex. o `go test` sem `-v` não nomeia os testes que passam. */
export function statesAfterSuite(items: TestItem[], run: TestRun): Record<string, TestState> {
  const named = parseSuiteOutput(run.output, items), out: Record<string, TestState> = {};
  for (const t of items) {
    const k = testKey(t), v = named.get(k);
    const status: TestStatus = v ?? (t.ignored ? "ignored" : run.ran && run.passed ? "passed" : "idle");
    out[k] = { status };
  }
  return out;
}

export function countStates(items: TestItem[], states: Record<string, TestState>): Counts {
  const c: Counts = { passed: 0, failed: 0, ignored: 0, total: items.length };
  for (const t of items) {
    const s = states[testKey(t)]?.status;
    if (s === "passed") c.passed++;
    else if (s === "failed") c.failed++;
    else if (s === "ignored") c.ignored++;
  }
  return c;
}

/** Texto da barra de estado: vazio sem resultados; «⟳ testes…» a correr; senão contagens reais. */
export function statusBarText(c: Counts, running: boolean): string {
  if (running) return "⟳ testes…";
  if (!c.passed && !c.failed) return "";
  return `✓ ${c.passed}` + (c.failed ? ` ✗ ${c.failed}` : "");
}
