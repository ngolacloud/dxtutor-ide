/* ═══════════ Co-Dev — vista: a proposta do `/backlog` e do `/project` no chat ═══════════
   O backlog (épicos → issues com pontos, âmbito e dependências) ou o plano do Project (método, sprints e o que
   fica no product backlog), e o que o humano pode fazer: abrir o rascunho, pedir o `/project`, criar o Project
   (com ou sem a aprovação Ready) e, depois de criado, entregar uma issue Ready ao Co-Dev. Os botões vão pelo
   despachante partilhado (`codev-backlog:*`, payload em `data-on`); os efeitos são injectados pela composição
   (`bindBacklogActions`): criar é do Project (com o diálogo de aprovação), abrir ficheiros é do editor. */

import { esc } from "../../../core";
import { registerActions } from "../../../app/actions";
import { translator } from "../../../app/i18n";
import { BACKLOG_MESSAGES } from "./backlog-messages";
import { byEpic, pointsOf, unplanned, type BacklogProposal, type DraftIssue } from "../domain/backlog";

const t = translator(BACKLOG_MESSAGES);

/** O que criar o Project devolveu, no que o cartão mostra. */
export interface CreatedSummary {
  created: Array<[string, string]>;
  existing: Array<[string, string]>;
  sprints: string[];
  ready: string[];
  notReady: Array<{ key: string; missing: string[] }>;
}

export interface BacklogActionDeps {
  openFile(rel: string): void;
  /** Põe texto no compositor (sem enviar). */
  prefill(text: string): void;
  create(o: { hash: string; plan: unknown; ready: boolean; issues: number; sprints: number }): Promise<CreatedSummary | null>;
  openProject(): void;
  workOn(key: string): void;
}

/** As propostas mostradas nesta execução, pelo id do cartão. */
const shown = new Map<string, BacklogProposal>();
let seq = 0;

const issueLine = (i: DraftIssue): string =>
  `<div class="bl-i"><div class="bl-ih"><code>${esc(i.ref)}</code><span class="tag${i.kind === "bug" ? " bad" : ""}">${esc(i.kind)}</span><span class="bl-tt">${esc(i.title)}</span>${
    i.points != null ? `<span class="bl-p">${i.points}</span>` : ""
  }</div><div class="bl-s">${t("scope")}: ${i.scope.map((s) => `<code>${esc(s)}</code>`).join(" ")}${i.deps.length ? ` · ${t("deps")} ${i.deps.map(esc).join(", ")}` : ""}</div></div>`;

function backlogBody(p: BacklogProposal): string {
  return byEpic(p.draft)
    .map(
      (g) =>
        `<details class="bl-e" open><summary>${esc(g.epic ? g.epic.title : t("noEpic"))} <span class="bl-c">${g.issues.length} ${t("issues")} · ${pointsOf(g.issues)}</span></summary>${g.issues
          .map(issueLine)
          .join("")}</details>`,
    )
    .join("");
}

function projectBody(p: BacklogProposal): string {
  const plan = p.plan!;
  const byRef = new Map(p.draft.issues.map((i) => [i.ref, i]));
  const head = [plan.method ? t("method", { method: plan.method }) : "", plan.iterDays ? t("iteration", { days: plan.iterDays }) : ""].filter(Boolean).join(" · ");
  const sprints = plan.sprints
    .map((s) => {
      const issues = s.issues.map((r) => byRef.get(r)).filter((i): i is DraftIssue => !!i);
      const cap = s.capacity != null ? ` · ${t("capacity", { cap: s.capacity })}` : "";
      return `<details class="bl-e" open><summary>${esc(t("sprintLine", { name: s.name, issues: issues.length, points: pointsOf(issues) }))}${cap}${
        s.goal ? ` <span class="bl-c">${esc(s.goal)}</span>` : ""
      }</summary>${issues.map(issueLine).join("")}</details>`;
    })
    .join("");
  const rest = unplanned(p.draft, plan);
  const backlog = rest.length ? `<details class="bl-e"><summary>${esc(t("productBacklog", { issues: rest.length }))}</summary>${rest.map(issueLine).join("")}</details>` : "";
  return (head ? `<div class="bl-m">${esc(head)}</div>` : "") + sprints + backlog;
}

