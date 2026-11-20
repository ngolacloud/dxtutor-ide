import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp, golden } from "./harness";

/* Rede de segurança (Fase 0 da extracção da feature Infra) para
 * `ui-app/src/features/infra.ts`, via o harness que carrega a cadeia real de
 * módulos. Dois motores alimentam o pane «Infra»: runtime de contentores /
 * dev-container / Kubernetes (migrado de v5.ts) e environments / drift /
 * observabilidade (migrado de v6.ts). Este ficheiro:
 *
 *  1) pina o markup de `renderInfraPane` (#pane-infra) em três estados —
 *     desligado (seed), ligado+deployado (runtime+dev-container+stack+cluster), e
 *     um ambiente não-local seleccionado (staging promovido);
 *  2) caracteriza o MOTOR a extrair para `features/infra/{domain,application}/`:
 *     runtime/K8s (projectContext/devcontainerJson/k8sInfra/appEnv/k8sDocs),
 *     secrets (localSecrets/initSecrets/secretCheck), drift (envDeps/envState/
 *     envHealth/driftReport/DSTY) e observabilidade (seeded/spark/obsInit).
 *
 * A partir daqui, diff de golden = regressão (corrige o código, nunca o snapshot
 * — ver skill ui-golden-check). As caracterizações fixam a saída EXACTA para que
 * a extracção do domínio/aplicação se prove byte-a-byte idêntica.
 *
 * Fixtures que o harness exclui (vivem em v5.ts/boot5 e v6.ts): o container
 * `#pane-infra` (criado em boot5) e o shim `RP.infra`→`renderInfraPane` (v6.ts).
 * São reproduzidos em `provideFixtures()`: o golden pina o render DADO este
 * ambiente, que é o que a app dá em runtime.
 *
 * Determinismo: o relógio é FIXADO (`setSystemTime`) antes de `bootApp` (padrão do
 * scm/debug.golden) — `obsInit`/`promote`/`K8S.at` usam `Date`/`Date.now`; timers
 * falsos neutralizam o polling de arranque. O estado window-backed (ENVS/ENVX/K8S/
 * STACK/DEVC/OBS) é reinicializado pela reavaliação de `infra.ts` em cada `bootApp`
 * (reassigna `window.X`); mesmo assim, cada teste fixa explicitamente o que muta. */

let w: any;

