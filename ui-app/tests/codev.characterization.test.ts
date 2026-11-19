import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";

/* Testes de caracterização do motor Co-Dev ACTUAL (features/codev.ts), antes de
 * qualquer extracção para Clean Architecture. Não tocam em código-fonte: só o
 * exercitam através do window real, carregado pelo harness. Cada `it` arranca
 * uma app fresca (bootApp) e usa temporizadores falsos para atravessar os
 * `beat()`/`sleep()` reais sem esperar tempo de relógio — isto é o que torna a
 * suite estável em corridas repetidas (nenhuma espera real, nenhum polling). */

let w: any;

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
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
      w.MODE = mode;
      const h = host();
      const p = w.doTool({ t: "read", p: w.P_LX }, h);
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
    w.MODE = mode;
    const h = host();
    const p = w.doTool({ t: "run", cmd }, h);
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
      w.MODE = mode;
      const h = host();
      const p = w.doTool({ t: "edit", p: w.P_LX, content: w.FS[w.P_LX].content + "\n// x" }, h);
      expect(gate(h)).toBeNull();
      expect(await resolved(p)).toBe(true);
    }
    w.MODE = "manual";
    const h = host();
    const p = w.doTool({ t: "edit", p: w.P_LX, content: w.FS[w.P_LX].content + "\n// y" }, h);
    expect(gate(h)).not.toBeNull();
    clickByLabel(h, "Aprovar edição");
    expect(await resolved(p)).toBe(true);
  });
});

describe("2. edição sem alterações nunca pede aprovação (invariante #1)", () => {
  it("'sem alterações' em manual/assist/auto: sucesso, sem gate", async () => {
    for (const mode of ["manual", "assist", "auto"]) {
      w.MODE = mode;
      const h = host();
      const same = w.FS[w.P_LX].content;
      const p = w.doTool({ t: "edit", p: w.P_LX, content: same }, h);
      expect(gate(h)).toBeNull();
      expect(await resolved(p)).toBe(true);
      expect(h.textContent).toContain("sem alterações");
    }
  });
});

describe("3. skip vs reject: skip devolve null (não false), rejeição devolve false", () => {
  it("edit rejeitado em manual -> false, FS não é escrito", async () => {
    w.MODE = "manual";
    const h = host();
    const before = w.FS[w.P_LX].content;
    const p = w.doTool({ t: "edit", p: w.P_LX, content: before + "\n// rejected" }, h);
    clickByLabel(h, "Rejeitar");
    expect(await resolved(p)).toBe(false);
    expect(w.FS[w.P_LX].content).toBe(before);
  });

  it("run saltado em assist (comando não-SAFE) -> null, não false", async () => {
    w.MODE = "assist";
    const h = host();
    const p = w.doTool({ t: "run", cmd: "curl example.org" }, h);
    clickByLabel(h, "Saltar");
    expect(await resolved(p)).toBeNull();
  });

  it("execSteps marca o passo como feito mesmo quando o comando foi saltado (null, não false)", async () => {
    w.MODE = "assist";
    const steps = [{ l: "correr algo não-seguro", tools: [{ t: "run", cmd: "curl example.org" }] }];
    const p = w.execSteps(steps, "título", false);
    await vi.advanceTimersByTimeAsync(400); // dá tempo ao primeiro beat(300) do loop
    const h2 = document.querySelector("#ag-msgs .m.ai:last-child") as HTMLElement;
    clickByLabel(h2, "Saltar");
    await resolved(p);
    const row = document.querySelector("#ag-msgs .m.ai:last-child .stp") as HTMLElement;
    expect(row.className).toContain("done");
    expect(row.querySelector(".g")?.textContent).toBe("✓");
  });
});

