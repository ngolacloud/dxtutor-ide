// Quadro (Board) — kanban de USER STORIES sobre o backend SQLite real (crate tutor-board,
// comandos board_load/board_save). Zero demo: o quadro NASCE VAZIO — tudo o que aparece veio
// de uma acção real (criar story, gerar backlog no Studio). A persistência é durável: cada
// alteração grava via board_save (substituição atómica por raiz de workspace) e reabrir o
// workspace relê exactamente o mesmo backlog via board_load.
//
// Honestidade das colunas: entrar em «Teste automático» corre run_all_tests DE VERDADE e o
// veredicto vem do runner (passa → validação funcional; falha → volta a desenvolvimento);
// «Concluído» só se alcança depois da validação funcional humana. Nada é simulado.

import { api, type Backlog, type Story, type Sprint, type TestRun } from "./tauri";
import { t } from "./i18n";

type Stage = "backlog" | "todo" | "dev" | "test" | "func" | "done";
const STAGES: Stage[] = ["backlog", "todo", "dev", "test", "func", "done"];

/** Uma story tal como o Studio a deriva do desenho (sem id/stage — o Board atribui-os). */
export interface GenStory { role: string; want: string; soThat: string; acceptance: string[]; points: number }
export interface GenBacklog { problem: string; stories: GenStory[] }

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Prompt-template de execução derivado da narrativa (context engineering, client-side). */
function execPrompt(role: string, want: string, soThat: string, ac: string[]): string {
  return `## ${t("board.pt.ctx")}\n${t("board.pt.ctxBody")}\n\n` +
    `## ${t("board.pt.task")}\n${t("board.asA", { role })} ${t("board.pt.want", { want })}` +
    (soThat ? ` ${t("board.soThat", { benefit: soThat })}` : "") + `\n\n` +
    `## ${t("board.acceptance")}\n${ac.length ? ac.map((a) => `- ${a}`).join("\n") : `- ${t("board.noAc")}`}\n\n` +
    `## ${t("board.pt.deliver")}\n${t("board.pt.deliverBody")}`;
}

export class Board {
  private state: Backlog = { problem: "", seq: 1, sprints: [], stories: [] };
  private loaded = false;
  private loading: Promise<void> | null = null; // single-flight: um só board_load em voo
  private view = -1; // filtro de sprint só-cliente (-1 = tudo); não persiste no backend
  private runs = new Map<string, TestRun>(); // último veredicto REAL por story (só-cliente)

  constructor(
    private host: HTMLElement,
    private root: () => string | null,
    private onTestRun: (title: string, run: TestRun) => void,
  ) {}

  storyCount(): number { return this.state.stories.length; }
  stories(): Story[] { return [...this.state.stories]; }

  /** Abrir/repintar a vista: lê o backend uma vez por raiz e renderiza. */
  async refresh(): Promise<void> {
    await this.ensureLoaded();
    this.render();
  }

  /** Reler do backend (ex.: raiz mudou) — o que se vê é o que está no SQLite. */
  async reload(): Promise<void> {
    if (this.loading) await this.loading; // nunca deixar um load atrasado clobberar o novo
    this.loaded = false;
    await this.refresh();
  }

