/* ═══════════ LSP P5 — o editor sem servidor de linguagem, num browser real ═══════════
   Sobre o `dist` (modo browser, sem Tauri, logo sem servidor): a gramática do Python chega pelo seu
   pedaço próprio (`import()`) e pinta o ficheiro; escrever duas letras abre a lista de palavras
   (marcada como palavras) e o Enter aceita; Ctrl+Shift+A comenta a selecção num bloco sem abrir o
   assistente. Teclas reais (Playwright), não eventos sintéticos. */
import { test, expect, type Page } from "@playwright/test";

async function boot(page: Page): Promise<void> {
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
}

/** Cria um ficheiro no workspace em memória e abre-o no editor. */
async function openFile(page: Page, rel: string, content: string): Promise<void> {
  await page.evaluate(
    ([rel, content]) => {
      const w = window as unknown as { ROOT: string; FS: Record<string, { content: string; orig: string | null }>; openPath: (p: string) => void };
      w.FS[w.ROOT + rel] = { content, orig: content };
      w.openPath(w.ROOT + rel);
    },
    [rel, content],
  );
  await expect(page.locator("#ed-ta")).toBeVisible();
}

test("Python sem extensão: a gramática do dxtutor pinta; duas letras abrem as palavras; Enter aceita", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await openFile(page, "src/calc.py", "def compute_total(values):\n    # soma\n    return sum(values)\n");
  await expect(page.locator("#ed-hl .l").first().locator("span.kw", { hasText: "def" })).toBeVisible();
  await expect(page.locator("#ed-hl .l").nth(1).locator("span.cm").last()).toContainText("soma");
  const ta = page.locator("#ed-ta");
  await ta.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("co");
  const box = page.locator("#lsp-complete");
  await expect(box).toBeVisible();
  await expect(box.locator(".lsp-c-note")).toHaveText("Words from your open files — no suggestions from a language server");
  await expect(box.locator(".lsp-c-row .lsp-c-label")).toHaveText(["compute_total"]);
  await page.keyboard.press("Enter");
  await expect(box).toHaveCount(0);
  await expect(ta).toHaveValue(/\ncompute_total$/);
  expect(errors).toEqual([]);
});

test("Ctrl+Shift+A no editor comenta a selecção num bloco e não abre o assistente", async ({ page }) => {
  await boot(page);
  await openFile(page, "src/lib.rs", "let x = a + b;\n");
  const ta = page.locator("#ed-ta");
  await ta.click();
  await page.evaluate(() => (document.getElementById("ed-ta") as HTMLTextAreaElement).setSelectionRange(8, 13));
  const pane = await page.evaluate(() => (window as unknown as { PANE: string }).PANE);
  await page.keyboard.press("Control+Shift+A");
  await expect(ta).toHaveValue("let x = /* a + b */;\n");
  expect(await page.evaluate(() => (window as unknown as { PANE: string }).PANE)).toBe(pane);
  await page.keyboard.press("Control+Shift+A");
  await expect(ta).toHaveValue("let x = a + b;\n");
});
