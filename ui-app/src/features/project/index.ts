/* ═════════ feature `project` — composition root (docs/v2/UI-AUDIT.md, item 5; phase A5) ═════════
   Wires the Tauri gateway and the legacy bridge into the use case and the view, registers
   the `VIEW.project` tab and the delegated listener, and reloads the project when another
   folder opens. Whoever opens the Project imports `openProject` (activity bar, menu,
   palette) — no window global. Kanban, Scrum, XP or Scrum + XP over the SQLite store. */

import { VIEW } from "../../app/store/registry";
import { makeProjectService } from "./application/project-service";
import { makeProjectView } from "./ui/view";
import { bindActions, type ActionEvent, type ActionTable } from "./ui/actions";
import { tauriProjectGateway } from "./infrastructure/tauri";
import { codev, dialog, git, loadMe, notify, openTab, workspace } from "./infrastructure/legacy-bridge";
import type { QuickFilter, Swim, View } from "./domain/board";
import type { State } from "./domain/types";
import { projectInbox } from "../../app/project-inbox";
import { translator } from "../../app/i18n";
import { PROJECT_ENGINE_MESSAGES } from "./application/messages";

const copy = translator(PROJECT_ENGINE_MESSAGES);

export const projectService = makeProjectService({
  copy,
  gateway: tauriProjectGateway,
  workspace,
  git,
  codev,
  dialog,
  notify,
  now: () => Date.now(),
});
const view = makeProjectView(projectService, () => Date.now());

VIEW.project = (_t, host) => view.mount(host);

/** Opens (or focuses) the Project tab. */
export function openProject(sub?: View): void {
  if (sub) projectService.setView(sub);
  openTab({ id: "project", title: "Project", kind: "project" });
}

const sel = (): string | null => projectService.state().selected;
const DAY = 86_400_000;

/** The named fields of the inline form the button belongs to. */
function formValues(e: ActionEvent): Record<string, string> {
  const form = e.el.closest(".pj-form");
  const out: Record<string, string> = {};
  form?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[name]").forEach((f) => (out[f.name] = f.value));
  return out;
}

