// feature `lsp` — os overrides do registo de linguagens (LSP P2): o registo efectivo, o caso de uso da paleta,
// a faixa de aprovação no cliente, e os ecrãs (o editor do lsp.json, a configuração efectiva, os ficheiros ignorados).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGISTRY, activeRegistry, languageFor, useRegistry } from "../src/features/lsp/domain/registry";
import { languageIdFor } from "../src/features/lsp/domain/languages";
import { effectiveEntry, effectiveRegistry, errorsKey, invalidFiles, projectFileKey, serversForInspection, type LspConfigView, type ServerView } from "../src/features/lsp/domain/overrides";
import { pendingApproval, type ServerApproval, type ServerStatus } from "../src/features/lsp/domain/server-status";
import { makeOverrides } from "../src/features/lsp/application/overrides";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import { LSP_OVERRIDE_MESSAGES } from "../src/features/lsp/application/override-messages";
import type { EditorNotice, EditorPort, LspConfigPort, LspPort, NoticeActions, OverridesView, WorkspacePort } from "../src/features/lsp/application/ports";
import { overridesView } from "../src/features/lsp/ui/config-view";

const server = (id: string, extra: Partial<ServerView> = {}): ServerView => ({ id, name: id, label: `${id}-ls`, command: `${id}-ls`, sources: ["bundled"], projectLaunch: [], approval: null, ...extra });

const approval: ServerApproval = {
  project: "/home/u/proj",
  server: "zls",
  label: "zls",
  program: "/home/u/proj/bin/zls",
  args: ["--stdio"],
  cwd: "/home/u/proj",
  file: "/home/u/proj/.dxtutor/lsp.json",
  hash: "abc123",
  insideProject: true,
  changed: ["command", "args"],
  command: "/home/u/proj/bin/zls --stdio",
  blocksStart: true,
  config: null,
};

/* só definições: o servidor corre com as de confiança até o humano aprovar as do projecto */
const settingsOnly: ServerApproval = {
  ...approval,
  program: "/usr/bin/zls",
  insideProject: false,
  changed: ["settings"],
  command: "/usr/bin/zls --stdio",
  hash: "def456",
  blocksStart: false,
  config: 'settings from .dxtutor/lsp.json:\n{ "zls": { "build_runner": "sh -c evil" } }\n(without the project: none)',
};

function view(extra: Partial<LspConfigView> = {}): LspConfigView {
  return {
    root: "/home/u/proj",
    userFile: { path: "/home/u/.config/dxtutor/lsp.json", exists: false, applied: false, errors: [] },
    projectFile: { path: "/home/u/proj/.dxtutor/lsp.json", exists: true, applied: true, errors: [] },
    // o projecto dá um servidor ao Zig (no registo embutido, Zig não tem)
    languages: REGISTRY.languages.map((l) => (l.id === "zig" ? { ...l, lspLanguageId: "zig", server: "zls" } : l)),
    servers: [...REGISTRY.servers.map((s) => ({ ...s, sources: ["bundled"], projectLaunch: [], approval: null })), server("zls", { sources: ["project"], projectLaunch: ["command", "args"], approval })],
    ...extra,
  };
}

afterEach(() => useRegistry(null));

