/* ═════════ feature `project` — use case: the Project views and their operations ═════════
   Keeps what the views draw (the project, the view, the selected issue and its history,
   the reports, the filters) and turns every human action into one atomic operation on the
   store. When the store refuses a move because of a rule (WIP, DoR, DoD, a skipped step, a
   block) the human may override it with a reason, which the store records. Nothing is
   kept locally: the store is the source of truth, and each operation returns the project
   after it. No DOM, no window: everything through the ports. */

import { issueDrift, parseViolations, type IssueDrift } from "../domain/drift";
import type { IssuePrompt, ProjectDeps } from "./ports";

/** Narrows the backend's `project_issue_prompt` answer. */
export function parsePrompt(v: unknown): IssuePrompt | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.text !== "string" || !o.text) return null;
  return {
    text: o.text,
    lang: typeof o.lang === "string" ? o.lang : "",
    source: typeof o.source === "string" ? o.source : "",
    version: typeof o.version === "string" ? o.version : "",
    tokens: typeof o.tokens === "number" ? o.tokens : 0,
    template: typeof o.template === "string" ? o.template : "",
  };
}
import { branchName, startWipRefusal, viewsFor, type Filters, type QuickFilter, type Swim, type View } from "../domain/board";
import { ptCopy } from "./messages";
import { MAX_CODEVS, parseSprintPlan, type SprintPlan } from "../domain/plan";
import {
  parseDetail,
  parseError,
  parseMethodChange,
  parseProject,
  parseReports,
  type Issue,
  type IssueDetail,
  type Method,
  type MethodChange,
  type Project,
  type ProjectError,
  type Reports,
  type State,
} from "../domain/types";

export interface ProjectState {
  /** `idle` before the first load; `unavailable` outside the desktop app or without a folder. */
  status: "idle" | "loading" | "ready" | "unavailable" | "error";
  project: Project | null;
  error: string | null;
  view: View;
  selected: string | null;
  detail: IssueDetail | null;
  reports: Reports | null;
  filters: Filters;
  swim: Swim;
  /** «Ver prompt» (RF-B03): the exact prompt of the selected issue, when open. */
  prompt: (IssuePrompt & { key: string }) | null;
  /** RF-A05: the architect's rules broken in the files Co-Dev changed for the selected issue
   *  (`null`: not loaded, no rules file, or no change sets). */
  drift: IssueDrift | null;
  /** Multi Co-Dev (phase 1): the parallel plan of one sprint, when open (read-only). */
  sprintPlan: { sprint: string; loading: boolean; data: SprintPlan | null; error: string | null } | null;
  /** The folder's detected test command (the default mandatory check when the project sets none). */
  testCommand: string | null;
  /** Board B: what choosing a method would change, shown in Settings until applied or cancelled. */
  methodPreview: MethodChange | null;
}

/** Operations whose rule refusals a reason may override (the store records it): moves, and the sprint
 *  capacity when planning, estimating or creating into a sprint (Board B). */
const OVERRIDABLE_OPS = new Set(["move", "plan_issue", "update_issue", "create_issue"]);

