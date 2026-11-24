/* ═════════ dxtutor IDE — feature: Testing (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o render do pane «Testing» que vivia no monólito
   `app.ts` como `RP.test`.

   Render quase-puro (browser): corre `window.runTests()` (motor de testes simulado que
   ainda vive no monólito, tipado no core), lê o DOM (`$`), compõe o cabeçalho
   (`hd`) e o ícone (`svg`), escapa texto (`esc`) e emite HTML. Os
   acções `test:runTask` / `test:gotoError` (eram `onclick` inline — U5b) resolvem
   `window.runTask` / `window.openPath` / `window.P_LX` no clique (continuam
   globais via o `Object.assign(window,…)` do monólito), por isso não são
   dependências de import.

   Shim transitório: publica `renderTestPane` no `window` porque o residual ainda
   invoca o pane pelo registo `RP` que o monólito cria DEPOIS desta folha carregar
   — em `app.ts`, `RP.test=()=>window.renderTestPane()` delega aqui (lazy, no
   switch de pane). Mesmo padrão de `features/run.ts`. */

import { $, hd, svg, esc } from "../core";
import { RP } from "../app/store/registry";
import { desktopPorts } from "../app/desktop";
import { registerActions, callGlobal } from "../app/actions";
import { codevAsk } from "../app/codev-ask";
import type { Runner, RunnerKind, TestScope, TestRunReport, TestHistory, CaseResult } from "../platform/tauri/tests";
import { caseFilter, counts, failureContext, flakyCases, flakyContext, fmtMs, groupBySuite, passRateTrend, slowestCases, STATUS, tail } from "./test-model";

/* ───── a parte desktop (A0.5 + A6, docs/v2/UI-AUDIT.md item 3) ─────
   Com uma pasta aberta na app Tauri, o pane deixa de mostrar o motor simulado. A A6 junta os
   RUNNERS que o projecto tem de facto (`test_runners`: cargo, go, pytest/unittest, vitest/jest,
   maven/gradle — nunca inventados), corre-os com saída estruturada (`test_run`: resultado,
   duração e falha por teste; «afectados» = os pacotes que o diff toca; watch = os afectados a
   cada gravação) e mostra o histórico guardado em SQLite (`test_history`: tendência, flaky,
   mais lentos). A lista sintáctica da A0.5 (`list_tests`) fica como «Tests in the code», com
   abrir no editor e correr um a um. A porta é instalada por platform/desktop/tests.ts; no
   browser e nos testes não existe e o pane mantém o comportamento anterior. */

/** Um teste descoberto (`tutor_eval::testnav::TestItem`). */
export interface TestItem { name: string; path: string; file: string; line: number; ignored: boolean; lang: string }
/** O resultado de uma execução (`tutor_eval::testnav::TestRun`). */
export interface TestRun { ran: boolean; passed: boolean; output: string }

export interface TestsDesktop {
  /** a pasta aberta (null = sem pasta: o pane fica no motor simulado) */
  root(): string | null;
  list(): Promise<TestItem[]>;
  run(t: TestItem): Promise<TestRun>;
  runAll(): Promise<TestRun>;
  open(file: string, line: number): void;
  /* A6 — ausentes num backend sem os comandos novos: o pane fica no modo A0.5 */
  runners?(): Promise<Runner[]>;
  runRunner?(runner: string, scope: TestScope): Promise<TestRunReport>;
  history?(): Promise<TestHistory>;
  /** o ficheiro activo no editor (para «Write a missing test») */
  currentFile?(): { path: string; text: string } | null;
}

type Light = "pass" | "fail" | "idle" | "running" | "skip";
const D = {
  root: null as string | null,
  items: null as TestItem[] | null,
  loading: false,
  error: "",
  light: {} as Record<string, Light>,
  output: {} as Record<string, string>,
  sel: null as string | null,
  busy: false,
  suite: null as TestRun | null,
  /* A6 */
  runners: null as Runner[] | null,
  runnersLoading: false,
  reports: {} as Record<string, TestRunReport>,
  /** runner id → o que está a correr («all», «changed», o nome de um teste) */
  running: {} as Record<string, string>,
  runError: {} as Record<string, string>,
  hist: null as TestHistory | null,
  histLoading: false,
  /** `<runner id>|<case id>` do resultado aberto */
  selCase: null as string | null,
  watch: false,
};
const key = (t: TestItem): string => t.lang + ":" + t.path;
const LIGHT: Record<Light, [string, string]> = {
  pass: ["var(--green)", "✓"], fail: ["var(--red)", "✖"], idle: ["var(--fg-muted)", "○"],
  running: ["var(--yellow)", "◐"], skip: ["var(--fg-muted)", "⊘"],
};
const errText = (e: unknown): string => String((e as Error)?.message || e);