describe("o registo efectivo (domínio)", () => {
  it("uma linguagem de um override passa a ter languageId e servidor; null volta ao embutido", () => {
    // no registo embutido, Zig não tem servidor
    expect(languageIdFor("/w/src/main.zig")).toBe(null);
    useRegistry(effectiveRegistry(view()));
    expect(languageIdFor("/w/src/main.zig")).toBe("zig");
    expect(languageFor("/w/src/main.ZIG")?.server).toBe("zls");
    // os campos de inspecção não entram no registo em uso
    expect(Object.keys(activeRegistry().servers.find((s) => s.id === "zls")!)).not.toContain("approval");
    useRegistry(null);
    expect(activeRegistry()).toBe(REGISTRY);
    expect(languageIdFor("/w/src/main.zig")).toBe(null);
  });

  it("os ficheiros ignorados, a entrada efectiva e a ordem da inspecção", () => {
    const bad = view({ userFile: { path: "/u/lsp.json", exists: true, applied: false, errors: ["servers[0] (`rust`): unknown field `comand`"] } });
    expect(invalidFiles(bad).map((f) => f.path)).toEqual(["/u/lsp.json"]);
    expect(invalidFiles(view())).toEqual([]);
    expect(invalidFiles(null)).toEqual([]);
    expect(errorsKey(invalidFiles(bad))).toContain("comand");
    const e = effectiveEntry(view(), "zls")!;
    expect(e.languages).toEqual(["zig"]);
    expect(e.approval?.hash).toBe("abc123");
    expect(e.approved).toBe(false);
    expect(JSON.parse(e.json)).toMatchObject({ id: "zls", command: "zls-ls" });
    expect(JSON.parse(e.json).sources).toBeUndefined();
    const approved = view({ servers: [server("zls", { projectLaunch: ["args"], approval: null })] });
    expect(effectiveEntry(approved, "zls")!.approved).toBe(true);
    expect(effectiveEntry(view(), "nope")).toBe(null);
    expect(serversForInspection(view())[0].id).toBe("zls"); // tocado por um override: primeiro
    expect(projectFileKey("proj/")).toBe("proj/.dxtutor/lsp.json");
  });

  it("um override que troca o comando não herda o «Install» do embutido", async () => {
    const { missingServerNotice } = await import("../src/features/lsp/domain/server-status");
    const st: ServerStatus = { language: "python", server: "pyright", installed: false, problem: "não encontrado" };
    expect(missingServerNotice(st)!.command).toBe("npm install -g pyright");
    useRegistry({ ...REGISTRY, servers: REGISTRY.servers.map((s) => (s.id === "python" ? { ...s, command: "basedpyright-langserver" } : s)) });
    const n = missingServerNotice(st)!;
    expect(n.command).toBe(null); // só a instrução
    expect(n.install).toBe("npm install -g pyright");
  });

  it("um pedido de aprovação só conta com o servidor instalado", () => {
    const st: ServerStatus = { language: "zls", server: "zls", installed: true, approval };
    expect(pendingApproval(st)).toBe(approval);
    expect(pendingApproval({ ...st, installed: false })).toBe(null);
    expect(pendingApproval({ ...st, approval: null })).toBe(null);
    expect(pendingApproval(null)).toBe(null);
  });
});