describe("4. decideQ: limiar de confiança 0.8 e estado 'pressuposto'", () => {
  const q = (conf: number) => ({ q: "pergunta?", opts: [{ l: "A", why: "a" }, { l: "B", why: "b" }], best: 0, conf, basis: "teste" });

  it("auto decide sempre sozinho; confiança baixa fica registada como pressuposto", async () => {
    w.MODE = "auto";
    const M = { title: "m", decs: [] };
    const p = w.decideQ(q(0.5), M);
    await resolved(p);
    expect(w.DECS[0].by).toBe("agente");
    expect(w.DECS[0].status).toBe("pressuposto");
  });

  it("auto com confiança alta decide sozinho com estado ok", async () => {
    w.MODE = "auto";
    const M = { title: "m", decs: [] };
    await resolved(w.decideQ(q(0.95), M));
    expect(w.DECS[0].by).toBe("agente");
    expect(w.DECS[0].status).toBe("ok");
  });

  it("assist com confiança >= 0.8 decide sozinho", async () => {
    w.MODE = "assist";
    const M = { title: "m", decs: [] };
    await resolved(w.decideQ(q(0.8), M));
    expect(w.DECS[0].by).toBe("agente");
    expect(w.DECS[0].status).toBe("ok");
  });

  it("assist com confiança < 0.8 pede ao humano", async () => {
    w.MODE = "assist";
    const M = { title: "m", decs: [] };
    const p = w.decideQ(q(0.5), M);
    await vi.advanceTimersByTimeAsync(10);
    const opt = document.querySelector("#ag-msgs .m.ai:last-child .qo button[data-i='1']") as HTMLElement;
    expect(opt).not.toBeNull();
    opt.click();
    await resolved(p);
    expect(w.DECS[0].by).toBe("humano");
  });
});

describe("5. conselho de modelos: melhor candidato sempre incluído, letras pós-filtro, empate", () => {
  it("o melhor candidato entra mesmo com o provedor desligado, e é reatribuído", async () => {
    w.MODE = "assist";
    w.PROV.gemini.on = false;
    const S = {
      best: 0,
      cands: [
        { prov: "gemini", title: "BEST", sum: "s", sc: { c: 10, a: 10, t: 10, r: 10, k: 10 } },
        { prov: "gemini", title: "TAMBEM_GEMINI", sum: "s", sc: { c: 5, a: 5, t: 5, r: 5, k: 5 } },
        { prov: "codex", title: "CODEX_ON", sum: "s", sc: { c: 1, a: 1, t: 1, r: 1, k: 1 } },
      ],
    };
    const M: any = { decs: [] };
    const pick = await resolved(w.council(S, M));
    const card = document.querySelector("#ag-msgs .m.ai:last-child") as HTMLElement;
    const cands = Array.from(card.querySelectorAll(".cand"));
    // só 2 sobrevivem ao filtro: o melhor (reatribuído) + o candidato com provedor ligado
    expect(cands.length).toBe(2);
    expect(cands[0].textContent).toContain("Proposta A");
    expect(cands[1].textContent).toContain("Proposta B");
    expect(pick.title).toBe("BEST");
    expect(pick.prov).toBe("claude"); // primeiro provedor ligado, por reatribuição
  });

  it("em empate de pontuação, o primeiro candidato ganha", async () => {
    w.MODE = "assist";
    const S = {
      best: 0,
      cands: [
        { prov: "claude", title: "TIE_A", sum: "s", sc: { c: 8, a: 8, t: 8, r: 8, k: 8 } },
        { prov: "claude", title: "TIE_B", sum: "s", sc: { c: 8, a: 8, t: 8, r: 8, k: 8 } },
      ],
    };
    const M: any = { decs: [] };
    const pick = await resolved(w.council(S, M));
    expect(pick.title).toBe("TIE_A");
  });

  it("em modo manual só são escolhíveis os candidatos com steps, mais o melhor", async () => {
    w.MODE = "manual";
    const S = {
      best: 0,
      cands: [
        { prov: "claude", title: "BEST_NO_STEPS", sum: "s", sc: { c: 9, a: 9, t: 9, r: 9, k: 9 } },
        { prov: "codex", title: "TEM_STEPS", sum: "s", sc: { c: 5, a: 5, t: 5, r: 5, k: 5 }, steps: [] },
        { prov: "ollama", title: "SEM_STEPS", sum: "s", sc: { c: 1, a: 1, t: 1, r: 1, k: 1 } },
      ],
    };
    const M: any = { decs: [] };
    const p = w.council(S, M);
    await vi.advanceTimersByTimeAsync(5000);
    const card = document.querySelector("#ag-msgs .m.ai:last-child") as HTMLElement;
    const btns = gateButtons(card);
    // BEST_NO_STEPS (é o melhor) + TEM_STEPS (tem steps); SEM_STEPS fica de fora
    expect(btns.length).toBe(2);
    btns[0].click();
    await resolved(p);
  });
});

