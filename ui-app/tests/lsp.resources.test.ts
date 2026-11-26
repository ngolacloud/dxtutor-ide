// feature `lsp` — os recursos dos servidores de linguagem (LSP P6): o `didClose` quando um separador fecha ou um
// ficheiro desaparece, a troca de pasta, a lista dos servidores a correr (caso de uso e ecrã) e o bus do editor.
import { afterEach, describe, expect, it } from "vitest";
import { makeLspClient } from "../src/features/lsp/application/lsp-client";
import { makeServers, REFRESH_MS } from "../src/features/lsp/application/servers";
import { LSP_SERVERS_MESSAGES } from "../src/features/lsp/application/servers-messages";
import { duration, memory, relativeTo, serverRows, totalMemory, type ServerInfo, type ServersView } from "../src/features/lsp/domain/servers";
import type { EditorPort, LspPort, ServersActions, ServersPort, ServersScreen, WorkspacePort } from "../src/features/lsp/application/ports";
import { serversScreen } from "../src/features/lsp/ui/servers-view";
import { createBus } from "../src/app/bus";

const ROOT = "/home/u/proj";

function client(files: Record<string, string>) {
  const calls: string[] = [];
  let root: string | null = ROOT;
  let current: string | null = null;
  const lsp = {
    start: async (r: string) => void calls.push(`start ${r}`),
    didOpen: async (path: string) => void calls.push(`open ${path}`),
    didChange: async (path: string, _t: string, v: number) => void calls.push(`change ${path} v${v}`),
    didClose: async (path: string) => void calls.push(`close ${path}`),
    closeFolder: async (r: string) => void calls.push(`closeFolder ${r}`),
    serverStatus: async () => ({ language: "python", server: "pyright", installed: true, problem: null }),
    onDiagnostics: () => {},
  } as unknown as LspPort;
  const workspace: WorkspacePort = {
    diskRoot: () => root,
    virtualPrefix: () => "proj/",
    fileKeyOfTab: (id) => (id && id in files ? id : null),
    currentFileKey: () => current,
    text: (k) => files[k] ?? null,
  };
  const editor = { repaint: () => {}, open: () => {}, notify: () => {}, writeFile: () => {}, reload: () => {}, notice: () => {} } as unknown as EditorPort;
  const c = makeLspClient({ lsp, workspace, editor, defer: (f) => f(), sleep: async () => {} });
  return {
    c,
    calls,
    files,
    activate: (k: string) => ((current = k), c.onTab(k)),
    setRoot: (r: string | null) => (root = r),
  };
}

describe("o didClose do cliente", () => {
  it("fechar o separador de um ficheiro aberto no servidor envia didClose uma vez; voltar a abri-lo envia didOpen", async () => {
    const t = client({ "proj/a.py": "x = 1\n", "proj/b.py": "y = 2\n" });
    await t.activate("proj/a.py");
    await t.activate("proj/b.py");
    await t.c.onTabClosed("proj/a.py");
    await t.c.onTabClosed("proj/a.py");
    await t.c.onTabClosed(null); // um separador que não é de ficheiro
    expect(t.calls).toEqual(["start /home/u/proj", "open /home/u/proj/a.py", "open /home/u/proj/b.py", "close /home/u/proj/a.py"]);
    expect([...t.c.opened().keys()]).toEqual(["/home/u/proj/b.py"]);
    await t.activate("proj/a.py");
    expect(t.calls.at(-1)).toBe("open /home/u/proj/a.py");
  });

  it("um separador que nunca chegou ao servidor não dá didClose", async () => {
    const t = client({ "proj/a.py": "x", "proj/notes.txt": "n" });
    await t.c.onTabClosed("proj/notes.txt");
    await t.c.onTabClosed("proj/a.py");
    expect(t.calls.filter((c) => c.startsWith("close"))).toEqual([]);
  });

  it("um ficheiro apagado ou renomeado fecha no servidor quando o workspace muda", async () => {
    const t = client({ "proj/a.py": "x", "proj/b.py": "y" });
    await t.activate("proj/a.py");
    await t.activate("proj/b.py");
    await t.c.onWorkspaceChanged();
    expect(t.calls.some((c) => c.startsWith("close"))).toBe(false);
    // renomeado: a chave antiga desaparece do FS
    t.files["proj/c.py"] = t.files["proj/a.py"];
    delete t.files["proj/a.py"];
    await t.c.onWorkspaceChanged();
    expect(t.calls.filter((c) => c.startsWith("close"))).toEqual(["close /home/u/proj/a.py"]);
    await t.activate("proj/c.py");
    expect(t.calls.at(-1)).toBe("open /home/u/proj/c.py");
  });

  it("abrir outra pasta pára os servidores da anterior e volta a arrancar a pasta quando regressa", async () => {
    const t = client({ "proj/a.py": "x" });
    await t.c.onFolder(ROOT); // a mesma: nada
    await t.activate("proj/a.py");
    t.setRoot("/home/u/other");
    // os separadores da pasta anterior fecham depois de a pasta mudar: pela chave, não pelo caminho novo
    await t.c.onTabClosed("proj/a.py");
    await t.c.onFolder("/home/u/other");
    expect(t.calls.slice(2)).toEqual(["close /home/u/proj/a.py", "closeFolder /home/u/proj"]);
    expect(t.c.opened().size).toBe(0);
    // de volta à primeira: arranca-a outra vez (o backend esqueceu-a)
    t.setRoot(ROOT);
    await t.c.onFolder(ROOT);
    await t.activate("proj/a.py");
    expect(t.calls.slice(-3)).toEqual(["closeFolder /home/u/other", "start /home/u/proj", "open /home/u/proj/a.py"]);
  });

  it("documentos ainda abertos da pasta anterior esquecem-se sem didClose (o backend fecha-os com a pasta)", async () => {
    const t = client({ "proj/a.py": "x" });
    await t.activate("proj/a.py");
    t.setRoot("/home/u/other");
    await t.c.onFolder("/home/u/other");
    expect(t.calls.filter((c) => c.startsWith("close "))).toEqual([]);
    expect(t.c.opened().size).toBe(0);
  });
});