function overridesSetup(opts: { files?: Record<string, string>; cfg?: LspConfigView; approve?: boolean; approveThrows?: string } = {}) {
  const calls: string[] = [];
  const files: Record<string, string> = opts.files ?? {};
  let cfg = opts.cfg ?? view();
  const config: LspConfigPort = {
    config: async (root) => (calls.push(`config ${root}`), cfg),
    configFile: async (kind, root) => (calls.push(`file ${kind} ${root}`), { path: kind === "user" ? "/u/lsp.json" : `${root}/.dxtutor/lsp.json`, exists: false, text: `// ${kind} template\n{}` }),
    saveUserConfig: async (text) => (calls.push(`save ${text}`), { path: "/u/lsp.json", exists: true, applied: text !== "bad", errors: text === "bad" ? ["not valid JSON"] : [] }),
    approveServer: async (root, srv, hash, approved, reason) => {
      calls.push(`approve ${root} ${srv} ${hash} ${approved} ${reason}`);
      if (opts.approveThrows) throw new Error(opts.approveThrows);
    },
    onConfig: () => {},
  };
  const workspace: WorkspacePort = {
    diskRoot: () => "/home/u/proj",
    virtualPrefix: () => "proj/",
    fileKeyOfTab: () => null,
    currentFileKey: () => "proj/src/main.zig",
    text: (k) => files[k] ?? null,
  };
  const shown: string[] = [];
  const editor = {
    repaint: () => {},
    open: (k: string, l: number, c: number) => void shown.push(`open ${k} ${l}:${c}`),
    notify: (m: string) => void shown.push(`notify ${m}`),
    writeFile: (k: string, t: string) => { files[k] = t; shown.push(`write ${k}`); },
    reload: () => {},
    replaceText: () => {},
    builtinFormat: () => {},
    notice: () => {},
  } as EditorPort;
  const dialogs: { title: string; command: string; scope: string }[] = [];
  const human = { approve: async (r: { title: string; command: string; scope: string }) => (dialogs.push(r), { approved: opts.approve ?? true, reason: "ok", decidedAt: 5 }) };
  const ui: string[] = [];
  let saveFn: ((t: string) => Promise<unknown>) | null = null;
  let reviewFn: ((id: string) => void) | null = null;
  const v: OverridesView = {
    editUserFile: (f, save) => { ui.push(`edit ${f.path} ${f.text.split("\n")[0]}`); saveFn = save; },
    showEffective: (cv, selected, review) => { ui.push(`effective ${selected}`); reviewFn = review; },
    showInvalid: (fs) => void ui.push(`invalid ${fs.map((f) => f.path).join(",")}`),
  };
  const changed = vi.fn();
  const ov = makeOverrides({ config, workspace, editor, human, view: v, onChanged: changed });
  return { ov, changed, calls, shown, files, dialogs, ui, setCfg: (c: LspConfigView) => (cfg = c), save: (t: string) => saveFn!(t), review: (id: string) => reviewFn!(id) };
}

