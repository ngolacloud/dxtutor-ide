/* ═════════ feature `integration` — ui: o painel «Rever e integrar» de uma issue (Multi Co-Dev, fase 4) ═════════
   Dono do DOM de `#ig-panel` (um diálogo por cima de tudo): as três condições da porta, cada uma com a sua
   evidência — as verificações (comando, exit, tempo, o fim da saída mascarado), as regras de arquitectura, o
   veredicto do revisor critério a critério (com ficheiros e linhas, testes, saída) e a aprovação funcional —, e
   porque é que «Integrar» está desligado. Os botões passam pelo despachante partilhado (`integration:*`,
   `data-on` = a issue). Não toca no `window` (regra A8). */

import { esc } from "../../../core";
import { blockers, canIntegrate, checkRows, conditions, evidenceText, short, type Condition, type ConditionId, type ReviewState } from "../domain/types";
import { INTEGRATION_MESSAGES, type IntegrationKey } from "../application/messages";

export type T = (k: IntegrationKey, p?: Record<string, string | number>) => string;

export const PANEL_ID = "ig-panel";

const PREFIX: Record<ConditionId, string> = { checks: "ck_", reviewer: "rv_", functional: "fn_" };
const TITLE: Record<ConditionId, IntegrationKey> = { checks: "condChecks", reviewer: "condReviewer", functional: "condFunctional" };

/** A frase de uma condição, a partir do código do Rust. */
export function conditionText(t: T, id: ConditionId, c: Condition, s: ReviewState): string {
  const key = `${PREFIX[id]}${c.code}`;
  // an unknown code (a newer backend) is said as it is, never as «ok»
  if (!Object.prototype.hasOwnProperty.call(INTEGRATION_MESSAGES.en, key)) return t("unknown", { code: c.code });
  return t(key as IntegrationKey, { items: c.items.join(", "), tree: s.review ? short(s.review.tree) : "?" });
}

const btn = (action: string, key: string, label: string, title: string, opts: { disabled?: boolean; cls?: string } = {}): string =>
  `<button class="mini${opts.cls ? ` ${opts.cls}` : ""}" data-action="integration:${action}" data-on="${esc(key)}" title="${esc(title)}"${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;

function checksBody(t: T, s: ReviewState, running: boolean): string {
  const rows = checkRows(s)
    .map(({ name, command, run }) => {
      const st = run
        ? run.timedOut
          ? t("checkTimedOut")
          : t("checkExit", { code: run.exit ?? "?", secs: (run.ms / 1000).toFixed(1) })
        : running
          ? t("checkRunning")
          : t("checkPending");
      const cls = run ? (run.passed ? "ok" : "bad") : "wait";
      const tail = run && run.tail ? `<details><summary>${esc(name)}</summary><pre class="ig-tail notr">${esc(run.tail)}</pre></details>` : "";
      return `<li class="ig-run ${cls}"><span class="ig-mark">${run ? (run.passed ? "✓" : "✕") : "·"}</span><b class="notr">${esc(name)}</b> <code class="notr">${esc(command)}</code> <span class="ig-dim">${esc(st)}</span>${tail}</li>`;
    })
    .join("");
  const r = s.review;
  const arch = r && r.arch.length
    ? `<ul class="ig-arch">${r.arch.map((a) => `<li><code class="notr">${esc(a.path)}${a.line ? `:${a.line}` : ""}</code> ${esc(a.rule)} — ${esc(a.message)}</li>`).join("")}</ul>`
    : "";
  const scan = r && r.scanFindings ? `<p class="ig-warn">${esc(t("scanFindings", { n: r.scanFindings }))}</p>` : "";
  return (rows ? `<ul class="ig-runs">${rows}</ul>` : "") + arch + scan;
}

function reviewerBody(t: T, s: ReviewState): string {
  const v = s.review?.verdict;
  if (!v) return "";
  const status = (x: string): string => (x === "met" ? t("st_met") : x === "not_met" ? t("st_not_met") : t("st_unclear"));
  const rows = v.criteria
    .map(
      (c) =>
        `<tr class="${c.status === "met" ? "ok" : "bad"}"><td>${c.index}</td><td>${esc(c.text)}</td><td>${esc(status(c.status))}</td><td>${c.evidence
          .map((e) => `<div class="notr">${esc(evidenceText(e))}</div>`)
          .join("")}${c.note ? `<div class="ig-dim">${esc(c.note)}</div>` : ""}</td></tr>`,
    )
    .join("");
  const by = t("verdictBy", { overall: status(v.overall), model: s.review?.reviewer ?? "?", tokens: (s.review?.tokensIn ?? 0) + (s.review?.tokensOut ?? 0) });
  return `<p class="ig-summary">${esc(v.summary)}</p><table class="ig-verdict"><tr><th>#</th><th>${esc(t("criterion"))}</th><th>${esc(t("status"))}</th><th>${esc(t("evidence"))}</th></tr>${rows}</table><div class="ig-dim">${esc(by)}</div>`;
}

export interface PanelModel {
  key: string;
  state: ReviewState | null;
  error: string | null;
  stage: string | null;
  busy: boolean;
  detected: string | null;
  /** Multi Co-Dev, fase 5: a secção «Autonomia e pull request», já desenhada (`ui/autonomy-view.ts`) */
  extra?: string;
}

