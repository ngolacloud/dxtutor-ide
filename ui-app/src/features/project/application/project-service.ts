/* ═════════ feature `project` — use case: the Project views and their operations ═════════
   Keeps what the views draw (the project, the view, the selected issue and its history,
   the reports, the filters) and turns every human action into one atomic operation on the
   store. When the store refuses a move because of a rule (WIP, DoR, DoD, a skipped step, a
   block) the human may override it with a reason, which the store records. Nothing is
   kept locally: the store is the source of truth, and each operation returns the project
   after it. No DOM, no window: everything through the ports. */

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
  };
}
import { branchName, viewsFor, type Filters, type QuickFilter, type Swim, type View } from "../domain/board";
import {
  parseDetail,
  parseError,
  parseProject,
  parseReports,
  type Issue,
  type IssueDetail,
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
}

export function makeProjectService(deps: ProjectDeps) {
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
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ProjectState>): void => {
    st = { ...st, ...patch };
    listeners.forEach((f) => f());
  };
  const root = (): string | null => deps.workspace.root();

  async function open(): Promise<void> {
    const r = root();
    if (!deps.gateway.available() || !r) {
      set({ status: "unavailable", project: null });
      return;
    }
    set({ status: "loading", error: null, filters: { ...st.filters, me: deps.workspace.me() } });
    try {
      const p = parseProject(await deps.gateway.load(r));
      if (!p) throw new Error("resposta inválida do store do projecto");
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
      if (st.view === "reports") void loadReports();
      return true;
    } catch (e: unknown) {
      const err: ProjectError = parseError(e);
      if (err.overridable && op.op === "move" && !op.reason) {
        const reason = deps.dialog.prompt(`${err.message}\n\nPara avançar mesmo assim, escreve o motivo (fica registado na actividade da issue):`);
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
      set({ selected: key, detail: null });
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
        deps.notify.toast("Esta pasta não é um repositório git");
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
        deps.notify.toast("O Co-Dev com agente precisa da app desktop, de uma pasta aberta e de um provedor com agente");
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
    loadReports,
  };
}

export type ProjectService = ReturnType<typeof makeProjectService>;
