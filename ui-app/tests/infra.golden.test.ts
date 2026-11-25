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
 *     envHealth/driftReport/DSTY) e observabilidade (spark — as séries e os logs são reais
 *     desde a R5c2 do ADR-0006: infra.r5c2.test.ts).
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
 * scm/debug.golden) — `promote`/`K8S.at` usam `Date`/`Date.now`; timers
 * falsos neutralizam o polling de arranque. O estado window-backed (ENVS/ENVX/K8S/
 * STACK/DEVC/OBS) é reinicializado pela reavaliação de `infra.ts` em cada `bootApp`
 * (reassigna `window.X`); mesmo assim, cada teste fixa explicitamente o que muta. */

let w: any;
let INF: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da infra da cadeia do bootApp (U7p2)
/* initSecrets/driftReport/DSTY já não são publicadas em window (ADR-0002 passo 6):
   o resíduo expõe-nas só pela porta tipada (como v6 as consome). Como `bootApp`
   faz `vi.resetModules()`, um import estático ficaria obsoleto — por isso lemos o
   módulo FRESCO (a mesma instância que a cadeia reavaliou) depois de cada bootApp. */
let infra: any;

/** Reproduz as peças que v5.ts/boot5 e v6.ts dão em runtime e o harness exclui. */
function provideFixtures(): void {
  const side = document.querySelector(".side");
  if (side && !document.getElementById("pane-infra")) side.insertAdjacentHTML("beforeend", '<div class="pane" id="pane-infra"></div>');
  w.RP.infra = () => INF.renderInfraPane();
}

/** Carimba o pane recém-renderizado e devolve o golden strippado. */
function paneGolden(): string { return golden(document.getElementById("pane-infra")!); }

/** Deploya o design corrente ao cluster local: escreve os manifestos gerados por
 *  `k8sInfra(SD)` em `deploy/k8s/`, parseia-os com `k8sDocs()` e constrói o `K8S`
 *  tal como `dxDeploy` + a decoração v6 fazem (com `ver`/`at` fixos). */
