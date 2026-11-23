// U3b (ADR-0004): o Co-Dev reage às mudanças de estado pelo bus — uma escrita em
// qualquer sítio (aqui directamente no window, como o monólito faz) actualiza a barra de
// estado, o compositor e o chip de contexto, sem ninguém chamar updateAgentUI/ctxPill.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
const $ = (s: string) => document.querySelector(s) as HTMLElement;

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  w.MODE = "assist";
  w.ACTIVE = "claude";
  w.CTX_ON = true;
});

it("mudar o modo pelo window actualiza a barra de estado e o compositor", () => {
  w.MODE = "auto";
  expect($("#st-mode").textContent).toBe("Co-Dev: Auto");
  expect($("#cc-mode").textContent).toBe("Auto");
  w.MODE = "manual";
  expect($("#st-mode").textContent).toBe("Co-Dev: Manual");
});

it("mudar o provedor pelo window actualiza o chip do modelo", () => {
  w.PROV.gemini.model = "gemini-2.5-pro";
  w.ACTIVE = "gemini";
  expect($("#st-model-l").textContent).toBe("Gemini");
  expect($("#cc-model").textContent).toContain("Gemini 2.5 Pro");
});

it("ligar/desligar o contexto do editor actualiza o chip de contexto", () => {
  const pill = $("#pill-ctx");
  w.CTX_ON = false;
  expect(pill.classList.contains("on")).toBe(false);
  w.CTX_ON = true;
  // com um ficheiro activo o chip acende; sem ficheiro fica apagado — mas foi redesenhado
  expect(pill.textContent).toMatch(/^@ /);
});
