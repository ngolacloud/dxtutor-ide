/* ═══════════ feature `testing` — ui: os runners reais, os resultados e o histórico (A6) ═══════════
   O markup da parte A6 do pane «Testing», a partir do estado de `runs-service.ts`: cada runner
   com o comando e porque não está disponível, os resultados da última corrida por suite (com
   a duração, a mensagem e a saída da falha aberta, e os pedidos ao Co-Dev), «Watch», e os
   cartões do histórico (última corrida, tendência, instáveis, mais lentos). Sem runners não
   desenha nada (o pane fica como antes). Acções: `data-action` + `data-on` (actions.ts).
   Sem `window`: o texto alheio passa sempre por `esc`. */

import { svg, esc } from "../../../core";
import { caseFilter, counts, flakyCases, fmtMs, groupBySuite, passRateTrend, slowestCases, tail } from "../domain/runs";
import type { CaseResult, Runner, RunnerKind } from "../domain/types";
import type { RunsState } from "../application/runs-service";

export interface RunsViewModel {
  state: RunsState;
  /** o Co-Dev está carregado (os botões de pedir só aparecem com ele) */
  canAsk: boolean;
  now: number;
}

const STATUS: Record<string, [string, string]> = {
  passed: ["var(--green)", "✓"],
  failed: ["var(--red)", "✖"],
  skipped: ["var(--fg-muted)", "⊘"],
};