function deployLocal(ver?: string): void {
  w.FS[w.ROOT + "deploy/k8s/all.yaml"] = { content: INF.k8sInfra(w.SD), orig: "" };
  const docs = INF.k8sDocs();
  const deps = docs.filter((d: any) => d.k === "Deployment").map((d: any) => ({ n: d.n, rep: d.rep, ready: d.rep, img: d.img, port: d.port }));
  INF.setK8s({ docs, deps, ver: ver || w.GIT.refs.develop, at: Date.parse("2026-01-01T00:00:00Z") });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  w = await bootApp();
  INF = await import("../src/features/infra");
  infra = await import("../src/features/infra");
  provideFixtures();
  // Defensivo (o window persiste no jsdom; a reavaliação de infra.ts reassigna mas
  // garantimos o ponto de partida de cada teste): ambiente local, sem observáveis.
  INF.ENVX.cur = "local";
  Object.keys(INF.OBS).forEach((k) => delete INF.OBS[k]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("golden de DOM — pane Infra (renderInfraPane)", () => {
  it("desligado: runtime/cluster off, sem dev container nem containers (seed)", () => {
    expect(w.ENVS.rtOn).toBe(false);
    expect(w.ENVS.k8sOn).toBe(false);
    expect(INF.k8s()).toBe(null);
    INF.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-disconnected");
  });

  it("ligado: runtime + dev container + stack a correr + cluster deployado", () => {
    w.ENVS.rtOn = true;
    w.ENVS.k8sOn = true;
    w.ENVS.ssh = ["dev@edge-01"];
    INF.setDevc({ name: "dxtutor-dev", image: "devcontainers/base:bookworm" });
    w.STACK = [
      { name: "orders-api", src: "build ./orders-api", url: "http://localhost:8080", state: "healthy" },
      { name: "orders-db", src: "postgres:16", url: "internal", state: "running" },
    ];
    deployLocal();
    INF.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-connected-deployed");
  });

  /* ADR-0006, R5c1: o estado de staging é a última leitura do cluster (o motivo do crash é o que o
     kubectl reporta — antes era um erro fabricado a partir dos segredos) */
  it("staging seleccionado: chips de ambiente + deps lidos do cluster (crash + ok)", () => {
    INF.ENVX.cur = "staging";
    INF.ENVX.st.staging = {
      ver: "d5f2b66",
      at: Date.parse("2026-01-01T00:00:00Z"),
      ingress: true,
      deps: [
        { n: "orders-api", rep: 1, ready: 1, status: "ok", err: null, restarts: 0 },
        { n: "billing-worker", rep: 1, ready: 0, status: "crash", err: "CrashLoopBackOff (último fim: Error 1)", restarts: 4 },
      ],
    };
    INF.renderInfraPane();
    expect(paneGolden()).toMatchSnapshot("pane-staging-selected");
  });
});

describe("caracterização do motor — runtime / dev-container / Kubernetes (a extrair p/ domain)", () => {
  it("projectContext: detecção de tecnologias a partir do FS do seed", () => {
    expect(INF.projectContext()).toMatchSnapshot("projectContext");
  });

  it("devcontainerJson: devcontainer.json derivado do contexto do projecto", () => {
    expect(INF.devcontainerJson()).toMatchSnapshot("devcontainerJson");
  });

  it("k8sInfra: manifestos (Deployment/Service/Secret/Ingress) a partir do design", () => {
    expect(INF.k8sInfra(w.SD)).toMatchSnapshot("k8sInfra");
  });

  it("appEnv: variáveis de ambiente de uma app (orders-api) a partir das arestas", () => {
    const api = w.SD.nodes.find((n: any) => n.id === "api");
    expect(INF.appEnv(api, w.SD)).toMatchSnapshot("appEnv-api");
  });

  it("k8sDocs: parse dos manifestos escritos em deploy/k8s", () => {
    deployLocal();
    expect(INF.k8sDocs()).toMatchSnapshot("k8sDocs");
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
    expect(cases.map((v) => [v, INF.urlHosts(v)])).toMatchSnapshot("urlHosts");
  });
});

describe("caracterização do motor — secrets (promoção aprovada por humano)", () => {
  it("localSecrets: segredos do ambiente local a partir do design/compose", () => {
    expect(INF.localSecrets()).toMatchSnapshot("localSecrets");
  });

  /* ADR-0006, R5c1: staging já não recebe valores «torcidos» — as chaves do design, por preencher */
  it("initSecrets: staging e production com as chaves do design por preencher (excepto PORT)", () => {
    infra.initSecrets();
    expect(INF.ENVX.sec).toMatchSnapshot("initSecrets-sec");
  });

  it("secretCheck: chaves em falta/vazias por ambiente (staging vs production)", () => {
    infra.initSecrets();
    expect({ staging: INF.secretCheck("staging"), production: INF.secretCheck("production") }).toMatchSnapshot("secretCheck");
  });
});

describe("caracterização do motor — drift (design vs realidade)", () => {
  it("DSTY: tabela de estilos/estados de drift (constante)", () => {
    expect(infra.DSTY).toMatchSnapshot("DSTY");
  });

  it("envDeps/envState/envHealth: cluster local deployado na versão de develop", () => {
    deployLocal();
    expect({ deps: INF.envDeps("local"), state: INF.envState("local"), health: INF.envHealth("local") }).toMatchSnapshot("env-local-deployed");
  });

  it("driftReport(local): sincronizado quando a versão bate certo com develop", () => {
    deployLocal(w.GIT.refs.develop);
    expect(infra.driftReport("local")).toMatchSnapshot("drift-sync");
  });

  it("driftReport(local): «behind» quando a versão deployada é anterior a develop", () => {
    deployLocal("c0ffee0");
    expect(infra.driftReport("local")).toMatchSnapshot("drift-behind");
  });

  it("driftReport(local): «drift» quando as réplicas a correr divergem do manifesto", () => {
    deployLocal(w.GIT.refs.develop);
    // o manifesto diz 1 réplica; simulamos 3 a correr num workload de serviço
    // (orders-db é um Deployment; as apps como orders-api só geram Secret).
    const d = INF.k8s().deps.find((x: any) => x.n === "orders-db");
    expect(d).toBeTruthy();
    d.rep = 3; d.ready = 3;
    expect(infra.driftReport("local")).toMatchSnapshot("drift-replicas");
  });

  /* ADR-0006, R5c1: o crash já não se fabrica a partir dos segredos — os workloads de staging são
     os da última leitura do seu namespace no cluster */
  it("envDeps(staging): os workloads da última leitura do cluster, sem inventar crashes", () => {
    deployLocal(w.GIT.refs.develop);
    infra.initSecrets();
    expect(INF.envDeps("staging")).toEqual([]); // nunca lido: nada
    const deps = [{ n: "orders-db", rep: 1, ready: 0, status: "crash", err: "ImagePullBackOff", restarts: 0 }];
    INF.ENVX.st.staging = { ver: w.GIT.refs.develop, at: 0, ingress: true, deps };
    expect(INF.envDeps("staging")).toEqual(deps);
  });
});

describe("caracterização do motor — observabilidade (o sparkline; as séries são reais desde a R5c2)", () => {
  it("spark: sparkline SVG a partir de uma série fixa (função pura)", () => {
    expect(INF.spark([0, 1, 2, 3, 2, 1, 4, 3], "var(--green)")).toMatchSnapshot("spark");
  });
});

describe("dispatch delegado (data-action) — Fase 4", () => {
  // O golden strippa onclick E data-action/data-on, logo NÃO prova que o listener
  // delegado dispara. Estes testes disparam eventos reais e observam o efeito (como os 6
  // de dispatch da visualizer): fecham a lacuna do golden. Escolhidos para evitar o
  // terminal/diálogo (só mutações de estado observáveis).
  const click = (el: Element) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const change = (el: Element) => el.dispatchEvent(new window.Event("change", { bubbles: true }));
  const q = (sel: string) => document.querySelector("#pane-infra " + sel)!;

  /* ADR-0006, R5a: no browser não há runtime a que ligar — o clique diz que precisa da app desktop
     (era um interruptor «simulated»); uma ligação presa de uma sessão antiga desliga-se */
  it("rt-connect: no browser não finge a ligação; uma ligação presa desliga-se", () => {
    const toast = vi.spyOn(w, "toast");
    INF.renderInfraPane();
    expect(w.ENVS.rtOn).toBe(false);
    click(q('[data-action="rt-connect"]'));
    expect(w.ENVS.rtOn).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/precisa da app desktop/));
    w.ENVS.rtOn = true;
    INF.renderInfraPane();
    click(q('[data-action="rt-connect"]'));
    expect(w.ENVS.rtOn).toBe(false);
  });

  it("rt-set: clicar «Podman» troca o runtime e desliga a ligação", () => {
    w.ENVS.rtOn = true;
    INF.renderInfraPane();
    click(q('[data-action="rt-set"][data-on="podman"]'));
    expect(w.ENVS.rt).toBe("podman");
    expect(w.ENVS.rtOn).toBe(false);
  });

  it("rt-sock: o onchange do input (evento change) actualiza o socket", () => {
    INF.renderInfraPane();
    const inp = q('input[data-action="rt-sock"]') as HTMLInputElement;
    inp.value = "/custom/docker.sock";
    change(inp);
    expect(w.ENVS.sock[w.ENVS.rt]).toBe("/custom/docker.sock");
  });

  it("kube-ns: o onchange do namespace (evento change) actualiza ENVS.ns", () => {
    INF.renderInfraPane();
    const inp = q('input[data-action="kube-ns"]') as HTMLInputElement;
    inp.value = "prod-ns";
    change(inp);
    expect(w.ENVS.ns).toBe("prod-ns");
  });

  it("env-chip: clicar o chip «Staging» selecciona o ambiente", () => {
    INF.renderInfraPane();
    click(q('[data-action="env-chip"][data-on="staging"]'));
    expect(INF.ENVX.cur).toBe("staging");
  });

  it("ssh-add: o onchange do input acrescenta um remote host", () => {
    INF.renderInfraPane();
    const inp = q('input[data-action="ssh-add"]') as HTMLInputElement;
    inp.value = "dev@edge-02";
    change(inp);
    expect(w.ENVS.ssh).toContain("dev@edge-02");
  });
});
