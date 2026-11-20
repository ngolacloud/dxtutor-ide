import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature Explain · Code-Review ·
 * Under-the-Hood) para `ui-app/src/features/codereview.ts`, via o harness que
 * carrega a cadeia real de módulos. Goldens de markup das duas tabs que os
 * comandos abrem — `renderCreviewView` (VIEW.creview) e `renderHoodView`
 * (VIEW.hood) — + caracterização do MOTOR puro a extrair (`reviewFindings`: a
 * regra de revisão, e a pontuação/severidade). ANTES de mover `reviewFindings`
 * e a política de severidade/score para `features/codereview/domain/`.
 *
 * A partir daqui, diff de golden = regressão (corrige o código, nunca o
 * snapshot — ver skill ui-golden-check). A caracterização de `reviewFindings`
 * fixa a saída EXACTA (severidades, títulos, linhas, ordem) para que a extracção
 * do domínio se prove byte-a-byte idêntica.
 *
 * Determinismo: nem `reviewFindings` nem os dois render usam Math.random/Date.
 * O workspace é semeado (VITE_SEED=1 fixo em vitest.config.ts → `SEED.base`), por
 * isso `FS[P_LX]` (crates/lexer/src/lib.rs) existe e tem o bug do iterador movido
 * (`for c in chars {` + `chars.peek()`), logo `lexBug()` é true — estado estável.
 * `window.SAMPLE` nasce `null` no arranque e o harness não corre o backend Tauri
 * (`window.claude` ausente), por isso o ramo «Deeper review with Claude» de
 * `renderCreviewView` fica OFF — baseline determinista. Timers falsos só para
 * neutralizar o polling de arranque (não há relógio a caracterizar).
 *
 * Ficheiros sintéticos: `SEED.base` só traz o lexer com bug e ficheiros limpos;
 * as outras regras (innerHTML/invoke/any em TS, clone/unwrap/LIMIT em Rust, FK em
 * SQL, Dockerfile, compose, k8s) exercitam-se injectando ficheiros deterministas
 * em `FS`, tal como o golden do `ext` injecta `scratch.ts` para o formatador.
 *
 * Chamamos `renderCreviewView`/`renderHoodView`/`reviewFindings` DIRECTAMENTE (não
 * via `VIEW.creview`/`VIEW.hood`): o harness exclui v5/v6, logo os shims de v6 não
 * existem aqui — a função a extrair é a de codereview.ts. */

let w: any;

const ROOT = "dxtutor/";
const P_LX = ROOT + "crates/lexer/src/lib.rs";

/** Ficheiro Rust sintético com três achados em severidades distintas: loop sobre
 *  clone do iterador (bug), `unwrap()` (risco) e `SELECT … LIMIT` sem `ORDER BY`
 *  (bug). Caminho sem «test» para não accionar a guarda do unwrap. */
const RS_MULTI = `fn load(conn: &Connection) -> Vec<Row> {
    let v = parse().unwrap();
    for c in it.clone() { use_it(c); }
    let sql = "SELECT id FROM t WHERE ws = ?1 LIMIT ?2";
    v
}
`;

/** TS sintético: `innerHTML` com interpolação (risco), `await invoke` sem
 *  try/catch (risco) e `: any` (estilo). Caminho fora de `desktop/src` para não
 *  accionar o `dsLint` de cores fixas. */
const TS_MULTI = `async function render(host: HTMLElement, id: string) {
  const items: any = await invoke("list", { id });
  host.innerHTML = \`<b>\${items[0].title}</b>\`;
}
`;

/** SQL sintético: chave estrangeira sem índice (perf). */
const SQL_FK = `CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id)
);
`;

/** Dockerfile sintético: root (risco), base `:latest` (risco), COPY src antes do
 *  build (perf). */
const DOCKERFILE = `FROM rust:latest
COPY src ./src
RUN cargo build --release
`;

/** k8s sintético: Deployment sem resources (risco) e Secret em texto claro (risco). */
const K8S = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: app
          image: app:1
---
apiVersion: v1
kind: Secret
stringData:
  password: hunter2
`;

/** docker-compose sintético: `depends_on` sem condição de saúde (risco). */
const COMPOSE = `services:
  app:
    build: .
    depends_on:
      - db
  db:
    image: postgres:16
