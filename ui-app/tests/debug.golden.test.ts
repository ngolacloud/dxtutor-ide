import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature Run and Debug) para
 * `ui-app/src/features/debug.ts`, via o harness que carrega a cadeia real de
 * módulos. Goldens do markup de `renderDebugPane` (#pane-debug) e `drawDbg`
 * (#pc-dbg) em três estados — sem sessão (lista Launch), sessão `pre` (a oferta
 * do .clone() do rustc, variante «bug» do seed) e sessão `code` percorrida até
 * ao fim (variante «clone») — + caracterização do MOTOR a extrair: os geradores
 * puros `lexTrace` (passos de código por variante), `crashTrace` (sonda de ops) e
 * `debugConfigs` (lançadores), e o estado de breakpoints `toggleBp`/`saveBps`/`BPS`.
 * ANTES de mover qualquer um destes para `features/debug/{domain,application}/`.
 *
 * A partir daqui, diff de golden = regressão (corrige o código, nunca o snapshot
 * — ver skill ui-golden-check). As caracterizações do motor fixam a saída EXACTA
 * (passos, hipóteses, fim) para que a extracção do domínio/aplicação se prove
 * byte-a-byte idêntica.
 *
 * Fixtures do runtime que o harness exclui (vivem em v6.ts/boot6): os containers
 * #pane-debug e #pc-dbg, o shim RP.debug→renderDebugPane, e os helpers de lexer
 * `LXL` (nº da linha por regex sobre o fonte) e `lexVariant` (variante do fonte).
 * São reproduzidos 1:1 em `provideV6Fixtures()`: o golden pina o render de
 * `debug.ts` DADO este ambiente, que é o que a app dá em runtime. `LXL`/`lexVariant`
 * tornam-se portas injectadas na extracção; pinar `lexTrace` contra um `LXL` real
 * sobre o seed é exactamente o contrato dessa porta.
 *
 * Determinismo: o relógio é FIXADO (`setSystemTime`) antes de `bootApp` (padrão do
 * scm.golden) — por segurança, embora o markup do debug não interpole tempo
 * (o `hhmm()` do feed fica em `f.t`, que não é renderizado). Timers falsos só para
 * neutralizar o polling de arranque. O seed deixa `FS[P_LX]` na variante «bug»
 * (`for c in chars {` + `chars.peek()`), que `lexVariant` reporta como "bug". */

let w: any;

/** Reproduz as peças que v6.ts/boot6 dão em runtime e o harness exclui. */
function provideV6Fixtures(): void {
  const side = document.querySelector(".side");
  if (side && !document.getElementById("pane-debug")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-debug"></div>');
  const pb = document.querySelector(".panel-body");
  if (pb && !document.getElementById("pc-dbg")) pb.insertAdjacentHTML("beforeend", '<div class="pcontent" id="pc-dbg"></div>');
  w.RP.debug = () => w.renderDebugPane();
  w.LXL = (re: RegExp) => { const ls = (w.FS[w.P_LX] ? w.FS[w.P_LX].content : "").split("\n"); return ls.findIndex((l: string) => re.test(l)) + 1; };
  w.lexVariant = () => {
    const c = w.FS[w.P_LX] ? w.FS[w.P_LX].content : "";
    if (w.lexBug()) return "bug";
    if (/for c in chars\.clone\(\)/.test(c)) return "clone";
    if (/for c in chars\.by_ref\(\)/.test(c)) return "byref";
    if (/while let Some\(c\) = chars\.next\(\)/.test(c)) return "whilelet";
    return "other";
  };
}

/** Carimba um container recém-renderizado e devolve o golden strippado. */
function paneGolden(): string { return golden(document.getElementById("pane-debug")!); }
function feedGolden(): string { return golden(document.getElementById("pc-dbg")!); }

/** Semeia um cenário de ops determinista (envState/secrets do infra devolvem `null`
 *  em headless): um crash de DNS em `orders-worker`, com `orders-api` saudável a
 *  apontar para o host correcto (exercita o ramo do «peer» de `crashTrace`). */
function seedOpsScenario(): void {
  w.ENVX.ns.staging = "dxtutor-staging";
  w.ENVX.sec = {
    staging: {
      "orders-worker": { DATABASE_URL: "postgres://app:secret@db.bad:5432/orders" },
      "orders-api": { DATABASE_URL: "postgres://app:secret@db.staging:5432/orders" },
    },
  };
  w.envState = () => ({
    deps: [
      { n: "orders-worker", status: "crash", restarts: 6, err: "dial tcp: lookup db.bad on 10.0.0.10:53: no such host" },
      { n: "orders-api", status: "ok" },
    ],
  });
  w.localSecrets = () => ({ "orders-worker": { DATABASE_URL: "postgres://app:secret@db.staging:5432/orders" } });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // O `window` persiste entre testes no jsdom; `debug.ts` reutiliza o `window.DBG`/
  // `window.BPS` existentes ao reavaliar. Repor ANTES do boot para cada teste
  // arrancar com sessão nula e sem breakpoints (independente da ordem).
  (window as any).DBG = null;
  if ((window as any).BPS instanceof Set) (window as any).BPS.clear();
  w = await bootApp();
  provideV6Fixtures();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — Run and Debug (renderDebugPane / drawDbg)", () => {
  it("sem sessão: lista Launch + feed vazio (empty state)", () => {
    expect(w.dbgState()).toBe(null);
    w.renderDebugPane();
    w.drawDbg();
    expect(paneGolden()).toMatchSnapshot("pane-no-session");
    expect(feedGolden()).toMatchSnapshot("feed-no-session");
  });

  it("sessão pre: variante «bug» do seed → oferta do .clone() do rustc", () => {
    expect(w.lexVariant()).toBe("bug");
    w.startDebug("lexer");
    const ds = w.dbgState();
    expect(ds.kind).toBe("pre");
    expect(ds.offer).toBe(true);
    w.renderDebugPane();
    expect(paneGolden()).toMatchSnapshot("pane-pre-session");
    expect(feedGolden()).toMatchSnapshot("feed-pre-session");
  });

  it("sessão code: variante «clone» percorrida até ao fim (root cause)", () => {
    // Troca o fonte do lexer para a variante «clone» (a que o rustc sugere); o seed
    // é «bug». O nº de linhas não muda, logo os breakpoints/LXL ficam estáveis.
    w.FS[w.P_LX].content = w.FS[w.P_LX].content.replace("for c in chars {", "for c in chars.clone() {");
    expect(w.lexVariant()).toBe("clone");
    w.startDebug("lexer");
    for (let k = 0; k < 20 && w.dbgState() && !w.dbgState().done; k++) w.dbgStep();
    const ds = w.dbgState();
    expect(ds.kind).toBe("code");
    expect(ds.done).toBe(true);
    expect(ds.end.ok).toBe(false);
    w.renderDebugPane();
    expect(paneGolden()).toMatchSnapshot("pane-code-session");
    expect(feedGolden()).toMatchSnapshot("feed-code-session");
  });
});

describe("caracterização do motor — geradores de traço (a extrair p/ domain)", () => {
  it("lexTrace: passos + fim exactos por variante (clone/byref/whilelet/other)", () => {
    for (const v of ["clone", "byref", "whilelet", "other"]) {
      expect(w.lexTrace(v)).toMatchSnapshot("lexTrace-" + v);
    }
  });

  it("debugConfigs: lançadores (só lexer sem ambientes crash hidratados)", () => {
    expect(w.debugConfigs()).toMatchSnapshot("debugConfigs");
  });

  it("crashTrace: sonda de ops (crash de DNS com peer saudável)", () => {
    seedOpsScenario();
    expect(w.crashTrace("staging", "orders-worker")).toMatchSnapshot("crashTrace-dns");
  });
});

describe("caracterização do motor — breakpoints (toggleBp/BPS)", () => {
  // Nota: o `localStorage` do jsdom é inoperante neste harness ("--localstorage-file
  // without a valid path"), por isso a PERSISTÊNCIA de `saveBps`/`LS` (porta de infra)
  // não se caracteriza aqui — só a semântica PURA do Set de breakpoints (chave
  // `path:line`, alternância idempotente), que é o que vai para o domínio.
  it("BPS nasce vazio para cada teste", () => {
    expect([...w.dbgBreaks]).toEqual([]);
  });

  it("toggleBp alterna por chave path:line (add/remove idempotente)", () => {
    const key = w.P_LX + ":7";
    expect(w.dbgBreaks.has(key)).toBe(false);
    w.toggleBp(w.P_LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(true);
    w.toggleBp(w.P_LX, 7);
    expect(w.dbgBreaks.has(key)).toBe(false);
  });
});
