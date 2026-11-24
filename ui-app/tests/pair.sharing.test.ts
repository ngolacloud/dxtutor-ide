import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* A1 — PairCode sharing (docs/v2/UI-AUDIT.md, items 1–2). The filter is on what is SENT:
   private files never reach the guest (snapshot, sync, view, tabs), .env and keys are always
   private, the host makes a tab or a folder private with a right-click, the guest mirrors
   only the shared tabs, and the tab bar says what is shared. A minimal channel stands in for
   the Tauri PairCode commands (pair_host/join/send) and events (pair-status/pair-msg). */

type Listener = (e: { payload: unknown }) => void;
let w: Window & Record<string, any>;
let L: Record<string, Listener>;
let sent: Array<Record<string, any>>;

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const last = (t: string) => [...sent].reverse().find((m) => m.t === t);
const status = (state: string) => L["pair-status"]({ payload: { state } });
const msg = (m: Record<string, unknown>) => L["pair-msg"]({ payload: JSON.stringify(m) });

beforeEach(async () => {
  vi.useFakeTimers();
  w = (await bootApp()) as Window & Record<string, any>;
  L = {};
  sent = [];
  w.__PAIRSIM__ = {
    T: { event: { listen: (n: string, f: Listener) => { L[n] = f; return Promise.resolve(); } } },
    inv: async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "pair_host") return "dxp_token";
      if (cmd === "pair_join") return "Walter";
      if (cmd === "pair_send") sent.push(JSON.parse(String(args?.msg)));
      return null;
    },
    R: { user: "ana", name: "proj", root: null, git: false, disk: {}, info: {}, errors: [] },
    media: () => null,
  };
  await import("../src/pair.ts");
});
afterEach(() => vi.useRealTimers());

describe("the host shares everything but its private files", () => {
  it("never sends .env or key files, and a tab made private leaves the guest", async () => {
    const R = w.ROOT as string;
    w.FS[R + ".env"] = { content: "API_KEY=s3cret", orig: null };
    w.FS[R + "deploy/id_ed25519"] = { content: "KEY", orig: null };
    w.FS[R + "notes/plan.md"] = { content: "# plan", orig: null };
    w.PAIR.ui.start();
    await flush();
    status("connected");
    await flush();
    const snap = last("snap")!;
    expect(Object.keys(snap.files)).toContain(R + "notes/plan.md");
    expect(Object.keys(snap.files)).not.toContain(R + ".env");
    expect(Object.keys(snap.files)).not.toContain(R + "deploy/id_ed25519");
    expect(JSON.stringify(sent)).not.toContain("s3cret");

    // the host opens the note: it is a shared tab, marked, and the guest is told
    w.openPath(R + "notes/plan.md");
    vi.advanceTimersByTime(250);
    await flush();
    expect(last("tabs")!.tabs).toContain(R + "notes/plan.md");
    const tab = [...document.querySelectorAll("#tabs .tab")].find((t) => t.textContent!.includes("plan.md")) as HTMLElement;
    expect(tab.classList.contains("pair-shared")).toBe(true);
    expect(document.querySelector("#tabs .pair-legend")!.textContent).toMatch(/Shared with .* · 1 tab$/);

    // right-click → private: removed from the guest, from its tabs, and from the view it follows
    tab.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    await flush();
    expect(last("files")!.del).toEqual([R + "notes/plan.md"]);
    expect(last("tabs")!.tabs).not.toContain(R + "notes/plan.md");
    vi.advanceTimersByTime(250);
    await flush();
    expect(last("view")!.path).toBeNull();
    const again = [...document.querySelectorAll("#tabs .tab")].find((t) => t.textContent!.includes("plan.md")) as HTMLElement;
    expect(again.classList.contains("pair-private")).toBe(true);
    expect(document.querySelector("#tabs .pair-legend")!.textContent).toMatch(/· 0 tabs$/);

    // edits to a private file are never synced
    w.FS[R + "notes/plan.md"].content = "# secret plan";
    w.refresh(true);
    vi.advanceTimersByTime(200);
    await flush();
    expect(JSON.stringify(sent)).not.toContain("secret plan");
  });

  it("a guest driving cannot write private paths on the host", async () => {
    const R = w.ROOT as string;
    w.PAIR.ui.start();
    await flush();
    status("connected");
    await flush();
    msg({ t: "ctl", driver: "guest" }); // the host only accepts this back from a driving guest
    w.PAIR.driver = "guest";
    msg({ t: "files", set: { [R + ".env"]: "API_KEY=x" }, del: [] });
    await flush();
    expect(w.FS[R + ".env"]).toBeUndefined();
  });
});

describe("the guest mirrors only the shared tabs", () => {
  it("opens the host's shared tabs and closes a tab whose file stops being shared", async () => {
    const R = w.ROOT as string;
    w.PAIR.ui.join = w.PAIR.ui.join; // (the panel input is empty: join through the client directly)
    await w.PAIR.ui.tab("join");
    (document.getElementById("pair-in") as HTMLTextAreaElement).value = "dxp_token";
    await w.PAIR.ui.join();
    status("connected");
    await flush();
    msg({ t: "hello", name: "Walter" });
    msg({ t: "snap", name: "proj", branch: "main", files: { [R + "a.rs"]: "a", [R + "b.rs"]: "b" }, orig: {}, driver: "host", view: null });
    await flush();
    msg({ t: "tabs", tabs: [R + "a.rs", R + "b.rs", R + "../etc/passwd"] });
    await flush();
    const titles = () => [...document.querySelectorAll("#tabs .tab .nm")].map((n) => n.textContent);
    expect(titles()).toEqual(["a.rs", "b.rs"]);
    expect(document.querySelector("#tabs .pair-legend")!.textContent).toMatch(/Shared by Walter · 2 tabs$/);
    msg({ t: "files", set: {}, del: [R + "b.rs"] });
    await flush();
    expect(titles()).toEqual(["a.rs"]);
  });
});

describe("the call lives in the side bar", () => {
  it("with no room in the side bar, the status item offers to show the call", async () => {
    w.PAIR.ui.start();
    await flush();
    status("connected");
    msg({ t: "hello", name: "Ana" });
    await flush();
    vi.advanceTimersByTime(800);
    // jsdom has no layout: the side bar has no size, as if it were hidden
    expect(document.getElementById("pair-dock")!.style.display).toBe("none");
    expect(document.getElementById("st-pair")!.textContent).toContain("show call");
    expect(document.documentElement.style.getPropertyValue("--pair-dock-h")).toBe("0px");
  });
});
