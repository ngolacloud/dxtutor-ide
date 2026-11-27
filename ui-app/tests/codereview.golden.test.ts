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
 * O workspace é a fixture `sample-workspace` (aplicada pelo harness), por
 * isso `FS[P_LX]` (crates/lexer/src/lib.rs) existe — já sem regras próprias (a do
 * E0382 do lexer de demonstração saiu: ADR-0006, R1c1).
 * `window.SAMPLE` nasce `null` no arranque e o harness não corre o backend Tauri
 * (`window.claude` ausente), por isso o ramo «Deeper review with Claude» de
 * `renderCreviewView` fica OFF — baseline determinista. Timers falsos só para
 * neutralizar o polling de arranque (não há relógio a caracterizar).
 *
 * Ficheiros sintéticos: a fixture só traz o lexer com bug e ficheiros limpos;
 * as outras regras (innerHTML/invoke/any em TS, clone/unwrap/LIMIT em Rust, FK em
 * SQL, Dockerfile, compose, k8s) exercitam-se injectando ficheiros deterministas
 * em `FS`, tal como o golden do `ext` injecta `scratch.ts` para o formatador.
 *
 * Chamamos `renderCreviewView`/`renderHoodView`/`reviewFindings` DIRECTAMENTE (não
 * via `VIEW.creview`/`VIEW.hood`): o harness exclui v5/v6, logo os shims de v6 não
 * existem aqui — a função a extrair é a de codereview.ts. */

