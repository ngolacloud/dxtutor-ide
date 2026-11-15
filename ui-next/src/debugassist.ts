// Debug Assistant (F14): a 5.ª tab do painel inferior, pedagógica e SÓ sobre dados medidos —
// o diagnóstico vivo da sessão LSP do ficheiro activo, a última corrida de testes e a sessão
// gdb quando parada. ANALYSING faz UM turno llm_chat governado (origin tutor-llm, mode
// project) por ACÇÃO explícita do utilizador; sem provedor mostra o texto do próprio
// compilador com rótulo honesto. Nada é enlatado: sem diagnóstico, o estado vazio diz isso.

import { listen, type LspDiagnostic, type TestRun, type TestItem, type DebugFrame, type DebugVar } from "./tauri";
import { t } from "./i18n";

// O evento lsp://diagnostics reencaminha os params crus do publishDiagnostics — além dos
// campos que o editor pinta, lemos aqui o relatedInformation (os notes do compilador).
interface WireDiag extends LspDiagnostic {
  relatedInformation?: { location: { uri: string }; message: string }[];
}

export interface DbgAssistHooks {
  root(): string;
  activeTab(): string | null;
  readBuffer(rel: string): string | undefined;
  /** Markers Monaco do ficheiro — a verdade do que o editor pinta (squiggles reais). */
  markers(rel: string): { line: number; col: number; message: string; error: boolean }[];
  lastTest(): { title: string; run: TestRun; item: TestItem | null } | null;
  rerunTest(item: TestItem | null): Promise<TestRun>;
  debugSnapshot(): { running: boolean; frames: DebugFrame[]; vars: DebugVar[] };
  hasProvider(): boolean;
  /** UM turno governado (llm_chat, mode project) — lança sem provedor. */
  analyze(prompt: string): Promise<{ text: string; origin: string }>;
  /** Arma um breakpoint real (glyph margin) e abre a vista Debug. */
  armBreakpoint(rel: string, line: number): void;
}

interface ActiveDiag { rel: string; line: number; message: string; related: string[] }

export class DebugAssist {
  // Diagnósticos completos por ficheiro, tal-e-qual chegaram do servidor LSP.
  private diags = new Map<string, WireDiag[]>();
  // Identidade de revisão (skill editor-code-intelligence): a análise guarda o rel e o
  // conteúdo do buffer no instante do turno; se o buffer entretanto mudou, o resultado é
  // descartado com nota honesta — nunca pinta sobre código que já não é o analisado.
  private analysis: { rel: string; contentAtAnalysis: string; text: string; origin: string } | null = null;
  private analysisNote = "";
  private busy = false;