describe("o caso de uso dos overrides (a paleta e os avisos)", () => {
  it("lê o registo efectivo uma vez por pasta, põe-no em uso e só avisa dos ficheiros ignorados quando mudam", async () => {
    const t = overridesSetup();
    await t.ov.ready("/home/u/proj");
    await t.ov.ready("/home/u/proj");
    expect(t.calls).toEqual(["config /home/u/proj"]);
    expect(languageIdFor("/home/u/proj/a.zig")).toBe("zig");
    expect(t.ui).toEqual([]); // nada inválido: nenhum aviso
    const bad = view({ projectFile: { path: "/home/u/proj/.dxtutor/lsp.json", exists: true, applied: false, errors: ["unknown field `lsp`"] } });
    t.setCfg(bad);
    await t.ov.reload();
    await t.ov.reload(); // os mesmos erros: não repete
    expect(t.ui).toEqual(["invalid /home/u/proj/.dxtutor/lsp.json"]);
    t.setCfg(view());
    await t.ov.reload(); // corrigido: tira o aviso
    expect(t.ui).toEqual(["invalid /home/u/proj/.dxtutor/lsp.json", "invalid "]);
  });

  it("abre o ficheiro do projecto num separador, criado com o modelo comentado se não existe", async () => {
    const t = overridesSetup();
    await t.ov.openProjectFile();
    expect(t.calls).toEqual(["file project /home/u/proj"]);
    expect(t.files["proj/.dxtutor/lsp.json"]).toBe("// project template\n{}");
    expect(t.shown).toEqual(["write proj/.dxtutor/lsp.json", "open proj/.dxtutor/lsp.json 1:0"]);
    // já no editor: abre-o tal como está (nunca o reescreve)
    const t2 = overridesSetup({ files: { "proj/.dxtutor/lsp.json": "{ \"servers\": [] }" } });
    await t2.ov.openProjectFile();
    expect(t2.calls).toEqual([]);
    expect(t2.files["proj/.dxtutor/lsp.json"]).toBe("{ \"servers\": [] }");
    expect(t2.shown).toEqual(["open proj/.dxtutor/lsp.json 1:0"]);
  });

  it("abre o ficheiro do utilizador no seu editor; gravar aplica e volta a ler o registo", async () => {
    const t = overridesSetup();
    await t.ov.openUserFile();
    expect(t.ui).toEqual(["edit /u/lsp.json // user template"]);
    const rep = await t.save("bad");
    expect(rep).toMatchObject({ applied: false, errors: ["not valid JSON"] });
    expect(t.calls).toEqual(["file user null", "save bad", "config /home/u/proj"]);
  });

  it("mostra a configuração efectiva com o servidor do ficheiro aberto escolhido; «Review…» abre a aprovação", async () => {
    const t = overridesSetup();
    await t.ov.showEffective();
    expect(t.ui).toEqual(["effective zls"]);
    t.review("zls");
    await vi.waitFor(() => expect(t.dialogs.length).toBe(1));
  });

  it("revê um comando do projecto: o diálogo mostra o comando EXACTO e de onde vem; o backend recebe a decisão", async () => {
    const t = overridesSetup();
    expect(await t.ov.review(approval)).toBe(true);
    expect(t.dialogs[0].command).toBe("/home/u/proj/bin/zls --stdio");
    expect(t.dialogs[0].title).toContain("zls");
    expect(t.dialogs[0].scope).toContain("/home/u/proj/.dxtutor/lsp.json");
    expect(t.dialogs[0].scope).toContain("command, args");
    expect(t.dialogs[0].scope).toContain("inside the project folder");
    expect(t.calls[0]).toBe("approve /home/u/proj zls abc123 true ok");
    expect(t.calls).toContain("config /home/u/proj"); // volta a ler: a aprovação já conta
    expect(t.changed).toHaveBeenCalled(); // o editor revê o ficheiro aberto
    // definições do projecto: o diálogo mostra-as por baixo do comando, e o título diz o que se aplica
    const st = overridesSetup();
    expect(await st.ov.review(settingsOnly)).toBe(true);
    expect(st.dialogs[0].title).toBe("Apply this project's settings to the zls language server");
    expect(st.dialogs[0].command).toContain("/usr/bin/zls --stdio\n\nsettings from .dxtutor/lsp.json:");
    expect(st.dialogs[0].command).toContain("sh -c evil");
    expect(st.calls[0]).toBe("approve /home/u/proj zls def456 true ok");
    // recusado: a recusa também vai ao backend (auditada), e nada corre
    const no = overridesSetup({ approve: false });
    expect(await no.ov.review(approval)).toBe(false);
    expect(no.calls[0]).toBe("approve /home/u/proj zls abc123 false ok");
    expect(no.shown.some((s) => s.includes("was not approved"))).toBe(true);
    // a auditoria falhou (ou o comando mudou entretanto): não aprovado, e diz porquê
    const fail = overridesSetup({ approveThrows: "the project's command changed since it was shown" });
    expect(await fail.ov.review(approval)).toBe(false);
    expect(fail.shown).toContain("notify Not approved: the project's command changed since it was shown");
  });
});

function clientSetup(st: ServerStatus | null, review: boolean | null = true) {
  const calls: string[] = [];
  const files: Record<string, string> = { "proj/src/main.zig": "const x = 1;\n" };
  let status = st;
  const lsp = {
    start: async (root: string) => void calls.push(`start ${root}`),
    didOpen: async (path: string, _t: string, lang: string) => void calls.push(`open ${path} ${lang}`),
    didChange: async () => {},
    serverStatus: async () => (calls.push("status"), status),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => "/home/u/proj",
    virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => (id && id in files ? id : null),
    currentFileKey: () => "proj/src/main.zig",
    text: (k) => files[k] ?? null,
  };
  const notices: { n: EditorNotice | null; acts?: NoticeActions }[] = [];
  const editor = {
    repaint: (k: string) => void calls.push(`repaint ${k}`),
    open: () => {},
    notify: (m: string) => void calls.push(`notify ${m}`),
    writeFile: () => {},
    reload: () => {},
    replaceText: () => {},
    builtinFormat: () => {},
    notice: (_k: string, n: EditorNotice | null, _d?: () => void, acts?: NoticeActions) => void notices.push({ n, acts }),
  } as EditorPort;
  const overrides = {
    ready: async (root: string) => { calls.push(`ready ${root}`); useRegistry(effectiveRegistry(view())); },
    review: async (a: ServerApproval) => {
      calls.push(`review ${a.hash}`);
      if (review) status = { language: "zls", server: "zls", installed: true, approval: null };
      return !!review;
    },
  };
  const configure = vi.fn();
  const client = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {}, overrides, configure });
  return { client, calls, notices, configure, setStatus: (s: ServerStatus | null) => (status = s) };
}