describe("o bus do editor", () => {
  it("editor:tab-closed leva o id e a chave do ficheiro", () => {
    const b = createBus();
    const got: unknown[] = [];
    b.on("editor:tab-closed", (p) => got.push(p));
    b.emit("editor:tab-closed", { id: "proj/a.py", path: "proj/a.py" });
    expect(got).toEqual([{ id: "proj/a.py", path: "proj/a.py" }]);
  });
});

const info = (o: Partial<ServerInfo> = {}): ServerInfo => ({
  key: "python\u0000/home/u/proj\u0000/home/u/proj",
  server: "python",
  label: "pyright",
  root: ROOT,
  project: ROOT,
  pid: 4242,
  state: "ready",
  documents: [],
  idleSecs: 125,
  stopsInSecs: 475,
  uptimeSecs: 900,
  memoryKib: 150 * 1024,
  ...o,
});
const view = (servers: ServerInfo[], o: Partial<ServersView> = {}): ServersView => ({ servers, idleMinutes: 10, maxServers: 6, ...o });
const en = (k: keyof typeof LSP_SERVERS_MESSAGES.en, p: Record<string, string | number> = {}) =>
  LSP_SERVERS_MESSAGES.en[k].replace(/\{(\w+)\}/g, (a, n: string) => (n in p ? String(p[n]) : a));

describe("a lista de servidores (domínio)", () => {
  it("durações, memória e caminhos legíveis", () => {
    expect([duration(0), duration(59), duration(61), duration(3600), duration(3720)]).toEqual(["0 s", "59 s", "1 min", "1 h", "1 h 2 min"]);
    expect([memory(null), memory(900), memory(150 * 1024), memory(1536 * 1024)]).toEqual(["—", "900 KiB", "150 MiB", "1.5 GiB"]);
    expect([relativeTo(ROOT, ROOT), relativeTo(`${ROOT}/svc/api`, `${ROOT}/`), relativeTo("/elsewhere", ROOT), relativeTo("/x", null)]).toEqual([".", "svc/api", "/elsewhere", "/x"]);
  });

  it("com ficheiros abertos diz quantos; sem eles, há quanto tempo está inactivo e quando pára", () => {
    const rows = serverRows(
      view([info({ documents: [`${ROOT}/a.py`, `${ROOT}/b.py`], stopsInSecs: null }), info({ key: "k2", label: "gopls", root: `${ROOT}/svc` }), info({ key: "k3", pid: null, state: "starting", stopsInSecs: null, memoryKib: null })]),
      ROOT,
      en,
    );
    expect(rows.map((r) => r.idle)).toEqual(["2 open", "idle 2 min · stops in 7 min", "idle 2 min"]);
    expect(rows[0].files).toEqual(["a.py", "b.py"]);
    expect(rows.map((r) => r.root)).toEqual([".", "svc", "."]);
    expect(rows.map((r) => [r.pid, r.memory])).toEqual([["4242", "150 MiB"], ["4242", "150 MiB"], ["—", "—"]]);
    expect(totalMemory(view([info(), info({ memoryKib: null }), info({ memoryKib: 1024 })]))).toBe(151 * 1024);
    expect(totalMemory(view([info({ memoryKib: null })]))).toBeNull();
  });

  it("sem tempo de inactividade (0), nenhum pára por estar inactivo", () => {
    const rows = serverRows(view([info({ stopsInSecs: null })], { idleMinutes: 0 }), ROOT, en);
    expect(rows[0].idle).toBe("idle 2 min");
  });
});

