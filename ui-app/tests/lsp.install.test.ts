// feature `lsp` — instalar o servidor em falta a partir das receitas do registo (LSP P3): o plano do backend
// (o comando exacto) → aprovação → auditoria → terminal de tarefa ou download conferido → o servidor arranca
// sem reiniciar. Portas falsas, sem Tauri nem DOM.
import { describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import { missingServerNotice, type InstallOption, type InstallPlan, type ServerStatus } from "../src/features/lsp/domain/server-status";
import { LSP_INSTALL_MESSAGES } from "../src/features/lsp/application/install-messages";
import type { EditorNotice, EditorPort, InstallPort, LspPort, NoticeActions, WorkspacePort } from "../src/features/lsp/application/ports";

const DIR = "/home/u/.local/share/ao.ngolacloud.dxtutor-ide/lsp-servers/typescript";
const NPM_CMD = `/home/u/.nvm/versions/node/v25.0.0/bin/npm install --global --prefix ${DIR} typescript-language-server typescript@5`;
const opt = (o: Partial<InstallOption>): InstallOption => ({
  id: "npm", manager: "npm", mode: "terminal", available: true, missing: null, command: NPM_CMD,
  steps: [], cwd: "/home/u", env: { PATH: "/home/u/.nvm/versions/node/v25.0.0/bin:/usr/bin" }, target: DIR,
  packages: ["typescript-language-server", "typescript@5"], url: null, sha256: null, ...o,
});
const plan = (options: InstallOption[], recommended: string | null = options.find((o) => o.available && o.mode !== "manual")?.id ?? null): InstallPlan => ({
  server: "typescript", label: "typescript-language-server", name: "TypeScript/JavaScript", dir: DIR, platform: "linux-x64",
  options, recommended, manual: "npm install -g typescript-language-server typescript@5", withheld: null,
});

function setup(o: { approve?: boolean; exit?: number; auditFails?: boolean; plan?: InstallPlan; downloadFails?: string } = {}) {
  const calls: string[] = [];
  let installed = false;
  const status = (): ServerStatus => ({ language: "typescript", server: "typescript-language-server", installed, problem: installed ? null : "não encontrado", foundAt: installed ? `${DIR}/bin/typescript-language-server` : null, managed: installed });
  const lsp = {
    start: async (root: string) => void calls.push(`start ${root}`),
    didOpen: async (path: string) => void calls.push(`open ${path}`),
    didChange: async () => {},
    onDiagnostics: () => {},
    serverStatus: async () => (calls.push("status"), status()),
  } as unknown as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => "/home/u/proj", virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => id, currentFileKey: () => "proj/src/app.ts", text: () => "const a = 1;\n",
  };
  let acts: NoticeActions | undefined;
  let notice: EditorNotice | null = null;
  const notes: string[] = [];
  const editor = {
    repaint: () => {}, open: () => {}, writeFile: () => {}, reload: () => {},
    notify: (m: string) => void notes.push(m),
    notice: (_k: string, n: EditorNotice | null, _d?: () => void, a?: NoticeActions) => { notice = n; acts = a; },
  } as unknown as EditorPort;
  const audits: string[] = [];
  const auditRows: { command: string; scope: string }[] = [];
  const installer: InstallPort = {
    plan: async (path) => (calls.push(`plan ${path}`), o.plan ?? plan([opt({})])),
    download: async (path, option) => {
      calls.push(`download ${path} ${option}`);
      if (o.downloadFails) throw new Error(o.downloadFails);
      installed = true;
      return status();
    },
    copy: async (t) => (calls.push(`copy ${t}`), true),
    approve: async (r) => (calls.push(`approve ${r.title} | ${r.command} | ${r.scope}`), { approved: o.approve ?? true, reason: "", decidedAt: 1 }),
    audit: async (_root, e) => {
      if (o.auditFails) throw new Error("db");
      audits.push(`${e.action} ${e.approved ? e.outcome ?? "?" : "refused"}`);
      auditRows.push({ command: e.command, scope: e.scope });
    },
    run: async (cmd, cwd, env, label) => {
      calls.push(`run ${cmd} @${cwd} PATH=${env.PATH} [${label}]`);
      if ((o.exit ?? 0) === 0) installed = true;
      return o.exit ?? 0;
    },
  };
  const client = makeLspClient({ lsp, workspace, editor, defer: () => {}, sleep: async () => {}, installer });
  return { client, calls, audits, auditRows, notes, acts: () => acts, notice: () => notice, installByHand: () => void (installed = true) };
}
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