/** O cartão de uma proposta (guarda-a para os botões). */
export function proposalHtml(p: BacklogProposal): string {
  const id = "bl" + ++seq;
  shown.set(id, p);
  const d = p.draft;
  const title = t(p.kind === "backlog" ? "backlogTitle" : "projectTitle", { title: d.title });
  const counts = t("counts", { epics: d.epics.length, issues: d.issues.length, points: pointsOf(d.issues) });
  const acts =
    p.kind === "backlog"
      ? `<button class="mini" data-action="codev-backlog:open" data-on="${id}">${t("open")}</button><button class="mini pri" data-action="codev-backlog:next" data-on="${id}" title="${esc(t("nextHint"))}">${t("next")}</button>`
      : `<button class="mini pri" data-action="codev-backlog:create" data-on="${id}">${t("create")}</button><button class="mini" data-action="codev-backlog:create-ready" data-on="${id}" title="${esc(t("createReadyHint"))}">${t("createReady")}</button><button class="mini" data-action="codev-backlog:open" data-on="${id}">${t("open")}</button>`;
  return `<div class="bl-card" id="${id}"><div class="bl-h"><b>${esc(title)}</b><span class="bl-c">${esc(counts)}</span></div>${
    p.kind === "backlog" ? backlogBody(p) : projectBody(p)
  }${p.kind === "backlog" ? `<div class="bl-n">${esc(t("savedIn", { path: p.path }))} ${esc(t("nextHint"))}</div>` : ""}<div class="bl-act">${acts}</div><div class="bl-res"></div></div>`;
}

/** O resultado de criar o Project: o que foi criado, o que ficou Ready (com o botão para o Co-Dev) e o que espera. */
export function createdHtml(c: CreatedSummary): string {
  const head = t("created", {
    created: c.created.length,
    existing: c.existing.length ? t("existing", { n: c.existing.length }) : "",
    sprints: c.sprints.length ? t("sprints", { n: c.sprints.length }) : "",
  });
  const ready = c.ready.length
    ? `<div class="bl-m">${t("readyList")}</div><div class="bl-act">${c.ready
        .map((k) => `<button class="mini pri" data-action="codev-backlog:work" data-on="${esc(k)}">${esc(t("work", { key: k }))}</button>`)
        .join("")}</div>`
    : `<div class="bl-m">${t("readyNone")}</div>`;
  const waiting = c.notReady.map((n) => `<div class="bl-s">${esc(t("waiting", { key: n.key, missing: n.missing.join("; ") }))}</div>`).join("");
  return `<div class="bl-ok">${esc(head)}</div>${ready}${waiting}<div class="bl-act"><button class="mini" data-action="codev-backlog:project" data-on="">${t("openProject")}</button></div>`;
}

const cardOf = (el: HTMLElement): HTMLElement | null => el.closest<HTMLElement>(".bl-card");

async function create(deps: BacklogActionDeps, id: string, el: HTMLElement, ready: boolean): Promise<void> {
  const p = shown.get(id);
  const card = cardOf(el);
  if (!p || !p.plan || !card) return;
  const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>(".bl-act button"));
  const res = card.querySelector<HTMLElement>(".bl-res")!;
  buttons.forEach((b) => (b.disabled = true));
  res.textContent = t("creating");
  const c = await deps.create({ hash: p.hash, plan: p.rawPlan, ready, issues: p.draft.issues.length, sprints: p.plan.sprints.length });
  if (!c) {
    res.textContent = t("notCreated");
    buttons.forEach((b) => (b.disabled = false));
    return;
  }
  res.innerHTML = createdHtml(c);
}

/** Liga os botões dos cartões (uma vez, na composição). */
export function bindBacklogActions(deps: BacklogActionDeps): void {
  registerActions({
    "codev-backlog:open": { click: (c) => deps.openFile(shown.get(c.on)?.path ?? ".dxtutor/backlog.json") },
    "codev-backlog:next": { click: () => deps.prefill("/project ") },
    "codev-backlog:create": { click: (c) => void create(deps, c.on, c.el, false) },
    "codev-backlog:create-ready": { click: (c) => void create(deps, c.on, c.el, true) },
    "codev-backlog:project": { click: () => deps.openProject() },
    "codev-backlog:work": { click: (c) => deps.workOn(c.on) },
  });
}
