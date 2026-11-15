// Monaco-backed editor with real debounced autosave. Each open file is a model; edits mark
// the buffer dirty and, after a short idle, are flushed to disk through the backend.

import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import { api, listen, type LspDiagnostic, type LspTextEdit, type LspWorkspaceEdit } from "./tauri";
import { t } from "./i18n";

export interface LspCtx {
  root(): string;
  openAt(rel: string, line: number, col: number): void;
  /** Buffer vivo do workspace (para aplicar WorkspaceEdits a ficheiros não abertos). */
  readBuffer(rel: string): string | undefined;
  /** setBuffer + autosave — o caminho dos buffers, para o SCM ver as alterações. */
  writeBuffer(rel: string, content: string): Promise<void>;
  notify(msg: string): void;
}

// Línguas com servidor LSP de sessão no backend (LANGS em src-tauri/src/lsp.rs).
const LSP_SESSION_LANGS = new Set(["rust", "go", "typescript", "javascript", "python"]);

const uriToPath = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

/** Aplica TextEdits LSP (0-based) a um texto, de trás para a frente (offsets estáveis). */
export function applyTextEdits(original: string, edits: LspTextEdit[]): string {
  const lines = original.split("\n");
  const sorted = [...edits].sort(
    (a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character,
  );
  for (const e of sorted) {
    const s = e.range.start;
    const en = e.range.end;
    if (s.line === en.line) {
      const ln = lines[s.line] ?? "";
      lines[s.line] = ln.slice(0, s.character) + e.newText + ln.slice(en.character);
    } else {
      const head = (lines[s.line] ?? "").slice(0, s.character);
      const tail = (lines[en.line] ?? "").slice(en.character);
      lines.splice(s.line, en.line - s.line + 1, head + e.newText + tail);
    }
  }
  return lines.join("\n");
}

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === "typescript" || label === "javascript") return new tsWorker();
    if (label === "json") return new jsonWorker();
    return new editorWorker();
  },
};

const LANG: Record<string, string> = {
  rs: "rust", ts: "typescript", js: "javascript", json: "json", md: "markdown",
  toml: "ini", py: "python", go: "go", c: "c", h: "c", cpp: "cpp", css: "css", html: "html",
  sh: "shell", yaml: "yaml", yml: "yaml",
};

function langOf(rel: string): string {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return LANG[ext] ?? "plaintext";
}

export class Editor {
  private ed: monaco.editor.IStandaloneCodeEditor;
  private models = new Map<string, monaco.editor.ITextModel>();
  private current = "";
  private saveTimer: number | null = null;

