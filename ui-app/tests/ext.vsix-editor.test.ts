// LSP P4 no editor real (cadeia de módulos do harness): instalar o VSIX real do Apache (mrmlnc.vscode-apache, gramática
// `.tmLanguage` em plist XML) faz do `.htaccess` — que o registo de linguagens não conhece — uma linguagem do editor: o
// nome na barra de estado, o realce da gramática, o Ctrl+/ com o `#` do language-configuration; a página da extensão diz
// o que ela acrescenta (e que não há servidor); desinstalar tira tudo. E o VSIX do Go mostra o gopls para o go.mod.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { vsixZip, type VsixId } from "./fixtures/vsix";

let w: any;
let DP: any;

beforeEach(async () => {
  delete (window as any).EXS;
  w = await bootApp();
  DP = (await import("../src/app/desktop")).desktopPorts;
}, 60_000); // o primeiro arranque transforma a app inteira: com a máquina carregada passa dos 15 s

afterEach(() => {
  vi.restoreAllMocks();
});

async function installVsix(id: VsixId): Promise<void> {
  DP.ext = { loadJSZip: async () => ({ loadAsync: async () => vsixZip(id) }) };
  vi.spyOn(w, "toast").mockImplementation(() => {});
  await w.loadVsix(new Uint8Array());
}

const lang = () => document.getElementById("st-lang")!.textContent;
const hl = (n: number) => document.querySelectorAll("#ed-hl .l")[n].innerHTML;
const ctrlSlash = () =>
  document.getElementById("ed-ta")!.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true, bubbles: true, cancelable: true }));

describe("LSP P4 — uma linguagem só de um VSIX no editor", () => {
  it("Apache: detecção pelo nome, realce da gramática plist, comentário, e desinstalar tira tudo", async () => {
    const { bus } = await import("../src/app/bus");
    const seen: number[] = [];
    const off = bus.on("ext:languages", ({ count }) => void seen.push(count));
    const KEY = w.ROOT + "public/.htaccess";
    w.FS[KEY] = { content: "# regras\nRewriteEngine On\n" };

    // sem a extensão: o registo não conhece o ficheiro
    w.openPath(KEY);
    expect(lang()).toBe("Texto");
    const generic = hl(1); // o realce genérico: palavras com maiúscula como tipos
    expect(generic).toBe('<span class="ty">RewriteEngine</span> <span class="ty">On</span>');

    await installVsix("mrmlnc.vscode-apache");
    expect(seen).toEqual([1]);
    expect(w.EXS.vsix[0]).toMatchObject({ id: "mrmlnc.vscode-apache", contrib: { grammars: ["apacheconf"], languages: ["apacheconf"], warnings: [] } });
    w.openPath(KEY);
    expect(lang()).toBe("Apache");
    expect(hl(0)).toBe('<span class="cm"># regras</span>');
    expect(hl(1)).toBe('<span class="kw">RewriteEngine</span> On'); // a gramática do VSIX

    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
    const at = ta.value.indexOf("Rewrite");
    ta.setSelectionRange(at, at);
    ctrlSlash();
    expect(w.FS[KEY].content).toBe("# regras\n# RewriteEngine On\n");

    // a página da extensão: nova no editor, sem servidor
    const host = document.createElement("div");
    w.renderExtd({ ext: "mrmlnc.vscode-apache" }, host);
    const text = host.textContent || "";
    expect(text).toContain("Language Apache (apacheconf) — new in the editor");
    expect(text).toContain(".htaccess");
    expect(text).toContain("No language server");

    w.extRemove("mrmlnc.vscode-apache");
    expect(seen).toEqual([1, 0]);
    w.FS[KEY].content = "# regras\nRewriteEngine On\n";
    w.openPath(KEY);
    expect(lang()).toBe("Texto");
    expect(hl(1)).toBe(generic);
    const before = w.FS[KEY].content;
    ta.setSelectionRange(0, 0);
    ctrlSlash();
    expect(w.FS[KEY].content).toBe(before);
    off();
  });

  it("desligar a extensão também tira a linguagem; voltar a ligar repõe-na", async () => {
    await installVsix("mrmlnc.vscode-apache");
    const KEY = w.ROOT + "conf/site.conf";
    w.FS[KEY] = { content: "Listen 80\n" };
    w.openPath(KEY);
    expect(lang()).toBe("Apache");
    w.extToggle("mrmlnc.vscode-apache");
    w.openPath(KEY);
    expect(lang()).toBe("Texto");
    w.extToggle("mrmlnc.vscode-apache");
    w.openPath(KEY);
    expect(lang()).toBe("Apache");
  });

  it("Go: a página diz que o go.mod passa a ter o gopls e o go.asm não; o go.mod tem nome e realce", async () => {
    await installVsix("golang.go");
    const host = document.createElement("div");
    w.renderExtd({ ext: "golang.go" }, host);
    const rows = [...host.querySelectorAll(".rowline")].map((r) => r.textContent || "");
    const at = (id: string) => rows.findIndex((r) => r.includes(`(${id})`));
    expect(rows[at("go")]).toContain("already a dxtutor language");
    expect(rows[at("go.mod")]).toContain("new in the editor");
    expect(rows[at("go.mod") + 1]).toBe("Language server: gopls, from dxtutor's language registry");
    expect(rows[at("go.asm") + 1]).toContain("No language server");
    const KEY = w.ROOT + "svc/go.mod";
    w.FS[KEY] = { content: "module example.com/x\n\ngo 1.22\n" };
    w.openPath(KEY);
    expect(lang()).toBe("Go Module File");
    expect(hl(0)).toContain("<span");
  });
});