`;

/** Injecta um ficheiro determinista no FS semeado. */
function put(path: string, content: string): void {
  w.FS[path] = { content, orig: content };
}

beforeEach(async () => {
  vi.useFakeTimers();
  w = await bootApp();
  // `LXL`/`lexVariant` são donos de `v6.ts`, que o harness exclui (como os goldens
  // de ext/codev). São helpers puros sobre `FS[P_LX]`: replicam-se aqui FIELMENTE
  // (cópia exacta do corpo em v6.ts) como fixture estável, para caracterizar o ramo
  // P_LX de `reviewFindings`/`renderHoodView`. `lexBug` já vem de diagnostics.ts na
  // cadeia. Baseline e re-corrida pós-extracção usam a mesma fixture → prova sólida.
  (window as any).LXL = (re: RegExp) => {
    const ls = (w.FS[P_LX] ? w.FS[P_LX].content : "").split("\n");
    return ls.findIndex((l: string) => re.test(l)) + 1;
  };
  (window as any).lexVariant = () => {
    const c = w.FS[P_LX] ? w.FS[P_LX].content : "";
    if (w.lexBug()) return "bug";
    if (/for c in chars\.clone\(\)/.test(c)) return "clone";
    if (/for c in chars\.by_ref\(\)/.test(c)) return "byref";
    if (/while let Some\(c\) = chars\.next\(\)/.test(c)) return "whilelet";
    return "other";
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("goldens de DOM — Code review (VIEW.creview)", () => {
  it("creview do lexer semeado (bug E0382, score baixo)", () => {
    const host = document.createElement("div");
    w.renderCreviewView({ path: P_LX }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("creview de ficheiro Rust com múltiplos achados (clone/unwrap/LIMIT)", () => {
    put("svc/load.rs", RS_MULTI);
    const host = document.createElement("div");
    w.renderCreviewView({ path: "svc/load.rs" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("creview de TS com innerHTML/invoke/any (risco + estilo)", () => {
    put("app/widget.ts", TS_MULTI);
    const host = document.createElement("div");
    w.renderCreviewView({ path: "app/widget.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("creview de ficheiro sem achados (ramo «No findings», score 100)", () => {
    put("app/clean.ts", "export const x = 1;\n");
    const host = document.createElement("div");
    w.renderCreviewView({ path: "app/clean.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("goldens de DOM — Under the hood (VIEW.hood)", () => {
  it("hood do lexer semeado (pipeline do compilador + memória + posse, variante bug)", () => {
    const host = document.createElement("div");
    w.renderHoodView({ path: P_LX }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("hood de SQL (plano de consulta)", () => {
    put("db/schema.sql", SQL_FK);
    const host = document.createElement("div");
    w.renderHoodView({ path: "db/schema.sql" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("hood de TS (build & runtime)", () => {
    put("app/widget.ts", TS_MULTI);
    const host = document.createElement("div");
    w.renderHoodView({ path: "app/widget.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("caracterização do motor — reviewFindings (regra pura a extrair)", () => {
  it("lexer semeado: um único achado, o bug E0382 na linha do peek", () => {
    const fs = w.reviewFindings(P_LX);
    expect(fs.length).toBe(1);
    expect(fs[0].sev).toBe("bug");
    expect(fs[0].t).toBe("Iterator used after being moved (E0382)");
    expect(fs[0].l).toBe(10); // linha de `chars.peek()` no lexer semeado
  });

  it("Rust múltiplo: clone(bug) + LIMIT(bug) + unwrap(risk), bugs primeiro", () => {
    put("svc/load.rs", RS_MULTI);
    const fs = w.reviewFindings("svc/load.rs");
    expect(fs.map((f: any) => f.sev)).toEqual(["bug", "bug", "risk"]);
    const titles = fs.map((f: any) => f.t);
    expect(titles).toContain("Loop iterates over a clone of the iterator");
    expect(titles).toContain("LIMIT without ORDER BY");
    expect(titles).toContain("unwrap() on a fallible value");
  });

  it("TS múltiplo: innerHTML(risk) + invoke(risk) + any(style), riscos antes do estilo", () => {
    put("app/widget.ts", TS_MULTI);
    const fs = w.reviewFindings("app/widget.ts");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk", "style"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "User text interpolated into innerHTML",
      "Backend call without error handling",
      "any disables type checking",
    ]);
  });

  it("SQL: chave estrangeira sem índice é um achado de performance", () => {
    put("db/schema.sql", SQL_FK);
    const fs = w.reviewFindings("db/schema.sql");
    expect(fs.map((f: any) => f.sev)).toEqual(["perf"]);
    expect(fs[0].t).toBe("Foreign key conversation_id has no index");
  });

  it("Dockerfile: root(risk) + base :latest(risk) + rebuild(perf)", () => {
    put("Dockerfile", DOCKERFILE);
    const fs = w.reviewFindings("Dockerfile");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk", "perf"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "Container runs as root",
      "Unpinned base image",
      "Dependencies rebuild on every source change",
    ]);
  });

  it("k8s: Deployment sem resources + Secret em texto claro (dois riscos)", () => {
    put("deploy/k8s/app.yaml", K8S);
    const fs = w.reviewFindings("deploy/k8s/app.yaml");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "No resource requests or limits",
      "Secret values in plain text in git",
    ]);
  });

  it("compose: depends_on sem condição de saúde (risco)", () => {
    put("docker-compose.yml", COMPOSE);
    const fs = w.reviewFindings("docker-compose.yml");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk"]);
    expect(fs[0].t).toBe("depends_on without a health condition");
  });

  it("ficheiro ausente de FS devolve lista vazia (guarda)", () => {
    expect(w.reviewFindings("nao/existe.rs")).toEqual([]);
  });

  it("ordem de severidade é bug < risk < perf < style (ordenação da regra)", () => {
    // Um Rust com unwrap(risk) + LIMIT(bug): o bug tem de vir primeiro apesar de
    // a linha do unwrap aparecer antes no ficheiro.
    put("svc/order.rs", `fn q() {\n    let x = f().unwrap();\n    let s = "SELECT a FROM t LIMIT 1";\n}\n`);
    const fs = w.reviewFindings("svc/order.rs");
    expect(fs.map((f: any) => f.sev)).toEqual(["bug", "risk"]);
  });

  it("pontuação: 100 menos as penalidades dos achados (via DOM .score)", () => {
    // Rust múltiplo = bug(25)+bug(25)+risk(12) = 62 → score 38.
    put("svc/load.rs", RS_MULTI);
    const host = document.createElement("div");
    w.renderCreviewView({ path: "svc/load.rs" }, host);
    const score = host.querySelector(".score")!;
    expect(score.textContent).toBe("38/100");
    expect(score.className).toContain("bad"); // 38 < THRESH(85)
  });
});
