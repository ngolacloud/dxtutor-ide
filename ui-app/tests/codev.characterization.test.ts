import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* Testes de caracterização do motor Co-Dev ACTUAL (features/codev.ts), antes de
 * qualquer extracção para Clean Architecture. Não tocam em código-fonte: só o
 * exercitam através do window real, carregado pelo harness. Cada `it` arranca
 * uma app fresca (bootApp) e usa temporizadores falsos para atravessar os
 * `beat()`/`sleep()` reais sem esperar tempo de relógio — isto é o que torna a
 * suite estável em corridas repetidas (nenhuma espera real, nenhum polling). */

let w: any;
let AS: any;
let CMD: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7k) // eslint-disable-line @typescript-eslint/no-explicit-any — o agentStore da cadeia do bootApp (U7i)
/** Um ficheiro da fixture do harness (tests/fixtures/sample-workspace.ts); era a constante
 *  `P_LX` do monólito, que saiu com os caminhos fixos do projecto de demonstração (ADR-0006, R1c2). */
let LX: string;

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  AS = (await import("../src/app/store")).agentStore;
  CMD = await import("../src/features/codev");
  LX = w.ROOT + "crates/lexer/src/lib.rs";
});

afterEach(() => {
  vi.useRealTimers();
});

/** Avança os temporizadores falsos até `p` resolver (ou until todos os timers
 * pendentes se esgotarem), devolvendo o valor resolvido. */
async function resolved<T>(p: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return p;
}

function host(): HTMLElement {
  return document.createElement("div");
}

function gate(h: HTMLElement): HTMLElement | null {
  return h.querySelector(".gate");
}

function gateButtons(h: HTMLElement): HTMLButtonElement[] {
  return Array.from(h.querySelectorAll(".gate .gb"));
}

function clickByLabel(h: HTMLElement, label: string) {
  const btn = gateButtons(h).find((b) => b.innerHTML === label);
  if (!btn) throw new Error(`botão "${label}" não encontrado no gate`);
  btn.click();
}

describe("1. política de aprovação por modo (doTool)", () => {
  it("read nunca pede aprovação, em qualquer modo", async () => {
    for (const mode of ["manual", "assist", "auto"]) {
      AS.mode = mode;
      const h = host();
      const p = CMD.doTool({ t: "read", p: LX }, h);
      expect(gate(h)).toBeNull();
      expect(await resolved(p)).toBe(true);
    }
  });

  it.each([
    ["manual", "cargo test", true],
    ["assist", "cargo test", false],
    ["auto", "cargo test", false],
    ["manual", "curl example.org", true],
    ["assist", "curl example.org", true],
    ["auto", "curl example.org", false],
    ["manual", "git push --force", true],
    ["assist", "git push --force", true],
    ["auto", "git push --force", true],
  ])("run %s + %s -> gate=%s", async (mode, cmd, expectGate) => {
    AS.mode = mode;
    const h = host();
    const p = CMD.doTool({ t: "run", cmd }, h);
    if (expectGate) {
      expect(gate(h)).not.toBeNull();
      clickByLabel(h, "Executar");
    } else {
      expect(gate(h)).toBeNull();
    }
    await resolved(p);
  });

  it("edit só pede aprovação em modo manual (assist/auto aplicam automaticamente)", async () => {
    for (const mode of ["assist", "auto"]) {
      AS.mode = mode;
      const h = host();
      const p = CMD.doTool({ t: "edit", p: LX, content: w.FS[LX].content + "\n// x" }, h);
      expect(gate(h)).toBeNull();
      expect(await resolved(p)).toBe(true);
    }
    AS.mode = "manual";
    const h = host();
    const p = CMD.doTool({ t: "edit", p: LX, content: w.FS[LX].content + "\n// y" }, h);
    expect(gate(h)).not.toBeNull();
    clickByLabel(h, "Aprovar edição");
    expect(await resolved(p)).toBe(true);
  });
});

describe("2. edição sem alterações nunca pede aprovação (invariante #1)", () => {
  it("'sem alterações' em manual/assist/auto: sucesso, sem gate", async () => {
    for (const mode of ["manual", "assist", "auto"]) {
      AS.mode = mode;
      const h = host();
      const same = w.FS[LX].content;
      const p = CMD.doTool({ t: "edit", p: LX, content: same }, h);
      expect(gate(h)).toBeNull();
      expect(await resolved(p)).toBe(true);
      expect(h.textContent).toContain("sem alterações");
    }
  });
});

describe("3. skip vs reject: skip devolve null (não false), rejeição devolve false", () => {
  it("edit rejeitado em manual -> false, FS não é escrito", async () => {
    AS.mode = "manual";
    const h = host();
    const before = w.FS[LX].content;
    const p = CMD.doTool({ t: "edit", p: LX, content: before + "\n// rejected" }, h);
    clickByLabel(h, "Rejeitar");
    expect(await resolved(p)).toBe(false);
    expect(w.FS[LX].content).toBe(before);
  });

  it("run saltado em assist (comando não-SAFE) -> null, não false", async () => {
    AS.mode = "assist";
    const h = host();
    const p = CMD.doTool({ t: "run", cmd: "curl example.org" }, h);
    clickByLabel(h, "Saltar");
    expect(await resolved(p)).toBeNull();
  });

});

describe("4. janela de histórico do live chat (últimas 9, sem líder não-user, prompt de sistema prefixado)", () => {
  it("corta para 9 mensagens, remove não-user à cabeça e prefixa o sistema na 1a", async () => {
    w.ACTIVE = "claude";
    w.PROV.claude.on = true;
    let captured: any[] = [];
    w.SAMPLE = vi.fn(async (msgs: any[]) => {
      captured = msgs;
      return { text: "resposta" };
    });
    // 11 mensagens prévias; a função guarda as últimas 9 (incluindo a nova), e
    // remove do início qualquer uma que não seja 'user'.
    for (let i = 0; i < 10; i++) {
      AS.chat.push({ role: i % 2 === 0 ? "assistant" : "user", content: "msg" + i });
    }
    await resolved(w.liveChat("pergunta final"));
    expect(captured.length).toBeLessThanOrEqual(9);
    expect(captured[0].role).toBe("user");
    expect(captured[0].content).toContain("———");
    expect(captured[captured.length - 1].content).toBe("pergunta final");
  });
});

describe("5. ordem/altura de publicação dos dados do motor Co-Dev", () => {
  it("ROLE/ROUTE/MODES/DECS/CKPT existem logo após a avaliação do módulo, exportados e já sem o window (U7j)", async () => {
    const CM = await import("../src/features/codev");
    for (const k of ["ROLE", "ROUTE", "MODES", "DECS", "CKPT"] as const) {
      expect(CM[k], k).toBeDefined();
      expect(w[k], `window.${k}`).toBeUndefined();
    }
    expect(Array.isArray(CM.DECS)).toBe(true);
    expect(Array.isArray(CM.CKPT)).toBe(true);
    expect(CM.DECS.length).toBe(0);
    // sem missões guionadas (ADR-0006, R1b): o motor e os cenários deixaram de existir
    for (const k of ["runMission", "demo", "CRIT", "MISSIONS", "GAPS", "council", "execSteps"]) {
      expect(w[k], `window.${k}`).toBeUndefined();
    }
  });
});
