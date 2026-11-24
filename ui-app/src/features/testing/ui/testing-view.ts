/* ═══════════ feature `testing` — ui: o markup do pane (ADR-0006, R2a) ═══════════
   Desenha o pane «Testing» a partir do estado do serviço: os testes descobertos por
   ficheiro com o estado real de cada um, a saída das corridas que falharam, a última
   corrida da suíte, e o comando de testes do projecto (para o que a descoberta não cobre,
   p.ex. JS/TS). As acções são `data-action`+`data-on` (listener delegado em `actions.ts`).
   Sem `window`: o texto alheio (nomes, caminhos, saídas) passa sempre por `esc`. */

import { hd, svg, esc } from "../../../core";
import { countStates, groupByFile, testKey } from "../domain/results";
import type { TestStatus } from "../domain/types";
import type { TestingState } from "../application/testing-service";

export interface TestingViewModel {
  /** Há pasta aberta (no desktop). */
  open: boolean;
  state: TestingState;
  /** O comando de testes detectado no projecto (`.dxtutor/commands.json`, package.json, …). */
  projectCmd: string | null;
  /** A6: as secções dos runners reais (`runs-view.ts`); vazio/ausente = o pane como antes. */
  runs?: string;
}

const ICON: Record<TestStatus, [string, string]> = {
  idle: ["○", "var(--fg-muted)"],
  running: ["⟳", "var(--accent-hover)"],
  passed: ["✓", "var(--green)"],
  failed: ["✗", "var(--red)"],
  ignored: ["⊘", "var(--fg-muted)"],
};

/** O fim de uma saída longa (o que interessa num teste que falhou está no fim). */
const tail = (s: string, n = 4000): string => (s.length > n ? "…\n" + s.slice(-n) : s);

export function renderTesting(m: TestingViewModel): string {
  const { state: st } = m, busy = st.running || st.loading, dis = busy ? " disabled" : "";
  const acts = m.open
    ? `<button title="Correr todos os testes" data-action="run-all"${dis || (st.items.length ? "" : " disabled")}>${svg("run")}</button><button title="Voltar a descobrir os testes" data-action="refresh"${dis}>${svg("refresh")}</button>`
    : "";
  if (!m.open) return hd("Testing", "") + '<div class="sections"><div class="sec-empty">Abre uma pasta (File → Open Folder…) para descobrir e correr os testes do projecto.</div></div>';

  const parts: string[] = [];
  if (m.runs) parts.push(m.runs);
  if (st.error) parts.push(`<div class="sec-empty" style="color:var(--red)">Erro: ${esc(st.error)}</div>`);
  if (st.loading && !st.items.length) parts.push('<div class="sec-empty">A procurar testes…</div>');
  else if (st.loaded && !st.items.length && !st.error) parts.push('<div class="sec-empty">Não encontrei testes Rust, Go ou Python nesta pasta.</div>');

  if (st.items.length) {
    const c = countStates(st.items, st.states);
    if (m.runs) parts.push(`<div class="scm-grp">Tests in the code</div>`);
    parts.push(`<div class="sec-empty">${c.total} teste(s)${c.passed || c.failed ? ` · <span style="color:var(--green)">${c.passed} passaram</span>${c.failed ? ` · <span style="color:var(--red)">${c.failed} falharam</span>` : ""}` : ""}${c.ignored ? ` · ${c.ignored} ignorado(s)` : ""}</div>`);
    for (const g of groupByFile(st.items)) {
      parts.push(`<div class="scm-grp notr">${esc(g.file)}<span class="cnt">${g.items.length}</span></div>`);
      for (const t of g.items) {
        const k = testKey(t), s = st.states[k] ?? { status: (t.ignored ? "ignored" : "idle") as TestStatus }, [ic, col] = ICON[s.status];
        parts.push(`<div class="scm-row" data-action="open-test" data-on="${esc(k)}" title="${esc(t.path)} · ${esc(t.lang)}"><span class="ic" style="color:${col};width:14px;text-align:center">${ic}</span><span class="nm notr" style="max-width:none">${esc(t.name)}</span><span class="pth">:${t.line}</span><span class="ra" style="display:flex"><button title="Correr este teste" data-action="run-test" data-on="${esc(k)}"${dis}>▶</button></span></div>`);
        if (s.status === "failed" && s.output) parts.push(`<pre class="notr" style="margin:2px 8px 6px 30px;max-height:180px;overflow:auto;font-size:11px;white-space:pre-wrap">${esc(tail(s.output))}</pre>`);
      }
    }
  }

  if (st.suite) {
    parts.push(`<div class="scm-grp">Última corrida da suíte<span class="cnt" style="color:${st.suite.ran && st.suite.passed ? "var(--green)" : "var(--red)"}">${st.suite.ran ? (st.suite.passed ? "passou" : "falhou") : "não correu"}</span></div>`);
    parts.push(`<pre class="notr" style="margin:2px 8px 6px;max-height:220px;overflow:auto;font-size:11px;white-space:pre-wrap">${esc(tail(st.suite.output))}</pre>`);
  }

  if (m.projectCmd) {
    parts.push(`<div class="scm-grp">Comando de testes do projecto</div><div class="sec-empty"><code class="notr">${esc(m.projectCmd)}</code></div><button class="btn ghost" data-action="run-project-cmd">Correr no terminal</button>`);
  } else if (st.loaded && !st.items.length) {
    parts.push('<div class="sec-empty">Também não detectei um comando de testes. Define-o em <code>.dxtutor/commands.json</code>.</div>');
  }

  return hd("Testing", acts) + `<div class="sections">${parts.join("")}</div>`;
}
