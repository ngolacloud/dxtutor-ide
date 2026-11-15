// Percurso de aprendizagem (Tutor/Learning Track) sobre o backend REAL de estudo
// (crates tutor-*): o catálogo vem de list_courses, a árvore de unidades/passos de
// get_course, a execução dos drills de run_drill, a correcção dos challenges de
// submit_step, o guia de remediação de get_study_guide e as pistas de request_hint.
// Zero demo: nenhum curso embutido em JSON no cliente.
//
// Contrato de honestidade (skill pedagogy-authoring do repo):
//   • A correcção de um challenge é decidida pelos TESTES ocultos do backend
//     (tutor_eval::assess), nunca por um modelo nem por heurística do cliente.
//   • A verificação de um drill é transcrição transparente: comparação linha a
//     linha com o `target` — não julga, não simula.
//   • O gabarito só viaja quando os testes passam (o backend serializa
//     gabarito: null numa falha); esta vista mostra apenas o que chegou e nunca
//     o guarda no dispositivo.
//   • A tutora explica e dá pistas graduais (request_hint, offline-safe); NUNCA
//     escreve o código do aluno — a pista é só texto no painel de resultados.

import { api, type CourseSummary, type Course, type Unit, type Step, type Assessment, type Hint, type DrillRun, type StudyGuide } from "./tauri";
import { t } from "./i18n";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

// Markdown compacto (headings, blocos de código, listas, negrito/itálico, code inline) —
// portado de desktop/src/shell/learn.ts; o conteúdo vem do backend, isto só o apresenta.
function mdInline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
}
function md(src: string): string {
  const out: string[] = [];
  String(src || "").split(/```/).forEach((p, i) => {
    if (i % 2) { out.push(`<pre>${esc(p.replace(/^[a-z]*\n/, "").replace(/\n$/, ""))}</pre>`); return; }
    p.split(/\n{2,}/).forEach((raw) => {
      const b = raw.trim(); if (!b) return;
      if (/^#{1,4}\s/.test(b)) {
        const lines = b.split("\n");
        out.push(`<h3>${mdInline(lines[0].replace(/^#+\s*/, ""))}</h3>`);
        if (lines.length > 1) out.push(`<p>${mdInline(lines.slice(1).join(" "))}</p>`);
      } else if (/^\s*[-*]\s/.test(b)) {
        out.push("<ul>" + b.split(/\n(?=\s*[-*]\s)/).map((l) => `<li>${mdInline(l.replace(/^\s*[-*]\s+/, "").replace(/\n\s*/g, " "))}</li>`).join("") + "</ul>");
      } else {
        out.push(`<p>${mdInline(b.replace(/\n/g, " "))}</p>`);
      }
    });
  });
  return out.join("");
}

const BADGE: Record<string, string> = { concept: "ln.badge.concept", drill: "ln.badge.drill", challenge: "ln.badge.challenge" };

export class Learn {
  private courses: CourseSummary[] = [];
  private course: Course | null = null;
  private loadError = "";
  // Progresso da sessão, em memória: o gabarito e os veredictos são do backend e
  // por contrato não se persistem no dispositivo; o resto segue a mesma vida.
  private done = new Set<string>();
  private openUnits = new Set<string>();
  private code = new Map<string, string>();
  private hintLevel = new Map<string, number>();
  private hintLog = new Map<string, Hint[]>();
  private runs = new Map<string, DrillRun | { error: string } | "loading">();
  private submissions = new Map<string, Assessment | { error: string } | "loading">();
  private guides = new Map<string, StudyGuide | { error: string }>();
  private guideOpen: string | null = null;
  private cur: string | null = null;

  constructor(private host: HTMLElement) {}

  // ── Acessos para o arnês (só leitura) ──────────────────────────────────────
  currentStepId(): string | null { return this.cur; }
  studentCode(): string { return this.cur ? this.code.get(this.cur) ?? "" : ""; }

  /** Abrir/repintar a vista: sem curso escolhido mostra o catálogo real. */
  async refresh(): Promise<void> {
    if (!this.course && !this.courses.length) await this.loadCourses();
    else this.render();
  }

  applyLocale(): void {
    if (this.host.innerHTML) this.render();
  }

  /** Catálogo real: list_courses (cursos embutidos nos crates tutor-*). */
  async loadCourses(): Promise<CourseSummary[]> {
    try { this.courses = await api.listCourses(); this.loadError = ""; }
    catch (e) { this.courses = []; this.loadError = String(e); }
    this.render();
    return [...this.courses];
  }

