import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature Visualize execution) para
 * `ui-app/src/features/visualizer.ts`, via o harness que carrega a cadeia real
 * de módulos. Caracteriza o MOTOR a extrair — um pipeline de compilador PURO:
 * o lexer `vzLex` (fonte → tokens), o parser `vzParse` (tokens → AST `{fns}`),
 * a inferência `vzHints` (tipos prováveis por uso), o interpretador com modelo
 * de memória `vzRun` (fonte → `{steps, end, out, err}`) e a narração `vzTell`
 * (evento → `{t,m,i,k}`) — e o GOLDEN do overlay `#viz` que `vizOpen`/`vzRender`
 * desenham. ANTES de mover qualquer um destes para
 * `features/visualizer/{domain,application,ui}/`.
 *
 * A partir daqui, diff de golden/snapshot = regressão (corrige o código, nunca
 * o snapshot — ver skill ui-golden-check). As caracterizações do motor fixam a
 * saída EXACTA (tokens, AST, passos, fim, narração) para que a extracção do
 * domínio se prove byte-a-byte idêntica.
 *
 * Sem fixtures de v6/boot (ao contrário do debug): tudo o que `visualizer.ts`
 * toca ao visualizar com fonte explícita vive na cadeia do harness — o overlay
 * `#viz` é injectado no `document.body` pelo próprio `vizOpen`, `hlLine` vem de
 * `features/syntax.ts` (shim no window), `$`/`esc`/`svg` do core, e `LS` de
 * `app.ts`. A decoração de `VIEW.lt`/`VIEW.hood` e o `boot7` (menus/CMD/EACT)
 * dependem de v5/v6/startup e ficam FORA deste golden (migram na Fase 3/4 como
 * portas de composição; aqui pinamos o motor puro + o overlay).
 *
 * Determinismo: `vzRun` não usa relógio nem aleatoriedade (endereços partem de
 * constantes fixas); o relógio é FIXADO na mesma (padrão scm/debug/board) só
 * para neutralizar o polling de arranque com timers falsos. As setas do overlay
 * (`vzArrows`) correm em `requestAnimationFrame` e dependem de `getBoundingClient
 * Rect` (zeros no jsdom); não adiantamos o rAF, logo `#vz-arrows` fica vazio e o
 * golden é estável. */

let w: any;

/** Programa mínimo determinista (Copy + aritmética + println) para pinar o
 *  pipeline completo sem o volume dos exemplos do catálogo. */
const TINY = `fn main() {
    let mut x = 5;
    x = x + 1;
    println!("{}", x);
}
`;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
});

afterEach(() => {
  vi.useRealTimers();
  // o overlay persiste no document.body entre testes (jsdom); limpa-o.
  const o = document.getElementById("viz");
  if (o) o.remove();
  (window as any).VZ = null;
});

/* ───────────── motor puro: lexer / parser / inferência ───────────── */
describe("visualizer · motor puro — lexer/parser", () => {
  it("vzLex produz os tokens exactos do programa mínimo", () => {
    expect(w.vzLex(TINY)).toMatchSnapshot();
  });

  it("vzParse produz o AST exacto do programa mínimo", () => {
    expect(w.vzParse(TINY)).toMatchSnapshot();
  });

  it("vzParse produz o AST do exemplo `sum` (fn + params + ref + for)", () => {
    expect(w.vzParse(w.VZS.sum[1])).toMatchSnapshot();
  });

  it("vzHints infere os tipos prováveis do exemplo `sum`", () => {
    const ast = w.vzParse(w.VZS.sum[1]);
    expect(w.vzHints(ast)).toMatchSnapshot();
  });
});

/* ───────────── motor puro: interpretador (vzRun) ───────────── */
describe("visualizer · motor puro — interpretador", () => {
  it("vzRun traça o programa mínimo passo-a-passo (estrutura completa)", () => {
    expect(w.vzRun(TINY)).toMatchSnapshot();
  });

  it("vzRun traça o crescimento de um Vec (`grow`, estrutura completa)", () => {
    expect(w.vzRun(w.VZS.grow[1])).toMatchSnapshot();
  });

  it("vzRun rejeita o use-after-move (`moved`) como erro de compilação", () => {
    expect(w.vzRun(w.VZS.moved[1])).toMatchSnapshot();
  });

  // Pino de comportamento ponta-a-ponta de TODO o catálogo de exemplos: nº de
  // passos, fim (ok/panic/comp), stdout e stderr. Apanha regressões sem o volume
  // do traço completo de cada um.
  it("vzRun — resumo determinista de cada exemplo do catálogo VZS", () => {
    const summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries<any>(w.VZS)) {
      const r = w.vzRun(v[1]);
      summary[k] = { title: v[0], steps: r.steps.length, end: r.end, out: r.out, err: r.err };
    }
    expect(summary).toMatchSnapshot();
  });
});