let w: any;
let CRM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7p5)

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
  CRM = await import("../src/features/codereview");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("goldens de DOM — Code review (VIEW.creview)", () => {
  it("creview de ficheiro Rust com múltiplos achados (clone/unwrap/LIMIT)", () => {
    put("svc/load.rs", RS_MULTI);
    const host = document.createElement("div");
    CRM.renderCreviewView({ path: "svc/load.rs" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("creview de TS com innerHTML/invoke/any (risco + estilo)", () => {
    put("app/widget.ts", TS_MULTI);
    const host = document.createElement("div");
    CRM.renderCreviewView({ path: "app/widget.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("creview de ficheiro sem achados (ramo «No findings», score 100)", () => {
    put("app/clean.ts", "export const x = 1;\n");
    const host = document.createElement("div");
    CRM.renderCreviewView({ path: "app/clean.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("goldens de DOM — Under the hood (VIEW.hood)", () => {
  it("hood de Rust: as fases do compilador explicadas, sem as dar por verificadas", () => {
    put("src/main.rs", "fn main() {}\n");
    const host = document.createElement("div");
    CRM.renderHoodView({ path: "src/main.rs" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("hood de SQL: plano derivado do WHERE e dos CREATE INDEX do workspace (SEARCH)", () => {
    put("db/migrations/0001_notes.sql", "CREATE TABLE notes (id INTEGER PRIMARY KEY, owner_id INTEGER);\nCREATE INDEX idx_notes_owner ON notes(owner_id);\n");
    put("db/queries.sql", "SELECT id FROM notes WHERE owner_id = ? LIMIT 10;\n");
    const host = document.createElement("div");
    CRM.renderHoodView({ path: "db/queries.sql" }, host);
    expect(golden(host)).toMatchSnapshot();
  });

  it("hood de SQL sem índice na coluna do WHERE: SCAN; sem SELECT: nenhum plano inventado", () => {
    put("db/queries.sql", "SELECT id FROM tags WHERE label = ?;\n");
    const host = document.createElement("div");
    CRM.renderHoodView({ path: "db/queries.sql" }, host);
    expect(host.textContent).toContain("SCAN tags");
    expect(host.textContent).toContain("no index on tags(label)");
    put("db/schema.sql", SQL_FK);
    CRM.renderHoodView({ path: "db/schema.sql" }, host);
    expect(host.textContent).not.toContain("Query plan");
  });

  it("hood de TS (build & runtime)", () => {
    put("app/widget.ts", TS_MULTI);
    const host = document.createElement("div");
    CRM.renderHoodView({ path: "app/widget.ts" }, host);
    expect(golden(host)).toMatchSnapshot();
  });
});

describe("caracterização do motor — reviewFindings (regra pura a extrair)", () => {
  it("cores fixas: qualquer CSS/TS do projecto, menos as definições de tokens", () => {
    put("web/app.css", ":root {\n  --accent: #e06c3b;\n}\n.btn { color: #fff; }\n");
    const fs = CRM.reviewFindings("web/app.css");
    expect(fs.map((f: any) => [f.l, f.sev, f.t])).toEqual([[4, "style", "Fixed colour #fff"]]);
    // a regra do E0382 do lexer de demonstração saiu (ADR-0006, R1c1)
    expect(CRM.reviewFindings(P_LX).some((f: any) => /E0382/.test(f.t))).toBe(false);
  });

  it("Rust múltiplo: clone(bug) + LIMIT(bug) + unwrap(risk), bugs primeiro", () => {
    put("svc/load.rs", RS_MULTI);
    const fs = CRM.reviewFindings("svc/load.rs");
    expect(fs.map((f: any) => f.sev)).toEqual(["bug", "bug", "risk"]);
    const titles = fs.map((f: any) => f.t);
    expect(titles).toContain("Loop iterates over a clone of the iterator");
    expect(titles).toContain("LIMIT without ORDER BY");
    expect(titles).toContain("unwrap() on a fallible value");
  });

  it("TS múltiplo: innerHTML(risk) + invoke(risk) + any(style), riscos antes do estilo", () => {
    put("app/widget.ts", TS_MULTI);
    const fs = CRM.reviewFindings("app/widget.ts");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk", "style"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "User text interpolated into innerHTML",
      "Backend call without error handling",
      "any disables type checking",
    ]);
  });

  it("SQL: chave estrangeira sem índice é um achado de performance", () => {
    put("db/schema.sql", SQL_FK);
    const fs = CRM.reviewFindings("db/schema.sql");
    expect(fs.map((f: any) => f.sev)).toEqual(["perf"]);
    expect(fs[0].t).toBe("Foreign key conversation_id has no index");
  });

  it("Dockerfile: root(risk) + base :latest(risk) + rebuild(perf)", () => {
    put("Dockerfile", DOCKERFILE);
    const fs = CRM.reviewFindings("Dockerfile");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk", "perf"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "Container runs as root",
      "Unpinned base image",
      "Dependencies rebuild on every source change",
    ]);
  });

  it("k8s: Deployment sem resources + Secret em texto claro (dois riscos)", () => {
    put("deploy/k8s/app.yaml", K8S);
    const fs = CRM.reviewFindings("deploy/k8s/app.yaml");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk", "risk"]);
    expect(fs.map((f: any) => f.t)).toEqual([
      "No resource requests or limits",
      "Secret values in plain text in git",
    ]);
  });

  it("compose: depends_on sem condição de saúde (risco)", () => {
    put("docker-compose.yml", COMPOSE);
    const fs = CRM.reviewFindings("docker-compose.yml");
    expect(fs.map((f: any) => f.sev)).toEqual(["risk"]);
    expect(fs[0].t).toBe("depends_on without a health condition");
  });

  it("ficheiro ausente de FS devolve lista vazia (guarda)", () => {
    expect(CRM.reviewFindings("nao/existe.rs")).toEqual([]);
  });

  it("ordem de severidade é bug < risk < perf < style (ordenação da regra)", () => {
    // Um Rust com unwrap(risk) + LIMIT(bug): o bug tem de vir primeiro apesar de
    // a linha do unwrap aparecer antes no ficheiro.
    put("svc/order.rs", `fn q() {\n    let x = f().unwrap();\n    let s = "SELECT a FROM t LIMIT 1";\n}\n`);
    const fs = CRM.reviewFindings("svc/order.rs");
    expect(fs.map((f: any) => f.sev)).toEqual(["bug", "risk"]);
  });

  it("pontuação: 100 menos as penalidades dos achados (via DOM .score)", () => {
    // Rust múltiplo = bug(25)+bug(25)+risk(12) = 62 → score 38.
    put("svc/load.rs", RS_MULTI);
    const host = document.createElement("div");
    CRM.renderCreviewView({ path: "svc/load.rs" }, host);
    const score = host.querySelector(".score")!;
    expect(score.textContent).toBe("38/100");
    expect(score.className).toContain("bad"); // 38 < THRESH(85)
  });
});
