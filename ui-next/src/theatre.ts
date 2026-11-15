// Theatre (.eview): Visualizar execução + Por dentro — HONESTOS sobre o backend real.
//
// • Trace: trace_execution corre o programa DE VERDADE (Python via sys.settrace; Rust por
//   instrumentação do fonte compilada e executada) e devolve cada passo observado
//   (linha/evento/função/locals/stdout acumulado). Esta vista só REPRODUZ esses passos —
//   nenhum valor é inventado, nenhuma animação tem dados fixos. O protótipo simulava um
//   subset de Rust no browser; isso foi abandonado pelo dono e NÃO vive aqui.
// • Pipeline: compile_pipeline emite as representações reais da toolchain (LLVM-IR, ASM,
//   MIR quando a toolchain o dá, bytes do binário, desassemblagem). Fases em falta chegam
//   explicadas em notes e são mostradas como «indisponível» — nunca preenchidas.
// • Relações: symbol_relations mapeia definições/referências/callers. A análise é
//   sintáctica → o chip diz SEMPRE como a relação foi estabelecida: «inferido» ou, com
//   homónimos, «ambíguo» (regra da skill editor-code-intelligence) — nunca finge resolução.

import * as monaco from "monaco-editor";
import { api, type ExecutionTraceDto, type PipelineDto, type Relations } from "./tauri";
import { t } from "./i18n";

export interface TheatreHooks {
  root(): string;
  /** Ficheiro activo no editor (buffer vivo) — o alvo do trace/pipeline. */
  activeFile(): { rel: string; content: string } | null;
}

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

/** Língua de trace pela extensão; o backend responde honestamente às que não suporta. */
function traceLang(rel: string): string {
  if (/\.rs$/.test(rel)) return "rust";
  if (/\.py$/.test(rel)) return "python";
  return rel.split(".").pop() ?? "";
}
function monacoLang(rel: string): string {
  if (/\.rs$/.test(rel)) return "rust";
  if (/\.py$/.test(rel)) return "python";
  return "plaintext";
}

type Mode = "trace" | "pipeline";

export class Theatre {
  private mode: Mode = "trace";
  // Snapshot traçado (o trace é da execução DESTE código, não do buffer que entretanto mude).
  private rel = "";
  private code = "";
  private dto: ExecutionTraceDto | null = null;
  private idx = 0;
  private busy: "" | "trace" | "pipe" = "";
  private err = "";
  private pipe: PipelineDto | null = null;
  private pipeRel = "";
  private pipeErr = "";
  private rels: Relations | null = null;
  private relErr = "";
  private ed: monaco.editor.IStandaloneCodeEditor | null = null;
  private model: monaco.editor.ITextModel | null = null;
  private deco: string[] = [];

  constructor(private host: HTMLElement, private hooks: TheatreHooks) {
    host.innerHTML = `
      <div class="th">
        <div class="th-head">
          <span class="th-title"></span>
          <span class="th-file"></span>
          <div class="th-tabs">
            <button class="th-tab on" data-mode="trace"></button>
            <button class="th-tab" data-mode="pipeline"></button>
          </div>
        </div>
        <div class="th-body th-body-trace">
          <div class="th-toolbar">
            <button class="th-run"></button>
            <button class="th-step" data-go="first">⏮</button>
            <button class="th-step" data-go="prev">◀</button>
            <button class="th-step" data-go="next">▶</button>
            <button class="th-step" data-go="last">⏭</button>
            <span class="th-pos"></span>
            <span class="th-event"></span>
          </div>
          <div class="th-main">
            <div class="th-code"></div>
            <div class="th-side">
              <div class="th-note"></div>
              <div class="th-sec th-sec-locals"></div>
              <div class="th-locals"></div>
              <div class="th-sec th-sec-stdout"></div>
              <pre class="th-stdout"></pre>
              <div class="th-sec th-sec-rel"></div>
              <div class="th-rel"></div>
            </div>
          </div>
        </div>
        <div class="th-body th-body-pipe hidden">
          <div class="th-toolbar">
            <button class="th-measure"></button>
            <span class="th-pipe-src"></span>
          </div>
          <div class="th-pipe"></div>
        </div>
      </div>`;
    this.host.querySelectorAll<HTMLButtonElement>(".th-tab").forEach((b) => {
      b.onclick = () => this.showMode((b.dataset.mode as Mode) ?? "trace");
    });
    (this.host.querySelector(".th-run") as HTMLButtonElement).onclick = () => void this.runTrace().catch(() => {});
    (this.host.querySelector(".th-measure") as HTMLButtonElement).onclick = () => void this.runPipeline().catch(() => {});
    this.host.querySelectorAll<HTMLButtonElement>(".th-step").forEach((b) => {
      b.onclick = () => {
        const n = this.dto?.steps.length ?? 0;
        if (!n) return;
        const go = b.dataset.go;
        this.goto(go === "first" ? 0 : go === "prev" ? this.idx - 1 : go === "next" ? this.idx + 1 : n - 1);
      };
    });
    this.applyLocale();
    this.render();
  }