/* ───────────── motor puro: narração (vzTell via VZ.notes) ───────────── */
describe("visualizer · motor puro — narração", () => {
  it("vzTell narra cada passo do exemplo `sum` (povoado por vizOpen em VZ.notes)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(w.VZ.notes).toMatchSnapshot();
  });
});

/* ───────────── overlay: markup de #viz ───────────── */
describe("visualizer · overlay #viz (golden)", () => {
  function vizGolden(): string {
    return golden(document.getElementById("viz")!);
  }

  it("renderiza o exemplo `sum` no passo 0", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(vizGolden()).toMatchSnapshot();
  });

  it("avança o exemplo `sum` até ao último passo (saída + contadores)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    w.vzGo(w.VZ.res.steps.length - 1);
    expect(vizGolden()).toMatchSnapshot();
  });

  it("mostra o cartão de erro do use-after-move (`moved`)", () => {
    w.vizOpen(w.VZS.moved[1], w.VZS.moved[0]);
    expect(vizGolden()).toMatchSnapshot();
  });

  it("profundidade `basic` — variáveis + call stack", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    w.VZ.depth = "basic";
    w.vzRender();
    expect(vizGolden()).toMatchSnapshot();
  });

  it("profundidade `machine` — memória + contadores + endereços", () => {
    w.vizOpen(w.VZS.grow[1], w.VZS.grow[0]);
    w.vzGo(5);
    w.VZ.depth = "machine";
    w.vzRender();
    expect(vizGolden()).toMatchSnapshot();
  });
});

/* ───────────── dispatch delegado: data-action → listener (ui/actions.ts) ─────────────
   O golden strippa data-action/data-on/onclick/onchange/oninput — logo NÃO prova que os
   botões do overlay ainda disparam o efeito certo depois da migração da Fase 4. Estes
   testes disparam eventos REAIS (click/change) sobre o markup renderizado e verificam o
   efeito observável (estado VZ, classe .show), cobrindo os dois tipos de evento. */
describe("visualizer · dispatch delegado (Fase 4)", () => {
  const q = (sel: string): HTMLElement => document.querySelector(sel) as HTMLElement;

  it("data-action=vz-step (click) avança um passo; vz-back recua", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(w.VZ.i).toBe(0);
    q('[data-action="vz-step"]').click();
    expect(w.VZ.i).toBe(1);
    q('[data-action="vz-back"]').click();
    expect(w.VZ.i).toBe(0);
  });

  it("data-action=vz-depth (click) com data-on troca a profundidade", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(w.VZ.depth).toBe("memory");
    q('[data-action="vz-depth"][data-on="machine"]').click();
    expect(w.VZ.depth).toBe("machine");
  });

  it("data-action=vz-close (click) fecha o overlay (remove .show)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(document.getElementById("viz")!.classList.contains("show")).toBe(true);
    q('[data-action="vz-close"]').click();
    expect(document.getElementById("viz")!.classList.contains("show")).toBe(false);
  });

  it("data-action=vz-predict (change) alterna o modo prever (lê .checked)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(w.VZ.predict).toBe(false);
    const cb = q('[data-action="vz-predict"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event("change", { bubbles: true }));
    expect(w.VZ.predict).toBe(true);
  });

  it("data-action=vz-pick (change) abre o exemplo escolhido (lê .value)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    const sel = q('[data-action="vz-pick"]') as HTMLSelectElement;
    sel.value = "grow";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(w.VZ.src).toBe(w.VZS.grow[1]);
  });

  it("data-action=vz-play (click) arranca o temporizador (toggle)", () => {
    w.vizOpen(w.VZS.sum[1], w.VZS.sum[0]);
    expect(w.VZ.timer).toBeNull();
    q('[data-action="vz-play"]').click();
    expect(w.VZ.timer).not.toBeNull();
    q('[data-action="vz-play"]').click();
    expect(w.VZ.timer).toBeNull();
  });
});