  constructor(
    private host: HTMLElement,
    private diffHost: HTMLElement,
    private onEdit: (rel: string, content: string) => void,
    private onAutosave: () => void,
    private lsp: LspCtx,
  ) {
    this.ed = monaco.editor.create(host, {
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      glyphMargin: true,
    });
    this.ed.onDidChangeModelContent(() => {
      if (!this.current) return;
      const value = this.ed.getValue();
      this.onEdit(this.current, value);
      this.lspChange(this.current, value);
      this.scheduleSave();
    });
    // Click the glyph margin to toggle a breakpoint on that line.
    this.ed.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && this.current) {
        const line = e.target.position?.lineNumber;
        if (line) this.toggleBreakpoint(this.current, line);
      }
    });
    this.registerLsp();
    this.bindDiagnostics();
  }

  // ── Breakpoints (per file, 1-based line) ──
  private breaks = new Map<string, Set<number>>();
  private bpDecos: string[] = [];
  private stopDeco: string[] = [];

  private toggleBreakpoint(rel: string, line: number): void {
    const set = this.breaks.get(rel) ?? new Set<number>();
    if (set.has(line)) set.delete(line);
    else set.add(line);
    this.breaks.set(rel, set);
    this.paintBreakpoints();
  }

  private paintBreakpoints(): void {
    if (!this.current) return;
    const set = this.breaks.get(this.current) ?? new Set<number>();
    this.bpDecos = this.ed.deltaDecorations(
      this.bpDecos,
      [...set].map((line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: false, glyphMarginClassName: "dbg-bp-glyph" },
      })),
    );
  }

  /** Add a breakpoint programmatically (used by the harness). */
  addBreakpoint(rel: string, line: number): void {
    const set = this.breaks.get(rel) ?? new Set<number>();
    set.add(line);
    this.breaks.set(rel, set);
    if (this.current === rel) this.paintBreakpoints();
  }

  /** Remove a breakpoint programmatically (harness cleanup). */
  removeBreakpoint(rel: string, line: number): void {
    const set = this.breaks.get(rel);
    if (!set) return;
    set.delete(line);
    if (this.current === rel) this.paintBreakpoints();
  }

  /** All breakpoints as {file (relative), line}. The caller makes them absolute. */
  breakpointList(): { rel: string; line: number }[] {
    const out: { rel: string; line: number }[] = [];
    for (const [rel, set] of this.breaks) for (const line of set) out.push({ rel, line });
    return out;
  }

  /** Highlight the line execution stopped at (clears the previous highlight). */
  highlightStop(line: number): void {
    this.stopDeco = this.ed.deltaDecorations(this.stopDeco, [
      { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "dbg-stopline" } },
    ]);
    this.reveal(line, 1);
  }
  clearStop(): void {
    this.stopDeco = this.ed.deltaDecorations(this.stopDeco, []);
  }

  // ── LSP de sessão: documento aberto/alterado + diagnostics (squiggles) ──
  // didOpen/didChange mantêm o overlay do servidor igual ao buffer vivo; o backend
  // reencaminha publishDiagnostics como evento lsp://diagnostics, pintado aqui em
  // markers Monaco sobre o model do ficheiro (a fonte diz qual servidor falou).
  private lspVersions = new Map<string, number>();

  private relFromAbs(path: string): string {
    const root = this.lsp.root();
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  }

  private lspOpen(rel: string, content: string): void {
    const lang = langOf(rel);
    if (!LSP_SESSION_LANGS.has(lang)) return;
    this.lspVersions.set(rel, 1);
    void api.lspDidOpen(`${this.lsp.root()}/${rel}`, content, lang).catch(() => { /* sem backend/LSP */ });
  }

  private lspChange(rel: string, content: string): void {
    const v = this.lspVersions.get(rel);
    if (v === undefined) return;
    this.lspVersions.set(rel, v + 1);
    void api.lspDidChange(`${this.lsp.root()}/${rel}`, content, v + 1).catch(() => { /* sem backend/LSP */ });
  }

  private bindDiagnostics(): void {
    void listen("lsp://diagnostics", (p) => {
      const ev = p as { uri: string; diagnostics: LspDiagnostic[] };
      const model = this.models.get(this.relFromAbs(uriToPath(ev.uri)));
      if (!model) return;
      const sev = (s?: number) =>
        s === 1 ? monaco.MarkerSeverity.Error : s === 2 ? monaco.MarkerSeverity.Warning
        : s === 3 ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Hint;
      monaco.editor.setModelMarkers(
        model,
        "lsp",
        ev.diagnostics.map((d) => ({
          severity: sev(d.severity),
          message: d.message,
          source: d.source ?? "lsp",
          startLineNumber: d.range.start.line + 1,
          startColumn: d.range.start.character + 1,
          endLineNumber: d.range.end.line + 1,
          endColumn: d.range.end.character + 1,
        })),
      );
    });
  }

  /** Markers Monaco de um ficheiro (para a UI/arnês afirmarem os squiggles reais). */
  markers(rel: string): { line: number; col: number; message: string; error: boolean }[] {
    return monaco.editor
      .getModelMarkers({ resource: monaco.Uri.file(rel) })
      .map((m) => ({
        line: m.startLineNumber,
        col: m.startColumn,
        message: m.message,
        error: m.severity === monaco.MarkerSeverity.Error,
      }));
  }

  /** Rename semântico em (line, col) — 1-based — via lsp_rename. O WorkspaceEdit é aplicado
   *  nos buffers do workspace (writeBuffer = setBuffer + autosave), em TODOS os ficheiros
   *  tocados, abertos ou não. Devolve o nº de ficheiros, "indexing" enquanto o servidor
   *  indexa, ou null quando não há servidor para o ficheiro. */
  async renameAt(rel: string, line: number, col: number, newName: string): Promise<number | "indexing" | null> {
    const edit = await api.lspRename(`${this.lsp.root()}/${rel}`, line - 1, col - 1, newName);
    if (!edit) return null;
    if (edit.indexing) return "indexing";
    return this.applyWorkspaceEdit(edit);
  }

  private async applyWorkspaceEdit(edit: LspWorkspaceEdit): Promise<number> {
    const byFile = new Map<string, LspTextEdit[]>();
    if (edit.documentChanges) {
      for (const dc of edit.documentChanges) byFile.set(uriToPath(dc.textDocument.uri), dc.edits);
    } else if (edit.changes) {
      for (const [uri, edits] of Object.entries(edit.changes)) byFile.set(uriToPath(uri), edits);
    }
    let touched = 0;
    for (const [path, edits] of byFile) {
      const rel = this.relFromAbs(path);
      const model = this.models.get(rel);
      let text: string;
      if (model) {
        // Pelo Monaco: um passo de undo e o buffer actualiza ao vivo (via onDidChangeModelContent
        // quando é o model activo; o writeBuffer abaixo cobre os não-activos).
        model.pushEditOperations(
          null,
          edits.map((e) => ({
            range: new monaco.Range(
              e.range.start.line + 1, e.range.start.character + 1,
              e.range.end.line + 1, e.range.end.character + 1,
            ),
            text: e.newText,
          })),
          () => null,
        );
        text = model.getValue();
      } else {
        const before = this.lsp.readBuffer(rel);
        if (before === undefined) continue; // fora do workspace carregado — não tocar
        text = applyTextEdits(before, edits);
      }
      await this.lsp.writeBuffer(rel, text);
      if (model !== this.ed.getModel()) this.lspChange(rel, text); // overlay LSP dos não-activos
      touched++;
    }
    return touched;
  }

  /** Substitui o conteúdo de um model ABERTO (um passo de undo). Dispara o mesmo caminho
   *  de um edit do utilizador quando é o model activo (buffer + autosave + didChange). */
  setContent(rel: string, text: string): void {
    const model = this.models.get(rel);
    if (!model) return;
    model.pushEditOperations(null, [{ range: model.getFullModelRange(), text }], () => null);
  }

  // Real LSP navigation backed by rust-analyzer (resolve_hover / resolve_definition). The
  // model's URI path IS the project-relative path; positions are 1-based for the backend.
  private registerLsp(): void {
    const relOf = (m: monaco.editor.ITextModel) => m.uri.path.replace(/^\//, "");
    const abs = (rel: string) => `${this.lsp.root()}/${rel}`;
    // F2 — rename semântico com prompt; o arnês chama renameAt directamente.
    this.ed.addCommand(monaco.KeyCode.F2, () => {
      const posn = this.ed.getPosition();
      const model = this.ed.getModel();
      if (!this.current || !posn || !model) return;
      const current = model.getWordAtPosition(posn)?.word ?? "";
      const next = window.prompt(t("lsp.promptRename"), current)?.trim();
      if (!next || next === current) return;
      void this.renameAt(this.current, posn.lineNumber, posn.column, next)
        .then((r) => {
          if (r === "indexing") this.lsp.notify(t("lsp.indexing"));
          else if (r === null) this.lsp.notify(t("lsp.renameUnavailable"));
          else this.lsp.notify(t("lsp.renamed", { files: String(r) }));
        })
        .catch((e) => this.lsp.notify(t("lsp.renameFailed", { err: String(e) })));
    });
    // Shift+F12 — referências reais (resolve_references, rust-analyzer one-shot com buffer
    // vivo); o peek do Monaco mostra a lista (declaração incluída).
    monaco.languages.registerReferenceProvider("rust", {
      provideReferences: async (model, pos) => {
        const refs = await api
          .resolveReferences(this.lsp.root(), abs(relOf(model)), pos.lineNumber, pos.column, model.getValue())
          .catch(() => []);
        const len = Math.max(model.getWordAtPosition(pos)?.word.length ?? 1, 1);
        return refs.map((r) => ({
          uri: monaco.Uri.file(this.relFromAbs(r.file)),
          range: new monaco.Range(r.line, r.col, r.line, r.col + len),
        }));
      },
    });
    monaco.languages.registerHoverProvider("rust", {
      provideHover: async (model, pos) => {
        const md = await api
          .resolveHover(this.lsp.root(), abs(relOf(model)), pos.lineNumber, pos.column, model.getValue())
          .catch(() => null);
        if (!md) return null;
        return { contents: [{ value: md }] };
      },
    });
    monaco.languages.registerDefinitionProvider("rust", {
      provideDefinition: async (model, pos) => {
        const def = await api
          .resolveDefinition(this.lsp.root(), abs(relOf(model)), pos.lineNumber, pos.column, model.getValue())
          .catch(() => null);
        if (!def) return null;
        const rel = def.file.startsWith(this.lsp.root())
          ? def.file.slice(this.lsp.root().length).replace(/^\//, "")
          : def.file;
        this.lsp.openAt(rel, def.line, def.col);
        return [];
      },
    });
  }

  // ── Diff view (SCM → file diff): original side = git_show HEAD:<rel>, modified side = the
  // live buffer. Read-only — it is a VIEW of the change, edits happen in the normal editor.
  private diffEd: monaco.editor.IStandaloneDiffEditor | null = null;
  private diffModels: { o: monaco.editor.ITextModel; m: monaco.editor.ITextModel } | null = null;
  private diffRel = "";

  showDiff(rel: string, original: string, modified: string): void {
    if (!this.diffEd) {
      // Reutiliza a MESMA instância monaco deste módulo — nunca um segundo import.
      this.diffEd = monaco.editor.createDiffEditor(this.diffHost, {
        theme: "vs-dark",
        automaticLayout: true,
        fontSize: 13,
        readOnly: true,
        originalEditable: false,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
      });
    }
    this.disposeDiffModels();
    const lang = langOf(rel);
    this.diffModels = {
      o: monaco.editor.createModel(original, lang),
      m: monaco.editor.createModel(modified, lang),
    };
    this.diffEd.setModel({ original: this.diffModels.o, modified: this.diffModels.m });
    this.diffRel = rel;
    this.diffHost.classList.remove("hidden");
    this.host.classList.add("hidden");
  }

  closeDiff(): void {
    if (this.diffRel === "") return;
    this.diffRel = "";
    this.diffEd?.setModel(null);
    this.disposeDiffModels();
    this.diffHost.classList.add("hidden");
    this.host.classList.remove("hidden");
  }

  private disposeDiffModels(): void {
    this.diffModels?.o.dispose();
    this.diffModels?.m.dispose();
    this.diffModels = null;
  }

  /** O estado do diff aberto — para o arnês afirmar os dois lados. */
  diffInfo(): { rel: string; visible: boolean; original: string; modified: string } {
    return {
      rel: this.diffRel,
      visible: !this.diffHost.classList.contains("hidden"),
      original: this.diffModels?.o.getValue() ?? "",
      modified: this.diffModels?.m.getValue() ?? "",
    };
  }

  open(rel: string, content: string): void {
    this.closeDiff();
    let model = this.models.get(rel);
    if (!model) {
      model = monaco.editor.createModel(content, langOf(rel), monaco.Uri.file(rel));
      this.models.set(rel, model);
      this.lspOpen(rel, content); // o servidor de sessão passa a ver o buffer vivo
    }
    this.current = rel;
    this.ed.setModel(model);
    this.paintBreakpoints();
    this.ed.focus();
  }

  /** Report cursor moves (1-based line/col) for the status bar. */
  onCursor(cb: (line: number, col: number) => void): void {
    this.ed.onDidChangeCursorPosition((e) => cb(e.position.lineNumber, e.position.column));
  }

  /** Dispose a file's model (on tab close). Returns true if it existed. */
  closeModel(rel: string): boolean {
    const m = this.models.get(rel);
    if (!m) return false;
    this.models.delete(rel);
    this.lspVersions.delete(rel); // reabrir volta a fazer didOpen (versão 1)
    m.dispose();
    if (this.current === rel) this.current = "";
    return true;
  }

  hasModel(rel: string): boolean {
    return this.models.has(rel);
  }

  /** Move the cursor to (line, col) — both 1-based — and reveal it. */
  reveal(line: number, col: number): void {
    this.ed.setPosition({ lineNumber: line, column: col });
    this.ed.revealLineInCenter(line);
    this.ed.focus();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.onAutosave();
    }, 350) as unknown as number;
  }

  /** Force any pending autosave immediately (e.g. before the window closes). */
  flushTimer(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.onAutosave();
    }
  }
}