  /** Rótulos estáticos na locale corrente (padrão dos outros módulos). */
  applyLocale(): void {
    (this.host.querySelector(".th-title") as HTMLElement).textContent = t("th.title");
    (this.host.querySelector('.th-tab[data-mode="trace"]') as HTMLElement).textContent = t("th.tabTrace");
    (this.host.querySelector('.th-tab[data-mode="pipeline"]') as HTMLElement).textContent = t("th.tabPipe");
    (this.host.querySelector(".th-run") as HTMLElement).textContent = t("th.run");
    (this.host.querySelector(".th-measure") as HTMLElement).textContent = t("th.measure");
    (this.host.querySelector(".th-sec-locals") as HTMLElement).textContent = t("th.locals");
    (this.host.querySelector(".th-sec-stdout") as HTMLElement).textContent = t("th.stdout");
    (this.host.querySelector(".th-sec-rel") as HTMLElement).textContent = t("th.relations");
    this.render();
  }

  /** Repinta ao abrir a vista (openSpecial) — nunca corre nada sozinho: traçar/medir
   *  compilam e EXECUTAM código, logo são sempre acção explícita do utilizador. */
  refresh(): void {
    this.render();
  }

  showMode(m: Mode): void {
    this.mode = m;
    this.host.querySelectorAll<HTMLElement>(".th-tab").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
    this.host.querySelector(".th-body-trace")?.classList.toggle("hidden", m !== "trace");
    this.host.querySelector(".th-body-pipe")?.classList.toggle("hidden", m !== "pipeline");
    if (m === "trace") this.ed?.layout();
  }

  // ── Trace ───────────────────────────────────────────────────────────────────

  /** Traça o ficheiro activo com o backend real. Lança em erro de invoke (o chamador
   *  decide o skip honesto); supported=false fica exposto tal-e-qual na vista. */
  async runTrace(): Promise<ExecutionTraceDto> {
    const f = this.hooks.activeFile();
    if (!f) {
      this.err = t("th.noFile");
      this.render();
      throw new Error(this.err);
    }
    this.rel = f.rel;
    this.code = f.content;
    this.err = "";
    this.dto = null;
    this.rels = null;
    this.relErr = "";
    this.busy = "trace";
    this.render();
    try {
      const dto = await api.traceExecution(traceLang(f.rel), f.content);
      this.dto = dto;
      this.idx = 0;
      return dto;
    } catch (e) {
      this.err = String(e);
      throw e;
    } finally {
      this.busy = "";
      this.render();
    }
  }

  /** Vai para o passo i (clamp) e realça a linha desse passo no Monaco. */
  goto(i: number): void {
    const n = this.dto?.steps.length ?? 0;
    if (!n) return;
    this.idx = Math.max(0, Math.min(n - 1, i));
    this.render();
  }

  stepCount(): number {
    return this.dto?.steps.length ?? 0;
  }

  /** A linha realçada AGORA no Monaco (lida das decorações do model, não do nosso estado). */
  decoratedLine(): number | null {
    if (!this.model) return null;
    const d = this.model.getAllDecorations().find((x) => x.options.className === "th-curline");
    return d ? d.range.startLineNumber : null;
  }

  // ── Pipeline ────────────────────────────────────────────────────────────────

  /** Mede o pipeline de compilação real do ficheiro activo. Lança em erro de invoke. */
  async runPipeline(): Promise<PipelineDto> {
    const f = this.hooks.activeFile();
    if (!f) {
      this.pipeErr = t("th.noFile");
      this.render();
      throw new Error(this.pipeErr);
    }
    this.pipeRel = f.rel;
    this.pipeErr = "";
    this.pipe = null;
    this.busy = "pipe";
    this.render();
    try {
      const dto = await api.compilePipeline(f.content);
      this.pipe = dto;
      return dto;
    } catch (e) {
      this.pipeErr = String(e);
      throw e;
    } finally {
      this.busy = "";
      this.render();
    }
  }

