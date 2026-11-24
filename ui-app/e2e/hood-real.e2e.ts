/* ═══════════ A8 — Under the hood, for real (docs/v2/UI-AUDIT.md item 7) ═══════════
   The real app in desktop mode against a scripted backend that answers `hood_line_asm`,
   `compile_pipeline`, `run_measured`, `measure_growth` and `trace_execution` the way the real
   toolchain does. Proves: the existing «Under the hood» page gets the buttons to the real views;
   picking a line shows its instructions (debug, then release); the compiler's stages come from
   compile_pipeline; the measured run and the growth with N are drawn; and the execution trace
   steps through the real execution with the locals that changed. */
import { test, expect, type Page } from "@playwright/test";

function fakeBackend(): void {
  type Handler = (e: { payload: unknown }) => void;
  const listeners: Record<string, Handler[]> = {};
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ cmd, args });
    switch (cmd) {
      case "app_info":
        return { version: "e2e", os: "linux", home: "/home/e2e", openAtStart: "/proj" };
      case "exec":
        return String(args.program) === "git" ? { code: 128, stdout: "", stderr: "" } : { code: 0, stdout: "", stderr: "" };
      case "load_workspace":
        return { root: "/proj", name: "proj", skipped: 0, truncated: false, files: [{ path: "src/main.rs", content: "fn sum(n: u64) -> u64 {\n    let mut s = 0;\n    for i in 0..n { s += i; }\n    s\n}\nfn main() {\n    let n: u64 = std::env::args().nth(1).map(|a| a.parse().unwrap()).unwrap_or(10);\n    println!(\"{}\", sum(n));\n}\n" }] };
      case "get_providers_config":
        return { anthropicKey: "sk-e2e" };
      case "list_providers":
      case "list_tests":
        return [];
      case "hood_line_asm":
        return args.release
          ? { ok: true, profile: "release", total: 4, lines: [{ line: 3, funcs: ["main::sum"], instructions: ["lea -0x1(%rdi),%rax", "imul %rdi,%rax", "shr %rax", "ret"] }], notes: "" }
          : { ok: true, profile: "debug", total: 38, lines: [{ line: 2, funcs: ["main::sum"], instructions: ["movq $0x0,-0x28(%rsp)"] }, { line: 3, funcs: ["main::sum"], instructions: ["mov -0x28(%rsp),%rax", "add %rcx,%rax", "jb 1590", "cmp %rdx,%rcx", "jne 1560"] }], notes: "" };
      case "compile_pipeline":
        return { mir: "", llvmIr: "define i64 @_ZN4main3sum(i64 %n) {\nstart:\n  ret i64 %0\n}", asm: "_ZN4main3sum:\n\tlea\t-1(%rdi), %rax", binaryBytes: 424242, disasm: "0000 <main::sum>:\n lea", notes: "MIR não disponível nesta toolchain (normalmente requer o canal nightly)." };
      case "run_measured":
        return { run: { ok: true, stdout: "45\n", stderr: "" }, telemetry: { wallMs: 1.8, cpuUserMs: 0.9, cpuSysMs: 0.4, peakRssKb: 2140, ioReadBlocks: 0, ioWriteBlocks: 0, exitCode: 0, samples: [{ tMs: 0, rssKb: 900 }, { tMs: 0.9, rssKb: 1800 }, { tMs: 1.7, rssKb: 2140 }] } };
      case "measure_growth":
        return { ok: true, samples: (args.sizes as number[]).map((n) => ({ n, ms: n / 1e5 })), bigO: "O(n)", rSquared: 0.998, confidence: "high", ranking: [["O(n)", 0.998], ["O(n log n)", 0.97]], baselineMs: 1.1, notes: "" };
      case "trace_execution":
        return {
          supported: true, notes: "", stdout: "45\n",
          steps: [
            { line: 6, event: "call", func: "main", depth: 0, locals: [], stdoutLen: 0 },
            { line: 2, event: "call", func: "sum", depth: 1, locals: [{ name: "n", value: "10", ty: "u64" }], stdoutLen: 0 },
            { line: 3, event: "line", func: "sum", depth: 1, locals: [{ name: "n", value: "10", ty: "u64" }, { name: "s", value: "0", ty: "u64" }], stdoutLen: 0 },
            { line: 4, event: "line", func: "sum", depth: 1, locals: [{ name: "n", value: "10", ty: "u64" }, { name: "s", value: "45", ty: "u64" }], stdoutLen: 0 },
            { line: 8, event: "line", func: "main", depth: 0, locals: [{ name: "n", value: "10", ty: "u64" }], stdoutLen: 3 },
          ],
        };
      default:
        return null;
    }
  };
  const w = window as unknown as Record<string, unknown>;
  w.__TAURI__ = { core: { invoke }, event: { listen: async (event: string, h: Handler) => { (listeners[event] ||= []).push(h); return () => undefined; } } };
  w.__fake = { calls };
}

