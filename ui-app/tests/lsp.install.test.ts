// feature `lsp` — «Copy» e «Install» no aviso de servidor em falta (portas falsas, sem Tauri nem DOM).
import { describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import { missingServerNotice } from "../src/features/lsp/domain/server-status";
import type { EditorPort, InstallPort, LspPort, NoticeActions, WorkspacePort } from "../src/features/lsp/application/ports";

function setup(o: { approve?: boolean; exit?: number; auditFails?: boolean } = {}) {
  const calls: string[] = [];
  let installed = false;
  const lsp = {
    start: async (root: string) => void calls.push(`start ${root}`),
    didOpen: async (path: string) => void calls.push(`open ${path}`),
    didChange: async () => {},
    onDiagnostics: () => {},
    serverStatus: async () => (calls.push("status"), { language: "typescript", server: "typescript-language-server", installed, problem: null }),
  } as unknown as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => "/home/u/proj", virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => id, currentFileKey: () => "proj/src/app.ts", text: () => "const a = 1;\n",
  };
  let acts: NoticeActions | undefined;
  let notice: string | null = null;
  const notes: string[] = [];
  const editor = {
    repaint: () => {}, open: () => {}, writeFile: () => {}, reload: () => {},
    notify: (m: string) => void notes.push(m),
    notice: (_k: string, n: { title: string } | null, _d?: () => void, a?: NoticeActions) => { notice = n ? n.title : null; acts = a; },
  } as unknown as EditorPort;
  const audits: string[] = [];
  const installer: InstallPort = {
    copy: async (t) => (calls.push(`copy ${t}`), true),
    approve: async (r) => (calls.push(`approve ${r.command}`), { approved: o.approve ?? true, reason: "", decidedAt: 1 }),
    audit: async (_root, e) => { if (o.auditFails) throw new Error("db"); audits.push(`${e.action} ${e.approved ? e.outcome ?? "?" : "refused"}`); },
    run: async (cmd, cwd) => { calls.push(`run ${cmd} @${cwd}`); if ((o.exit ?? 0) === 0) installed = true; return o.exit ?? 0; },
  };
  const client = makeLspClient({ lsp, workspace, editor, defer: () => {}, sleep: async () => {}, installer });
  return { client, calls, audits, notes, acts: () => acts, notice: () => notice };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("servidor em falta: copiar e instalar", () => {
  it("só os servidores que se instalam com um comando têm «Install»", () => {
    expect(missingServerNotice({ language: "typescript", server: "typescript-language-server", installed: false })!.command).toBe("npm install -g typescript-language-server typescript");
    expect(missingServerNotice({ language: "java", server: "jdtls", installed: false })!.command).toBe(null);
  });

  it("«Copy» copia o comando e avisa", async () => {
    const t = setup();
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.copy!();
    await tick();
    expect(t.calls).toContain("copy npm install -g typescript-language-server typescript");
    expect(t.notes.at(-1)).toMatch(/^Copied/);
  });

  it("«Install»: aprovado → auditado → terminal na pasta → volta a perguntar → arranca o servidor", async () => {
    const t = setup();
    await t.client.onTab("proj/src/app.ts");
    expect(t.notice()).toBe("No TypeScript/JavaScript language server");
    t.acts()!.install!();
    await tick(); await tick(); await tick();
    expect(t.calls).toEqual([
      "status",
      "approve npm install -g typescript-language-server typescript",
      "run npm install -g typescript-language-server typescript @/home/u/proj",
      "status",
      "start /home/u/proj",
      "open /home/u/proj/src/app.ts",
    ]);
    expect(t.audits).toEqual(["lsp.install sent", "lsp.install ok"]);
    expect(t.notes.at(-1)).toMatch(/installed — live diagnostics/);
  });

  it("recusado: auditado e nada corre", async () => {
    const t = setup({ approve: false });
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.install!();
    await tick();
    expect(t.calls.some((c) => c.startsWith("run"))).toBe(false);
    expect(t.audits).toEqual(["lsp.install refused"]);
  });

  it("sem auditoria não instala; a falhar, diz o código e a dica do nvm", async () => {
    const a = setup({ auditFails: true });
    await a.client.onTab("proj/src/app.ts");
    a.acts()!.install!();
    await tick();
    expect(a.calls.some((c) => c.startsWith("run"))).toBe(false);
    expect(a.notes.at(-1)).toMatch(/audit log failed/);
    const b = setup({ exit: 243 });
    await b.client.onTab("proj/src/app.ts");
    b.acts()!.install!();
    await tick(); await tick();
    expect(b.audits).toEqual(["lsp.install sent", "lsp.install failed"]);
    expect(b.notes.at(-1)).toMatch(/exit code 243.*nvm/);
  });
});
