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

/* ───── a parte desktop (A0.5, docs/v2/UI-AUDIT.md) ─────
   Com uma pasta aberta na app Tauri, o pane deixa de mostrar o motor simulado e passa a
   listar os testes REAIS do projecto (`list_tests`, descoberta sintáctica no backend) e a
   corrê-los (`run_test`, `run_all_tests`). A porta é instalada por platform/desktop/tests.ts;
   no browser e nos testes não existe e o pane mantém o comportamento anterior. */

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
};
const key = (t: TestItem): string => t.lang + ":" + t.path;
const LIGHT: Record<Light, [string, string]> = {
  pass: ["var(--green)", "✓"], fail: ["var(--red)", "✖"], idle: ["var(--fg-muted)", "○"],
  running: ["var(--yellow)", "◐"], skip: ["var(--fg-muted)", "⊘"],
};

function reset(root: string | null): void {
  Object.assign(D, { root, items: null, loading: false, error: "", light: {}, output: {}, sel: null, busy: false, suite: null });
}

async function discover(d: TestsDesktop): Promise<void> {
  D.loading = true; D.error = ""; renderTestPane();
  try { D.items = await d.list(); } catch (e) { D.error = String((e as Error).message || e); D.items = []; }
  D.loading = false; renderTestPane();
}

async function runOne(d: TestsDesktop, t: TestItem): Promise<void> {
  const k = key(t); D.light[k] = "running"; renderTestPane();
  try {
    const r = await d.run(t);
    D.light[k] = !r.ran ? "fail" : r.passed ? "pass" : "fail";
    D.output[k] = r.output;
  } catch (e) { D.light[k] = "fail"; D.output[k] = String((e as Error).message || e); }
  renderTestPane();
}

/** Lê o resultado por teste da saída de texto do runner (libtest e `go test -v`) — aproximação
 *  da A0.5; a A6 troca isto pela saída estruturada (JSON/JUnit) de cada ferramenta. */
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

async function runAll(d: TestsDesktop): Promise<void> {
  if (D.busy) return;
  D.busy = true; (D.items || []).forEach((t) => { if (!t.ignored) D.light[key(t)] = "running"; }); renderTestPane();
  try {
    const r = await d.runAll();
    D.suite = r;
    (D.items || []).forEach((t) => { if (D.light[key(t)] === "running") D.light[key(t)] = "idle"; });
    applySuiteOutput(D.items || [], r.output);
  } catch (e) {
    D.suite = { ran: false, passed: false, output: String((e as Error).message || e) };
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

function renderDesktop(el: HTMLElement, d: TestsDesktop): void {
  const root = d.root();
  if (root !== D.root) reset(root);
  if (D.items === null && !D.loading) { void discover(d); return; }
  const items = D.items || [];
  const st = (t: TestItem): Light => D.light[key(t)] || (t.ignored ? "skip" : "idle");
  const n = (l: Light) => items.filter((t) => st(t) === l).length;
  const failed = items.filter((t) => st(t) === "fail");
  const btn = (act: string, title: string, icon: string, on = "") => `<button title="${title}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${D.busy ? " disabled" : ""}>${svg(icon)}</button>`;
  let body: string;
  if (D.loading) body = `<div class="sec-empty">A descobrir os testes do projecto…</div>`;
  else if (D.error) body = `<div class="sec-empty" style="color:var(--red)">${esc(D.error)}</div>`;
  else if (!items.length) body = `<div class="sec-empty">Nenhum teste encontrado. A descoberta procura testes Rust (#[test]), Go (func TestXxx) e Python (unittest).</div>`;
  else {
    const files = [...new Set(items.map((t) => t.file))];
    body = `<div class="sec-empty"><b style="color:var(--green)">${n("pass")} passados</b> · <b style="color:${n("fail") ? "var(--red)" : "var(--fg-muted)"}">${n("fail")} falhados</b> · <span>${n("idle")} por correr</span>${n("skip") ? ` · <span>${n("skip")} ignorados</span>` : ""}</div>`
      + (failed.length ? `<button class="btn ghost" data-action="test-rerun-failed"${D.busy ? " disabled" : ""}>Correr de novo os ${failed.length} falhados</button>` : "")
      + files.map((f) => {
        const ts = items.filter((t) => t.file === f);
        const worst: Light = ts.some((t) => st(t) === "fail") ? "fail" : ts.some((t) => st(t) === "running") ? "running" : ts.every((t) => st(t) === "pass" || st(t) === "skip") && ts.some((t) => st(t) === "pass") ? "pass" : "idle";
        return `<div class="scm-grp" title="${esc(f)}"><span style="color:${LIGHT[worst][0]}">${LIGHT[worst][1]}</span> ${esc(f)}<span class="cnt">${ts.length}</span><button class="mini" style="margin-left:6px" title="Correr os testes deste ficheiro" data-action="test-run-file" data-on="${esc(f)}"${D.busy ? " disabled" : ""}>▶</button></div>`
          + ts.map((t) => { const l = st(t), k = key(t); return `<div class="scm-row${D.sel === k ? " cur" : ""}" data-action="test-select" data-on="${esc(k)}"><span style="color:${LIGHT[l][0]};width:14px;text-align:center">${LIGHT[l][1]}</span><span class="nm" style="max-width:none">${esc(t.name)}</span><span class="pth">${esc(t.lang)}</span><span class="ra"><button title="Abrir no editor" data-action="test-open" data-on="${esc(k)}">↗</button><button title="Correr este teste" data-action="test-run" data-on="${esc(k)}"${D.busy ? " disabled" : ""}>▶</button></span></div>`; }).join("");
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
  if (act === "test-run-all") void runAll(d);
  else if (act === "test-discover") { D.items = null; void discover(d); }
  else if (act === "test-rerun-failed") void runMany(d, items.filter((t) => D.light[key(t)] === "fail"));
  else if (act === "test-run-file") void runMany(d, items.filter((t) => t.file === on && !t.ignored));
  else if (act === "test-run") { const t = byKey(on); if (t && !D.busy) { D.sel = on; void runOne(d, t); } }
  else if (act === "test-open") { const t = byKey(on); if (t) d.open(t.file, t.line); }
  else if (act === "test-select") { D.sel = D.sel === on ? null : on; renderTestPane(); }
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