  /** Abre a árvore real de um curso (get_course). */
  async openCourse(language: string): Promise<Course | null> {
    try { this.course = await api.getCourse(language); this.loadError = ""; }
    catch (e) { this.course = null; this.loadError = String(e); }
    this.cur = null;
    this.guideOpen = null;
    if (this.course && this.course.units.length) this.openUnits.add(this.course.units[0].id);
    this.render();
    return this.course;
  }

  /** Volta ao catálogo (o progresso da sessão mantém-se em memória). */
  private closeCourse(): void {
    this.course = null;
    this.cur = null;
    this.render();
  }

  private findStep(id: string): { unit: Unit; step: Step; index: number } | null {
    if (!this.course) return null;
    for (const unit of this.course.units) {
      const index = unit.steps.findIndex((s) => s.id === id);
      if (index >= 0) return { unit, step: unit.steps[index], index };
    }
    return null;
  }

  private currentStep(): Step | null {
    const f = this.cur ? this.findStep(this.cur) : null;
    return f ? f.step : null;
  }

  /** Abre um passo; um passo só abre se o anterior da mesma unidade estiver feito. */
  openStep(id: string): void {
    const f = this.findStep(id);
    if (!f) return;
    if (f.index > 0 && !this.done.has(f.unit.steps[f.index - 1].id)) { this.note(t("ln.unlockPrev")); return; }
    this.cur = id;
    this.openUnits.add(f.unit.id);
    this.guideOpen = null;
    if (!this.code.has(id)) this.code.set(id, f.step.kind === "challenge" ? f.step.starter.replace(/^\n/, "") : "");
    this.render();
  }

  // ── Drill: transcrição transparente, linha a linha contra o target do backend ──
  private drillLines(step: Step): string[] {
    return step.target.replace(/^\n/, "").replace(/\n+$/, "").split("\n");
  }
  private drillState(step: Step): { T: string[]; ok: boolean[]; n: number; all: boolean } {
    const T = this.drillLines(step);
    const typed = (this.code.get(step.id) ?? "").replace(/\s+$/, "").split("\n");
    const ok = T.map((l, i) => typed[i] !== undefined && typed[i].trimEnd() === l.trimEnd());
    return { T, ok, n: ok.filter(Boolean).length, all: ok.every(Boolean) && typed.length === T.length };
  }

  /** Corre o programa completo do drill no backend (run_drill) — execução, não julgamento. */
  private async runDrill(step: Step): Promise<void> {
    if (this.runs.has(step.id)) return;
    this.runs.set(step.id, "loading");
    this.renderResults();
    if (!this.course) return;
    try {
      const r = await api.runDrill(this.code.get(step.id) ?? "", this.course.language, step.dependencies);
      this.runs.set(step.id, r);
    } catch (e) { this.runs.set(step.id, { error: String(e) }); }
    this.renderResults();
  }

  /** Submete um challenge: a correcção vem dos testes ocultos do backend (submit_step). */
  private async submitChallenge(step: Step): Promise<void> {
    this.submissions.set(step.id, "loading");
    this.renderResults();
    try {
      const a = await api.submitStep(step.id, this.code.get(step.id) ?? "");
      this.submissions.set(step.id, a);
      if (a.correctness.passed && !this.done.has(step.id)) { this.done.add(step.id); this.render(); return; }
    } catch (e) { this.submissions.set(step.id, { error: String(e) }); }
    this.renderResults();
  }

  /** Pista gradual da tutora (request_hint, nível 1..3). Só texto — nunca toca no código. */
  async hint(): Promise<Hint> {
    const step = this.currentStep();
    if (!step) throw new Error(t("ln.openStep"));
    const level = Math.min(3, (this.hintLevel.get(step.id) ?? 0) + 1);
    this.hintLevel.set(step.id, level);
    const h = await api.requestHint(step.id, this.code.get(step.id) ?? "", level);
    const log = this.hintLog.get(step.id) ?? [];
    log.push(h);
    this.hintLog.set(step.id, log);
    this.renderResults();
    return h;
  }

  private hintUi(): void {
    void this.hint().catch((e) => {
      const step = this.currentStep();
      if (!step) return;
      const log = this.hintLog.get(step.id) ?? [];
      log.push({ text: String(e), provider: "error", level: this.hintLevel.get(step.id) ?? 1 });
      this.hintLog.set(step.id, log);
      this.renderResults();
    });
  }