  /** Garante UM load (chamadas concorrentes partilham a mesma promessa — um load atrasado
   * nunca substitui estado que entretanto já recebeu acções reais do utilizador). */
  private ensureLoaded(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    if (!this.loading) this.loading = this.load().finally(() => { this.loading = null; });
    return this.loading;
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  private async load(): Promise<void> {
    try {
      const wire = await api.boardLoad(this.root());
      if (wire && Array.isArray(wire.stories)) this.state = wire;
      else this.state = { problem: "", seq: 1, sprints: [], stories: [] };
    } catch (e) {
      console.warn("board_load falhou:", e);
      this.state = { problem: "", seq: 1, sprints: [], stories: [] };
    }
    this.normalize();
    this.loaded = true;
  }

  /** ≥2 sprints estruturais (índices coerentes) para a barra de filtros — sem conteúdo. */
  private normalize(): void {
    while (this.state.sprints.length < 2) this.state.sprints.push({ index: this.state.sprints.length, goal: "" } as Sprint);
    this.state.sprints.forEach((s, i) => (s.index = i));
  }

  /** Grava já (board_save é atómico e idempotente). Sem backend, falha visível na consola. */
  private async save(): Promise<void> {
    try {
      await api.boardSave(this.root(), this.state);
    } catch (e) {
      console.warn("board_save falhou:", e);
    }
  }

  /** Cria uma user story real e persiste-a. Devolve a story criada (para o harness afirmar). */
  async addStory(want: string, role: string, soThat: string, kind: "feature" | "fix" = "feature"): Promise<Story> {
    await this.ensureLoaded();
    const st: Story = {
      id: `DX-${this.state.seq++}`,
      sprint: this.view < 0 ? 0 : this.view,
      role, want, soThat,
      acceptance: [], points: 2, stage: "todo", kind,
      prompt: execPrompt(role, want, soThat, []),
      note: "", branch: null,
    };
    this.state.stories.push(st);
    await this.save();
    this.render();
    return st;
  }

  /** Ingere um backlog derivado (Studio «gerar backlog»): APPEND de stories reais + persiste.
   *  Devolve quantas entraram. Nunca substitui o que o utilizador já tinha. */
  async ingest(g: GenBacklog): Promise<number> {
    await this.ensureLoaded();
    if (!this.state.problem && g.problem) this.state.problem = g.problem;
    for (const s of g.stories) {
      this.state.stories.push({
        id: `DX-${this.state.seq++}`,
        sprint: 0,
        role: s.role, want: s.want, soThat: s.soThat,
        acceptance: s.acceptance, points: s.points, stage: "backlog", kind: "feature",
        prompt: execPrompt(s.role, s.want, s.soThat, s.acceptance),
        note: "", branch: null,
      });
    }
    await this.save();
    this.render();
    return g.stories.length;
  }

  // ── movimentação honesta entre colunas ──────────────────────────────────────
  private byId(id: string): Story | undefined {
    return this.state.stories.find((s) => s.id === id);
  }

  private drop(id: string, stage: Stage): void {
    const it = this.byId(id);
    if (!it || it.stage === stage) return;
    if (stage === "done") {
      if (it.stage !== "func") { this.note(t("board.onlyAfterFunc")); return; }
      this.approve(id);
      return;
    }
    if (stage === "test" || stage === "func") {
      if (stage === "func") this.note(t("board.testsFirst"));
      void this.moveToTest(it);
      return;
    }
    it.stage = stage;
    void this.save();
    this.render();
  }

  /** «Teste automático» é REAL: run_all_tests decide para onde a story vai a seguir. */
  private async moveToTest(it: Story): Promise<void> {
    const root = this.root();
    it.stage = "test"; it.note = t("board.running"); this.runs.delete(it.id);
    void this.save(); this.render();
    if (!root) {
      it.note = t("board.noFolderTest"); it.stage = "dev";
      void this.save(); this.render();
      return;
    }
    let run: TestRun;
    try {
      run = await api.runAllTests(root);
    } catch (e) {
      run = { ran: false, passed: false, output: String(e) };
    }
    this.runs.set(it.id, run);
    const ok = run.ran && run.passed;
    it.note = ok ? "" : run.ran ? t("board.testFailed") : t("board.testDidNotRunNote");
    it.stage = ok ? "func" : "dev";
    void this.save(); this.render();
    this.onTestRun(it.id, run);
  }

  private approve(id: string): void {
    const it = this.byId(id);
    if (!it || it.stage !== "func") return;
    it.note = ""; it.stage = "done";
    void this.save(); this.render();
  }

  private reject(id: string): void {
    const it = this.byId(id);
    if (!it) return;
    const why = window.prompt(t("board.rejectPrompt"), "");
    if (why === null) return;
    it.note = t("board.rejectedNote") + (why.trim() ? ": " + why.trim() : "");
    this.runs.delete(it.id);
    it.stage = "dev";
    void this.save(); this.render();
  }

  /** ▶ Executar sprint: move backlog→todo e corre a suite REAL para as stories pendentes. */
  private async runSprint(s: number): Promise<void> {
    for (const it of this.state.stories) if (it.sprint === s && it.stage === "backlog") it.stage = "todo";
    void this.save(); this.render();
    const pending = this.state.stories.filter((i) => i.sprint === s && (i.stage === "todo" || i.stage === "dev"));
    if (!pending.length) { this.note(t("board.sprintEmpty", { s: s + 1 })); return; }
    const root = this.root();
    if (!root) { this.note(t("board.noFolder")); return; }
    for (const it of pending) { it.stage = "test"; it.note = t("board.running"); this.runs.delete(it.id); }
    void this.save(); this.render();
    let run: TestRun;
    try { run = await api.runAllTests(root); }
    catch (e) { run = { ran: false, passed: false, output: String(e) }; }
    const ok = run.ran && run.passed;
    for (const it of pending) {
      this.runs.set(it.id, run);
      it.note = ok ? "" : run.ran ? t("board.testFailed") : t("board.testDidNotRunNote");
      it.stage = ok ? "func" : "dev";
    }
    void this.save(); this.render();
    this.onTestRun(t("board.sprintOut", { s: s + 1 }), run);
  }

  private newStoryUi(): void {
    const want = (window.prompt(t("board.newWant"), "") || "").trim();
    if (!want) return;
    const fx = /^fix:/i.test(want);
    const role = (window.prompt(t("board.newRole"), t("board.defaultRole")) || t("board.defaultRole")).trim();
    const soThat = (window.prompt(t("board.newSoThat"), "") || "").trim();
    void this.addStory(want.replace(/^fix:\s*/i, ""), role, soThat, fx ? "fix" : "feature");
  }

  private note(msg: string): void {
    const el = this.host.querySelector<HTMLElement>(".kb-note");
    if (el) el.textContent = msg;
  }

  // ── render ──────────────────────────────────────────────────────────────────
  private cardHtml(it: Story): string {
    const run = this.runs.get(it.id);
    const verdict = run
      ? `<span class="${run.ran && run.passed ? "kc-ok" : "kc-bad"}">${run.ran && run.passed ? "✓ " + esc(t("board.testsPass")) : run.ran ? "✖ " + esc(t("board.testsFail")) : "• " + esc(t("board.testsDidNotRun"))}</span>`
      : "";
    const notes = verdict || it.note ? `<div class="kc-n">${verdict}${it.note ? `<span>${esc(it.note)}</span>` : ""}</div>` : "";
    const story = `<div class="kc-story">${esc(t("board.asA", { role: it.role }))}` +
      (it.soThat ? ` ${esc(t("board.soThat", { benefit: it.soThat }))}` : "") + `</div>`;
    const ac = it.acceptance.length
      ? `<div class="kc-ac"><b>${esc(t("board.acceptance"))} (${it.acceptance.length})</b><ul>${it.acceptance.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`
      : `<div class="kc-ac kc-sub">${esc(t("board.noAc"))}</div>`;
    const detail = `<div class="kc-detail" data-detail="${esc(it.id)}">${ac}` +
      `<div class="kc-prompt"><b>${esc(t("board.promptTitle"))}</b><pre>${esc(it.prompt)}</pre></div></div>`;
    let actions = "";
    if (it.stage === "func") {
      actions = `<button class="mini pri" data-approve="${esc(it.id)}">${esc(t("board.validate"))}</button>` +
        `<button class="mini" data-reject="${esc(it.id)}">${esc(t("board.reject"))}</button>`;
    }
    const btns = `<div class="kc-a"><button class="mini" data-prompt="${esc(it.id)}">${esc(t("board.viewPrompt"))}</button>${actions}</div>`;
    return `<div class="kc" draggable="true" data-id="${esc(it.id)}">` +
      `<div class="kc-h"><span class="kc-id">${esc(it.id)}</span><span class="kc-tag${it.kind === "fix" ? " bad" : ""}">${esc(it.kind)}</span>` +
      `<span class="kc-p">${it.points}</span><span class="kc-tag kc-right">S${it.sprint + 1}</span></div>` +
      `<div class="kc-t">${esc(it.want)}</div>` + story + notes + detail + btns + `</div>`;
  }

  private render(): void {
    const v = this.view;
    const list = this.state.stories.filter((i) => v < 0 || i.sprint === v);
    const pts = list.reduce((a, i) => a + i.points, 0);
    const done = list.filter((i) => i.stage === "done").reduce((a, i) => a + i.points, 0);
    const filters = [-1, 0, 1].map((s) =>
      `<button class="mini${v === s ? " pri" : ""}" data-sprint="${s}">${esc(s < 0 ? t("board.all") : t("board.sprintN", { n: s + 1 }))}</button>`).join("");
    const goal = v >= 0 && this.state.sprints[v]?.goal
      ? `<span class="kb-goal">${esc(t("board.goal"))}: ${esc(this.state.sprints[v].goal)}</span>` : "";
    const bar = `<div class="kb-bar"><b>${esc(t("board.title"))}</b>${filters}${goal}` +
      `<span class="kb-prog"><i style="width:${pts ? (done / pts) * 100 : 0}%"></i></span>` +
      `<span class="kb-pts">${done}/${pts} pts</span>` +
      `<span class="kb-note"></span><span class="kb-sp"></span>` +
      `<button class="mini" data-new>${esc(t("board.newStory"))}</button>` +
      `<button class="mini pri" data-run>${esc(t("board.runSprint"))}</button></div>`;
    let body: string;
    if (!this.state.stories.length) {
      // Nasce vazio — zero demo: só acções reais criam conteúdo.
      body = `<div class="kb-empty"><div><b>${esc(t("board.emptyTitle"))}</b><br>${esc(t("board.empty"))}</div></div>`;
    } else {
      body = `<div class="kb-cols">${STAGES.map((k) => {
        const xs = list.filter((i) => i.stage === k);
        const desc = k === "test" ? `<div class="kcol-d">${esc(t("board.testDesc"))}</div>`
          : k === "func" ? `<div class="kcol-d">${esc(t("board.funcDesc"))}</div>` : "";
        return `<div class="kcol" data-stage="${k}"><div class="kcol-h">${esc(t("board." + k))}<span class="kcol-cnt">${xs.length}</span></div>${desc}${xs.map((i) => this.cardHtml(i)).join("")}</div>`;
      }).join("")}</div>`;
    }
    this.host.innerHTML = `<div class="kb">${bar}${body}</div>`;
    this.wire();
  }

  private wire(): void {
    const host = this.host;
    host.querySelectorAll<HTMLElement>("[data-sprint]").forEach((b) =>
      (b.onclick = () => { this.view = Number(b.dataset.sprint); this.render(); }));
    const nw = host.querySelector<HTMLElement>("[data-new]");
    if (nw) nw.onclick = () => this.newStoryUi();
    const run = host.querySelector<HTMLElement>("[data-run]");
    if (run) run.onclick = () => void this.runSprint(this.view < 0 ? 0 : this.view);
    host.querySelectorAll<HTMLElement>(".kc").forEach((c) => {
      c.addEventListener("dragstart", (e) => {
        (e as DragEvent).dataTransfer?.setData("text/plain", c.dataset.id || "");
      });
    });
    host.querySelectorAll<HTMLElement>(".kcol").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", () => col.classList.remove("over"));
      col.addEventListener("drop", (e) => {
        e.preventDefault(); col.classList.remove("over");
        const id = (e as DragEvent).dataTransfer?.getData("text/plain");
        if (id) this.drop(id, col.dataset.stage as Stage);
      });
    });
    host.querySelectorAll<HTMLElement>("[data-approve]").forEach((b) => (b.onclick = () => this.approve(b.dataset.approve || "")));
    host.querySelectorAll<HTMLElement>("[data-reject]").forEach((b) => (b.onclick = () => this.reject(b.dataset.reject || "")));
    host.querySelectorAll<HTMLElement>("[data-prompt]").forEach((b) => (b.onclick = () => {
      host.querySelector<HTMLElement>(`[data-detail="${b.dataset.prompt}"]`)?.classList.toggle("open");
    }));
  }
}
