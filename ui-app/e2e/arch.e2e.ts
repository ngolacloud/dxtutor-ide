/* ═══════════ Studio de arquitectura num browser real (F0) ═══════════
   Prova a cablagem que os testes jsdom não vêem: o app.ts importa `openArch` e põe-no na
   paleta de comandos; o separador abre VAZIO (sem dados de demonstração); acrescentar um
   componente pelo catálogo desenha o nó; e, sem Tauri, a validação diz que precisa do
   backend em vez de validar no cliente. */
import { test, expect } from "@playwright/test";

test("abre o Studio de arquitectura pela paleta, vazio, e desenha um componente", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("dialog", (d) => void d.accept("Orders"));
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);

  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#pal")).toBeVisible();
  // num arranque a frio, escrever antes de o campo ter o foco perde as teclas
  await expect(page.locator("#pal input")).toBeFocused();
  await page.keyboard.type("System architecture");
  await page.keyboard.press("Enter");

  const studio = page.locator(".arch-studio");
  await expect(studio).toBeVisible();
  await expect(studio.locator("[data-n]")).toHaveCount(0);
  await expect(studio.locator("[data-arch-insp]")).toContainText("The design is empty");

  await studio.locator('[data-action="arch-add"][data-on="service"]').click();
  await expect(studio.locator("[data-n]")).toHaveCount(1);
  // clicar no fundo do canvas desselecciona: o inspector volta à validação
  await studio.locator("svg[data-arch-svg]").click({ position: { x: 200, y: 300 } });
  await expect(studio.locator("[data-arch-insp]")).toContainText("open the desktop app");
  await page.screenshot({ path: test.info().outputPath("arch.png") });

  // F5.2: «§ Rules» abre o painel das regras do arquitecto; sem Tauri, diz onde elas vivem
  await studio.locator('[data-action="arch-rules"]').click();
  await expect(studio.locator("[data-arch-insp]")).toContainText("Architect's rules");
  await expect(studio.locator("[data-arch-insp]")).toContainText("open a folder in the desktop app");
  await expect(studio.locator('[data-action="arch-rules"]')).toHaveClass(/pri/);
  // o Import/Export fecha-o (um painel de cada vez)
  await studio.locator('[data-action="arch-io"]').click();
  await expect(studio.locator("[data-arch-insp]")).toContainText("Import Mermaid");
  await expect(studio.locator('[data-action="arch-rules"]')).not.toHaveClass(/pri/);
  expect(errors).toEqual([]);
});