const ago = (ms: number, now: number): string => {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function caseRow(m: RunsViewModel, rid: string, kind: RunnerKind, c: CaseResult): string {
  const st = m.state, [col, g] = STATUS[c.status], k = `${rid}|${c.id}`, open = st.selected === k;
  const dis = st.running ? " disabled" : "";
  let h = `<div class="scm-row tr-case${open ? " cur" : ""}" data-action="case-select" data-on="${esc(k)}"><span style="color:${col};width:14px;text-align:center">${g}</span><span class="nm notr" style="max-width:none">${esc(c.name)}</span><span class="pth">${esc(fmtMs(c.durationMs))}</span><span class="ra" style="display:flex">${c.file ? `<button title="Open in the editor" data-action="case-open" data-on="${esc(c.file)}">↗</button>` : ""}${caseFilter(kind, c) ? `<button title="Run this test" data-action="case-run" data-on="${esc(k)}"${dis}>▶</button>` : ""}</span></div>`;
  if (open) {
    const asks = c.status === "failed" && m.canAsk
      ? `<div class="tr-acts"><button class="btn ghost" data-action="ask-failure" data-on="explain|${esc(k)}">Explain failure</button><button class="btn ghost" data-action="ask-failure" data-on="fix|${esc(k)}">Fix with Co-Dev</button></div>`
      : "";
    const message = c.message
      ? `<div class="tr-msg notr">${esc(c.message)}</div>`
      : c.status === "failed" ? `<div class="tr-msg">The runner gave no message for this failure; see the run output below.</div>` : "";
    h += `<div class="tr-detail">${message}${c.output ? `<pre class="tr-out notr">${esc(tail(c.output, 6000))}</pre>` : ""}${c.file ? `<div class="tr-dim notr">${esc(c.file)}</div>` : ""}${asks}</div>`;
  }
  return h;
}

function runnerBlock(m: RunsViewModel, r: Runner): string {
  const st = m.state, rep = st.reports[r.id], busy = st.running?.runner === r.id ? st.running.what : null, err = st.errors[r.id];
  const dis = st.running ? " disabled" : "";
  const btns = r.available
    ? `<span class="ra" style="display:flex"><button title="Run all (${esc(r.command)})" data-action="runner-all" data-on="${esc(r.id)}"${dis}>${svg("run")}</button><button title="Run the tests affected by the files changed since the last commit" data-action="runner-changed" data-on="${esc(r.id)}"${dis}>Δ</button></span>`
    : "";
  let h = `<div class="scm-grp tr-runner" title="${esc(r.command)}"><span class="tr-kind">${esc(r.kind)}</span>${r.dir !== "." ? `<span class="notr">${esc(r.dir)}</span>` : ""}<code class="tr-cmd notr">${esc(r.command)}</code>${btns}</div>`;
  if (!r.available) h += `<div class="sec-empty tr-off">${r.reason ? `<span class="notr">${esc(r.reason)}</span>` : "Not available."}</div>`;
  if (busy) h += `<div class="sec-empty"><span style="color:var(--yellow)">◐</span> ${busy === "all" ? "Running all tests…" : busy === "changed" ? "Running the affected tests…" : `<span class="notr">${esc(busy)}</span> …`}</div>`;
  if (err) h += `<div class="sec-empty notr" style="color:var(--red)">${esc(err)}</div>`;
  if (rep) {
    const n = counts(rep.results);
    h += `<div class="sec-empty tr-sum"><b style="color:var(--green)">${n.passed} passed</b> · <b style="color:${n.failed ? "var(--red)" : "var(--fg-muted)"}">${n.failed} failed</b>${n.skipped ? ` · <span>${n.skipped} skipped</span>` : ""} · <span>${esc(fmtMs(rep.durationMs))}</span></div>`;
    if (rep.note) h += `<div class="sec-empty tr-note notr">${esc(rep.note)}</div>`;
    if (!rep.ran || (!rep.results.length && rep.output)) h += `<pre class="tr-out notr">${esc(tail(rep.output, 6000))}</pre>`;
    for (const g of groupBySuite(rep.results)) {
      h += `<div class="tr-suite"><span style="color:${g.failed ? "var(--red)" : "var(--green)"}">${g.failed ? "✖" : "✓"}</span> <span class="notr">${esc(g.suite)}</span><span class="cnt">${g.cases.length}</span></div>`;
      h += [...g.cases].sort((a, b) => (a.status === "failed" ? 0 : 1) - (b.status === "failed" ? 0 : 1)).map((c) => caseRow(m, r.id, r.kind, c)).join("");
    }
  }
  return h;
}

function spark(vals: number[]): string {
  if (!vals.length) return "";
  const w = 8, gap = 3, hgt = 28, width = vals.length * (w + gap);
  return `<svg class="tr-spark" width="${width}" height="${hgt}" viewBox="0 0 ${width} ${hgt}" aria-hidden="true">${vals
    .map((v, i) => { const h = Math.max(2, Math.round((v / 100) * hgt)); return `<rect x="${i * (w + gap)}" y="${hgt - h}" width="${w}" height="${h}" rx="1.5" fill="${v === 100 ? "var(--green)" : v >= 80 ? "var(--yellow)" : "var(--red)"}"><title>${v}%</title></rect>`; })
    .join("")}</svg>`;
}

function historyCards(m: RunsViewModel): string {
  const h = m.state.history;
  if (!h) return `<div class="sec-empty">Loading…</div>`;
  if (!h.runs.length) return `<div class="sec-empty">No runs kept yet. The cards fill in from the runs you make here (kept in the project database).</div>`;
  const last = h.runs[0], trend = passRateTrend(h.runs), flaky = flakyCases(h.cases), slow = slowestCases(h.cases);
  const dots = (s: string) => [...s].map((ch) => `<i class="tr-dot ${ch === "p" ? "p" : ch === "f" ? "f" : "s"}"></i>`).join("");
  const card = (t: string, b: string) => `<div class="tr-card"><div class="tr-ct">${t}</div>${b}</div>`;
  return `<div class="tr-cards">`
    + card("Last run", `<div><b style="color:${last.ok ? "var(--green)" : "var(--red)"}">${last.ok ? "✓ passed" : "✖ failed"}</b> · <span>${ago(last.at, m.now)}</span></div><div class="tr-dim"><code class="notr">${esc(last.command)}</code></div><div class="tr-dim"><span>${last.passed} passed</span> · <span>${last.failed} failed</span>${last.skipped ? ` · <span>${last.skipped} skipped</span>` : ""} · <span>${esc(fmtMs(last.durationMs))}</span></div>`)
    + card("Pass rate", trend.length ? `<div class="tr-big">${trend[trend.length - 1]}%</div>${spark(trend)}<div class="tr-dim">Last ${trend.length} runs</div>` : `<div class="tr-dim">No run has run tests yet.</div>`)
    + card("Flaky", flaky.length
      ? flaky.slice(0, 5).map((c) => `<div class="tr-fl"><span class="notr tr-nm" title="${esc(c.suite)}">${esc(c.name)}</span><span class="tr-dots" title="Recent results, newest first">${dots(c.recent)}</span>${m.canAsk ? `<button class="mini" title="Ask Co-Dev for the likely cause" data-action="ask-flaky" data-on="${esc(c.caseId)}">?</button>` : ""}</div>`).join("")
      : `<div class="tr-dim">None: no test has changed result without reason in the last runs.</div>`)
    + card("Slowest", slow.length
      ? slow.map((c) => `<div class="tr-fl"><span class="notr tr-nm" title="${esc(c.suite)}">${esc(c.name)}</span><span class="tr-dim">${esc(fmtMs(c.avgMs))}</span></div>`).join("")
      : `<div class="tr-dim">The runner reports no per-test durations.</div>`)
    + `</div>`;
}

/** As secções A6 do pane; vazio quando a pasta não tem runners (o pane fica como antes). */
export function renderRuns(m: RunsViewModel): string {
  const rs = m.state.runners;
  if (!rs.length) return "";
  let h = `<div class="scm-grp">Runners</div>` + rs.map((r) => runnerBlock(m, r)).join("");
  if (rs.some((r) => r.available)) {
    h += `<div class="tr-bar"><label class="tr-watch" title="On every save, run the tests affected by the saved files"><input type="checkbox" data-action="watch"${m.state.watch ? " checked" : ""}> <span>Watch</span></label>${m.canAsk ? `<button class="btn ghost" data-action="write-test">Write a missing test</button>` : ""}</div>`;
  }
  return h + `<div class="scm-grp">History</div>` + historyCards(m);
}