/** Reproduz as peças que v5.ts/boot5 e v6.ts dão em runtime e o harness exclui. */
function provideFixtures(): void {
  const side = document.querySelector(".side");
  if (side && !document.getElementById("pane-infra")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-infra"></div>');
  w.RP.infra = () => w.renderInfraPane();
}

/** Carimba o pane recém-renderizado e devolve o golden strippado. */
function paneGolden(): string { return golden(document.getElementById("pane-infra")!); }

/** Deploya o design corrente ao cluster local: escreve os manifestos gerados por
 *  `k8sInfra(SD)` em `deploy/k8s/`, parseia-os com `k8sDocs()` e constrói o `K8S`
 *  tal como `dxDeploy` + a decoração v6 fazem (com `ver`/`at` fixos). */
function deployLocal(ver?: string): void {
  w.FS[w.ROOT + "deploy/k8s/all.yaml"] = { content: w.k8sInfra(w.SD), orig: "" };
  const docs = w.k8sDocs();
  const deps = docs.filter((d: any) => d.k === "Deployment").map((d: any) => ({ n: d.n, rep: d.rep, ready: d.rep, img: d.img, port: d.port }));
  w.K8S = { docs, deps, ver: ver || w.GIT.refs.develop, at: Date.parse("2026-01-01T00:00:00Z") };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
  provideFixtures();
  // Defensivo (o window persiste no jsdom; a reavaliação de infra.ts reassigna mas
  // garantimos o ponto de partida de cada teste): ambiente local, sem observáveis.
  w.ENVX.cur = "local";
  Object.keys(w.OBS).forEach((k) => delete w.OBS[k]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — pane Infra (renderInfraPane)", () => {
  it("desligado: runtime/cluster off, sem dev container nem containers (seed)", () => {
    expect(w.ENVS.rtOn).toBe(false);
    expect(w.ENVS.k8sOn).toBe(false);
    expect(w.K8S).toBe(null);
    w.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-disconnected");
  });

  it("ligado: runtime + dev container + stack a correr + cluster deployado", () => {
    w.ENVS.rtOn = true;
    w.ENVS.k8sOn = true;
    w.ENVS.ssh = ["dev@edge-01"];
    w.DEVC = { name: "dxtutor-dev", image: "devcontainers/base:bookworm" };
    w.STACK = [
      { name: "orders-api", src: "build ./orders-api", url: "http://localhost:8080", state: "healthy" },
      { name: "orders-db", src: "postgres:16", url: "internal", state: "running" },
    ];
    deployLocal();
    w.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-connected-deployed");
  });

  it("staging seleccionado: chips de ambiente + deps promovidos (crash + ok)", () => {
    w.ENVX.cur = "staging";
    w.ENVX.st.staging = {
      ver: "d5f2b66",
      at: Date.parse("2026-01-01T00:00:00Z"),
      ingress: true,
      deps: [
        { n: "orders-api", rep: 1, ready: 1, status: "ok" },
        { n: "billing-worker", rep: 1, ready: 0, status: "crash", err: "DATABASE_URL is required" },
      ],
    };
    w.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-staging-selected");
  });
});

describe("caracterização do motor — runtime / dev-container / Kubernetes (a extrair p/ domain)", () => {
  it("projectContext: detecção de tecnologias a partir do FS do seed", () => {
    expect(w.projectContext()).toMatchSnapshot("projectContext");
  });

  it("devcontainerJson: devcontainer.json derivado do contexto do projecto", () => {
    expect(w.devcontainerJson()).toMatchSnapshot("devcontainerJson");
  });

  it("k8sInfra: manifestos (Deployment/Service/Secret/Ingress) a partir do design", () => {
    expect(w.k8sInfra(w.SD)).toMatchSnapshot("k8sInfra");
  });

  it("appEnv: variáveis de ambiente de uma app (orders-api) a partir das arestas", () => {
    const api = w.SD.nodes.find((n: any) => n.id === "api");
    expect(w.appEnv(api, w.SD)).toMatchSnapshot("appEnv-api");
  });

  it("k8sDocs: parse dos manifestos escritos em deploy/k8s", () => {
    deployLocal();
    expect(w.k8sDocs()).toMatchSnapshot("k8sDocs");
  });

  it("urlHosts: extracção do host de várias formas de URL (função pura)", () => {
    const cases = [
      "postgres://app:app@orders-db:5432/app",
      "redis://session-cache:6379",
      "http://orders-api",
      "order-events:9324",
      "8080",
      "",
    ];
    expect(cases.map((v) => [v, w.urlHosts(v)])).toMatchSnapshot("urlHosts");
  });
});

describe("caracterização do motor — secrets (promoção aprovada por humano)", () => {
  it("localSecrets: segredos do ambiente local a partir do design/compose", () => {
    expect(w.localSecrets()).toMatchSnapshot("localSecrets");
  });

  it("initSecrets: deriva staging (valores mascarados) e production (vazios)", () => {
    w.initSecrets();
    expect(w.ENVX.sec).toMatchSnapshot("initSecrets-sec");
  });

  it("secretCheck: chaves em falta/vazias por ambiente (staging vs production)", () => {
    w.initSecrets();
    expect({ staging: w.secretCheck("staging"), production: w.secretCheck("production") }).toMatchSnapshot("secretCheck");
  });
});

describe("caracterização do motor — drift (design vs realidade)", () => {
  it("DSTY: tabela de estilos/estados de drift (constante)", () => {
    expect(w.DSTY).toMatchSnapshot("DSTY");
  });

  it("envDeps/envState/envHealth: cluster local deployado na versão de develop", () => {
    deployLocal();
    expect({ deps: w.envDeps("local"), state: w.envState("local"), health: w.envHealth("local") }).toMatchSnapshot("env-local-deployed");
  });

  it("driftReport(local): sincronizado quando a versão bate certo com develop", () => {
    deployLocal(w.GIT.refs.develop);
    expect(w.driftReport("local")).toMatchSnapshot("drift-sync");
  });

  it("driftReport(local): «behind» quando a versão deployada é anterior a develop", () => {
    deployLocal("c0ffee0");
    expect(w.driftReport("local")).toMatchSnapshot("drift-behind");
  });

  it("driftReport(local): «drift» quando as réplicas a correr divergem do manifesto", () => {
    deployLocal(w.GIT.refs.develop);
    // o manifesto diz 1 réplica; simulamos 3 a correr num workload de serviço
    // (orders-db é um Deployment; as apps como orders-api só geram Secret).
    const d = w.K8S.deps.find((x: any) => x.n === "orders-db");
    expect(d).toBeTruthy();
    d.rep = 3; d.ready = 3;
    expect(w.driftReport("local")).toMatchSnapshot("drift-replicas");
  });

  it("envDeps: workload em crash quando um segredo aponta para um host inexistente", () => {
    deployLocal(w.GIT.refs.develop);
    w.ENVX.cur = "staging";
    w.initSecrets();
    // aponta o DATABASE_URL de staging para um host que não é um serviço do design
    const apiKey = Object.keys(w.ENVX.sec.staging).find((a) => w.ENVX.sec.staging[a].DATABASE_URL);
    if (apiKey) w.ENVX.sec.staging[apiKey].DATABASE_URL = "postgres://app:app@db.nowhere:5432/app";
    w.ENVX.st.staging = { ver: w.GIT.refs.develop, at: 0, ingress: true, deps: [] };
    expect(w.envDeps("staging")).toMatchSnapshot("envDeps-crash");
  });
});

describe("caracterização do motor — observabilidade (determinista por seed)", () => {
  it("seeded: PRNG determinista (mesma seed → mesma sequência)", () => {
    const r = w.seeded("orders-api");
    expect(Array.from({ length: 8 }, () => +r().toFixed(6))).toMatchSnapshot("seeded-seq");
  });

  it("spark: sparkline SVG a partir de uma série fixa (função pura)", () => {
    expect(w.spark([0, 1, 2, 3, 2, 1, 4, 3], "var(--green)")).toMatchSnapshot("spark");
  });

  it("obsInit: séries + logs seedados para um workload (local/orders-api)", () => {
    const o = w.obsInit("local", "orders-api");
    expect({
      n: o.n, env: o.env, crash: o.crash, kind: o.kind,
      cpu: o.cpu.map((x: number) => +x.toFixed(3)),
      logs: o.logs,
    }).toMatchSnapshot("obsInit");
  });
});
