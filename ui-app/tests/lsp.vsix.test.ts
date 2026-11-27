// LSP P4 no cliente do editor (portas falsas): instalar o VSIX do Go (golang.go) faz o `go.mod` abrir no servidor do Go
// com o id do VSIX como `languageId` — as linguagens vão ao backend antes —; uma linguagem do mesmo VSIX que o gopls não
// lista não abre nada; desinstalar fecha o documento no servidor.
import { afterEach, describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import { makeContributionsSync } from "../src/features/lsp/application/contributions";
import type { EditorPort, LspPort, WorkspacePort } from "../src/features/lsp/application/ports";
import { contributedLanguages, useContributed, type ContributedLanguage } from "../src/features/lsp/domain/registry";
import { contributedLanguages as fromInstalled, languagesOf } from "../src/features/ext/domain/contributions";
import { vsixManifest } from "./fixtures/vsix";

afterEach(() => useContributed(() => []));

/** As linguagens do VSIX real do Go, como a feature `ext` as põe no registo. */
const goLanguages = (): ContributedLanguage[] => {
  const m = vsixManifest("golang.go");
  return fromInstalled([{ id: "golang.go", languages: languagesOf(m.contributes as never), grammars: [], themes: [], snippets: [], configs: [], warnings: [] }]);
};

function setup(files: Record<string, string>) {
  const calls: string[] = [];
  let current: string | null = null;
  const lsp: LspPort = {
    start: async (root) => void calls.push(`start ${root}`),
    didOpen: async (path, _t, lang) => void calls.push(`open ${path} ${lang}`),
    didChange: async () => {},
    didClose: async (path) => void calls.push(`close ${path}`),
    hover: async () => null,
    definition: async () => null,
    references: async () => null,
    prepareRename: async () => null,
    rename: async () => null,
    onDiagnostics: () => {},
    serverStatus: async (path) => (calls.push(`status ${path}`), { language: "go", server: "gopls", installed: true, problem: null }),
  } as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => "/home/u/proj",
    virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => (id && id in files ? id : null),
    currentFileKey: () => current,
    text: (k) => files[k] ?? null,
  };
  const notices = new Map<string, string | null>();
  const editor: EditorPort = {
    repaint: () => {},
    open: () => {},
    notify: () => {},
    writeFile: () => {},
    reload: () => {},
    notice: (k, n) => void notices.set(k, n ? n.title : null),
  };
  const contributions = makeContributionsSync({
    languages: contributedLanguages,
    send: async (l) => void calls.push(`contributions ${l.map((x) => x.id).join(",")}`),
  });
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {}, contributions });
  const activate = (k: string | null) => {
    current = k;
    return client.onTab(k);
  };
  return { client, calls, activate, notices };
}

describe("LSP P4 — o VSIX escolhe o servidor do registo", () => {
  it("sem o VSIX, o go.mod não abre; com ele, abre com o languageId do VSIX, depois de as linguagens irem ao backend", async () => {
    const t = setup({ "proj/go.mod": "module x\n", "proj/asm_amd64.s": "TEXT ·f(SB)\n" });
    await t.activate("proj/go.mod");
    expect(t.calls).toEqual(["contributions "]);

    const go = goLanguages();
    useContributed(() => go);
    await t.client.onLanguagesChanged();
    expect(t.calls).toEqual([
      "contributions ",
      "contributions go,go.asm,go.mod,go.work,go.sum,gotmpl",
      "status /home/u/proj/go.mod",
      "start /home/u/proj",
      "open /home/u/proj/go.mod go.mod",
    ]);
    // a linguagem do mesmo VSIX que o gopls não lista: nada
    await t.activate("proj/asm_amd64.s");
    expect(t.calls.filter((c) => c.includes("asm_amd64"))).toEqual([]);
  });

  it("desinstalar o VSIX fecha o documento no servidor e tira-o do cliente", async () => {
    const go = goLanguages();
    useContributed(() => go);
    const t = setup({ "proj/go.mod": "module x\n" });
    await t.activate("proj/go.mod");
    expect(t.client.opened().has("/home/u/proj/go.mod")).toBe(true);
    useContributed(() => []);
    await t.client.onLanguagesChanged();
    expect(t.calls.slice(-2)).toEqual(["contributions ", "close /home/u/proj/go.mod"]);
    expect(t.client.opened().has("/home/u/proj/go.mod")).toBe(false);
    expect(t.notices.get("proj/go.mod")).toBeNull(); // a faixa (se houvesse) sai
  });
});
