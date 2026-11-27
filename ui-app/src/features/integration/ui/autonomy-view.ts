/* ═════════ feature `integration` — ui: a secção «Autonomia e pull request» do painel (Multi Co-Dev, fase 5) ═════════
   Dentro de `#ig-panel`, por baixo das três condições: o interruptor geral («Pausar a autonomia»), o modo de
   integração da issue, o pull request (o `gh` aqui, o aberto e o seu estado no GitHub, «Abrir um pull request»), as
   delegações que a cobrem (quem, o quê, o âmbito, quando expira, «Revogar») e o editor para delegar, e o registo do
   que a autonomia fez, com as linhas de auditoria de cada passo. Os botões passam pelo despachante partilhado
   (`integration:*`, `data-on` = a issue, ou `issue|id`). Não toca no `window` (regra A8). */

import { esc } from "../../../core";
import { ACTIONS, HOURS, activeDelegations, canOpenPr, remaining, type Action, type AutonomyEvent, type Overview, type PrState } from "../domain/autonomy";
import type { AuditRow } from "../application/ports";
import type { AutonomyKey } from "../application/autonomy-messages";

export type TA = (k: AutonomyKey, p?: Record<string, string | number>) => string;

export interface AutonomyModel {
  key: string;
  overview: Overview | null;
  pr: PrState | null;
  error: string | null;
  busy: boolean;
  audit(id: number): AuditRow | null;
  eventText(code: string): string;
}

const ACT: Record<Action, AutonomyKey> = { review: "act_review", integrate: "act_integrate", pr: "act_pr" };

