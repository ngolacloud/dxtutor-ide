// LSP P5 — Shift+Alt+F no editor de um ficheiro, com o formatador do servidor de linguagem ligado (desktop com
// pasta): a tecla é dele, e o «Format Document» do dxtutor só corre quando ele cai para trás. Num ficheiro à parte:
// o harness reavalia os atalhos globais a cada teste e o document guardaria os listeners dos testes anteriores.
import { expect, it, vi } from "vitest";
import { bootApp } from "./harness";

it("a tecla é do servidor; o «Format Document» do dxtutor só corre quando ele cai para trás (sem servidor), uma vez", async () => {
  const w = (await bootApp()) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- a janela do harness
  const { services } = await import("../src/app/services");
  const { bindFormatHooks } = await import("../src/features/lsp/ui/format-hooks");
  const key = w.ROOT + "src/util.py";
  w.FS[key] = { content: "x = 1  \n", orig: "" };
  w.openPath(key);
  const ta = document.getElementById("ed-ta") as HTMLTextAreaElement;
  const press = () => ta.dispatchEvent(new KeyboardEvent("keydown", { key: "F", code: "KeyF", shiftKey: true, altKey: true, bubbles: true, cancelable: true }));
  const builtin = vi.spyOn(w, "vsxFmt");
  let outcome: "formatted" | "fallback" = "formatted";
  const formatAt = vi.fn(async () => outcome);
  bindFormatHooks({ formatAt, builtinFormat: () => w.vsxFmt(), enabled: () => true });
  services.lspFormat = { handles: () => true };
  press();
  await new Promise((r) => setTimeout(r, 0));
  expect(formatAt).toHaveBeenCalledTimes(1);
  expect(builtin).not.toHaveBeenCalled(); // antes corriam os dois: o atalho global primeiro
  outcome = "fallback";
  press();
  await new Promise((r) => setTimeout(r, 0));
  expect(builtin).toHaveBeenCalledTimes(1);
  expect(w.FS[key].content).toBe("x = 1\n");
  // sem o formatador do servidor ligado (browser, ou sem pasta), o atalho global formata
  delete services.lspFormat;
  (document as unknown as Record<string, (() => void) | undefined>).__lspFormatHooks__?.();
  press();
  expect(builtin).toHaveBeenCalledTimes(2);
});