async function boot(page: Page): Promise<void> {
  await page.addInitScript(fakeBackend);
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.waitForFunction(() => Object.keys((window as unknown as { FS: Record<string, unknown> }).FS).some((k) => k.endsWith("src/main.rs")));
}

const calls = (page: Page, cmd: string) =>
  page.evaluate((cmd) => (window as unknown as { __fake: { calls: Array<{ cmd: string; args: Record<string, unknown> }> } }).__fake.calls.filter((c) => c.cmd === cmd).map((c) => c.args), cmd);

const openHoodPage = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { openPath: (p: string) => void; ROOT: string; hoodCmd: () => void };
    w.openPath(w.ROOT + "src/main.rs");
    w.hoodCmd();
  });

test("machine code per line (debug and release), the compiler's stages, measured run, growth, and the real execution trace", async ({ page }) => {
  await boot(page);
  await openHoodPage(page);
  await page.locator('[data-action="hd-open-real"]').click();
  const hd = page.locator(".hd").filter({ has: page.locator(".hd-src") }).first();
  await expect(hd.locator(".hd-l")).toHaveCount(10);
  await expect(hd.locator(".hd-meta").first()).toContainText("38");
  await hd.locator('.hd-l[data-on="3"]').click();
  await expect(hd.locator(".hd-code")).toContainText("add %rcx,%rax");
  // release: the loop becomes a closed formula
  await hd.locator('[data-action="hd-profile"][data-on="release"]').click();
  await expect(hd.locator(".hd-code")).toContainText("imul %rdi,%rax");
  expect((await calls(page, "hood_line_asm")).map((a) => a.release)).toEqual([false, true]);
  // a measured run and the growth with N
  await hd.locator('[data-action="hd-run"]').click();
  await expect(hd.locator(".hd-kv")).toContainText("2.1 MB");
  await hd.locator('[data-action="hd-sizes"]').fill("1k 2k 4k 8k 16k");
  await hd.locator('[data-action="hd-growth"]').click();
  await expect(hd.locator(".hd-fit")).toContainText("O(n)");
  expect((await calls(page, "measure_growth")).at(-1)?.sizes).toEqual([1000, 2000, 4000, 8000, 16000]);
  await page.screenshot({ path: test.info().outputPath("a8-hood.png") });
  // the compiler's stages
  await hd.locator('[data-action="hd-stage"][data-on="llvm"]').click();
  await expect(hd.locator(".hd-code.hd-big")).toContainText("define i64");
  await expect(hd.locator(".hd-meta").first()).toContainText("nightly");

  // the real execution, step by step
  await openHoodPage(page);
  await page.locator('[data-action="hd-open-trace"]').click();
  const tr = page.locator(".hd").filter({ has: page.locator(".tr-ctl") }).first();
  await expect(tr.locator(".hd-meta", { hasText: /step 1 of 5/ })).toBeVisible();
  await tr.locator('[data-action="tr-step"][data-on="1"]').click();
  await tr.locator('[data-action="tr-step"][data-on="2"]').click();
  await tr.locator('[data-action="tr-step"][data-on="3"]').click();
  await expect(tr.locator(".hd-l.sel")).toHaveAttribute("data-on", "4");
  await expect(tr.locator(".hd-var.chg")).toContainText("45");
  await expect(tr.locator(".hd-card").first()).toContainText("sum");
  await tr.locator('[data-action="tr-step"][data-on="4"]').click();
  await expect(tr.locator(".hd-card").last()).toContainText("45");
  await page.screenshot({ path: test.info().outputPath("a8-trace.png") });
  expect((await calls(page, "trace_execution")).at(-1)).toMatchObject({ language: "rust" });
});