const btn = (action: string, on: string, label: string, title: string, opts: { disabled?: boolean; cls?: string } = {}): string =>
  `<button class="mini${opts.cls ? ` ${opts.cls}` : ""}" data-action="integration:${action}" data-on="${esc(on)}" title="${esc(title)}"${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;

const when = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function prBody(t: TA, m: AutonomyModel): string {
  const p = m.pr;
  if (!p) return "";
  const gh = p.gh
    ? !p.gh.installed
      ? `<p class="ig-warn">${esc(t("ghMissing", { notes: p.gh.notes }))}</p>`
      : !p.gh.signedIn
        ? `<p class="ig-warn">${esc(t("ghSignedOut"))}</p>`
        : `<p class="ig-dim notr">${esc(t("ghOk", { version: p.gh.version }))}</p>`
    : "";
  const rec = p.record ? `<p class="notr">${esc(t("prRecord", { n: p.record.number, branch: p.record.branch, target: p.record.target, who: p.record.actor }))} <code>${esc(p.record.prUrl)}</code></p>` : "";
  const live = p.live
    ? `<p class="ig-dim">${esc(
        t("prLive", {
          state: p.live.mergedAt ? t("prMerged", { at: p.live.mergedAt }) : p.live.state,
          draft: p.live.draft ? t("prDraft") : "",
          review: p.live.review || "—",
          passed: p.live.checks.passed,
          failed: p.live.checks.failed,
          pending: p.live.checks.pending,
        }),
      )}</p>`
    : p.liveError
      ? `<p class="ig-warn">${esc(t("prLiveError", { error: p.liveError }))}</p>`
      : "";
  const blocked = p.blocked ? `<p class="ig-dim">${esc(t("prBlocked", { why: p.blocked }))}</p>` : "";
  const branch = /refs\/heads\/(\S+)/.exec(p.plan ?? "")?.[1] ?? "?";
  const target = /--base '([^']*)'/.exec(p.plan ?? "")?.[1] ?? "?";
  const open = canOpenPr(p) ? `<div class="ig-auto-row">${btn("pr-open", m.key, t("prOpen"), t("prOpenTitle", { branch, target }), { disabled: m.busy })}</div>` : "";
  return `<h4>${esc(t("pr"))}</h4>${gh}${rec}${live}${blocked}${open}`;
}

function delegationsBody(t: TA, m: AutonomyModel, o: Overview): string {
  const active = activeDelegations(o);
  const rows = active.length
    ? `<ul class="ig-dels">${active
        .map((d) => {
          const r = remaining(d, o.now);
          const where = t(d.scope === "issue" ? "scope_issue" : "scope_sprint", { target: d.target });
          return `<li><b class="notr">#${d.id}</b> ${esc(where)}: ${esc(d.actions.map((a) => t(ACT[a])).join("; "))} <span class="ig-dim">${esc(t("grantedBy", { who: d.grantedBy, h: r.h, m: r.m }))}</span> ${btn("revoke", `${m.key}|${d.id}`, t("revoke"), t("revokeTitle"), { disabled: m.busy })}</li>`;
        })
        .join("")}</ul>`
    : `<p class="ig-dim">${esc(t("none"))}</p>`;
  const checks = ACTIONS.map((a) => `<label class="ig-chk"><input type="checkbox" name="ig-act" value="${a}"> ${esc(t(ACT[a]))}</label>`).join("");
  const scope = `<select name="ig-scope"><option value="issue">${esc(t("forIssue"))}</option>${
    o.sprint ? `<option value="sprint">${esc(t("forSprint", { sprint: o.sprint }))}</option>` : `<option value="sprint" disabled>${esc(t("noSprint"))}</option>`
  }</select>`;
  const hours = `<select name="ig-hours">${HOURS.map((h) => `<option value="${h}"${h === 24 ? " selected" : ""}>${esc(t("hours", { h }))}</option>`).join("")}</select>`;
  const form = `<div class="ig-grant" data-grant="${esc(m.key)}">${checks}<div class="ig-auto-row">${scope}${hours}${btn("delegate", m.key, t("delegate"), t("delegateTitle"), { disabled: m.busy, cls: "pri" })}</div></div>`;
  return `<h4>${esc(t("delegations"))}</h4>${rows}${form}`;
}

function eventRow(t: TA, m: AutonomyModel, e: AutonomyEvent): string {
  const out = (["started", "ok", "stopped", "failed"] as const).includes(e.outcome as "ok") ? t(`out_${e.outcome}` as AutonomyKey) : e.outcome;
  const links = e.audit
    .map((id) => {
      const row = m.audit(id);
      const link = btn("audit", `${m.key}|${id}`, t("auditLink", { id }), t("auditTitle"), { cls: "ig-link" });
      return row
        ? `${link}<div class="ig-audit notr">${esc(when(row.at))} · ${esc(t("auditRow", { call: row.call, outcome: row.outcome, by: row.decidedBy }))}<br><code>${esc(row.command)}</code>${row.reason ? `<br>${esc(row.reason)}` : ""}</div>`
        : link;
    })
    .join(" ");
  const cls = e.outcome === "ok" ? "ok" : e.outcome === "started" ? "wait" : "bad";
  return `<li class="ig-ev ${cls}"><span class="ig-dim notr">${esc(when(e.at))} · ${esc(e.action)}</span> <b>${esc(out)}</b> — ${esc(m.eventText(e.code))}${e.detail ? ` <span class="ig-dim notr">${esc(e.detail)}</span>` : ""} ${links}</li>`;
}

/** O markup da secção (puro sobre o modelo); vazio sem nada lido. */
export function renderAutonomy(t: TA, m: AutonomyModel): string {
  const o = m.overview;
  if (!o && !m.pr && !m.error) return "";
  const err = m.error ? `<p class="ig-err">${esc(m.error)}</p>` : "";
  if (!o) return `<section class="ig-auto"><h3>${esc(t("section"))}</h3>${err}${prBody(t, m)}</section>`;
  const sw = o.switch.paused
    ? `<p class="ig-warn">${esc(t("paused", { by: o.switch.by ? t("pausedBy", { who: o.switch.by }) : "" }))}</p>${btn("resume", m.key, t("resume"), t("resume"), { disabled: m.busy })}`
    : `<p class="ig-dim">${esc(t("running"))}</p>${btn("pause", m.key, t("pause"), t("pauseTitle"), { cls: "ig-stop" })}`;
  const mode = o.mode && ["manual", "integrate", "pr", "ambiguous"].includes(o.mode) ? `<p>${esc(t(`mode_${o.mode}` as AutonomyKey))}</p>` : "";
  const log = o.events.length ? `<ul class="ig-log">${o.events.map((e) => eventRow(t, m, e)).join("")}</ul>` : `<p class="ig-dim">${esc(t("noLog"))}</p>`;
  return (
    `<section class="ig-auto" data-auto="${esc(m.key)}"><h3>${esc(t("section"))}</h3><p class="ig-dim">${esc(t("rule"))}</p>${err}` +
    `<div class="ig-auto-row">${sw}<span class="ig-dim">${esc(t("rate", { used: o.used, limit: o.limit }))}</span></div>${mode}` +
    prBody(t, m) +
    delegationsBody(t, m, o) +
    `<h4>${esc(t("log"))}</h4>${log}</section>`
  );
}

/** O que o editor de delegações tem escolhido (lido no clique de «Delegar»). */
export function readGrantForm(host: ParentNode, key: string): { scope: "issue" | "sprint"; actions: Action[]; hours: number } {
  const form = [...host.querySelectorAll<HTMLElement>("[data-grant]")].find((f) => f.dataset.grant === key) ?? null;
  const actions = form ? [...form.querySelectorAll<HTMLInputElement>('input[name="ig-act"]:checked')].map((i) => i.value).filter((a): a is Action => (ACTIONS as string[]).includes(a)) : [];
  const scope = form?.querySelector<HTMLSelectElement>('select[name="ig-scope"]')?.value === "sprint" ? "sprint" : "issue";
  const h = Number(form?.querySelector<HTMLSelectElement>('select[name="ig-hours"]')?.value ?? 24);
  return { scope, actions, hours: (HOURS as readonly number[]).includes(h) ? h : 24 };
}