function servers(initial: ServersView) {
  let current = initial;
  const calls: string[] = [];
  let changed: () => void = () => {};
  let ticks: (() => void) | null = null;
  let open = false;
  const shown: ServersView[] = [];
  let acts: ServersActions | null = null;
  const port: ServersPort = {
    list: async () => (calls.push("list"), current),
    stop: async (k) => {
      calls.push(`stop ${k}`);
      if (k === "bad") throw new Error("that language server is not running any more");
      current = view(current.servers.filter((s) => s.key !== k));
    },
    restart: async (k) => void calls.push(`restart ${k}`),
    onChanged: (cb) => (changed = cb),
    onLimit: () => {},
  };
  const screen: ServersScreen = {
    show: (v, a) => {
      open = true;
      shown.push(v);
      acts = a;
    },
    isOpen: () => open,
  };
  const notes: string[] = [];
  let logs = 0;
  const s = makeServers({
    port,
    screen,
    copy: en,
    notify: (m) => notes.push(m),
    showLog: () => logs++,
    every: (ms, f) => {
      expect(ms).toBe(REFRESH_MS);
      ticks = f;
      return () => (ticks = null);
    },
  });
  return {
    s,
    calls,
    shown,
    notes,
    acts: () => acts!,
    tick: () => ticks?.(),
    ticking: () => ticks != null,
    changed: () => changed(),
    close: () => (open = false),
    logs: () => logs,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("a lista de servidores (caso de uso)", () => {
  it("abre com a lista, relê-a enquanto está aberta e pára de reler quando fecha", async () => {
    const t = servers(view([info()]));
    await t.s.show();
    expect(t.shown).toHaveLength(1);
    expect(t.ticking()).toBe(true);
    t.tick();
    await flush();
    t.changed(); // lsp://servers
    await flush();
    expect(t.shown).toHaveLength(3);
    t.close();
    t.tick();
    await flush();
    expect(t.ticking()).toBe(false);
    t.changed();
    await flush();
    expect(t.shown).toHaveLength(3);
  });

  it("«Stop» e «Restart» vão ao backend, dizem o resultado e redesenham", async () => {
    const t = servers(view([info()]));
    await t.s.show();
    t.acts().stop(info().key);
    await flush();
    await flush();
    expect(t.calls).toContain(`stop ${info().key}`);
    expect(t.notes).toEqual(["pyright stopped."]);
    expect(t.shown.at(-1)!.servers).toEqual([]);
    t.acts().restart("k9");
    await flush();
    await flush();
    expect(t.notes.at(-1)).toBe("k9 restarted.");
    t.acts().stop("bad");
    await flush();
    await flush();
    expect(t.notes.at(-1)).toBe("bad: that language server is not running any more");
    t.acts().showLog();
    expect(t.logs()).toBe(1);
  });

  it("o tecto por cumprir é avisado com os números", () => {
    const t = servers(view([]));
    t.s.onLimit({ running: 7, max: 6, servers: [] });
    expect(t.notes).toEqual([en("limit", { running: 7, max: 6 })]);
  });
});

describe("o ecrã dos servidores", () => {
  afterEach(() => document.getElementById("lsp-servers")?.remove());

  it("desenha a tabela, redesenha no lugar e os botões chamam as acções com a chave", () => {
    const got: string[] = [];
    const acts: ServersActions = { stop: (k) => got.push(`stop ${k}`), restart: (k) => got.push(`restart ${k}`), showLog: () => got.push("log") };
    const screen = serversScreen(() => ROOT);
    expect(screen.isOpen()).toBe(false);
    screen.show(view([info({ documents: [`${ROOT}/a.py`], stopsInSecs: null })]), acts);
    const box = document.getElementById("lsp-servers")!;
    expect(screen.isOpen()).toBe(true);
    const row = box.querySelector("tr[data-i]")!;
    expect(row.textContent).toContain("pyright");
    expect(row.textContent).toContain("4242");
    expect(row.textContent).toContain("1 open");
    expect(row.textContent).toContain("150 MiB");
    expect(box.textContent).toContain("stops after 10 min");
    (row.querySelector('[data-k="restart"]') as HTMLButtonElement).click();
    (row.querySelector('[data-k="stop"]') as HTMLButtonElement).click();
    expect(got).toEqual([`restart ${info().key}`, `stop ${info().key}`]);
    // redesenha no mesmo diálogo
    screen.show(view([]), acts);
    expect(document.querySelectorAll("#lsp-servers")).toHaveLength(1);
    expect(box.textContent).toContain("No language server is running");
    (box.querySelector('[data-k="log"]') as HTMLButtonElement).click();
    expect(got.at(-1)).toBe("log");
    expect(screen.isOpen()).toBe(false);
  });

  it("o texto escapa o que vem do backend", () => {
    const screen = serversScreen(() => null);
    screen.show(view([info({ label: "<img src=x onerror=1>", root: "/a<b>" })]), { stop: () => {}, restart: () => {}, showLog: () => {} });
    const box = document.getElementById("lsp-servers")!;
    expect(box.querySelector("img")).toBeNull();
    expect(box.textContent).toContain("<img src=x onerror=1>");
  });
});
