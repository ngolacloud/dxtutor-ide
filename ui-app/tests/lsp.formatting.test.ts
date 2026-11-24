// feature `lsp` — formatação: domínio, cliente (portas falsas) e Shift+Alt+F (eventos reais, jsdom).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { caretAfterFormatting, formattingEdits } from "../src/features/lsp/domain/formatting";
import { makeLspClient, type FormatOutcome } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindFormatHooks } from "../src/features/lsp/ui/format-hooks";

const UGLY = "public class Main {\npublic static void main(String[] args) {\n  int   total=1 ;\n}\n}\n";
const PRETTY = "public class Main {\n    public static void main(String[] args) {\n        int total = 1;\n    }\n}\n";
/** O documento inteiro trocado de uma vez (como o kotlin-language-server faz). */
const whole = (from: string, to: string) => [{ range: { start: { line: 0, character: 0 }, end: { line: from.split("\n").length, character: 0 } }, newText: to }];

describe("formatação — domínio", () => {
  it("edições da resposta; null quando o servidor não formatou", () => {
    expect(formattingEdits([{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: "    " }, { nope: 1 }])).toEqual([
      { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, newText: "    " },
    ]);
    expect(formattingEdits([])).toEqual([]);
    expect(formattingEdits(null)).toBeNull();
  });

  it("o cursor fica entre os mesmos caracteres visíveis", () => {
    const caret = UGLY.indexOf("total") + 2; // «to|tal»
    const after = caretAfterFormatting(UGLY, PRETTY, caret);
    expect(PRETTY.slice(after - 2, after + 3)).toBe("total");
    expect(caretAfterFormatting(UGLY, PRETTY, 0)).toBe(0);
    expect(caretAfterFormatting(UGLY, PRETTY, UGLY.length)).toBe(PRETTY.length - 1); // depois do último «}»
  });
});

function setup(answer: unknown, opts: { noServer?: boolean } = {}) {
  const calls: string[] = [];
  const files: Record<string, string> = { "p/Main.java": UGLY, "p/notes.txt": "x" };
  let current = "p/Main.java";
  const lsp = {
    start: async () => {},
    didOpen: async () => {},
    didChange: async () => {},
    format: async (path: string, tab: number, spaces: boolean, range: unknown) => (calls.push(`format ${path} ${tab} ${spaces} ${JSON.stringify(range)}`), answer),
    serverStatus: async () => ({ language: "java", server: "jdtls", installed: !opts.noServer }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => current, text: (k) => files[k] ?? null };
  const shown: string[] = [];
  const editor = {
    repaint() {}, open() {}, notice() {}, reload() {}, writeFile() {}, builtinFormat() {},
    notify: (m: string) => void shown.push(m),
    replaceText: (k: string, t: string, caret: number) => {
      files[k] = t;
      shown.push(`replace ${k} caret=${caret}`);
    },
  } as unknown as EditorPort;
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  return { client, calls, files, shown, open: (k: string) => ((current = k), client.onTab(k)) };
}

describe("formatação — cliente", () => {
  it("formata o documento: troca o texto e mantém o cursor", async () => {
    const t = setup(whole(UGLY, PRETTY));
    await t.open("p/Main.java");
    const caret = UGLY.indexOf("total") + 2;
    expect(await t.client.formatAt(caret, caret)).toBe("formatted");
    expect(t.calls).toEqual(["format /w/Main.java 4 true null"]);
    expect(t.files["p/Main.java"]).toBe(PRETTY);
    const at = Number(t.shown.at(-1)!.split("caret=")[1]);
    expect(PRETTY.slice(at - 2, at + 3)).toBe("total");
  });

  it("com selecção pede só o intervalo; se o servidor não o formata, avisa e não muda nada", async () => {
    const t = setup(null);
    await t.open("p/Main.java");
    const s = UGLY.indexOf("  int"), e = UGLY.indexOf(";") + 1;
    expect(await t.client.formatAt(s, e)).toBe("failed");
    expect(t.calls[0]).toBe('format /w/Main.java 4 true {"start":{"line":2,"character":0},"end":{"line":2,"character":17}}');
    expect(t.files["p/Main.java"]).toBe(UGLY);
    expect(t.shown.at(-1)).toMatch(/could not format the selection/);
  });

  it("documento sem resposta, ficheiro sem servidor ou já formatado", async () => {
    const none = setup(null);
    await none.open("p/Main.java");
    expect(await none.client.formatAt(0, 0)).toBe("fallback");
    const txt = setup([]);
    await txt.open("p/notes.txt"); // .txt: nenhum servidor
    expect(await txt.client.formatAt(0, 0)).toBe("fallback");
    expect(txt.calls).toEqual([]);
    const same = setup([]);
    await same.open("p/Main.java");
    expect(await same.client.formatAt(0, 0)).toBe("unchanged");
    expect(same.shown).toEqual([]);
  });
});

describe("formatação — Shift+Alt+F", () => {
  let ta: HTMLTextAreaElement;
  const log: string[] = [];
  let outcome: FormatOutcome;
  let enabled = true;
  const globalShortcut = () => void log.push("atalho global"); // o features/shortcuts.ts
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const press = () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F", code: "KeyF", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));

  beforeEach(() => {
    log.length = 0;
    outcome = "formatted";
    enabled = true;
    document.body.innerHTML = `<textarea id="ed-ta">${UGLY}</textarea>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    document.addEventListener("keydown", globalShortcut);
    bindFormatHooks({ formatAt: async (s, e) => (log.push(`format ${s}-${e}`), outcome), builtinFormat: () => void log.push("builtin"), enabled: () => enabled });
  });
  afterEach(() => document.removeEventListener("keydown", globalShortcut));

  it("formata pelo servidor e não deixa a tecla chegar ao atalho global", async () => {
    ta.setSelectionRange(3, 3);
    press();
    await flush();
    expect(log).toEqual(["format 3-3"]);
  });

  it("sem servidor (ou se ele não formata o documento) corre o «Format Document» do dxtutor", async () => {
    outcome = "fallback";
    press();
    await flush();
    expect(log).toEqual(["format 0-0", "builtin"]);
  });

  it("sem pasta real não intercepta: a tecla é do atalho global, como antes", async () => {
    enabled = false;
    press();
    await flush();
    expect(log).toEqual(["atalho global"]);
  });
});