  constructor(private host: HTMLElement, private hooks: DbgAssistHooks) {
    void listen("lsp://diagnostics", (p) => {
      const ev = p as { uri: string; diagnostics: WireDiag[] };
      const root = this.hooks.root();
      const path = decodeURIComponent(String(ev.uri).replace(/^file:\/\//, ""));
      const rel = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
      this.diags.set(rel, ev.diagnostics ?? []);
      if (!this.host.classList.contains("hidden")) this.render();
    });
    this.render();
  }

  /** Recalcula as secções das fontes vivas (chamado ao activar a tab). Nunca corre o LLM. */
  refresh(): void {
    this.render();
  }

  applyLocale(): void {
    this.render();
  }

  /** O 1.º diagnóstico de ERRO do ficheiro activo: a linha/mensagem vêm do marker Monaco (a
   *  verdade pintada no editor); os notes vêm do diagnostic cru correspondente. */
  private activeError(): ActiveDiag | null {
    const rel = this.hooks.activeTab();
    if (!rel) return null;
    const mk = this.hooks.markers(rel).find((m) => m.error);
    if (!mk) return null;
    const wire = (this.diags.get(rel) ?? []).find(
      (d) => (d.severity ?? 1) === 1 && d.range.start.line + 1 === mk.line && d.message === mk.message,
    );
    const related = (wire?.relatedInformation ?? []).map((r) => r.message);
    return { rel, line: mk.line, message: mk.message, related };
  }

  /** Hipóteses derivadas SÓ do diagnóstico: as linhas-nota além da 1.ª quando existem;
   *  num diagnóstico de uma linha (estilo rust-analyzer nativo, «expected i32, found
   *  &'static str») as cláusulas verbatim são os notes — nunca prosa nossa. Junta-se o
   *  relatedInformation tal-e-qual. Sem nada disto, a lista fica vazia (estado honesto). */
  private hypsFromDiag(d: ActiveDiag): string[] {
    const notes = d.message.split("\n").slice(1).map((l) => l.trim()).filter(Boolean);
    if (!notes.length) {
      const clauses = d.message.split(", ").map((c) => c.trim()).filter(Boolean);
      if (clauses.length > 1) notes.push(...clauses);
    }
    return [...notes, ...d.related];
  }

  /** Hipóteses da sessão gdb parada: frames e locals REAIS do stop corrente. */
  private hypsFromGdb(): string[] {
    const snap = this.hooks.debugSnapshot();
    if (!snap.running || !snap.frames.length) return [];
    const frames = snap.frames.slice(0, 3).map((f) => `#${f.level} ${f.func} (${f.file.split("/").pop()}:${f.line})`);
    const vars = snap.vars.slice(0, 6).map((v) => `${v.name} = ${v.value}`);
    return [...frames, ...vars];
  }

  /** A análise só se mostra se o buffer ainda é o analisado (identidade de revisão). */
  private freshAnalysis(rel: string | null): { text: string; origin: string } | null {
    if (!this.analysis || this.analysis.rel !== rel) return null;
    if (this.hooks.readBuffer(this.analysis.rel) !== this.analysis.contentAtAnalysis) {
      this.analysis = null;
      this.analysisNote = t("dbga.drift");
      return null;
    }
    return { text: this.analysis.text, origin: this.analysis.origin };
  }

  /** UM turno governado sobre o diagnóstico + excerto real do buffer — só por acção. */
  private async analyze(d: ActiveDiag): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.analysisNote = t("dbga.busy", { file: d.rel });
    this.render();
    const content = this.hooks.readBuffer(d.rel) ?? "";
    const lines = content.split("\n");
    const lo = Math.max(0, d.line - 1 - 20);
    const excerpt = lines.slice(lo, d.line + 20).map((l, i) => `${lo + i + 1}: ${l}`).join("\n");
    const related = d.related.length ? `\nRelated notes:\n${d.related.join("\n")}` : "";
    const prompt =
      `A developer hit this REAL compiler diagnostic in ${d.rel} at line ${d.line}.\n` +
      `Diagnostic (verbatim):\n${d.message}${related}\n\nCode excerpt:\n\`\`\`\n${excerpt}\n\`\`\`\n` +
      `Explain pedagogically WHY this error happens before HOW to fix it. Be concise.`;
    try {
      const r = await this.hooks.analyze(prompt);
      this.analysis = { rel: d.rel, contentAtAnalysis: content, text: r.text, origin: r.origin };
      this.analysisNote = "";
    } catch (e) {
      this.analysis = null;
      this.analysisNote = String(e);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /** Estado observável para o arnês — separa hipóteses por fonte; nunca inventa campos. */
  state(): {
    file: string | null; line: number | null; message: string; related: string[];
    hypsDiag: string[]; hypsGdb: string[];
    analysis: { origin: string; len: number } | null; note: string;
  } {
    const d = this.activeError();
    const fresh = this.freshAnalysis(d?.rel ?? null);
    return {
      file: d?.rel ?? null,
      line: d?.line ?? null,
      message: d?.message ?? "",
      related: d?.related ?? [],
      hypsDiag: d ? this.hypsFromDiag(d) : [],
      hypsGdb: this.hypsFromGdb(),
      analysis: fresh ? { origin: fresh.origin, len: fresh.text.length } : null,
      note: this.analysisNote,
    };
  }

  private render(): void {
    const d = this.activeError();
    const hypsDiag = d ? this.hypsFromDiag(d) : [];
    const hypsGdb = this.hypsFromGdb();
    const last = this.hooks.lastTest();
    const failedTest = last && last.run.ran && !last.run.passed ? last : null;
    const fresh = this.freshAnalysis(d?.rel ?? null);
    const hasProv = this.hooks.hasProvider();
    const nHyps = hypsDiag.length + hypsGdb.length;
    this.host.innerHTML =
      `<div class="dba">` +
      `<div class="dba-head"></div>` +
      `<div class="dba-sec dba-sec-an"></div><div class="dba-an"></div>` +
      `<div class="dba-sec dba-sec-hy"></div><div class="dba-hy"></div>` +
      `<div class="dba-sec dba-sec-nx"></div><div class="dba-nx"></div>` +
      `</div>`;
    const q = (sel: string) => this.host.querySelector(sel) as HTMLElement;
    q(".dba-sec-an").textContent = t("dbga.secAnalysing");
    q(".dba-sec-hy").textContent = t("dbga.secHypotheses");
    q(".dba-sec-nx").textContent = t("dbga.secNext");
    // Cabeçalho: o diagnóstico real do ficheiro activo, ou o estado vazio honesto.
    const head = q(".dba-head");
    if (d) {
      head.innerHTML = `<span class="dba-loc"></span><span class="dba-msg"></span>`;
      (head.querySelector(".dba-loc") as HTMLElement).textContent = `${d.rel}:${d.line}`;
      (head.querySelector(".dba-msg") as HTMLElement).textContent = d.message.split("\n")[0];
    } else {
      head.textContent = t("dbga.noDiag");
    }
    // ANALYSING: com provedor, UM turno por botão; sem provedor, texto do compilador verbatim.
    const an = q(".dba-an");
    if (!d) {
      an.innerHTML = `<div class="dba-dim"></div>`;
      (an.firstChild as HTMLElement).textContent = t("dbga.noDiag");
    } else if (!hasProv) {
      an.innerHTML = `<div class="dba-noprov"></div><pre class="dba-comp"></pre>`;
      (an.querySelector(".dba-noprov") as HTMLElement).textContent = t("dbga.noProvider");
      (an.querySelector(".dba-comp") as HTMLElement).textContent =
        d.message + (d.related.length ? `\n${d.related.join("\n")}` : "");
    } else {
      an.innerHTML = `<button class="dba-analyze"></button><div class="dba-note"></div><pre class="dba-out hidden"></pre>`;
      const btn = an.querySelector(".dba-analyze") as HTMLButtonElement;
      btn.textContent = t("dbga.analyze");
      btn.disabled = this.busy;
      btn.onclick = () => void this.analyze(d);
      (an.querySelector(".dba-note") as HTMLElement).textContent = this.analysisNote;
      if (fresh) {
        const out = an.querySelector(".dba-out") as HTMLElement;
        out.classList.remove("hidden");
        out.textContent = fresh.text;
      }
    }
    // HYPOTHESES: só dados reais — notes do diagnostic e/ou o stop corrente do gdb.
    const hy = q(".dba-hy");
    if (!nHyps) {
      hy.innerHTML = `<div class="dba-dim"></div>`;
      (hy.firstChild as HTMLElement).textContent = t("dbga.noHypo");
    } else {
      hy.innerHTML =
        hypsDiag.map(() => `<div class="dba-row" data-src="diag"><span class="dba-tag"></span><span class="dba-txt"></span></div>`).join("") +
        hypsGdb.map(() => `<div class="dba-row" data-src="gdb"><span class="dba-tag"></span><span class="dba-txt"></span></div>`).join("");
      const rows = hy.querySelectorAll(".dba-row");
      [...hypsDiag, ...hypsGdb].forEach((h, i) => {
        const r = rows[i];
        (r.querySelector(".dba-tag") as HTMLElement).textContent =
          i < hypsDiag.length ? t("dbga.srcDiag") : t("dbga.srcGdb");
        (r.querySelector(".dba-txt") as HTMLElement).textContent = h;
      });
    }
    // NEXT: acções REAIS — nenhum botão que simule.
    const nx = q(".dba-nx");
    let btns = "";
    if (d) btns += `<button class="dba-debug"></button>`;
    if (failedTest) btns += `<button class="dba-test"></button>`;
    if (!btns) {
      nx.innerHTML = `<div class="dba-dim"></div>`;
      (nx.firstChild as HTMLElement).textContent = t("dbga.noNext");
    } else {
      nx.innerHTML = btns;
      if (d) {
        const b = nx.querySelector(".dba-debug") as HTMLButtonElement;
        b.textContent = t("dbga.debugThis", { n: String(d.line) });
        b.onclick = () => this.hooks.armBreakpoint(d.rel, d.line);
      }
      if (failedTest) {
        const b = nx.querySelector(".dba-test") as HTMLButtonElement;
        b.textContent = t("dbga.rerunTest", { name: failedTest.title });
        b.onclick = () => void this.hooks.rerunTest(failedTest.item).then(() => this.render());
      }
    }
  }
}