function reset(root: string | null): void {
  Object.assign(D, {
    root, items: null, loading: false, error: "", light: {}, output: {}, sel: null, busy: false, suite: null,
    runners: null, runnersLoading: false, reports: {}, running: {}, runError: {}, hist: null, histLoading: false, selCase: null, watch: false,
  });
}

async function discover(d: TestsDesktop): Promise<void> {
  D.loading = true; D.error = ""; renderTestPane();
  try { D.items = await d.list(); } catch (e) { D.error = errText(e); D.items = []; }
  D.loading = false; renderTestPane();
}

async function loadRunners(d: TestsDesktop): Promise<void> {
  if (!d.runners) return;
  D.runnersLoading = true;
  try { D.runners = await d.runners(); } catch (e) { D.runners = []; D.error = D.error || errText(e); }
  D.runnersLoading = false; renderTestPane();
}

async function loadHistory(d: TestsDesktop): Promise<void> {
  if (!d.history) return;
  D.histLoading = true;
  try { D.hist = await d.history(); } catch { D.hist = { runs: [], cases: [] }; }
  D.histLoading = false; renderTestPane();
}

async function runOne(d: TestsDesktop, t: TestItem): Promise<void> {
  const k = key(t); D.light[k] = "running"; renderTestPane();
  try {
    const r = await d.run(t);
    D.light[k] = !r.ran ? "fail" : r.passed ? "pass" : "fail";
    D.output[k] = r.output;
  } catch (e) { D.light[k] = "fail"; D.output[k] = errText(e); }
  renderTestPane();
}

/** Lê o resultado por teste da saída de texto do runner (libtest e `go test -v`) — o caminho
 *  da A0.5 quando o backend não tem os runners da A6. */
function applySuiteOutput(items: TestItem[], out: string): void {
  const rust = new Map<string, string>(), go = new Map<string, string>();
  for (const m of out.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)) rust.set(m[1], m[2]);
  for (const m of out.matchAll(/^\s*--- (PASS|FAIL|SKIP): (\S+)/gm)) go.set(m[2], m[1]);
  for (const t of items) {
    const v = t.lang === "go" ? go.get(t.path) : t.lang === "rust" ? rust.get(t.path) : undefined;
    if (!v) continue;
    D.light[key(t)] = v === "ok" || v === "PASS" ? "pass" : v === "ignored" || v === "SKIP" ? "skip" : "fail";
  }
}

/** Os resultados estruturados de um runner acendem também a lista «Tests in the code». */
function applyReport(rep: TestRunReport): void {
  const lang = rep.kind === "cargo" ? "rust" : rep.kind === "go" ? "go" : rep.kind === "pytest" || rep.kind === "unittest" ? "python" : "";
  if (!lang) return;
  for (const t of D.items || []) {
    if (t.lang !== lang) continue;
    const c = rep.results.find((r) => r.name === t.path || r.name === t.name);
    if (c) D.light[key(t)] = c.status === "passed" ? "pass" : c.status === "skipped" ? "skip" : "fail";
  }
}

async function runAll(d: TestsDesktop): Promise<void> {
  if (D.busy) return;
  /* com runners (A6): corre cada runner disponível, com resultado por teste e histórico */
  const rs = (D.runners || []).filter((r) => r.available);
  if (d.runRunner && rs.length) { for (const r of rs) await runRunner(d, r.id, { kind: "all" }); return; }
  D.busy = true; (D.items || []).forEach((t) => { if (!t.ignored) D.light[key(t)] = "running"; }); renderTestPane();
  try {
    const r = await d.runAll();
    D.suite = r;
    (D.items || []).forEach((t) => { if (D.light[key(t)] === "running") D.light[key(t)] = "idle"; });
    applySuiteOutput(D.items || [], r.output);
  } catch (e) {
    D.suite = { ran: false, passed: false, output: errText(e) };
    (D.items || []).forEach((t) => { if (D.light[key(t)] === "running") D.light[key(t)] = "idle"; });
  }
  D.busy = false; renderTestPane();
}

