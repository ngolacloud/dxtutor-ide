/* ═══════════ A1 — PairCode: shared tabs and the call in the side bar (docs/v2/UI-AUDIT.md, items 1–2) ═══════════
   The real app in desktop mode, hosting a session against a scripted channel: a fake
   `window.__TAURI__` answers the desktop boot and `pair_host`/`pair_send`, and plays the guest
   joining (`pair-status: connected`, `hello`). The two-instance pairtest proves the real
   transport; this proves what crosses it and the layout: private files are never sent, tabs
   are marked shared/private with the legend, the call sits at the bottom of the side bar at
   its full width (36 px minimised), and with the side bar hidden it lives in the status bar. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const sent: Array<Record<string, unknown>> = [];
  const emit = (event: string, payload: unknown) => (listeners[event] || []).forEach((h) => h({ payload }));
  const files: Record<string, string> = {
    "src/main.rs": "fn main() {\n    println!(\"hi\");\n}\n",
    "notes/plan.md": "# plan\n",
    ".env": "API_KEY=e2e-secret\n",
  };
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "walter\n", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", files: Object.entries(files).map(([path, content]) => ({ path, content })), skipped: 0, truncated: false };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
        return [];
      case "pair_host":
        setTimeout(() => {
          emit("pair-status", { state: "connected", peer: "guest" });
          emit("pair-msg", JSON.stringify({ t: "hello", name: "Ana", rtc: false }));
        }, 200);
        return "dxp_e2e_token";
      case "pair_send":
        sent.push(JSON.parse(String(args.msg)));
        return null;
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = {
    core: { invoke },
    event: {
      listen: async (event: string, h: Handler) => {
        (listeners[event] ||= []).push(h);
        return () => undefined;
      },
    },
  };
  w.__fake = { sent };
}

async function host(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/main.rs")));
  await page.evaluate(() => (window as unknown as { PAIR: { ui: { start(): void } } }).PAIR.ui.start());
  await page.waitForFunction(() => (window as unknown as { PAIR: { state: string } }).PAIR.state === "connected");
  await page.keyboard.press("Escape");
}

const sent = (page: Page) => page.evaluate(() => (window as unknown as { __fake: { sent: Array<Record<string, unknown>> } }).__fake.sent);

test("the host shares tabs but never private files; the call docks in the side bar", async ({ page }) => {
  await host(page);
  const root = await page.evaluate(() => (window as unknown as { ROOT: string }).ROOT);
  // the snapshot never carried the secret
  const snap = (await sent(page)).find((m) => m.t === "snap") as { files: Record<string, string> };
  expect(Object.keys(snap.files)).toContain(root + "src/main.rs");
  expect(Object.keys(snap.files)).not.toContain(root + ".env");
  expect(JSON.stringify(await sent(page))).not.toContain("e2e-secret");

  await page.evaluate((r) => { const w = window as unknown as { openPath: (p: string) => void }; w.openPath(r + "notes/plan.md"); w.openPath(r + "src/main.rs"); }, root);
  await expect(page.locator("#tabs .pair-legend")).toHaveText(/Shared with Ana · 2 tabs/);
  await expect(page.locator("#tabs .tab.pair-shared")).toHaveCount(2);

  // right-click → private: marked, counted out, and removed from the guest
  await page.locator("#tabs .tab", { hasText: "plan.md" }).click({ button: "right" });
  await expect(page.locator("#tabs .tab.pair-private")).toHaveCount(1);
  await expect(page.locator("#tabs .pair-legend")).toHaveText(/Shared with Ana · 1 tab$/);
  await expect.poll(async () => (await sent(page)).some((m) => m.t === "files" && (m.del as string[]).includes(root + "notes/plan.md"))).toBe(true);

  // the call: at the bottom of the side bar, full width, the side bar keeps the room free
  const dock = page.locator("#pair-dock");
  await expect(dock).toBeVisible();
  const [d, side] = await Promise.all([dock.boundingBox(), page.locator(".side").boundingBox()]);
  expect(Math.round(d!.x)).toBe(Math.round(side!.x));
  expect(Math.round(d!.width)).toBe(Math.round(side!.width));
  expect(Math.round(d!.y + d!.height)).toBe(Math.round(side!.y + side!.height));
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector(".side")!).paddingBottom);
  expect(Math.round(parseFloat(pad))).toBe(Math.round(d!.height));
  await page.screenshot({ path: test.info().outputPath("a1-host.png") });

  // minimised: just the 36 px header
  await page.locator('#pair-dock [data-action="pair:min"]').click();
  await expect.poll(async () => Math.round((await dock.boundingBox())!.height)).toBeLessThanOrEqual(37);
  await page.screenshot({ path: test.info().outputPath("a1-minimised.png") });
});

test("with the side bar hidden the call lives in the status bar, which brings it back", async ({ page }) => {
  await host(page);
  await page.evaluate(() => (window as unknown as { toggleSide: () => void }).toggleSide());
  await expect(page.locator("#pair-dock")).toBeHidden();
  await expect(page.locator("#st-pair")).toContainText("show call");
  await page.screenshot({ path: test.info().outputPath("a1-status.png") });
  await page.locator("#st-pair").click();
  await expect(page.locator("#pair-dock")).toBeVisible();
  await expect(page.locator("#st-pair")).not.toContainText("show call");
});