export function makeProjectService(deps: ProjectDeps) {
  const copy = deps.copy ?? ptCopy;
  let st: ProjectState = {
    status: "idle",
    project: null,
    error: null,
    view: "board",
    selected: null,
    detail: null,
    reports: null,
    filters: { q: "", quick: [], me: "" },
    swim: "epic",
    prompt: null,
    drift: null,
    sprintPlan: null,
    testCommand: null,
    methodPreview: null,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ProjectState>): void => {
    st = { ...st, ...patch };
    listeners.forEach((f) => f());
  };
  const root = (): string | null => deps.workspace.root();
  const lang = (): "pt" | "en" => deps.lang?.() ?? "pt";
  /** The parallel plan's requests: only the newest one paints. */
  let planSeq = 0;

  async function open(): Promise<void> {
    const r = root();
    if (!deps.gateway.available() || !r) {
      set({ status: "unavailable", project: null });
      return;
    }
    planSeq++;
    set({ status: "loading", error: null, sprintPlan: null, filters: { ...st.filters, me: deps.workspace.me() }, testCommand: deps.workspace.testCommand?.() ?? null });
    try {
      const p = parseProject(await deps.gateway.load(r));
      if (!p) throw new Error(copy("badResponse"));
      set({ status: "ready", project: p, view: viewsFor(p.method).includes(st.view) ? st.view : "board" });
      if (st.view === "reports") void loadReports();
      if (st.selected) void loadDetail(st.selected);
    } catch (e: unknown) {
      set({ status: "error", error: parseError(e).message });
    }
  }

  /** Applies an operation. A refused move may be overridden with a reason (asked here). */
  async function apply(op: Record<string, unknown>): Promise<boolean> {
    const r = root();
    if (!r) return false;
    try {
      const p = parseProject(await deps.gateway.apply(r, op));
      if (p) set({ project: p, error: null });
      if (st.selected) void loadDetail(st.selected);
      // the open parallel plan follows the project (a new issue in the sprint, a scope, a dependency…)
      if (st.sprintPlan) void loadPlan(st.sprintPlan.sprint);
      if (st.view === "reports") void loadReports();
      return true;
    } catch (e: unknown) {
      const err: ProjectError = parseError(e);
      if (err.overridable && OVERRIDABLE_OPS.has(String(op.op)) && !op.reason) {
        const reason = deps.dialog.prompt(copy("overrideReason", { error: err.message }));
        if (reason && reason.trim()) return apply({ ...op, reason: reason.trim() });
        return false;
      }
      deps.notify.toast(err.message);
      return false;
    }
  }

  async function loadDetail(key: string): Promise<void> {
    const r = root();
    if (!r) return;
    try {
      const d = parseDetail(await deps.gateway.issue(r, key));
      if (st.selected === key) set({ detail: d });
      // RF-A05: the drift of the rules in the files of the issue's change sets
      if (d.changeSets.length && deps.gateway.conformance) {
        const raw = await deps.gateway.conformance(r).catch(() => null);
        const drift = raw === null ? null : issueDrift(d.changeSets, parseViolations(raw));
        if (st.selected === key) set({ drift });
      }
    } catch (e: unknown) {
      deps.notify.toast(parseError(e).message);
    }
  }

  async function loadReports(): Promise<void> {
    const r = root();
    if (!r) return;
    try {
      set({ reports: parseReports(await deps.gateway.reports(r)) });
    } catch (e: unknown) {
      deps.notify.toast(parseError(e).message);
    }
  }

  /** Multi Co-Dev (phase 1): asks the planner for the sprint's parallel plan (nothing runs). A newer request wins. */
  async function loadPlan(sprint: string): Promise<void> {
    const r = root();
    if (!r || !deps.gateway.sprintPlan) {
      deps.notify.toast(copy("planNeedsDesktop"));
      return;
    }
    const seq = ++planSeq;
    set({ sprintPlan: { sprint, loading: true, data: st.sprintPlan?.sprint === sprint ? st.sprintPlan.data : null, error: null } });
    try {
      const data = parseSprintPlan(await deps.gateway.sprintPlan(r, sprint, null));
      if (seq !== planSeq) return;
      if (!data) throw new Error(copy("planBad"));
      set({ sprintPlan: { sprint, loading: false, data, error: null } });
    } catch (e: unknown) {
      if (seq !== planSeq) return;
      set({ sprintPlan: { sprint, loading: false, data: null, error: parseError(e).message } });
    }
  }

  const issue = (key: string): Issue | undefined => st.project?.issues.find((i) => i.key === key);

  return {
    state: (): ProjectState => st,
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    open,
    apply,
    setView(v: View): void {
      set({ view: v });
      if (v === "reports") void loadReports();
    },
    select(key: string | null): void {
      set({ selected: key, detail: null, drift: null });
      if (key) void loadDetail(key);
    },
    search(q: string): void {
      set({ filters: { ...st.filters, q } });
    },
    toggleQuick(f: QuickFilter): void {
      const quick = st.filters.quick.includes(f) ? st.filters.quick.filter((x) => x !== f) : [...st.filters.quick, f];
      set({ filters: { ...st.filters, quick } });
    },
    setSwim(s: Swim): void {
      set({ swim: s });
    },
    move: (key: string, to: State): Promise<boolean> => apply({ op: "move", key, to }),
    create(title: string, sprint?: string | null): Promise<boolean> {
      if (!title.trim()) return Promise.resolve(false);
      return apply({ op: "create_issue", title: title.trim(), sprint: sprint ?? null });
    },
    update: (key: string, patch: Record<string, unknown>): Promise<boolean> => apply({ op: "update_issue", key, ...patch }),
    toggleCriterion(key: string, idx: number): Promise<boolean> {
      const i = issue(key);
      if (!i) return Promise.resolve(false);
      const items = i.acceptance.map((c, k) => (k === idx ? { ...c, done: !c.done } : c));
      return apply({ op: "set_acceptance", key, items });
    },
    addCriterion(key: string, text: string): Promise<boolean> {
      const i = issue(key);
      if (!i || !text.trim()) return Promise.resolve(false);
      return apply({ op: "set_acceptance", key, items: [...i.acceptance, { text: text.trim(), done: false }] });
    },
    removeCriterion(key: string, idx: number): Promise<boolean> {
      const i = issue(key);
      if (!i) return Promise.resolve(false);
      return apply({ op: "set_acceptance", key, items: i.acceptance.filter((_, k) => k !== idx) });
    },
    /** Board B: ticks an item of the project's own Definition of Ready on the issue (like the DoD). */
    toggleDor(key: string, idx: number): Promise<boolean> {
      const i = issue(key);
      const p = st.project;
      if (!i || !p) return Promise.resolve(false);
      const flags = p.dor.map((_, k) => (k === idx ? !i.dorDone[k] : !!i.dorDone[k]));
      return apply({ op: "update_issue", key, dor_done: flags });
    },
    /** Board B: choosing a method first shows what it changes (the store's preview: its defaults where the
     *  user set nothing, and what stays); `applyMethod` makes it so. Without a preview (no desktop), at once. */
    async chooseMethod(method: Method): Promise<boolean> {
      const r = root();
      if (!r || !st.project) return false;
      if (method === st.project.method) {
        set({ methodPreview: null });
        return true;
      }
      if (!deps.gateway.methodPreview) return apply({ op: "settings", method, lang: lang() });
      try {
        const ch = parseMethodChange(await deps.gateway.methodPreview(r, method, lang()));
        if (!ch) throw new Error(copy("methodPreviewBad"));
        set({ methodPreview: ch });
        return true;
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
        return false;
      }
    },
    async applyMethod(): Promise<boolean> {
      const ch = st.methodPreview;
      if (!ch) return false;
      const ok = await apply({ op: "settings", method: ch.to, lang: lang() });
      if (ok) set({ methodPreview: null });
      return ok;
    },
    cancelMethod(): void {
      set({ methodPreview: null });
    },
    toggleDod(key: string, idx: number): Promise<boolean> {
      const i = issue(key);
      const p = st.project;
      if (!i || !p) return Promise.resolve(false);
      const flags = p.dod.map((_, k) => (k === idx ? !i.dodDone[k] : !!i.dodDone[k]));
      return apply({ op: "update_issue", key, dod_done: flags });
    },
    async remove(key: string): Promise<boolean> {
      if (!deps.dialog.confirm(`Apagar ${key}? A actividade fica registada.`)) return false;
      const ok = await apply({ op: "delete_issue", key });
      if (ok && st.selected === key) set({ selected: null, detail: null });
      return ok;
    },
    comment: (key: string, text: string): Promise<boolean> => (text.trim() ? apply({ op: "comment", key, text }) : Promise.resolve(false)),
    plan: (key: string, sprint: string | null): Promise<boolean> => apply({ op: "plan_issue", key, sprint }),
    rank: (key: string, before: string | null): Promise<boolean> => apply({ op: "rank", key, before }),
    accept: (id: number): Promise<boolean> => apply({ op: "accept_proposal", id }),
    dismiss: (id: number): Promise<boolean> => apply({ op: "dismiss_proposal", id }),
    /** Exports the Co-Dev audit log of an issue as JSON (RF-T01): every action, who asked,
     *  the mode, who decided and when, model and tokens. */
    async exportAudit(key: string): Promise<void> {
      const r = root();
      if (!r || !deps.gateway.audit || !deps.download) {
        deps.notify.toast("O registo de auditoria só existe na app desktop, com uma pasta aberta");
        return;
      }
      try {
        const rows = await deps.gateway.audit(r, key);
        if (!Array.isArray(rows) || !rows.length) {
          deps.notify.toast(`Ainda não há registo do Co-Dev para ${key}`);
          return;
        }
        deps.download(`audit-${key}.json`, JSON.stringify(rows, null, 2) + "\n");
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
      }
    },
    /** Links the commits that cite issue keys (read from `git log`). */
    async syncCommits(): Promise<void> {
      if (!deps.git.available() || !st.project) return;
      try {
        const commits = await deps.git.log();
        if (commits.length) await apply({ op: "link_commits", commits });
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
      }
    },
    /** Creates the issue's branch with the exact git command and records it on the issue. */
    async createBranch(key: string): Promise<void> {
      const i = issue(key);
      if (!i) return;
      if (!deps.git.available()) {
        deps.notify.toast(copy("notARepo"));
        return;
      }
      const name = branchName(i);
      try {
        await deps.git.branch(name);
        await apply({ op: "update_issue", key, branch: name });
        deps.notify.toast(`git checkout -b ${name}`);
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
      }
    },
    /** Hands the issue to Co-Dev (the agent's changes are recorded as its change sets). With the
     *  store's prompt (F4): only when the Definition of Ready is complete, and with the exact
     *  prompt the backend assembled from the project's template (RF-B02/B03). */
    async work(key: string): Promise<void> {
      const i = issue(key);
      if (!i || !st.project) return;
      if (!deps.codev.available()) {
        deps.notify.toast(copy("needsAgent"));
        return;
      }
      if (deps.canDrive && !deps.canDrive()) {
        deps.notify.toast(deps.navigatorMessage ?? "Só quem conduz a sessão PairCode executa issues com o Co-Dev");
        return;
      }
      const r = root();
      if (r && deps.gateway.issuePrompt && deps.codev.workWith) {
        if (i.missing.length) {
          deps.notify.toast(`${key} ainda não está Ready — falta: ${i.missing.join("; ")}`);
          return;
        }
        // Board B: the issue goes to In progress by the normal move when its Co-Dev session really starts
        // (the backend, `codev_agent::send`: a session may wait for another's files). When the WIP limit
        // would refuse it, ask now: with a reason it moves as a recorded override; without one, no start
        const full = startWipRefusal(st.project, i);
        if (full) {
          const reason = deps.dialog.prompt(copy("startWip", { key, count: full.count, limit: full.limit }));
          if (!reason || !reason.trim()) return;
          if (!(await apply({ op: "move", key, to: "progress", reason: reason.trim() }))) return;
        }
        try {
          const p = parsePrompt(await deps.gateway.issuePrompt(r, key));
          if (!p) throw new Error("o prompt da issue veio vazio");
          deps.codev.workWith(i, p);
        } catch (e: unknown) {
          deps.notify.toast(parseError(e).message);
        }
        return;
      }
      deps.codev.work(i, st.project);
    },
    /** «Ver prompt» (RF-B03): the exact text the issue goes with, and its tokens. */
    async viewPrompt(key: string): Promise<void> {
      const r = root();
      if (!r || !deps.gateway.issuePrompt) {
        deps.notify.toast("O prompt da issue é montado pela app desktop, com uma pasta aberta");
        return;
      }
      try {
        const p = parsePrompt(await deps.gateway.issuePrompt(r, key));
        if (p) set({ prompt: { ...p, key } });
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
      }
    },
    closePrompt(): void {
      set({ prompt: null });
    },
    /** RF-A05: the Problems panel with only the files Co-Dev changed for the selected issue. */
    driftInProblems(): void {
      const k = st.selected, d = st.drift;
      if (!k || !d || !d.files.length || !deps.showInProblems) return;
      deps.showInProblems(k, d.files);
    },
    /** Opens a violation's file at its line. */
    openViolation(path: string, line: number | null): void {
      deps.openAt?.(path, line ?? 1);
    },
    /** RF-B04 (F4): edit the prompt template in the IDE. With the built-in one in use, the project's
     *  file (`.dxtutor/prompts/issue.<lang>.md`) is created from it first — after the human
     *  confirms; then it opens in the editor. «View prompt» shows the new version afterwards. */
    async editTemplate(): Promise<void> {
      const r = root(), p = st.prompt, files = deps.templates;
      if (!r || !p || !files) {
        deps.notify.toast("O template edita-se na app desktop, com uma pasta aberta");
        return;
      }
      const lang = p.lang === "pt" ? "pt" : "en";
      const rel = p.source && p.source !== "builtin" ? p.source : `.dxtutor/prompts/issue.${lang}.md`;
      try {
        if (!p.source || p.source === "builtin") {
          if (!p.template.trim()) throw new Error("o backend não mandou o texto do template");
          const ok = deps.dialog.confirm(
            `Create ${rel} from the built-in template?\n\nIt becomes this project's template: commit it with the code. Changes to it are the architect's or the tech lead's.`,
          );
          if (!ok) return;
          await files.write(r, rel, p.template);
          // the project's template from now on: «Commit template» shows
          if (st.prompt) set({ prompt: { ...st.prompt, source: rel } });
        }
        await files.open(rel);
        deps.notify.toast(`${rel}: edit it and save — «View prompt» shows the new version`);
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
      }
    },
    /** RF-B04 (F4.4): the template's own commit — only that file, by the architect or the tech lead. */
    async commitTemplate(): Promise<string | null> {
      const r = root(), p = st.prompt, files = deps.templates;
      if (!r || !p || !files || !p.source || p.source === "builtin") return null;
      const lang = p.lang === "pt" ? "pt" : "en";
      const message = deps.dialog.prompt(`Commit only ${p.source}. Message:`, `docs(prompt): update the issue template (${lang})`);
      if (!message || !message.trim()) return null;
      try {
        const hash = await files.commit(r, p.source, message.trim());
        deps.notify.toast(`${p.source} committed (${hash})`);
        return hash;
      } catch (e: unknown) {
        deps.notify.toast(parseError(e).message);
        return null;
      }
    },
    loadReports,
    loadPlan,
    closePlan(): void {
      planSeq++;
      set({ sprintPlan: null });
    },
    /** Multi Co-Dev (the integration gate): records that the issue does what its criteria ask. The store
     *  decides who and when, and refuses without criteria; the command checks who may (the issue's
     *  responsible, or a Product Owner / Tech Lead). The note is optional; cancelling the dialog stops. */
    async approveFunctional(key: string): Promise<boolean> {
      const note = deps.dialog.prompt(copy("approveNote", { key }), "");
      if (note === null) return false;
      const ok = await apply({ op: "approve_functional", key, note: note.trim() || null });
      if (ok) deps.notify.toast(copy("approved", { key }));
      return ok;
    },
    /** Withdraws the functional approval, with a reason (recorded and audited). */
    async revokeFunctional(key: string): Promise<boolean> {
      const by = issue(key)?.functional?.by ?? "";
      const reason = deps.dialog.prompt(copy("revokeReason", { key, by }), "");
      if (!reason || !reason.trim()) return false;
      const ok = await apply({ op: "revoke_functional", key, reason: reason.trim() });
      if (ok) deps.notify.toast(copy("revoked", { key }));
      return ok;
    },
    /** How many Co-Devs work the sprint (1…8, `null` unsets it); the open plan is recomputed (as after any change). */
    async setCodevs(sprint: string, codevs: number | null | undefined): Promise<boolean> {
      if (codevs === undefined) {
        deps.notify.toast(copy("codevsRange", { max: MAX_CODEVS }));
        return false;
      }
      return apply({ op: "set_sprint_codevs", id: sprint, codevs });
    },
  };
}

export type ProjectService = ReturnType<typeof makeProjectService>;
