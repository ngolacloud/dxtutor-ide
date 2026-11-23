/* ═══════════ Arranque da ui-app num browser real (ADR-0004, U0) ═══════════
   Rede de segurança da migração para Clean Architecture: os goldens (jsdom) provam o
   markup de cada feature; este teste prova que a APP INTEIRA arranca com as 43 tags pela
   ordem certa, sem erros de página, e que os painéis, o painel inferior, a paleta e o
   compositor do Co-Dev respondem. Corre sobre o `dist` (modo browser, sem Tauri). */
import { test, expect, type Page } from "@playwright/test";

/** Erros de página e `console.error`, menos o ruído de rede de recursos externos (tipos de
 *  letra do Google, que o CI pode não alcançar). */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/fonts\.(googleapis|gstatic)\.com|Failed to load resource/.test(t)) return;
    errors.push(`console.error: ${t}`);
  });
  return errors;
}

async function boot(page: Page): Promise<string[]> {
  const errors = collectErrors(page);
  await page.goto("/index.html");
  await expect(page.locator("#activity .act").first()).toBeVisible();
  // o arranque termina com o startup.ts (i18n + primeira pintura)
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  return errors;
}

test("arranca sem erros e desenha a estrutura principal", async ({ page }) => {
  const errors = await boot(page);
  for (const sel of ["#menubar", "#activity", "#pane-explorer", "#tabs", "#panel", "#agent", "#ag-compose #cc", ".status"]) {
    await expect(page.locator(sel).first(), sel).toBeVisible();
  }
  // os globais de que o resto da app depende existem (a ordem das tags foi respeitada)
  const globals = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return ["svg", "goPane", "palette", "handlePrompt", "updateAgentUI", "setMode", "renderScmPane"].filter((k) => typeof w[k] !== "function");
  });
  expect(globals, "globais em falta").toEqual([]);
  await page.screenshot({ path: test.info().outputPath("arranque.png") });
  expect(errors).toEqual([]);
});

test("percorre todos os painéis da barra de actividade", async ({ page }) => {
  const errors = await boot(page);
  const panes = await page.$$eval("#activity .act[data-pane]", (els) =>
    els.map((e) => (e as HTMLElement).dataset.pane ?? "").filter(Boolean),
  );
  expect(panes.length).toBeGreaterThan(5);
  for (const p of panes) {
    const act = page.locator(`#activity .act[data-pane="${p}"]`).first();
    // clicar no painel que já está activo recolhe a barra lateral (como no VS Code)
    if (await act.evaluate((e) => e.classList.contains("on"))) continue;
    await act.click();
    const pane = page.locator(`#pane-${p}`);
    if (await pane.count()) await expect(pane, `#pane-${p}`).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("painel inferior, paleta de comandos e compositor do Co-Dev respondem", async ({ page }) => {
  const errors = await boot(page);
  // separadores do painel inferior
  const tabs = page.locator(".ptab");
  const n = await tabs.count();
  for (let i = 0; i < n; i++) if (await tabs.nth(i).isVisible()) await tabs.nth(i).click();
  // paleta de comandos
  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#pal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pal")).toBeHidden();
  // compositor do Co-Dev: os popovers abrem e fecham
  for (const id of ["#cc-plus", "#cc-slash", "#cc-model", "#cc-mode"]) {
    await page.locator(id).click();
    await expect(page.locator("#cc-pop"), id).toBeVisible();
    await page.locator("#ag-msgs").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#cc-pop"), `${id} fecha`).toBeHidden();
  }
  // escrever e mudar de modo pelo teclado
  await page.locator("#ag-input").fill("olá");
  await page.locator("#ag-input").press("Shift+Tab");
  await expect(page.locator("#cc-mode")).toContainText(/Auto|Plano|Plan|Manual|Assist/);
  expect(errors).toEqual([]);
});