describe("servidor em falta: as maneiras de instalar do backend", () => {
  it("a faixa mostra as maneiras do plano, com o comando EXACTO e a escolhida à partida", async () => {
    const t = setup({ plan: plan([opt({ id: "apt", manager: "apt", mode: "manual", command: "sudo apt-get install x", target: "system", env: {} }), opt({})]) });
    await t.client.onTab("proj/src/app.ts");
    const n = t.notice()!;
    expect(n.title).toBe("No TypeScript/JavaScript language server");
    expect(t.calls.slice(0, 2)).toEqual(["status", "plan /home/u/proj/src/app.ts"]);
    expect(n.way).toBe("npm"); // a recomendada: a primeira que o dxtutor corre
    const [apt, npm] = n.ways!;
    expect(apt).toMatchObject({ id: "apt", label: "apt (you run it)", runnable: false, shown: "sudo apt-get install x" });
    expect(apt.note).toMatch(/sudo, so dxtutor does not run it/);
    expect(npm).toMatchObject({ id: "npm", label: "npm", runnable: true, shown: NPM_CMD });
    expect(npm.note).toContain(DIR);
    expect(n.labels?.install).toBe("Install");
    expect(t.acts()!.recheck).toBeTypeOf("function");
  });

  it("um gestor que falta ou uma release sem versão para a máquina: diz porquê e não corre", async () => {
    const t = setup({
      plan: plan([
        opt({ available: false, missing: "npm" }),
        opt({ id: "github", manager: "github", mode: "download", available: false, missing: "platform", command: "download …", url: "https://github.com/o/r/releases/download/v1/x.zip" }),
      ]),
    });
    await t.client.onTab("proj/src/app.ts");
    const n = t.notice()!;
    expect(n.ways!.map((w) => w.label)).toEqual(["npm — npm not found", "GitHub release — no build for linux-x64"]);
    expect(n.ways!.every((w) => !w.runnable)).toBe(true);
    expect(t.acts()!.install).toBeUndefined(); // nada que o dxtutor possa correr: sem «Install»
    expect(n.install).toBe("npm install -g typescript-language-server typescript@5"); // a instrução à mão
  });

  it("«Copy» copia o comando da maneira escolhida", async () => {
    const t = setup();
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.copy!("npm");
    await tick();
    expect(t.calls).toContain(`copy ${NPM_CMD}`);
    expect(t.notes.at(-1)).toBe(`Copied: ${NPM_CMD}`);
  });

  it("«Install» (terminal): aprovação do comando exacto → auditoria → terminal com o PATH do plano → arranca sem reiniciar", async () => {
    const t = setup();
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.install!("npm");
    await tick(8);
    expect(t.calls).toEqual([
      "status",
      "plan /home/u/proj/src/app.ts",
      `approve Install the typescript-language-server language server with npm | ${NPM_CMD} | terminal · installs into ${DIR} · your login shell's PATH (e.g. nvm's node)`,
      `run ${NPM_CMD} @/home/u PATH=/home/u/.nvm/versions/node/v25.0.0/bin:/usr/bin [install typescript-language-server]`,
      "status",
      "start /home/u/proj",
      "open /home/u/proj/src/app.ts",
    ]);
    expect(t.audits).toEqual(["lsp.install sent", "lsp.install ok"]);
    expect(t.auditRows[0].command).toBe(NPM_CMD); // o que se auditou é o que correu
    expect(t.notes.at(-1)).toBe(`typescript-language-server installed (${DIR}/bin/typescript-language-server) — live diagnostics, hover and go to definition are on.`);
  });

  it("«Install» (release): o backend descarrega e confere pelo id da maneira, nunca por um URL", async () => {
    const gh = opt({ id: "github", manager: "github", mode: "download", command: `download https://github.com/o/r/releases/download/v1/x.gz\ncheck    sha256 ${"a".repeat(64)}\nunpack   into ${DIR}`, url: "https://github.com/o/r/releases/download/v1/x.gz", sha256: "a".repeat(64), env: {} });
    const t = setup({ plan: plan([gh]) });
    await t.client.onTab("proj/src/app.ts");
    expect(t.notice()!.ways![0].shown).toBe("https://github.com/o/r/releases/download/v1/x.gz");
    t.acts()!.install!("github");
    await tick(8);
    expect(t.calls[2]).toBe(`approve Download the typescript-language-server language server | ${gh.command} | dxtutor · pinned GitHub release, SHA-256 checked before unpacking · ${DIR}`);
    expect(t.calls[3]).toBe("download /home/u/proj/src/app.ts github");
    expect(t.calls.some((c) => c.startsWith("run "))).toBe(false);
    expect(t.audits).toEqual(["lsp.install sent", "lsp.install ok"]);
    expect(t.calls.slice(-2)).toEqual(["start /home/u/proj", "open /home/u/proj/src/app.ts"]);
  });

  it("uma release que não confere: auditada como falhada, diz o erro e nada arranca", async () => {
    const gh = opt({ id: "github", manager: "github", mode: "download", command: "download …", url: "https://github.com/o/r/releases/download/v1/x.gz", env: {} });
    const t = setup({ plan: plan([gh]), downloadFails: "checksum mismatch for https://github.com/o/r/releases/download/v1/x.gz — nothing was installed" });
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.install!("github");
    await tick(8);
    expect(t.audits).toEqual(["lsp.install sent", "lsp.install failed"]);
    expect(t.notes.at(-1)).toMatch(/^typescript-language-server was not installed: checksum mismatch/);
    expect(t.calls.some((c) => c.startsWith("open "))).toBe(false);
  });

  it("apt/brew nunca correm daqui, nem pedindo", async () => {
    const t = setup({ plan: plan([opt({ id: "apt", manager: "apt", mode: "manual", command: "sudo apt-get install x", target: "system", env: {} })]) });
    await t.client.onTab("proj/src/app.ts");
    expect(t.acts()!.install).toBeUndefined();
    expect(t.notice()!.way).toBe("apt");
    t.acts()!.copy!("apt");
    await tick();
    expect(t.calls).toContain("copy sudo apt-get install x");
    expect(t.calls.some((c) => c.startsWith("approve") || c.startsWith("run"))).toBe(false);
  });

  it("recusado: auditado e nada corre", async () => {
    const t = setup({ approve: false });
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.install!("npm");
    await tick();
    expect(t.calls.some((c) => c.startsWith("run"))).toBe(false);
    expect(t.audits).toEqual(["lsp.install refused"]);
  });

  it("sem auditoria não instala; a falhar, diz o código de saída", async () => {
    const a = setup({ auditFails: true });
    await a.client.onTab("proj/src/app.ts");
    a.acts()!.install!("npm");
    await tick();
    expect(a.calls.some((c) => c.startsWith("run"))).toBe(false);
    expect(a.notes.at(-1)).toBe("Not installed: the audit log failed (db)");
    const b = setup({ exit: 243 });
    await b.client.onTab("proj/src/app.ts");
    b.acts()!.install!("npm");
    await tick();
    expect(b.audits).toEqual(["lsp.install sent", "lsp.install failed"]);
    expect(b.notes.at(-1)).toBe("typescript-language-server was not installed (exit code 243). Read the terminal for the reason.");
  });

  it("«Check again»: instalado à mão, a faixa sai e o servidor arranca sem reiniciar", async () => {
    const t = setup({ plan: plan([opt({ id: "apt", manager: "apt", mode: "manual", command: "sudo apt-get install x", target: "system", env: {} })]) });
    await t.client.onTab("proj/src/app.ts");
    t.acts()!.recheck!();
    await tick();
    expect(t.notes.at(-1)).toBe("typescript-language-server is still not found.");
    expect(t.notice()).not.toBe(null);
    expect(t.calls.filter((c) => c === "status").length).toBe(2); // perguntou outra vez, não usou a cache
    // o humano correu o apt no terminal dele: agora existe
    t.installByHand();
    t.acts()!.recheck!();
    await tick();
    expect(t.notice()).toBe(null); // a faixa sai
    expect(t.calls.slice(-2)).toEqual(["start /home/u/proj", "open /home/u/proj/src/app.ts"]);
    expect(t.notes.at(-1)).toBe(`typescript-language-server found (${DIR}/bin/typescript-language-server) — starting it.`);
  });

  it("um ficheiro sem plano (o backend falhou): só a instrução à mão do registo", () => {
    const n = missingServerNotice({ language: "typescript", server: "typescript-language-server", installed: false }, null)!;
    expect(n.options).toEqual([]);
    expect(LSP_INSTALL_MESSAGES.en.noWay).toContain("{server}");
  });
});
