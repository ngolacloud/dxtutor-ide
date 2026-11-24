// feature `lsp` — assinatura da chamada (signatureHelp): domínio, cliente e teclado (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signatureParts, signatureTrigger, signatureView, type SignatureView } from "../src/features/lsp/domain/signature";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { bindSignatureHooks } from "../src/features/lsp/ui/signature-hooks";

describe("signatureHelp — domínio", () => {
  it("parâmetros dados como texto (jdtls) e o activo da resposta", () => {
    const v = signatureView({
      signatures: [{ label: "add(int a, int b) : int", documentation: "Adds two numbers.", parameters: [{ label: "int a" }, { label: "int b", documentation: { kind: "markdown", value: "the **second**" } }] }],
      activeSignature: 0,
      activeParameter: 1,
    })!;
    expect(v.params).toEqual([{ start: 4, end: 9 }, { start: 11, end: 16 }]);
    expect(v.active).toBe(1);
    expect(v.doc).toBe("Adds two numbers.");
    expect(v.paramDoc).toBe("the second");
    expect(signatureParts(v)).toEqual([
      { text: "add(int a, ", active: false },
      { text: "int b", active: true },
      { text: ") : int", active: false },
    ]);
  });

  it("parâmetros como intervalos, activeParameter da assinatura sobrepõe-se, e sobrecargas", () => {
    const v = signatureView({
      signatures: [
        { label: "greet()" },
        { label: "greet(name: String, times: Int)", parameters: [{ label: [6, 18] }, { label: [20, 30] }], activeParameter: 0 },
      ],
      activeSignature: 1,
      activeParameter: 1,
    })!;
    expect(v.label).toBe("greet(name: String, times: Int)");
    expect(v.active).toBe(0);
    expect(v.overloads).toBe("2/2");
    expect(signatureParts(v).find((p) => p.active)?.text).toBe("name: String");
  });

  it("sem assinaturas → null; parâmetro activo fora do intervalo → nenhum realçado", () => {
    expect(signatureView(null)).toBeNull();
    expect(signatureView({ signatures: [] })).toBeNull();
    const v = signatureView({ signatures: [{ label: "f(x)", parameters: [{ label: "x" }] }], activeParameter: 5 })!;
    expect(v.active).toBe(-1);
    expect(signatureParts(v)).toEqual([{ text: "f(x)", active: false }]);
  });

  it("disparo: depois de «(» ou «,»", () => {
    expect(signatureTrigger("add(", 4)).toBe("(");
    expect(signatureTrigger("add(1,", 6)).toBe(",");
    expect(signatureTrigger("add(1", 5)).toBeNull();
  });
});

describe("signatureHelp — cliente", () => {
  it("dá ao servidor o texto acabado de escrever e passa o carácter e o isRetrigger", async () => {
    const calls: string[] = [];
    const files: Record<string, string> = { "p/A.java": "class A {}" };
    const lsp = {
      start: async () => {},
      didOpen: async () => {},
      didChange: async (_p: string, t: string) => void calls.push(`change ${t}`),
      signatureHelp: async (_p: string, l: number, c: number, trig: string | null, re: boolean) => (calls.push(`sig ${l}:${c} ${trig} ${re}`), { signatures: [{ label: "add(int a)" }] }),
      onDiagnostics: () => {},
    } as unknown as LspPort;
    const workspace: WorkspacePort = { diskRoot: () => "/w", virtualPrefix: () => "p/", fileKeyOfTab: (id) => id, currentFileKey: () => "p/A.java", text: (k) => files[k] ?? null };
    const client = makeLspClient({ lsp, workspace, editor: { repaint() {}, open() {}, notify() {}, writeFile() {}, reload() {} } as EditorPort, defer: (f) => f() });
    await client.onTab("p/A.java");
    files["p/A.java"] = "class A { x = add( }";
    expect((await client.signatureHelpAt(18, "(", false))?.label).toBe("add(int a)");
    expect(calls).toEqual(["change class A { x = add( }", "sig 0:18 ( false"]);
  });
});

describe("signatureHelp — teclado", () => {
  let ta: HTMLTextAreaElement;
  const asked: string[] = [];
  let answer: SignatureView | null;
  const view = (active: number): SignatureView => signatureView({ signatures: [{ label: "add(int a, int b)", parameters: [{ label: "int a" }, { label: "int b" }] }], activeParameter: active })!;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const type = (text: string) => {
    ta.value = text;
    ta.setSelectionRange(text.length, text.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const bold = () => document.querySelector("#lsp-signature b")?.textContent ?? null;

  beforeEach(() => {
    asked.length = 0;
    answer = view(0);
    document.body.innerHTML = `<textarea id="ed-ta"></textarea>`;
    ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    ta.focus();
    bindSignatureHooks({ signatureHelpAt: async (o, t, re) => (asked.push(`${o} ${t} ${re}`), answer), enabled: () => true });
  });
  afterEach(() => vi.useRealTimers());

  it("«(» abre com o 1.º parâmetro a negrito; «,» pede de novo (retrigger) e passa ao 2.º", async () => {
    type("int t = Util.add(");
    await flush();
    expect(asked).toEqual(["17 ( false"]);
    expect(document.querySelector("#lsp-signature .lsp-sig-label")!.textContent).toBe("add(int a, int b)");
    expect(bold()).toBe("int a");
    answer = view(1);
    type("int t = Util.add(1,");
    await flush();
    expect(asked.at(-1)).toBe("19 , true");
    expect(bold()).toBe("int b");
  });

  it("escrever dentro da chamada pergunta de novo; quando o servidor não responde nada, fecha", async () => {
    vi.useFakeTimers();
    type("f(");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("lsp-signature")).not.toBeNull();
    answer = null; // o cursor saiu da chamada
    type("f(1) ");
    await vi.advanceTimersByTimeAsync(150);
    expect(asked.at(-1)).toBe("5 null true");
    expect(document.getElementById("lsp-signature")).toBeNull();
  });

  it("Escape fecha; Ctrl+Shift+Espaço abre a pedido", async () => {
    type("f(");
    await flush();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(document.getElementById("lsp-signature")).toBeNull();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await flush();
    expect(asked.at(-1)).toBe("2 null false");
    expect(document.getElementById("lsp-signature")).not.toBeNull();
  });
});