describe("6. estratégia de correcção: switch vs incremental, e fallback sem restaurar checkpoint", () => {
  const baseScenario = () => ({
    title: "S",
    best: 0,
    cands: [{ steps: [{ l: "refazer", tools: [{ t: "read", p: w.P_LX }] }] }],
    steps: [{ l: "plano original", tools: [{ t: "read", p: w.P_LX }] }],
    fix: {
      strategy: "inc",
      steps: [{ for: "tests", l: "corrigir testes", tools: [{ t: "read", p: w.P_LX }] }],
    },
  });

  it("retries > 1 força estratégia switch e restaura o checkpoint inicial", async () => {
    w.MODE = "auto";
    const restoreSpy = vi.spyOn(w, "restoreCkpt");
    const S = baseScenario();
    const M: any = { decs: [], retries: 2, ck0: 123 };
    const ev = { score: 10, fails: [{ id: "tests", l: "x", cause: "c", fixd: "f" }] };
    await resolved(w.reflect(S, M, ev));
    expect(restoreSpy).toHaveBeenCalledWith(123, true);
  });

  it("fix.strategy==='switch' força switch mesmo na 1a tentativa", async () => {
    w.MODE = "auto";
    const restoreSpy = vi.spyOn(w, "restoreCkpt");
    const S = baseScenario();
    S.fix.strategy = "switch";
    const M: any = { decs: [], retries: 1, ck0: 456 };
    const ev = { score: 10, fails: [{ id: "tests", l: "x", cause: "c", fixd: "f" }] };
    await resolved(w.reflect(S, M, ev));
    expect(restoreSpy).toHaveBeenCalledWith(456, true);
  });

  it("estratégia incremental não restaura o checkpoint", async () => {
    w.MODE = "auto";
    const restoreSpy = vi.spyOn(w, "restoreCkpt");
    const S = baseScenario();
    const M: any = { decs: [], retries: 1, ck0: 789 };
    const ev = { score: 10, fails: [{ id: "tests", l: "x", cause: "c", fixd: "f" }] };
    await resolved(w.reflect(S, M, ev));
    expect(restoreSpy).not.toHaveBeenCalled();
  });

  it("se o filtro incremental não encontra passos, cai para o plano completo SEM restaurar", async () => {
    w.MODE = "auto";
    const restoreSpy = vi.spyOn(w, "restoreCkpt");
    const S = baseScenario();
    S.fix.steps = [{ for: "outro-id-qualquer", l: "x", tools: [{ t: "read", p: w.P_LX }] }];
    const M: any = { decs: [], retries: 1, ck0: 999 };
    const ev = { score: 10, fails: [{ id: "tests", l: "x", cause: "c", fixd: "f" }] };
    await resolved(w.reflect(S, M, ev));
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});

describe("7. modo auto commita sem perguntar", () => {
  it("runMission em modo auto completa e chama commitGit sem nenhum gate interactivo", async () => {
    w.MODE = "auto";
    const commitSpy = vi.spyOn(w, "commitGit").mockReturnValue({ h: "abc1234" });
    const S = {
      id: "synthetic",
      title: "Missão sintética",
      prompt: "pedido",
      ready: () => null,
      reads: [],
      understand: "entendido",
      reqs: [],
      questions: [],
      cands: [{ prov: "claude", title: "única proposta", sum: "s", sc: { c: 10, a: 10, t: 10, r: 10, k: 10 }, steps: [{ l: "passo único", tools: [{ t: "read", p: w.P_LX }] }] }],
      best: 0,
      verify: ["echo ok"],
      checks: [{ id: "chk", l: "passa sempre", w: 100, fn: () => true }],
      done: ["feito"],
      commit: "fix: synthetic test commit",
    };
    // Se qualquer gate interactivo aparecesse, esta promessa nunca resolveria
    // (runAllTimersAsync só avança temporizadores, não clica botões) e o teste
    // falharia por timeout — a conclusão com sucesso já prova "sem perguntar".
    await resolved(w.runMission(S, "pedido sintético"));
    expect(commitSpy).toHaveBeenCalledWith("fix: synthetic test commit");
    expect(w.MISSIONS[0].state).toBe("concluída");
  });
});

describe("8. runMission: user(text) corre antes de qualquer early-exit", () => {
  it("sem provedor ligado, a mensagem do utilizador aparece antes do aviso do sistema", async () => {
    Object.values(w.PROV).forEach((p: any) => (p.on = false));
    const S = { id: "z", title: "Missão sem provedores", ready: () => null };
    await resolved(w.runMission(S, "o meu pedido"));
    const msgs = Array.from(document.querySelectorAll("#ag-msgs .m"));
    const userIdx = msgs.findIndex((m) => m.className.includes("user"));
    const sysIdx = msgs.findIndex((m) => m.textContent?.includes("Não há nenhum provedor ligado"));
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(sysIdx).toBeGreaterThan(userIdx);
    expect(msgs[userIdx].textContent).toContain("o meu pedido");
  });

  it("sem provedor ligado, user() corre mesmo quando o cenário está 'ready' com aviso", async () => {
    Object.values(w.PROV).forEach((p: any) => (p.on = false));
    const S = { id: "z2", title: "Missão", ready: () => "já está feito" };
    await resolved(w.runMission(S, "outro pedido"));
    const msgs = Array.from(document.querySelectorAll("#ag-msgs .m"));
    expect(msgs.some((m) => m.textContent?.includes("outro pedido"))).toBe(true);
  });
});

describe("9. janela de histórico do live chat (últimas 9, sem líder não-user, prompt de sistema prefixado)", () => {
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
      w.CHAT.push({ role: i % 2 === 0 ? "assistant" : "user", content: "msg" + i });
    }
    await resolved(w.liveChat("pergunta final"));
    expect(captured.length).toBeLessThanOrEqual(9);
    expect(captured[0].role).toBe("user");
    expect(captured[0].content).toContain("———");
    expect(captured[captured.length - 1].content).toBe("pergunta final");
  });
});

describe("10. ordem/altura de publicação dos globais do motor Co-Dev no window", () => {
  it("ROLE/ROUTE/MODES/CRIT/MISSIONS/DECS/CKPT/GAPS já existem logo após a avaliação do módulo", () => {
    for (const k of ["ROLE", "ROUTE", "MODES", "CRIT", "MISSIONS", "DECS", "CKPT", "GAPS"]) {
      expect(w[k], `window.${k}`).toBeDefined();
    }
    expect(Array.isArray(w.MISSIONS)).toBe(true);
    expect(Array.isArray(w.DECS)).toBe(true);
    expect(Array.isArray(w.CKPT)).toBe(true);
    expect(w.MISSIONS.length).toBe(0);
    expect(w.DECS.length).toBe(0);
  });
});

describe("11. SCN_() é lazy: lê SEED/ROOT/P_* de app.ts (avaliado depois) sem rebentar", () => {
  it("demo('a') funciona depois do arranque, lendo os caminhos reais do app.ts", async () => {
    w.MODE = "assist";
    expect(() => w.demo("a")).not.toThrow();
    await vi.advanceTimersByTimeAsync(50);
    const card = document.querySelector("#ag-msgs .m.ai") as HTMLElement;
    expect(card).not.toBeNull();
  });
});
