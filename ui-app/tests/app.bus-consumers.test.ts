// U3b (ADR-0004): o Co-Dev reage às mudanças de estado pelo bus — uma escrita em
// qualquer sítio (aqui directamente no window, como o monólito faz) actualiza a barra de
// estado, o compositor e o chip de contexto, sem ninguém chamar updateAgentUI/ctxPill.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let AS: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o agentStore da cadeia do bootApp (U7i)
const $ = (s: string) => document.querySelector(s) as HTMLElement;

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  AS = (await import("../src/app/store")).agentStore;
  AS.mode = "assist";
  w.ACTIVE = "claude";
  AS.contextEnabled = true;
});

it("mudar o modo no dono actualiza a barra de estado e o compositor", () => {
  AS.mode = "auto";
  expect($("#st-mode").textContent).toBe("Co-Dev: Auto");
  expect($("#cc-mode").textContent).toBe("Auto");
  AS.mode = "manual";
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
  AS.contextEnabled = false;
  expect(pill.classList.contains("on")).toBe(false);
  AS.contextEnabled = true;
  // com um ficheiro activo o chip acende; sem ficheiro fica apagado — mas foi redesenhado
  expect(pill.textContent).toMatch(/^@ /);
});

/* ───── U3c: colecções com dono e eventos do workspace, da execução e dos provedores ───── */

it("os donos guardam os MESMOS objectos que o app.ts criou (adopção, sem cópia)", async () => {
  const { workspaceStore, agentStore } = await import("../src/app/store");
  expect(workspaceStore.files).toBe(w.FS);
  expect(workspaceStore.root).toBe("dxtutor/");
  expect(agentStore.providers).toBe(w.PROV);
  // a conversa e a execução são as do features/codev.ts (o RUN de lá traz o pend/abort), já sem o window (U7i)
  expect(Array.isArray(agentStore.chat)).toBe(true);
  expect(agentStore.run).toHaveProperty("pend", null);
  expect("CHAT" in w || "RUN" in w).toBe(false);
  expect(Object.keys(workspaceStore.files).length).toBeGreaterThan(5);
});

it("refresh() emite workspace:changed (quem decorava o refresh subscreve agora)", async () => {
  const { bus } = await import("../src/app/bus");
  const seen: Array<{ fromEditor: boolean; force: boolean }> = [];
  bus.on("workspace:changed", (p) => seen.push(p));
  w.refresh();
  w.refresh(true, true);
  expect(seen).toEqual([
    { fromEditor: false, force: false },
    { fromEditor: true, force: true },
  ]);
  // writeFile chama o refresh → o mesmo sinal
  w.writeFile(w.ROOT + "notes/u3c.md", "olá");
  expect(seen.length).toBe(3);
});

it("runState emite agent:run e o compositor troca enviar↔parar sem ser chamado", () => {
  w.runState(true, "teste");
  expect($("#cc-send").classList.contains("stop")).toBe(true);
  w.runState(false);
  expect($("#cc-send").classList.contains("stop")).toBe(false);
});

it("mudar o modelo de um provedor emite agent:providers e redesenha o chip", async () => {
  const { agentStore } = await import("../src/app/store");
  w.ACTIVE = "claude";
  w.PROV.claude.model = "claude-sonnet-5-5";
  agentStore.providerChanged("claude");
  expect($("#cc-model").textContent).toContain("Sonnet 5.5");
});