async function runMany(d: TestsDesktop, list: TestItem[]): Promise<void> {
  if (D.busy) return;
  D.busy = true;
  for (const t of list) await runOne(d, t);
  D.busy = false; renderTestPane();
}

async function runRunner(d: TestsDesktop, id: string, scope: TestScope): Promise<void> {
  if (!d.runRunner || D.running[id]) return;
  D.running[id] = scope.kind === "case" ? scope.name : scope.kind;
  delete D.runError[id];
  renderTestPane();
  try {
    const rep = await d.runRunner(id, scope);
    /* correr um teste só actualiza esse resultado na última execução completa */
    const prev = D.reports[id];
    if (scope.kind === "case" && prev && rep.ran) {
      const byId = new Map(rep.results.map((r) => [r.id, r]));
      D.reports[id] = { ...prev, results: prev.results.map((r) => byId.get(r.id) || r).concat(rep.results.filter((r) => !prev.results.some((p) => p.id === r.id))) };
    } else D.reports[id] = rep;
    applyReport(rep);
  } catch (e) { D.runError[id] = errText(e); }
  delete D.running[id];
  renderTestPane();
  void loadHistory(d);
}

/* watch (TEST-05): a cada gravação, os testes afectados pelos ficheiros gravados */
let watchFiles = new Set<string>();
let watchT: ReturnType<typeof setTimeout> | undefined;
function onSaved(e: Event): void {
  const d = desktopPorts.tests;
  if (!D.watch || !d || !d.root() || !d.runRunner) return;
  const files = ((e as CustomEvent<{ files?: string[] }>).detail?.files || []).filter((f) => typeof f === "string");
  files.forEach((f) => watchFiles.add(f));
  clearTimeout(watchT);
  watchT = setTimeout(() => {
    const fs = [...watchFiles]; watchFiles = new Set();
    if (!fs.length) return;
    for (const r of (D.runners || []).filter((r) => r.available)) {
      if (r.dir === "." || fs.some((f) => f.startsWith(r.dir + "/"))) void runRunner(d, r.id, { kind: "changed", files: fs });
    }
  }, 400);
}
document.addEventListener("dx:saved", onSaved);

function ask(intent: "explain" | "fix", rid: string, caseId: string): void {
  const rep = D.reports[rid], c = rep?.results.find((r) => r.id === caseId);
  if (!rep || !c) return;
  const ctx = failureContext(rep, c);
  if (intent === "explain") void codevAsk.ask({ intent: "explain", text: "Explica porque é que este teste falha.", context: [ctx], send: true });
  else void codevAsk.ask({ intent: "fix", text: `Corrige o código para o teste «${c.name}» passar (não alteres o teste, a não ser que esteja errado). Depois corre \`${rep.command}\`.`, context: [ctx], send: true });
}

function writeMissingTest(d: TestsDesktop): void {
  const f = d.currentFile ? d.currentFile() : null;
  const r = (D.runners || []).find((x) => x.available);
  const how = r ? ` com ${r.kind} (o projecto corre \`${r.command}\`)` : "";
  void codevAsk.ask({
    intent: "change",
    text: f ? `Escreve o teste em falta para ${f.path}${how}: cobre o comportamento que os testes actuais não verificam.` : `Escreve o teste em falta${how}.`,
    context: f ? [{ kind: "file", label: f.path, text: f.text.slice(0, 12000), path: f.path }] : [],
  });
}

function askFlaky(caseId: string): void {
  const s = D.hist?.cases.find((c) => c.caseId === caseId);
  if (!s) return;
  void codevAsk.ask({ intent: "explain", text: "Este teste passa e falha sem o código mudar. Qual é a causa provável e como o tornar determinista?", context: [flakyContext(s)], send: true });
}