/** O markup do painel (puro sobre o modelo). */
export function renderPanel(t: T, m: PanelModel): string {
  const s = m.state;
  const head = `<div class="ig-head"><h2>${esc(t("title", { key: m.key }))}</h2>${s?.title ? `<span class="ig-name">${esc(s.title)}</span>` : ""}<span class="ig-sp"></span>${btn("refresh", m.key, "⟳", t("refresh"))}${btn("close", m.key, "✕", t("close"))}</div>`;
  if (!s) return `<div class="ig-box">${head}${m.error ? `<p class="ig-err">${esc(m.error)}</p>` : `<p class="ig-dim">…</p>`}</div>`;
  const running = s.running || !!m.stage;
  const tips = s.tips
    ? `<p class="ig-rule">${esc(t("rule", { branch: s.tips.branch, target: s.tips.target }))} <span class="ig-dim notr">${esc(s.tips.branch)} ${esc(short(s.tips.head))} → ${esc(s.tips.target)} ${esc(short(s.tips.base))} · ${esc(t("ahead", { n: s.ahead, target: s.tips.target }))}</span></p>`
    : `<p class="ig-err">${esc(t("noTips", { why: s.tipsError ?? "?" }))}</p>`;
  const dirty = s.uncommitted.length ? `<p class="ig-warn">${esc(t("uncommitted", { files: s.uncommitted.slice(0, 6).join(", ") + (s.uncommitted.length > 6 ? " …" : "") }))}</p>` : "";
  const stage = m.stage ? `<p class="ig-stage">${esc(m.stage)}</p>` : "";
  const sections = conditions(s.gate)
    .map(({ id, c }) => {
      const body = id === "checks" ? checksBody(t, s, running) : id === "reviewer" ? reviewerBody(t, s) : "";
      const fix =
        id === "checks" && c.code === "none_set"
          ? m.detected
            ? btn("detected", m.key, t("useDetected", { cmd: m.detected }), t("useDetected", { cmd: m.detected }), { disabled: m.busy })
            : `<p class="ig-dim">${esc(t("noDetected"))}</p>`
          : "";
      return `<section class="ig-cond ${c.ok ? "ok" : "bad"}" data-cond="${id}"><h3><span class="ig-mark">${c.ok ? "✓" : "✕"}</span>${esc(t(TITLE[id]))}</h3><p class="ig-why">${esc(conditionText(t, id, c, s))}</p>${body}${fix}</section>`;
    })
    .join("");
  const can = canIntegrate(s);
  const why = can ? "" : `<span class="ig-dim">${esc(t("whyDisabled"))} ${esc(blockers(s).map(({ id, c }) => conditionText(t, id, c, s)).join(" · "))}</span>`;
  const target = s.tips?.target ?? "?";
  const foot =
    `<div class="ig-foot">${why}<span class="ig-sp"></span>` +
    (running ? btn("cancel", m.key, t("cancel"), t("cancel")) : "") +
    btn("request", m.key, t("request"), s.requestBlocked ?? t("requestTitle", { target }), { disabled: !s.request || running || m.busy }) +
    btn("integrate", m.key, t("integrate"), can ? t("integrateTitle", { target }) : t("whyDisabled"), { disabled: !can || m.busy, cls: "pri" }) +
    `</div>`;
  const blocked = s.requestBlocked && !running ? `<p class="ig-dim">${esc(s.requestBlocked)}</p>` : "";
  return `<div class="ig-box">${head}${tips}${dirty}${stage}${sections}${blocked}${m.extra ?? ""}${foot}</div>`;
}

/** Mostra (ou actualiza) o painel; `null` fecha-o. */
export function showPanel(html: string | null): void {
  let host = document.getElementById(PANEL_ID);
  if (html === null) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement("div");
    host.id = PANEL_ID;
    host.className = "ig-overlay";
    host.setAttribute("role", "dialog");
    host.setAttribute("aria-modal", "true");
    document.body.appendChild(host);
  }
  // keep the open <details> (a check's output) open across a refresh
  const open = new Set([...host.querySelectorAll("details[open] summary")].map((x) => x.textContent ?? ""));
  // and what the delegation editor has chosen (phase 5): a refresh never undoes a choice in progress
  const ticked = new Set([...host.querySelectorAll<HTMLInputElement>("input[type=checkbox][name]:checked")].map((i) => `${i.name}=${i.value}`));
  const picked = new Map([...host.querySelectorAll<HTMLSelectElement>("select[name]")].map((x) => [x.name, x.value] as const));
  host.innerHTML = html;
  host.querySelectorAll("details").forEach((d) => {
    if (open.has(d.querySelector("summary")?.textContent ?? "")) d.open = true;
  });
  host.querySelectorAll<HTMLInputElement>("input[type=checkbox][name]").forEach((i) => {
    if (ticked.has(`${i.name}=${i.value}`)) i.checked = true;
  });
  host.querySelectorAll<HTMLSelectElement>("select[name]").forEach((x) => {
    const v = picked.get(x.name);
    if (v !== undefined && [...x.options].some((o) => o.value === v && !o.disabled)) x.value = v;
  });
}