const lines = (s: string | undefined): string[] => (s ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
const enter = (f: (e: ActionEvent) => void) => (e: ActionEvent) => {
  const k = e.ev as KeyboardEvent;
  if (k.key !== "Enter" || k.shiftKey) return;
  e.ev.preventDefault();
  const v = (e.el as HTMLInputElement).value;
  if (!v.trim()) return;
  f({ ...e, value: v });
  (e.el as HTMLInputElement).value = "";
};

function submit(e: ActionEvent): void {
  const v = formValues(e);
  const s = projectService;
  if (e.on === "sprint") {
    const start = Date.parse(v.start ?? "");
    const end = Date.parse(v.end ?? "") + DAY - 1;
    if (!v.name?.trim() || !Number.isFinite(start) || !Number.isFinite(end)) return notify.toast(copy("sprintNeeds"));
    void s.apply({ op: "create_sprint", name: v.name, goal: v.goal ?? "", start, end, capacity: v.capacity ? Number(v.capacity) : null });
  } else if (e.on === "release") {
    const date = Date.parse(v.date ?? "");
    if (!v.version?.trim() || !Number.isFinite(date)) return notify.toast(copy("releaseNeeds"));
    void s.apply({ op: "create_release", version: v.version, date, goal: v.goal ?? "", epic: v.epic ?? "" });
  } else if (e.on === "settings") {
    const wip: Record<string, number> = {};
    for (const st of ["progress", "review", "accept"]) {
      const n = v[`wip_${st}`];
      if (n && Number(n) > 0) wip[st] = Number(n);
    }
    void s.apply({ op: "settings", key_prefix: v.key_prefix, iter_days: Number(v.iter_days), wip, dor: lines(v.dor), dod: lines(v.dod) });
  }
}

function field(e: ActionEvent): void {
  const key = sel();
  if (!key) return;
  const f = e.on;
  let value: unknown = e.value;
  if (f === "points") value = e.value === "" ? null : Math.max(0, Math.round(Number(e.value)));
  if (f === "blocked") value = e.value.trim() ? e.value.trim() : null;
  void projectService.update(key, { [f]: value });
}

const table: ActionTable = {
  "pj-view": { click: (e) => projectService.setView(e.on as View) },
  "pj-card": {
    click: (e) => projectService.select(e.on),
    dragstart: (e) => (e.ev as DragEvent).dataTransfer?.setData("text/plain", e.on),
  },
  "pj-col": {
    dragover: (e) => {
      e.ev.preventDefault();
      e.el.classList.add("drop");
    },
    dragleave: (e) => e.el.classList.remove("drop"),
    drop: (e) => {
      e.ev.preventDefault();
      e.el.classList.remove("drop");
      const key = (e.ev as DragEvent).dataTransfer?.getData("text/plain");
      if (key) void projectService.move(key, e.on as State);
    },
  },
  "pj-open": { click: (e) => projectService.select(e.on) },
  "pj-close": { click: () => projectService.select(null) },
  "pj-search": { input: (e) => projectService.search(e.value) },
  "pj-quick": { click: (e) => projectService.toggleQuick(e.on as QuickFilter) },
  "pj-swim": { click: (e) => projectService.setSwim(e.on as Swim) },
  "pj-sync": { click: () => void projectService.syncCommits() },
  "pj-new": { keydown: enter((e) => void projectService.create(e.value, e.on || null)) },
  "pj-plan": { change: (e) => void projectService.plan(e.on, e.value || null) },
  "pj-plan-to": { click: (e) => { const [k, s] = e.on.split("|"); void projectService.plan(k, s || null); } },
  "pj-unplan": { click: (e) => void projectService.plan(e.on, null) },
  "pj-up": { click: (e) => { const [k, b] = e.on.split("|"); void projectService.rank(k, b || null); } },
  "pj-down": { click: (e) => { const [k, b] = e.on.split("|"); void projectService.rank(k, b || null); } },
  "pj-accept": { click: (e) => void projectService.accept(Number(e.on)) },
  "pj-dismiss": { click: (e) => void projectService.dismiss(Number(e.on)) },
  "pj-move": { click: (e) => { const k = sel(); if (k) void projectService.move(k, e.on as State); } },
  "pj-field": { change: field },
  "pj-crit": { change: (e) => { const k = sel(); if (k) void projectService.toggleCriterion(k, Number(e.on)); } },
  "pj-crit-del": { click: (e) => { const k = sel(); if (k) void projectService.removeCriterion(k, Number(e.on)); } },
  "pj-crit-add": { keydown: enter((e) => { const k = sel(); if (k) void projectService.addCriterion(k, e.value); }) },
  "pj-ready": { change: (e) => { const k = sel(); if (k) void projectService.update(k, { ready: e.checked }); } },
  "pj-dod": { change: (e) => { const k = sel(); if (k) void projectService.toggleDod(k, Number(e.on)); } },
  "pj-branch": { click: () => { const k = sel(); if (k) void projectService.createBranch(k); } },
  "pj-work": { click: () => { const k = sel(); if (k) projectService.work(k); } },
  "pj-delete": { click: (e) => void projectService.remove(e.on) },
  "pj-comment": { keydown: enter((e) => { const k = sel(); if (k) void projectService.comment(k, e.value); }) },
  "pj-submit": { click: submit },
  "pj-sprint-start": { click: (e) => void projectService.apply({ op: "start_sprint", id: e.on }) },
  "pj-sprint-close": {
    click: (e) => {
      const p = projectService.state().project;
      const next = p?.sprints.find((s) => s.state === "planned" && s.id !== e.on) ?? null;
      const where = next ? next.name : "o backlog";
      if (dialog.confirm(`Fechar a sprint? O trabalho por terminar passa para ${where}.`)) {
        void projectService.apply({ op: "close_sprint", id: e.on, carry_to: next?.id ?? null });
      }
    },
  },
  "pj-rel-del": { click: (e) => { if (dialog.confirm(`Apagar a release ${e.on}?`)) void projectService.apply({ op: "delete_release", version: e.on }); } },
  "pj-retro-add": {
    keydown: enter((e) => {
      const active = projectService.state().project?.sprints.find((s) => s.state === "active");
      void projectService.apply({ op: "retro_add", kind: e.on, text: e.value, sprint: active?.id ?? null });
    }),
  },
  "pj-retro-del": { click: (e) => void projectService.apply({ op: "retro_delete", id: Number(e.on) }) },
  "pj-retro-backlog": {
    click: async () => {
      const p = projectService.state().project;
      for (const n of p?.retro.filter((x) => x.kind === "action") ?? []) {
        await projectService.apply({ op: "propose", title: n.text, kind: "task", source: "retro" });
      }
      projectService.setView("backlog");
    },
  },
  "pj-method": { click: (e) => void projectService.apply({ op: "settings", method: e.on }) },
  "pj-reload": { click: () => void projectService.open() },
};
bindActions(table);

/* other features send proposals to the inbox (PROJ-01): never issues straight into the project */
projectInbox.register(async (items) => {
  if (!tauriProjectGateway.available() || !workspace.root()) return 0;
  let n = 0;
  for (const it of items) if (await projectService.apply({ op: "propose", ...it })) n++;
  return n;
});

/* another folder opened in the desktop app: the project is that folder's */
document.addEventListener("dx:workspace", () => {
  const r = workspace.root();
  if (!r) return;
  void loadMe(r).then(() => {
    if (projectService.state().status !== "idle") void projectService.open();
  });
});