  /** Guia de estudo real da unidade (get_study_guide) — erro honesto quando não existe. */
  private async openGuide(unitId: string): Promise<void> {
    if (!this.course) return;
    if (!this.guides.has(unitId)) {
      try { this.guides.set(unitId, await api.getStudyGuide(this.course.language, unitId)); }
      catch (e) { this.guides.set(unitId, { error: String(e) }); }
    }
    this.guideOpen = this.guideOpen === unitId ? null : unitId;
    this.render();
  }

  // ── Botão primário + avanço sequencial ─────────────────────────────────────
  private sequence(): Step[] {
    return this.course ? this.course.units.reduce<Step[]>((a, u) => a.concat(u.steps), []) : [];
  }

  private advance(step: Step): void {
    const seq = this.sequence();
    const i = seq.findIndex((s) => s.id === step.id);
    const next = i >= 0 ? seq[i + 1] : undefined;
    if (next) this.openStep(next.id);
    else { this.note(t("ln.trackComplete")); this.render(); }
  }

  private async onPrimary(): Promise<void> {
    const step = this.currentStep();
    if (!step) return;
    if (this.done.has(step.id)) { this.advance(step); return; }
    if (step.kind === "concept") { this.done.add(step.id); this.advance(step); return; }
    if (step.kind === "drill") {
      const d = this.drillState(step);
      if (d.all) { this.done.add(step.id); this.render(); }
      else this.note(t("ln.keepTyping", { n: d.n, total: d.T.length }));
      return;
    }
    await this.submitChallenge(step); // challenge: os testes decidem
  }