  // ── Relações de símbolos ────────────────────────────────────────────────────

  /** Mapeia `symbol` no projecto com symbol_relations; o chip diz COMO foi estabelecido. */
  async showRelations(symbol: string): Promise<Relations> {
    this.relErr = "";
    try {
      const rels = await api.symbolRelations(this.hooks.root(), symbol);
      this.rels = rels;
      return rels;
    } catch (e) {
      this.relErr = String(e);
      throw e;
    } finally {
      this.render();
    }
  }

  /** Estado do chip de resolução tal como está no DOM (para o arnês). */
  chipState(): { res: string; label: string } | null {
    const chip = this.host.querySelector<HTMLElement>(".th-chip");
    return chip ? { res: chip.dataset.res ?? "", label: chip.textContent ?? "" } : null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  private ensureEditor(): void {
    const hostEl = this.host.querySelector(".th-code") as HTMLElement;
    if (!this.ed) {
      this.ed = monaco.editor.create(hostEl, {
        value: "",
        theme: "vs-dark",
        readOnly: true,
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
      });
    }
    const want = this.code;
    if (!this.model || this.model.getValue() !== want) {
      const old = this.model;
      this.model = monaco.editor.createModel(want, monacoLang(this.rel));
      this.ed.setModel(this.model);
      old?.dispose();
      this.deco = [];
    }
  }

  private render(): void {
    (this.host.querySelector(".th-file") as HTMLElement).textContent =
      this.mode === "trace" ? this.rel || this.hooks.activeFile()?.rel || "" : this.pipeRel || this.hooks.activeFile()?.rel || "";
    this.renderTrace();
    this.renderPipe();
  }

  private renderTrace(): void {
    const note = this.host.querySelector(".th-note") as HTMLElement;
    const pos = this.host.querySelector(".th-pos") as HTMLElement;
    const event = this.host.querySelector(".th-event") as HTMLElement;
    const locals = this.host.querySelector(".th-locals") as HTMLElement;
    const stdout = this.host.querySelector(".th-stdout") as HTMLElement;
    const relHost = this.host.querySelector(".th-rel") as HTMLElement;
    const dto = this.dto;
    if (this.busy === "trace") {
      note.innerHTML = `<div class="th-msg">${esc(t("th.busyTrace"))}</div>`;
    } else if (this.err) {
      note.innerHTML = `<div class="th-msg th-err">${esc(this.err)}</div>`;
    } else if (!dto) {
      note.innerHTML = `<div class="th-msg">${esc(t("th.hint"))}</div>`;
    } else if (!dto.supported) {
      note.innerHTML = `<div class="th-msg">${esc(t("th.unsupported"))}</div><pre class="th-notes">${esc(dto.notes)}</pre>`;
    } else {
      // Notas honestas do traçador (truncagem, erro de execução, fallback sem variáveis).
      note.innerHTML = dto.notes ? `<pre class="th-notes">${esc(dto.notes)}</pre>` : "";
    }
    const steps = dto?.supported ? dto.steps : [];
    const cur = steps.length ? steps[this.idx] : null;
    pos.textContent = steps.length ? t("th.step", { i: String(this.idx + 1), n: String(steps.length) }) : "";
    this.host.querySelectorAll<HTMLButtonElement>(".th-step").forEach((b) => (b.disabled = !steps.length));
    if (cur) {
      event.innerHTML =
        `<span class="th-ev th-ev-${esc(cur.event)}">${esc(cur.event)}</span> ` +
        `<button class="th-func" title="${esc(t("th.mapFunc"))}">${esc(cur.func)}</button>` +
        `<span class="th-depth">${esc(t("th.depth", { n: String(cur.depth) }))}</span>`;
      (event.querySelector(".th-func") as HTMLButtonElement).onclick = () =>
        void this.showRelations(cur.func).catch(() => {});
      locals.innerHTML = cur.locals.length
        ? `<table><tbody>${cur.locals
            .map((v) => `<tr><td class="th-vn">${esc(v.name)}</td><td class="th-vv">${esc(v.value)}</td><td class="th-vt">${esc(v.ty)}</td></tr>`)
            .join("")}</tbody></table>`
        : `<div class="th-dim">${esc(t("th.noLocals"))}</div>`;
      // stdout: quando o traçador mediu o acumulado por passo (Python), mostra a fatia
      // até este passo; quando não intercepta a meio (Rust põe stdoutLen=0 honesto),
      // mostra a saída FINAL com o rótulo a dizê-lo — nunca uma reconstrução inventada.
      const perStep = steps.some((s) => s.stdoutLen > 0);
      (this.host.querySelector(".th-sec-stdout") as HTMLElement).textContent =
        perStep ? t("th.stdout") : t("th.stdoutFinal");
      const shown = perStep ? (this.dto?.stdout ?? "").slice(0, cur.stdoutLen) : this.dto?.stdout ?? "";
      stdout.textContent = shown || t("th.noOutput");
    } else {
      event.textContent = "";
      locals.innerHTML = "";
      stdout.textContent = dto?.supported && dto.stdout ? dto.stdout : "";
    }
    // Relações do símbolo pedido, com o chip de honestidade sintáctica.
    if (this.relErr) {
      relHost.innerHTML = `<div class="th-msg th-err">${esc(this.relErr)}</div>`;
    } else if (this.rels) {
      const r = this.rels;
      const res = r.ambiguous ? "ambiguous" : r.resolution;
      const label = r.ambiguous ? t("th.relAmbiguous") : r.resolution === "resolved" ? t("th.relResolved") : t("th.relInferred");
      const list = (title: string, refs: { file: string; line: number }[]) =>
        `<div class="th-rel-sec">${esc(title)} (${refs.length})</div>` +
        refs.slice(0, 8).map((x) => `<div class="th-rel-row">${esc(x.file)}:${x.line}</div>`).join("");
      relHost.innerHTML =
        `<div class="th-rel-head"><code>${esc(r.symbol)}</code> <span class="th-chip" data-res="${esc(res)}">${esc(label)}</span></div>` +
        list(t("th.relDefs"), r.definitions) +
        list(t("th.relRefs"), r.references) +
        list(t("th.relCallers"), r.callers);
    } else {
      relHost.innerHTML = `<div class="th-dim">${esc(t("th.relHint"))}</div>`;
    }
    // Código traçado + realce da linha corrente no Monaco.
    if (this.code) {
      this.ensureEditor();
      if (cur && this.ed) {
        this.deco = this.ed.deltaDecorations(this.deco, [
          { range: new monaco.Range(cur.line, 1, cur.line, 1), options: { isWholeLine: true, className: "th-curline" } },
        ]);
        this.ed.revealLineInCenterIfOutsideViewport(cur.line);
      } else if (this.ed) {
        this.deco = this.ed.deltaDecorations(this.deco, []);
      }
    }
  }

  private renderPipe(): void {
    const hostEl = this.host.querySelector(".th-pipe") as HTMLElement;
    if (this.busy === "pipe") {
      hostEl.innerHTML = `<div class="th-msg">${esc(t("th.busyPipe"))}</div>`;
      return;
    }
    if (this.pipeErr) {
      hostEl.innerHTML = `<div class="th-msg th-err">${esc(this.pipeErr)}</div>`;
      return;
    }
    const p = this.pipe;
    if (!p) {
      hostEl.innerHTML = `<div class="th-msg">${esc(t("th.pipeHint"))}</div>`;
      return;
    }
    const stage = (key: string, title: string, text: string) =>
      `<div class="th-stage" data-stage="${key}"><div class="th-stage-h">${esc(title)}</div>` +
      (text ? `<pre>${esc(text)}</pre>` : `<div class="th-dim">${esc(t("th.stageMissing"))}</div>`) +
      `</div>`;
    hostEl.innerHTML =
      stage("mir", "MIR", p.mir) +
      stage("llvm", "LLVM-IR", p.llvmIr) +
      stage("asm", "Assembly", p.asm) +
      `<div class="th-stage" data-stage="bin"><div class="th-stage-h">${esc(t("th.binary"))}</div>` +
      (p.binaryBytes > 0
        ? `<div class="th-bytes">${esc(t("th.bytes", { n: String(p.binaryBytes) }))}</div>`
        : `<div class="th-dim">${esc(t("th.stageMissing"))}</div>`) +
      `</div>` +
      stage("disasm", t("th.disasm"), p.disasm) +
      (p.notes ? `<div class="th-stage" data-stage="notes"><div class="th-stage-h">${esc(t("th.notes"))}</div><pre>${esc(p.notes)}</pre></div>` : "");
  }
}
