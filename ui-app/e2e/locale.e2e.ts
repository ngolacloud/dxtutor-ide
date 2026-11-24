/* ═══════════ mudar de língua recarrega a interface (ADR-0004, U6c lote 3) ═══════════
   O setLocale grava a língua e recarrega: os textos com chave nascem já na língua nova (aqui, o título do quadro,
   que vem do catálogo do board) e a língua sobrevive ao recarregamento. */
import { test, expect } from "@playwright/test";

test("setLocale grava a língua, recarrega, e os textos com chave nascem na língua nova", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/index.html");
  await page.waitForFunction(() => typeof (window as unknown as { setLocale?: unknown }).setLocale === "function");
  const boardTitle = async () => {
    await page.evaluate(() => (window as unknown as { openBoard: () => void }).openBoard());
    return page.locator(".kb-bar b").first().textContent();
  };
  expect(await boardTitle()).toBe("Board");

  await Promise.all([page.waitForEvent("load"), page.evaluate(() => (window as unknown as { setLocale: (l: string) => void }).setLocale("ptAO"))]);
  await page.waitForFunction(() => typeof (window as unknown as { openBoard?: unknown }).openBoard === "function");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("pt-AO");
  expect(await boardTitle()).toBe("Quadro");

  await Promise.all([page.waitForEvent("load"), page.evaluate(() => (window as unknown as { setLocale: (l: string) => void }).setLocale("en"))]);
  await page.waitForFunction(() => typeof (window as unknown as { openBoard?: unknown }).openBoard === "function");
  expect(await boardTitle()).toBe("Board");
  expect(errors).toEqual([]);
});