const ago = (ms: number): string => {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function caseRow(rid: string, kind: RunnerKind, c: CaseResult): string {
  const [col, g] = STATUS[c.status], k = `${rid}|${c.id}`, open = D.selCase === k;
  const filter = caseFilter(kind, c), busy = !!D.running[rid];
  let h = `<div class="scm-row tr-case${open ? " cur" : ""}" data-action="test-case-sel" data-on="${esc(k)}"><span style="color:${col};width:14px;text-align:center">${g}</span><span class="nm" style="max-width:none">${esc(c.name)}</span><span class="pth">${esc(fmtMs(c.durationMs))}</span><span class="ra">${c.file ? `<button title="Open in the editor" data-action="test-case-open" data-on="${esc(c.file)}">↗</button>` : ""}${filter ? `<button title="Run this test" data-action="test-case-run" data-on="${esc(k)}"${busy ? " disabled" : ""}>▶</button>` : ""}</span></div>`;
  if (open) {
    const actions = c.status === "failed" && codevAsk.available()
      ? `<div class="tr-acts"><button class="btn ghost" data-action="test-ask" data-on="explain|${esc(k)}">Explain failure</button><button class="btn ghost" data-action="test-ask" data-on="fix|${esc(k)}">Fix with Co-Dev</button></div>`
      : "";
    h += `<div class="tr-detail">${c.message ? `<div class="tr-msg">${esc(c.message)}</div>` : c.status === "failed" ? `<div class="tr-msg">${esc("The runner gave no message for this failure; see the run output below.")}</div>` : ""}${c.output ? `<pre class="tr-out">${esc(tail(c.output, 6000))}</pre>` : ""}${c.file ? `<div class="tr-dim">${esc(c.file)}</div>` : ""}${actions}</div>`;
  }
  return h;
}

function runnerBlock(r: Runner): string {
  const rep = D.reports[r.id], busy = D.running[r.id], err = D.runError[r.id];
  const btns = r.available
    ? `<span class="ra" style="display:flex"><button title="Run all (${esc(r.command)})" data-action="test-runner-all" data-on="${esc(r.id)}"${busy ? " disabled" : ""}>${svg("run")}</button><button title="Run the tests affected by the files changed since the last commit" data-action="test-runner-changed" data-on="${esc(r.id)}"${busy ? " disabled" : ""}>Δ</button></span>`
    : "";
  let h = `<div class="scm-grp tr-runner" title="${esc(r.command)}"><span class="tr-kind">${esc(r.kind)}</span>${r.dir !== "." ? `<span class="notr">${esc(r.dir)}</span>` : ""}<code class="tr-cmd">${esc(r.command)}</code>${btns}</div>`;
  if (!r.available) h += `<div class="sec-empty tr-off">${esc(r.reason || "Not available.")}</div>`;
  if (busy) h += `<div class="sec-empty"><span style="color:var(--yellow)">◐</span> Running ${busy === "all" ? "all tests" : busy === "changed" ? "the affected tests" : `<span class="notr">${esc(busy)}</span>`}…</div>`;
  if (err) h += `<div class="sec-empty" style="color:var(--red)">${esc(err)}</div>`;
  if (rep) {
    const n = counts(rep.results);
    h += `<div class="sec-empty tr-sum"><b style="color:var(--green)">${n.passed} passed</b> · <b style="color:${n.failed ? "var(--red)" : "var(--fg-muted)"}">${n.failed} failed</b>${n.skipped ? ` · <span>${n.skipped} skipped</span>` : ""} · <span>${esc(fmtMs(rep.durationMs))}</span></div>`;
    if (rep.note) h += `<div class="sec-empty tr-note">${esc(rep.note)}</div>`;
    if (!rep.ran || (!rep.results.length && rep.output)) h += `<pre class="tr-out">${esc(tail(rep.output, 6000))}</pre>`;
    for (const g of groupBySuite(rep.results)) {
      h += `<div class="tr-suite"><span style="color:${g.failed ? "var(--red)" : "var(--green)"}">${g.failed ? "✖" : "✓"}</span> <span class="notr">${esc(g.suite)}</span><span class="cnt">${g.cases.length}</span></div>`;
      h += [...g.cases].sort((a, b) => (a.status === "failed" ? 0 : 1) - (b.status === "failed" ? 0 : 1)).map((c) => caseRow(r.id, r.kind, c)).join("");
    }
  }
  return h;
}

function spark(vals: number[]): string {
  if (!vals.length) return "";
  const w = 8, gap = 3, hgt = 28;
  return `<svg class="tr-spark" width="${vals.length * (w + gap)}" height="${hgt}" viewBox="0 0 ${vals.length * (w + gap)} ${hgt}" aria-hidden="true">${vals
    .map((v, i) => { const h = Math.max(2, Math.round((v / 100) * hgt)); return `<rect x="${i * (w + gap)}" y="${hgt - h}" width="${w}" height="${h}" rx="1.5" fill="${v === 100 ? "var(--green)" : v >= 80 ? "var(--yellow)" : "var(--red)"}"><title>${v}%</title></rect>`; })
    .join("")}</svg>`;
}

function historyCards(): string {
  const h = D.hist;
  if (!h) return D.histLoading ? `<div class="sec-empty">Loading…</div>` : "";
  if (!h.runs.length) return `<div class="sec-empty">No runs kept yet. The cards fill in from the runs you make here (kept in the project database).</div>`;
  const last = h.runs[0], trend = passRateTrend(h.runs), flaky = flakyCases(h.cases), slow = slowestCases(h.cases);
  const dots = (s: string) => [...s].map((ch) => `<i class="tr-dot ${ch === "p" ? "p" : ch === "f" ? "f" : "s"}"></i>`).join("");
  const card = (t: string, b: string) => `<div class="tr-card"><div class="tr-ct">${t}</div>${b}</div>`;
  return `<div class="tr-cards">`
    + card("Last run", `<div><b style="color:${last.ok ? "var(--green)" : "var(--red)"}">${last.ok ? "✓ passed" : "✖ failed"}</b> · <span>${ago(last.at)}</span></div><div class="tr-dim"><code>${esc(last.command)}</code></div><div class="tr-dim"><span>${last.passed} passed</span> · <span>${last.failed} failed</span>${last.skipped ? ` · <span>${last.skipped} skipped</span>` : ""} · <span>${esc(fmtMs(last.durationMs))}</span></div>`)
    + card("Pass rate", trend.length ? `<div class="tr-big">${trend[trend.length - 1]}%</div>${spark(trend)}<div class="tr-dim">Last ${trend.length} runs</div>` : `<div class="tr-dim">No run has run tests yet.</div>`)
    + card("Flaky", flaky.length
      ? flaky.slice(0, 5).map((c) => `<div class="tr-fl"><span class="notr tr-nm" title="${esc(c.suite)}">${esc(c.name)}</span><span class="tr-dots" title="Recent results, newest first">${dots(c.recent)}</span>${codevAsk.available() ? `<button class="mini" title="Ask Co-Dev for the likely cause" data-action="test-flaky-ask" data-on="${esc(c.caseId)}">?</button>` : ""}</div>`).join("")
      : `<div class="tr-dim">None: no test has changed result without reason in the last runs.</div>`)
    + card("Slowest", slow.length
      ? slow.map((c) => `<div class="tr-fl"><span class="notr tr-nm" title="${esc(c.suite)}">${esc(c.name)}</span><span class="tr-dim">${esc(fmtMs(c.avgMs))}</span></div>`).join("")
      : `<div class="tr-dim">The runner reports no per-test durations.</div>`)
    + `</div>`;
}

function renderDesktop(el: HTMLElement, d: TestsDesktop): void {
  const root = d.root();
  if (root !== D.root) reset(root);
  if (D.items === null && !D.loading) { void discover(d); return; }
  if (d.runners && D.runners === null && !D.runnersLoading) { void loadRunners(d); }
  if (d.history && D.hist === null && !D.histLoading) { void loadHistory(d); }
  const items = D.items || [];
  const st = (t: TestItem): Light => D.light[key(t)] || (t.ignored ? "skip" : "idle");
  const n = (l: Light) => items.filter((t) => st(t) === l).length;
  const failed = items.filter((t) => st(t) === "fail");
  const anyRunning = D.busy || Object.keys(D.running).length > 0;
  const btn = (act: string, title: string, icon: string, on = "") => `<button title="${title}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${anyRunning ? " disabled" : ""}>${svg(icon)}</button>`;
  const a6 = !!d.runRunner && !!D.runners;
  let body = "";
  /* A6: os runners reais, os resultados por teste e o histórico */
  if (a6) {
    const rs = D.runners || [];
    body += `<div class="scm-grp">Runners</div>`;
    body += rs.length
      ? rs.map(runnerBlock).join("")
      : `<div class="sec-empty">No test runner found in this folder. Detected: Cargo, Go modules, pytest/unittest, vitest/jest (installed in node_modules), Maven and Gradle.</div>`;
    if (rs.some((r) => r.available)) {
      body += `<div class="tr-bar"><label class="tr-watch" title="On every save, run the tests affected by the saved files"><input type="checkbox" data-action="test-watch"${D.watch ? " checked" : ""}> <span>Watch</span></label>${codevAsk.available() ? `<button class="btn ghost" data-action="test-write">Write a missing test</button>` : ""}</div>`;
    }
    if (d.history) body += `<div class="scm-grp">History</div>${historyCards()}`;
  }
  if (D.loading) body += `<div class="sec-empty">A descobrir os testes do projecto…</div>`;
  else if (D.error) body += `<div class="sec-empty" style="color:var(--red)">${esc(D.error)}</div>`;
  else if (!items.length) body += a6 ? "" : `<div class="sec-empty">Nenhum teste encontrado. A descoberta procura testes Rust (#[test]), Go (func TestXxx) e Python (unittest).</div>`;
  else {
    const files = [...new Set(items.map((t) => t.file))];
    if (a6) body += `<div class="scm-grp">Tests in the code</div>`;
    body += `<div class="sec-empty"><b style="color:var(--green)">${n("pass")} passados</b> · <b style="color:${n("fail") ? "var(--red)" : "var(--fg-muted)"}">${n("fail")} falhados</b> · <span>${n("idle")} por correr</span>${n("skip") ? ` · <span>${n("skip")} ignorados</span>` : ""}</div>`
      + (failed.length ? `<button class="btn ghost" data-action="test-rerun-failed"${anyRunning ? " disabled" : ""}>Correr de novo os ${failed.length} falhados</button>` : "")
      + files.map((f) => {
        const ts = items.filter((t) => t.file === f);
        const worst: Light = ts.some((t) => st(t) === "fail") ? "fail" : ts.some((t) => st(t) === "running") ? "running" : ts.every((t) => st(t) === "pass" || st(t) === "skip") && ts.some((t) => st(t) === "pass") ? "pass" : "idle";
        return `<div class="scm-grp" title="${esc(f)}"><span style="color:${LIGHT[worst][0]}">${LIGHT[worst][1]}</span> ${esc(f)}<span class="cnt">${ts.length}</span><button class="mini" style="margin-left:6px" title="Correr os testes deste ficheiro" data-action="test-run-file" data-on="${esc(f)}"${anyRunning ? " disabled" : ""}>▶</button></div>`
          + ts.map((t) => { const l = st(t), k = key(t); return `<div class="scm-row${D.sel === k ? " cur" : ""}" data-action="test-select" data-on="${esc(k)}"><span style="color:${LIGHT[l][0]};width:14px;text-align:center">${LIGHT[l][1]}</span><span class="nm" style="max-width:none">${esc(t.name)}</span><span class="pth">${esc(t.lang)}</span><span class="ra"><button title="Abrir no editor" data-action="test-open" data-on="${esc(k)}">↗</button><button title="Correr este teste" data-action="test-run" data-on="${esc(k)}"${anyRunning ? " disabled" : ""}>▶</button></span></div>`; }).join("");
      }).join("");
    const sel = D.sel ? items.find((t) => key(t) === D.sel) : null;
    const out = sel ? D.output[key(sel)] : D.suite ? D.suite.output : "";
    if (out) body += `<div class="scm-grp">${sel ? `<span>Saída ·</span> <span class="notr">${esc(sel.name)}</span>` : "Saída · suite completa"}</div><pre class="sec-empty" style="white-space:pre-wrap;max-height:260px;overflow:auto;font-family:var(--font-mono);font-size:11.5px">${esc(out.slice(-6000))}</pre>`;
  }
  el.innerHTML = hd("Testing", btn("test-run-all", "Correr todos", "run") + btn("test-discover", "Descobrir de novo", "refresh")) + `<div class="sections">${body}</div>`;
}

function onPaneClick(e: Event): void {
  const d = desktopPorts.tests; if (!d || !d.root()) return;
  const a = (e.target as Element).closest("[data-action]"); if (!a || !(a as HTMLElement).closest("#pane-test")) return;
  const act = a.getAttribute("data-action") || "", on = a.getAttribute("data-on") || "";
  if (!act.startsWith("test-")) return;
  e.stopPropagation();
  const items = D.items || [], byKey = (k: string) => items.find((t) => key(t) === k);
  const split = (s: string): [string, string] => { const i = s.indexOf("|"); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };
  if (act === "test-run-all") void runAll(d);
  else if (act === "test-discover") { D.items = null; D.runners = null; D.hist = null; void discover(d); }
  else if (act === "test-rerun-failed") void runMany(d, items.filter((t) => D.light[key(t)] === "fail"));
  else if (act === "test-run-file") void runMany(d, items.filter((t) => t.file === on && !t.ignored));
  else if (act === "test-run") { const t = byKey(on); if (t && !D.busy) { D.sel = on; void runOne(d, t); } }
  else if (act === "test-open") { const t = byKey(on); if (t) d.open(t.file, t.line); }
  else if (act === "test-select") { D.sel = D.sel === on ? null : on; renderTestPane(); }
  /* A6 */
  else if (act === "test-runner-all") void runRunner(d, on, { kind: "all" });
  else if (act === "test-runner-changed") void runRunner(d, on, { kind: "changed", files: [] });
  else if (act === "test-case-sel") { D.selCase = D.selCase === on ? null : on; renderTestPane(); }
  else if (act === "test-case-open") d.open(on, 1);
  else if (act === "test-case-run") {
    const [rid, cid] = split(on), r = (D.runners || []).find((x) => x.id === rid), c = D.reports[rid]?.results.find((x) => x.id === cid);
    const name = r && c ? caseFilter(r.kind, c) : null;
    if (name) { D.selCase = on; void runRunner(d, rid, { kind: "case", name }); }
  }
  else if (act === "test-ask") { const [intent, rest] = split(on), [rid, cid] = split(rest); ask(intent === "fix" ? "fix" : "explain", rid, cid); }
  else if (act === "test-flaky-ask") askFlaky(on);
  else if (act === "test-write") writeMissingTest(d);
  else if (act === "test-watch") { D.watch = (a as HTMLInputElement).checked; }
}
document.addEventListener("click", onPaneClick);
document.addEventListener("dx:workspace", () => { reset(null); });

/** Renderiza o pane «Testing»: estado do build + lista de testes passados/falhados. */
function renderTestPane(): void {
  const el = $("#pane-test");
  if (!el) return;
  const d = desktopPorts.tests;
  if (d && d.root()) { renderDesktop(el, d); return; }
  const r = window.runTests();
  const body = !r.build
    ? `<div class="sec-empty" style="color:var(--red)">Build falhou — ${esc(
        r.err.split("\n")[0],
      )}</div><button class="btn ghost" data-action="test:gotoError">Ir para o erro</button>`
    : `<div class="sec-empty"><b style="color:var(--green)">${
        r.tests.filter((t) => t.ok).length
      } passados</b> · <b style="color:${
        r.ok ? "var(--fg-muted)" : "var(--red)"
      }">${r.tests.filter((t) => !t.ok).length} falhados</b></div>` +
      r.tests
        .map(
          (t) =>
            `<div class="scm-row" data-action="test:runTask" data-on="${esc('cargo test -p ' + t.n.split(
              "::",
            )[0])}"><span style="color:${
              t.ok ? "var(--green)" : "var(--red)"
            };width:14px;text-align:center">${t.ok ? "✓" : "✖"}</span><span class="nm" style="max-width:none">${t.n}</span></div>`,
        )
        .join("") +
      `<div class="sec-empty">O resultado é calculado a partir do conteúdo actual dos ficheiros.</div>`;
  el.innerHTML =
    hd(
      "Testing",
      `<button title="Correr todos" data-action="test:runTask" data-on="cargo test">${svg(
        "run",
      )}</button>`,
    ) + `<div class="sections">${body}</div>`;
}

/* ── publicação transitória no window (shim para o residual: RP.test delega aqui) ── */
window.renderTestPane = renderTestPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.test = renderTestPane;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
const UA = window as unknown as { P_LX: string };
registerActions({
  "test:gotoError": { click: () => void callGlobal("openPath", UA.P_LX, 10) },
  "test:runTask": { click: (c) => void callGlobal("runTask", c.on) },
});