describe("o cliente: a faixa de aprovação e o lembrete dos overrides", () => {
  it("põe o registo efectivo em uso antes de decidir a linguagem (uma linguagem nova do override abre)", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: true, approval: null });
    await t.client.onTab("proj/src/main.zig");
    expect(t.calls).toEqual(["ready /home/u/proj", "status", "start /home/u/proj", "open /home/u/proj/src/main.zig zig"]);
  });

  it("um comando do projecto por aprovar: faixa com «Review…» e o ficheiro NÃO abre no servidor; aprovado, abre", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: true, approval });
    await t.client.onTab("proj/src/main.zig");
    expect(t.calls.some((c) => c.startsWith("open ") || c.startsWith("start "))).toBe(false);
    const last = t.notices.at(-1)!;
    expect(last.n?.kind).toBe("approval");
    expect(last.n?.title).toBe("zls is waiting for your approval");
    expect(last.n?.detail).toContain("/home/u/proj/bin/zls --stdio");
    expect(last.n?.hint).toBe("The program is inside the project folder.");
    last.acts!.review!();
    await vi.waitFor(() => expect(t.calls).toContain("open /home/u/proj/src/main.zig zig"));
    expect(t.calls).toContain("review abc123");
    expect(t.calls).toContain("repaint proj/src/main.zig");
    expect(t.notices.at(-1)!.n).toBe(null); // a faixa sai
  });

  it("só definições do projecto: o servidor arranca (com as de confiança) e a faixa pede a revisão das definições", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: true, approval: settingsOnly });
    await t.client.onTab("proj/src/main.zig");
    expect(t.calls).toContain("open /home/u/proj/src/main.zig zig"); // a linguagem funciona
    const last = t.notices.at(-1)!;
    expect(last.n?.kind).toBe("approval");
    expect(last.n?.title).toBe("zls: this project's settings are waiting for your approval");
    expect(last.n?.detail).toContain("its own settings");
    expect(last.n?.detail).toContain("not applied until you approve them");
    last.acts!.review!();
    await vi.waitFor(() => expect(t.calls).toContain("review def456"));
  });

  it("recusado: a faixa fica e nada arranca", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: true, approval }, false);
    await t.client.onTab("proj/src/main.zig");
    t.notices.at(-1)!.acts!.review!();
    await vi.waitFor(() => expect(t.calls).toContain("review abc123"));
    await vi.waitFor(() => expect(t.notices.length).toBe(2));
    expect(t.notices.at(-1)!.n?.kind).toBe("approval");
    expect(t.calls.some((c) => c.startsWith("open "))).toBe(false);
  });

  it("a faixa de servidor em falta lembra os overrides e tem «Configure…»", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: false, problem: "não encontrado" });
    await t.client.onTab("proj/src/main.zig");
    const last = t.notices.at(-1)!;
    expect(last.n?.kind).toBe("missing");
    expect(last.n?.hint).toBe(LSP_OVERRIDE_MESSAGES.en.overridesHint);
    last.acts!.configure!();
    expect(t.configure).toHaveBeenCalled();
  });

  it("um ficheiro de overrides mudou: esquece o estado dos servidores e revê o ficheiro aberto", async () => {
    const t = clientSetup({ language: "zls", server: "zls", installed: true, approval: null });
    await t.client.onTab("proj/src/main.zig");
    t.setStatus({ language: "zls", server: "zls", installed: true, approval });
    await t.client.onConfigChanged();
    expect(t.calls.filter((c) => c === "status").length).toBe(2);
    expect(t.notices.at(-1)!.n?.kind).toBe("approval");
  });
});

