/* ═══════════ Studio de arquitectura: o desenho de referência num browser real (F3/F4) ═══════════
   Guarda no localStorage o desenho «Docker vs Kubernetes» (feito com as funções do domínio,
   como o Studio o guardaria), abre o separador e confirma que se desenha: dois painéis com
   barra de título, grupos tracejados com pílula, os 21 cartões e as setas, sem erros de
   página; depois «⇅ Arrange» (auto-layout). As capturas ficam em test-results. Os dados vivem SÓ neste
   teste — a app nunca traz desenhos de demonstração. */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { reference } from "../tests/fixtures/arch-reference";

/** Captura do desenho inteiro: o mesmo SVG numa página só dele, com as variáveis de cor do tema. */
async function snapshot(page: Page, svg: Locator, path: string): Promise<void> {
  const page2 = await page.context().newPage();
  const { html, vars } = await svg.evaluate((el) => {
    const cs = getComputedStyle(document.documentElement);
    const names = ["--bg-base", "--bg-elevated", "--bg-hover", "--border-strong", "--fg", "--fg-dim", "--fg-muted", "--accent", "--green", "--guide", "--font-ui", "--font-mono"];
    return { html: el.outerHTML, vars: names.map((n) => `${n}:${cs.getPropertyValue(n)}`).join(";") };
  });
  await page2.setContent(`<style>:root{${vars}}body{margin:0;background:var(--bg-base)}</style>${html}`);
  await page2.locator("svg").screenshot({ path });
  await page2.close();
}

test("desenha o desenho de referência «Docker vs Kubernetes» guardado", async ({ page }) => {
  const design = reference();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript((json) => localStorage.setItem("dxnext-studio:default", json), JSON.stringify(design));
  await page.setViewportSize({ width: 1800, height: 1200 });
  await page.goto("/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#activity .act").length > 5);
  await page.keyboard.press("Control+Shift+P");
  await expect(page.locator("#pal")).toBeVisible();
  // num arranque a frio, escrever antes de o campo ter o foco perde as teclas
  await expect(page.locator("#pal input")).toBeFocused();
  await page.keyboard.type("System architecture");
  await page.keyboard.press("Enter");

  const svg = page.locator(".arch-studio svg[data-arch-svg]");
  await expect(svg).toBeVisible();
  await expect(svg.locator("[data-n]")).toHaveCount(21);
  await expect(svg.locator("[data-e]")).toHaveCount(19);
  await expect(svg.locator("text", { hasText: /^Docker$/ })).toHaveCount(1); // só a barra (o corpo não tem pílula)
  await expect(svg.locator("text", { hasText: /^Control Plane$/ })).toHaveCount(1);
  await expect(svg.locator("text", { hasText: "kubectl apply" })).toHaveCount(1);
  await snapshot(page, svg, test.info().outputPath("docker-vs-kubernetes.png"));

  // ⇅ Arrange: o auto-layout arruma tudo de cima para baixo (confirma-se o diálogo)
  page.once("dialog", (dlg) => void dlg.accept());
  await page.locator('[data-action="arch-arrange"]').click();
  await expect(svg.locator("[data-n]")).toHaveCount(21);
  await snapshot(page, svg, test.info().outputPath("docker-vs-kubernetes-arranged.png"));
  expect(errors).toEqual([]);
});
