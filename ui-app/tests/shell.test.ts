// U4d1 (ADR-0004): a «shell» da janela em features/shell.ts.
import { beforeEach, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let SHM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7f)
const $ = (s: string) => document.querySelector(s) as HTMLElement;

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  SHM = await import("../src/features/shell");
  SHM.buildActivity();
});

it("setPane mostra o painel, marca o botão, chama o renderer de RP e actualiza o dono", async () => {
  const { layoutStore } = await import("../src/app/store/layout");
  const spy = vi.fn();
  w.RP.__teste = spy;
  document.body.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-__teste"></div>');
  SHM.setVar("--side-w", "250px");
  SHM.setPane("__teste");
  expect(spy).toHaveBeenCalledTimes(1);
  expect($("#pane-__teste").classList.contains("show")).toBe(true);
  expect(layoutStore.pane).toBe("__teste");
  expect(w.PANE).toBe("__teste");
  // clicar no activo com tgl recolhe a barra lateral
  SHM.setPane("__teste", true);
  expect(w.getVar("--side-w")).toBe("0px");
  // e abrir outro painel volta a abri-la
  w.goPane("scm");
  expect(w.getVar("--side-w")).toBe("250px");
  expect(document.querySelector('.act.on[data-pane="scm"]')).not.toBeNull();
});

it("togglePanel/setPanelTab: abre o painel inferior e mostra o separador pedido", () => {
  SHM.setVar("--panel-h", "0px");
  w.setPanelTab("problems", true);
  expect(w.getVar("--panel-h")).toBe("230px");
  expect($("#pc-problems").classList.contains("show")).toBe(true);
  w.togglePanel();
  expect(w.getVar("--panel-h")).toBe("0px");
});

it("badges conta as alterações por commitar e marca a execução do Co-Dev", async () => {
  const { agentStore } = await import("../src/app/store");
  // o botão do Co-Dev entra no ACTS pelo boot6 (que não corre no harness)
  (await import("../src/boot")).ACTS.push({ ic: "sparkle", pane: "codev", title: "Co-Dev" });
  SHM.buildActivity();
  agentStore.run.active = true;
  SHM.badges();
  expect($('.act[data-pane="codev"] .badge').textContent).toBe("●");
  agentStore.run.active = false;
  SHM.badges();
  expect($('.act[data-pane="codev"] .badge').style.display).toBe("none");
  const n = w.changes().length;
  expect($('.act[data-pane="scm"] .badge').textContent).toBe(n ? String(n) : "");
});

it("buildActivity desenha um botão por ACTS; hd é o cabeçalho partilhado do core", async () => {
  expect(document.querySelectorAll("#activity .act").length).toBe((await import("../src/boot")).ACTS.length);
  expect(w.hd("Título", "<b>x</b>")).toBe('<div class="side-hd"><span class="t">Título</span><span class="acts"><b>x</b></span></div>');
});
