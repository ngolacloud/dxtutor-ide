// Gestor de missões — sessões Co-Dev reais (codev_session_list) + tarefas delegadas ao
// ciclo isolado do backend (agent_task_submit → agent_task_status → agent_task_cancel).
//
// Uma «missão» delega uma mudança a um worktree git ISOLADO de HEAD (RF-AG-01/05): o
// backend aplica os ficheiros lá e devolve o diff unificado, que o humano revê antes de
// qualquer coisa aterrar. A primeira fonte real de alterações é o scaffold do desenho do
// Studio — obtido por arch_scaffold_preview (não escreve nada) e injectado via hooks.
// A secção de sessões é SÓ LEITURA: lista os worktrees codev/* que o dock abriu — este
// painel observa, nunca cria nem apaga sessões.

import { api, type SessionInfo, type AgentTask } from "./tauri";
import { t } from "./i18n";

type MissionState = "running" | "done" | "error" | "cancelled";
export interface Mission {
  id: number; title: string; taskId: string | null; state: MissionState;
  files: number; patch: string; error: string;
}

export interface ManagerHooks {
  root(): string;
  /** O scaffold do desenho corrente do Studio, SEM tocar no disco (arch_scaffold_preview). */
  preview(): Promise<[string, string][]>;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

export class Manager {
  private sessions: SessionInfo[] = [];
  private sessErr = "";
  private missions: Mission[] = [];
  private seq = 0;

  constructor(private host: HTMLElement, private hooks: ManagerHooks) {}

  /** Relê as sessões Co-Dev reais do backend e repinta. Nunca lança — erro honesto no DOM. */
  async refresh(): Promise<SessionInfo[]> {
    const root = this.hooks.root();
    if (!root) {
      this.sessions = [];
      this.sessErr = t("mg.noFolder");
    } else {
      try { this.sessions = await api.codevSessionList(root); this.sessErr = ""; }
      catch (e) { this.sessions = []; this.sessErr = String(e); }
    }
    this.render();
    return [...this.sessions];
  }

  /** Slugs das sessões tal como listadas AGORA (para o arnês comparar com o backend). */
  listedSlugs(): string[] {
    return this.sessions.map((s) => s.slug);
  }

  /** As missões como listadas AGORA (só-leitura — o hub Co-Dev espelha, nunca duplica). */
  missionsView(): { title: string; state: string }[] {
    return this.missions.map((m) => ({ title: m.title, state: m.state }));
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  /** Delega o scaffold do Studio como missão isolada e espera o estado terminal.
   *  Devolve a missão (done com patch, ou error) — o arnês afirma sobre ela. */
  async delegate(): Promise<Mission> {
    const m: Mission = { id: ++this.seq, title: t("mg.scaffoldTitle", { n: "…" }), taskId: null, state: "running", files: 0, patch: "", error: "" };
    this.missions.unshift(m);
    this.render();
    const fail = (err: string): Mission => { m.state = "error"; m.error = err; this.render(); return m; };
    const root = this.hooks.root();
    if (!root) return fail(t("mg.noFolder"));
    let preview: [string, string][] = [];
    try { preview = await this.hooks.preview(); }
    catch (e) { return fail(String(e)); }
    if (!preview.length) return fail(t("mg.invalid"));
    m.files = preview.length;
    m.title = t("mg.scaffoldTitle", { n: preview.length });
    this.render();
    try { m.taskId = await api.agentTaskSubmit(root, preview); }
    catch (e) { return fail(String(e)); }
    // Recolha por polling (submit → status): o worktree isolado corre no backend.
    for (let tries = 0; tries < 100; tries++) {
      if (m.state !== "running") return m; // cancelada entretanto
      let task: AgentTask | null = null;
      try { task = await api.agentTaskStatus(m.taskId); }
      catch (e) { return fail(String(e)); }
      if (task && task.status !== "running") {
        m.state = task.status === "done" ? "done" : "error";
        m.patch = task.patch;
        m.error = task.error;
        this.render();
        return m;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return fail(t("mg.timeout"));
  }

  private cancel(id: number): void {
    const m = this.missions.find((x) => x.id === id);
    if (!m) return;
    if (m.taskId) void api.agentTaskCancel(m.taskId).catch(() => { /* já não existe */ });
    if (m.state === "running") m.state = "cancelled";
    this.render();
  }

  private forget(id: number): void {
    const i = this.missions.findIndex((x) => x.id === id);
    if (i >= 0) {
      const m = this.missions[i];
      if (m.taskId) void api.agentTaskCancel(m.taskId).catch(() => { /* já não existe */ });
      this.missions.splice(i, 1);
    }
    this.render();
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  private sessionsHtml(): string {
    if (this.sessErr) return `<div class="mg-err">${esc(this.sessErr)}</div>`;
    if (!this.sessions.length) return `<div class="mg-sub">${esc(t("mg.noSessions"))}</div>`;
    return this.sessions.map((s) =>
      `<div class="mg-sess" data-sess="${esc(s.slug)}"><b>${esc(s.slug)}</b>` +
      `<code>${esc(s.branch)}</code><span>→ ${esc(s.base)}</span>` +
      `<small title="${esc(s.worktree)}">${esc(s.worktree)}</small></div>`).join("");
  }

  private missionHtml(m: Mission): string {
    const label = t("mg.state." + m.state);
    const body = m.state === "done"
      ? (m.patch ? `<pre class="mg-patch">${esc(m.patch)}</pre>` : `<div class="mg-sub">${esc(t("mg.noChanges"))}</div>`)
      : m.state === "error" ? `<div class="mg-err">${esc(m.error)}</div>` : "";
    const action = m.state === "running"
      ? `<button class="mini" data-cancel="${m.id}">${esc(t("mg.cancel"))}</button>`
      : `<button class="mini" data-forget="${m.id}">${esc(t("mg.forget"))}</button>`;
    return `<div class="mg-card mg-${m.state}"><div class="mg-h"><span class="mg-dot"></span>` +
      `<b>${esc(m.title)}</b><span class="mg-state">${esc(label)}</span><span class="sp"></span>${action}</div>${body}</div>`;
  }

  private render(): void {
    this.host.innerHTML = `<div class="mg">
      <div class="mg-top"><h2>${esc(t("mg.title"))}</h2><div class="mg-sub">${esc(t("mg.sub"))}</div></div>
      <div class="mg-sec"><div class="mg-sech"><b>${esc(t("mg.sessions"))}</b>
        <button class="mini" data-refresh>${esc(t("mg.refresh"))}</button></div>
        <div class="mg-subnote">${esc(t("mg.sessionsSub"))}</div>
        <div class="mg-sesslist">${this.sessionsHtml()}</div></div>
      <div class="mg-sec"><div class="mg-sech"><b>${esc(t("mg.missions"))}</b>
        <button class="mini pri" data-delegate>${esc(t("mg.delegate"))}</button></div>
        <div class="mg-list">${this.missions.length ? this.missions.map((m) => this.missionHtml(m)).join("") : `<div class="mg-sub">${esc(t("mg.empty"))}</div>`}</div></div>
    </div>`;
    const q = (sel: string): HTMLElement | null => this.host.querySelector(sel);
    const rf = q("[data-refresh]");
    if (rf) rf.onclick = () => void this.refresh();
    const dg = q("[data-delegate]");
    if (dg) dg.onclick = () => void this.delegate();
    this.host.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => (b.onclick = () => this.cancel(Number(b.dataset.cancel))));
    this.host.querySelectorAll<HTMLElement>("[data-forget]").forEach((b) => (b.onclick = () => this.forget(Number(b.dataset.forget))));
  }
}