  private note(msg: string): void {
    const el = this.host.querySelector<HTMLElement>(".ln-note");
    if (el) el.textContent = msg;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  private render(): void {
    if (!this.course) { this.renderCatalog(); return; }
    const c = this.course;
    const seq = this.sequence();
    const total = seq.reduce((a, s) => a + s.points, 0);
    const earned = seq.reduce((a, s) => a + (this.done.has(s.id) ? s.points : 0), 0);
    let side = `<div class="ln-course"><b>${esc(c.title)}</b>` +
      `<button class="mini" data-back>${esc(t("ln.changeTrack"))}</button></div>` +
      `<div class="ln-tot"><span class="ln-bar"><i style="width:${total ? (earned / total) * 100 : 0}%"></i></span>` +
      `<span>${esc(t("ln.pts", { earned, total }))}</span></div>`;
    let lvl = "";
    for (const u of c.units) {
      const open = this.openUnits.has(u.id);
      const dn = u.steps.filter((s) => this.done.has(s.id)).length;
      if (u.level !== lvl) { side += `<div class="ln-lvl">${esc(t("level." + u.level))}</div>`; lvl = u.level; }
      side += `<div class="ln-unit${open ? " open" : ""}" data-unit="${esc(u.id)}">` +
        `<span class="chev">${open ? "▾" : "▸"}</span><span class="nm">${esc(u.title)}</span>` +
        `<button class="ln-guide" data-guide="${esc(u.id)}" title="${esc(t("ln.guideTitle"))}">📖</button>` +
        `<span class="cnt">${dn}/${u.steps.length}</span></div>`;
      if (open) {
        side += u.steps.map((s, i) => {
          const done = this.done.has(s.id);
          const lock = i > 0 && !this.done.has(u.steps[i - 1].id);
          const mark = done ? "✓" : lock ? "🔒" : "▶";
          return `<div class="ln-step${this.cur === s.id ? " cur" : ""}${lock ? " lock" : ""}" data-step="${esc(s.id)}">` +
            `<span class="st">${mark}</span><span class="nm">${esc(s.title)}</span>` +
            `<span class="tag k-${esc(s.kind)}">${esc(t(BADGE[s.kind] ?? "ln.badge.concept"))}</span><span class="pt">+${s.points}</span></div>`;
        }).join("");
      }
    }
    const step = this.currentStep();
    const main = step
      ? `<div class="ln-detail"><div class="ln-bar-top"><b>${esc(step.title)}</b><span class="ln-note"></span><span class="sp"></span>` +
        `<button class="mini pri" data-primary></button></div>` +
        (step.kind === "concept" ? "" :
          `<textarea class="ln-code" spellcheck="false">${esc(this.code.get(step.id) ?? "")}</textarea>`) +
        `<div class="ln-res"></div></div>`
      : `<div class="ln-empty">${esc(t("ln.openStep"))}</div>`;
    this.host.innerHTML = `<div class="ln"><div class="ln-side">${side}</div><div class="ln-main">${main}</div></div>`;
    this.wire();
    this.renderResults();
  }

  private renderCatalog(): void {
    const cards = this.courses.length
      ? `<div class="ln-cards">${this.courses.map((c) =>
          `<button class="ln-cc" data-course="${esc(c.language)}"><b>${esc(c.title)}</b>` +
          `<span class="tag">${esc(c.level)}</span><small>${esc(c.summary)}</small></button>`).join("")}</div>`
      : `<div class="ln-empty">${esc(this.loadError || t("ln.noCourses"))}</div>`;
    this.host.innerHTML = `<div class="ln-cat"><h2>${esc(t("ln.onbTitle"))}</h2>` +
      `<div class="ln-sub">${esc(t("ln.onbSub"))}</div>${cards}</div>`;
    this.host.querySelectorAll<HTMLElement>("[data-course]").forEach((b) => {
      b.onclick = () => void this.openCourse(b.dataset.course ?? "");
    });
  }

  private wire(): void {
    const q = <T extends HTMLElement>(sel: string): T | null => this.host.querySelector(sel) as T | null;
    const back = q<HTMLElement>("[data-back]");
    if (back) back.onclick = () => this.closeCourse();
    this.host.querySelectorAll<HTMLElement>(".ln-unit").forEach((row) => {
      row.onclick = () => {
        const id = row.dataset.unit ?? "";
        if (this.openUnits.has(id)) this.openUnits.delete(id); else this.openUnits.add(id);
        this.render();
      };
    });
    this.host.querySelectorAll<HTMLElement>("[data-guide]").forEach((b) => {
      b.onclick = (e) => { e.stopPropagation(); void this.openGuide(b.dataset.guide ?? ""); };
    });
    this.host.querySelectorAll<HTMLElement>(".ln-step").forEach((row) => {
      row.onclick = () => this.openStep(row.dataset.step ?? "");
    });
    const prim = q<HTMLElement>("[data-primary]");
    if (prim) prim.onclick = () => void this.onPrimary();
    const code = q<HTMLTextAreaElement>(".ln-code");
    if (code) {
      code.oninput = () => {
        const step = this.currentStep();
        if (!step) return;
        this.code.set(step.id, code.value);
        if (step.kind === "drill" && !this.done.has(step.id) && this.drillState(step).all) {
          this.done.add(step.id);
          this.render(); // o drill ficou completo — repinta árvore e resultados
          return;
        }
        this.renderResults();
      };
    }
  }

  /** (Re)pinta só o painel de resultados — o textarea do aluno nunca é reconstruído a escrever. */
  private renderResults(): void {
    const el = this.host.querySelector<HTMLElement>(".ln-res");
    const go = this.host.querySelector<HTMLElement>("[data-primary]");
    const step = this.currentStep();
    if (!el || !step) return;
    const done = this.done.has(step.id);
    let label = t("ln.continue");
    let h = `<div class="ln-kind"><span>${esc(t("ln." + step.kind))}</span><b>${done ? "✓ " : ""}+${step.points} ${esc(t("ln.ptsShort"))}</b></div>`;
    if (step.intro.trim()) h += `<div class="ln-card ln-hood">${md(step.intro)}</div>`;

    if (step.kind === "concept") {
      h += `<div class="ln-card">${md(step.body)}</div>`;
    } else if (step.kind === "drill") {
      const d = this.drillState(step);
      h += `<div class="ln-card">${md(step.prompt)}` +
        `<div class="ln-prog"><span class="ln-bar"><i style="width:${d.T.length ? (d.n / d.T.length) * 100 : 0}%"></i></span>` +
        `<span>${esc(t("ln.lines", { n: d.n, total: d.T.length }))}</span></div>` +
        `<div class="ln-target">${d.T.map((l, i) => {
          const cur = !d.ok[i] && d.ok.slice(0, i).every(Boolean);
          const cls = d.ok[i] ? " ok" : cur ? " cur" : "";
          const cm = (d.ok[i] || cur) && step.lineComments[i] ? `<small>${mdInline(step.lineComments[i])}</small>` : "";
          return `<div class="tl${cls}"><span class="n">${d.ok[i] ? "✓" : i + 1}</span><div><code>${esc(l) || "&nbsp;"}</code>${cm}</div></div>`;
        }).join("")}</div></div>`;
      if (done) {
        if (step.explanation.trim()) h += `<div class="ln-card ok">${md(step.explanation)}</div>`;
        h += this.drillOutputCard(step);
      }
      label = done ? t("ln.continue") : t("ln.check");
    } else { // challenge
      h += `<div class="ln-card">${md(step.instructions)}</div>`;
      h += this.challengeResultCard(step, done);
      label = done ? t("ln.continue") : t("ln.submit");
    }

    // Guia de estudo da unidade corrente, quando aberto (conteúdo real do backend).
    const f = this.cur ? this.findStep(this.cur) : null;
    if (f && this.guideOpen === f.unit.id) {
      const g = this.guides.get(f.unit.id);
      if (g && "error" in g) h += `<div class="ln-card bad"><h3>${esc(t("ln.guideTitle"))}</h3><pre>${esc(g.error)}</pre></div>`;
      else if (g) h += `<div class="ln-card ln-guidecard"><h3>${esc(g.title)}</h3>${md(g.body)}</div>`;
    }

    // Ajuda da tutora + pistas já pedidas (texto apenas; nunca toca no código do aluno).
    h += `<div class="ln-help"><button class="mini" data-ask>${esc(t("ln.ask"))}</button><span>${esc(t("ln.askNote"))}</span></div>`;
    const hints = this.hintLog.get(step.id) ?? [];
    h += `<div class="ln-hints">${hints.map((hint) =>
      `<div class="ln-hint"><b>${esc(t("ln.hint", { n: hint.level }))}</b> ${mdInline(hint.text)}</div>`).join("")}</div>`;

    const top = el.scrollTop;
    el.innerHTML = h;
    el.scrollTop = top;
    if (go) go.textContent = label;
    const ask = el.querySelector<HTMLElement>("[data-ask]");
    if (ask) ask.onclick = () => this.hintUi();

    // Dispara a execução real do drill uma vez, quando ficou completo.
    if (step.kind === "drill" && done && !this.runs.has(step.id)) void this.runDrill(step);
  }

  private drillOutputCard(step: Step): string {
    const r = this.runs.get(step.id);
    if (r === undefined) return "";
    if (r === "loading") return `<div class="ln-card"><h3>${esc(t("ln.output"))}</h3><p>${esc(t("ln.runningDrill"))}</p></div>`;
    if ("error" in r) return `<div class="ln-card bad"><h3>${esc(t("ln.output"))}</h3><pre>${esc(r.error)}</pre></div>`;
    const outBody = r.stdout.trim() ? `<pre>${esc(r.stdout)}</pre>` : `<p>${esc(t("ln.noOutput"))}</p>`;
    const errBody = r.stderr.trim() ? `<pre>${esc(r.stderr)}</pre>` : "";
    return `<div class="ln-card${r.ok ? "" : " bad"}"><h3>${esc(t("ln.output"))}</h3>${outBody}${errBody}</div>`;
  }

  private challengeResultCard(step: Step, done: boolean): string {
    const a = this.submissions.get(step.id);
    if (a === "loading") return `<div class="ln-card"><h3>${esc(t("ln.running"))}</h3></div>`;
    if (a && "error" in a) return `<div class="ln-card bad"><h3>${esc(t("ln.notYet"))}</h3><pre>${esc(a.error)}</pre></div>`;
    if (a) {
      const c = a.correctness;
      let out = `<div class="ln-card ${c.passed ? "ok" : "bad"}"><h3>${c.passed ? esc(t("ln.passed")) : esc(t("ln.notYet"))}</h3>` +
        `<div>${esc(c.summary)}</div>${c.raw.trim() ? `<pre>${esc(c.raw)}</pre>` : ""}`;
      if (a.complexity) out += `<div class="ln-cx"><span>${esc(t("ln.measured"))} <b>${esc(a.complexity.bigO)}</b></span><span>${esc(a.complexity.confidence)}</span></div>`;
      out += `</div>`;
      // O gabarito só vem do backend quando os testes passam — mostramos apenas o que chegou.
      if (a.gabarito) {
        const g = a.gabarito;
        out += `<div class="ln-card"><h3>${esc(t("ln.refSolution"))}</h3>` +
          `<div class="ln-cx"><span>${esc(t("ln.time"))} <b>${esc(g.time)}</b></span><span>${esc(t("ln.space"))} <b>${esc(g.space)}</b></span></div>` +
          `<pre>${esc(g.solution.replace(/\n$/, ""))}</pre>${md(g.justification)}</div>`;
      }
      return out;
    }
    if (done) return `<div class="ln-card ok"><h3>${esc(t("ln.passed"))}</h3></div>`;
    return "";
  }
}
