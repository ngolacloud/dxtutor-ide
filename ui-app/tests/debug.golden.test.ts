import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança da feature Run and Debug (`ui-app/src/features/debug.ts`), via o
 * harness que carrega a cadeia real de módulos.
 *
 * ADR-0005, R1c2 (decisão registada no ADR): as sessões simuladas saíram — o passo-a-passo
 * guionado do lexer de demonstração e as sondas `kubectl` inventadas a um pod em crash —
 * e com elas os goldens `pane-pre-session`/`feed-pre-session`/`pane-code-session`/
 * `feed-code-session`, as caracterizações `lexTrace-*`/`crashTrace-dns`/`debugConfigs`
 * e os testes de dispatch de start/step/watch-add. Ficam: os goldens do pane e do
 * assistente sem depurador (regenerados — o texto passou a dizer que não há adaptador
 * ligado), o pane com breakpoints, o dispatch dos breakpoints e a semântica do Set.
 *
 * Diff de golden = regressão (corrige o código, nunca o snapshot — ver skill
 * ui-golden-check).
 *
 * Fixtures do runtime que o harness exclui (vivem em v6.ts/boot6): os containers
 * #pane-debug e #pc-dbg, reproduzidos 1:1 em `provideV6Fixtures()`. */

let w: any;
/** Um ficheiro da fixture do harness (tests/fixtures/sample-workspace.ts). */
let LX: string;

/** Reproduz as peças que v6.ts/boot6 dão em runtime e o harness exclui. */
function provideV6Fixtures(): void {
  const side = document.querySelector(".side");
  if (side && !document.getElementById("pane-debug")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-debug"></div>');
  const pb = document.querySelector(".panel-body");
  if (pb && !document.getElementById("pc-dbg")) pb.insertAdjacentHTML("beforeend", '<div class="pcontent" id="pc-dbg"></div>');
}

function paneGolden(): string { return golden(document.getElementById("pane-debug")!); }
function feedGolden(): string { return golden(document.getElementById("pc-dbg")!); }

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // O `window` persiste entre testes no jsdom; `debug.ts` reutiliza o `window.BPS`
  // existente ao reavaliar. Limpar ANTES do boot para cada teste arrancar sem breakpoints.
  if ((window as any).BPS instanceof Set) (window as any).BPS.clear();
  w = await bootApp();
  // `toggleBp` grava em LS («bps6»), que sobrevive entre testes neste jsdom; a hidratação
  // é preguiçosa (na primeira entrada), por isso esvaziar aqui chega.
  w.LS.set("bps6", []);
  provideV6Fixtures();
  LX = w.ROOT + "crates/lexer/src/lib.rs";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — Run and Debug (renderDebugPane / drawDbg)", () => {
  it("sem depurador: o pane e o assistente dizem que não há adaptador ligado", () => {
    w.renderDebugPane();
    w.drawDbg();
    expect(paneGolden()).toMatchSnapshot("pane-no-debugger");
    expect(feedGolden()).toMatchSnapshot("feed-no-debugger");
  });

  it("com breakpoints: a lista mostra ficheiro e linha", () => {
    w.toggleBp(LX, 5);
    w.toggleBp(LX, 10);
    w.renderDebugPane();
    expect(paneGolden()).toMatchSnapshot("pane-breakpoints");
  });
});

describe("sem sessões simuladas (ADR-0005, R1c2)", () => {
  it("startDebug abre o pane, avisa que não há depurador e não cria sessão", () => {
    const toast = vi.spyOn(w, "toast");
    w.startDebug();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/No debugger attached/));
    expect(w.DBG).toBeUndefined();
    expect(document.querySelector("#pane-debug .dbg-ctl")).toBe(null);
  });

  it("os motores e geradores simulados já não são publicados", () => {
    for (const n of ["dbgState", "dbgContinue", "dbgFeed", "dbgApplyClone", "dbgFix", "dbgFinish", "lexTrace", "crashTrace", "debugConfigs", "dbgLaunch", "lexVariant", "LXL", "lexBug"]) {
      expect(w[n], n).toBeUndefined();
    }
  });
});

describe("dispatch delegado (data-action) — Fase 4", () => {
  // O golden strippa data-action/data-on, logo NÃO prova que o listener delegado
  // dispara. Estes testes disparam eventos reais e observam o efeito.
  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

  it("bp-del: clicar «×» de um breakpoint remove-o do Set (closest vence a linha)", () => {
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(LX + ":7")).toBe(true);
    w.renderDebugPane();
    const del = document.querySelector(`#pane-debug [data-action="bp-del"][data-on="${LX}:7"]`)!;
    expect(del).toBeTruthy();
    click(del);
    expect(w.dbgBreaks.has(LX + ":7")).toBe(false);
  });

  it("open-bp: clicar a linha abre o ficheiro na linha do breakpoint", () => {
    const open = vi.spyOn(w, "openPath").mockImplementation(() => {});
    w.toggleBp(LX, 7);
    w.renderDebugPane();
    click(document.querySelector(`#pane-debug .scm-row[data-on="${LX}:7"] .nm`)!);
    expect(open).toHaveBeenCalledWith(LX, 7);
  });
});

describe("caracterização do motor — breakpoints (toggleBp/BPS)", () => {
  // Só a semântica do Set (chave `path:line`, alternância idempotente); a persistência
  // em LS é porta de infra e o beforeEach esvazia-a.
  it("BPS nasce vazio para cada teste", () => {
    expect([...w.dbgBreaks]).toEqual([]);
  });

  it("toggleBp alterna por chave path:line (add/remove idempotente)", () => {
    const key = LX + ":7";
    expect(w.dbgBreaks.has(key)).toBe(false);
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(true);
    w.toggleBp(LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(false);
  });
});