describe("os ecrãs dos overrides (DOM)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("o editor do lsp.json do utilizador: grava, mostra os erros de um ficheiro ignorado, Esc fecha", async () => {
    const save = vi.fn(async (text: string) => (text.includes("oops") ? { path: "/u/lsp.json", exists: true, applied: false, errors: ["not valid JSON: EOF at line 1 column 5"] } : { path: "/u/lsp.json", exists: true, applied: true, errors: [] }));
    overridesView.editUserFile({ path: "/u/lsp.json", exists: false, text: "// template\n{}" }, save);
    const box = document.getElementById("lsp-config")!;
    expect(box.querySelector("code")!.textContent).toBe("/u/lsp.json");
    const ta = box.querySelector("textarea")!;
    expect(ta.value).toBe("// template\n{}");
    ta.value = "{ oops";
    (box.querySelector('[data-k="save"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(box.querySelector(".lsp-cfg-out")!.textContent).toContain("ignored until it is fixed"));
    expect(save).toHaveBeenCalledWith("{ oops");
    expect(box.querySelector(".lsp-cfg-errs")!.textContent).toContain("line 1 column 5");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("lsp-config")).toBe(null);
  });

  it("o aviso dos ficheiros ignorados lista cada um com os erros e «Open»; [] tira-o", () => {
    const open = vi.fn();
    overridesView.showInvalid([{ path: "/p/.dxtutor/lsp.json", exists: true, applied: false, errors: ["servers[0] (`rust`): unknown field `comand`"] }], open);
    const el = document.getElementById("lsp-config-errors")!;
    expect(el.textContent).toContain("/p/.dxtutor/lsp.json");
    expect(el.textContent).toContain("unknown field `comand`");
    (el.querySelector("[data-open]") as HTMLButtonElement).click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ path: "/p/.dxtutor/lsp.json" }));
    overridesView.showInvalid([], open);
    expect(document.getElementById("lsp-config-errors")).toBe(null);
  });

  it("a configuração efectiva: os ficheiros, a entrada em JSON e «Review…» para um servidor pendente", () => {
    const review = vi.fn();
    overridesView.showEffective(view(), "zls", review);
    const box = document.getElementById("lsp-effective")!;
    expect(box.textContent).toContain("/home/u/proj/.dxtutor/lsp.json");
    expect(box.querySelector(".lsp-eff-json")!.textContent).toContain('"command": "zls-ls"');
    expect(box.textContent).toContain("Waiting for your approval: /home/u/proj/bin/zls --stdio");
    // as definições pendentes aparecem na vista
    overridesView.showEffective(view({ servers: [server("zls", { projectConfig: ["settings"], approval: settingsOnly })] }), "zls", review);
    expect(document.querySelector(".lsp-eff-config")!.textContent).toContain("sh -c evil");
    overridesView.showEffective(view(), "zls", review);
    (box.querySelector('[data-k="review"]') as HTMLButtonElement).click();
    expect(review).toHaveBeenCalledWith("zls");
    // escolher outro servidor redesenha
    overridesView.showEffective(view(), "rust", review);
    const sel = document.getElementById("lsp-eff-server") as HTMLSelectElement;
    expect(sel.value).toBe("rust");
    expect(document.querySelector(".lsp-eff-json")!.textContent).toContain('"label": "rust-analyzer"');
  });
});
