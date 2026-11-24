import { describe, expect, it } from "vitest";
import { projectContext, devcontainerJson, appEnv, k8sInfra, k8sDocs } from "../src/features/infra/domain/kubernetes";
import { urlHosts, designApps, localSecrets, deriveSecrets, secretCheck } from "../src/features/infra/domain/secrets";
import { envDeps, envStateOf, envHealthOf, driftReport, commitsBetween, parseClusterState, envManifest, deploymentsIn, ANN_VER, ANN_AT } from "../src/features/infra/domain/environments";
import { spark, toMiB, parseDockerStats, parseKubectlTop, parseLogLines, obsTarget, pushSample, emptyObs, OBS_POINTS } from "../src/features/infra/domain/observability";
import { RTN, KCTX, ENVL, DSTY, defaultEnvs, defaultEnvx } from "../src/features/infra/domain/constants";
import type { Catalog, Design, DesignNode, Files, K8sState } from "../src/features/infra/domain/types";

/* Testes unitários do domínio PURO da feature Infra (ADR-0002, Fase 2). Exercitam
 * cada gerador/selector com uma fixture sintética de design + catálogo (sem DOM,
 * sem window) — complementam o golden de caracterização (infra.golden.test.ts), que
 * pina os mesmos contra o catálogo REAL do seed na cadeia integrada. */

/* ───── fixture sintética: gateway → {web, api}; api → db(sql); cache ───── */
const D: Design = {
  nodes: [
    { id: "gw", tech: "alb", n: "Gateway", x: 0, y: 0, st: "plan" },
    { id: "web", tech: "react", n: "Web", x: 0, y: 0, st: "plan" },
    { id: "api", tech: "axum", n: "Orders API", x: 0, y: 0, st: "plan" },
    { id: "db", tech: "pg", n: "Orders DB", x: 0, y: 0, st: "plan" },
    { id: "cache", tech: "redis", n: "Cache", x: 0, y: 0, st: "plan" },
  ],
  edges: [["gw", "web"], ["gw", "api"], ["api", "db"], ["api", "cache"]],
};
const slug = (n: DesignNode): string => n.n.toLowerCase().replace(/ /g, "-");
const cat: Catalog = {
  tech: {
    alb: { kind: "gateway", port: 80, img: "alb:1" },
    react: { kind: "web", port: 8080, img: "web:1" },
    axum: { kind: "app", port: 8080, img: "api:1" },
    pg: { kind: "sql", port: 5432, img: "postgres:16" },
    redis: { kind: "cache", port: 6379, img: "redis:7" },
  },
  kind: {
    gateway: {},
    web: {},
    app: {},
    sql: { wire: (s) => [`DATABASE_URL: "postgres://app:app@${s}:5432/app"`], hc: true },
    cache: { wire: (s) => [`REDIS_URL: "redis://${s}:6379"`] },
  },
  isApp: (n) => ["app", "web"].includes(cat.tech[n.tech].kind),
  slug,
};
const node = (id: string): DesignNode => D.nodes.find((n) => n.id === id)!;

describe("projectContext", () => {
  it("detecta tecnologias pelos caminhos do FS", () => {
    const files: Files = { "p/Cargo.toml": { content: "" }, "p/app.ts": { content: "" }, "p/db/migrations/1.sql": { content: "" }, "p/.dxtutor/regras.md": { content: "" } };
    expect(projectContext(files)).toEqual([["rust", "Rust"], ["node", "TypeScript / Node"], ["sql", "SQL migrations"], ["rules", "Project rules"]]);
  });
  it("FS vazio → sem tecnologias", () => {
    expect(projectContext({})).toEqual([]);
  });
});

describe("devcontainerJson", () => {
  it("features + mounts + ports + postCreate derivados do contexto", () => {
    expect(devcontainerJson(["rust", "node"], [8080, 5432], "/run/x.sock")).toMatchSnapshot();
  });
  it("sem portas → forwardPorts 1420; sem rust/node → postCreate 'true'", () => {
    const j = JSON.parse(devcontainerJson(["go"], [], "/s"));
    expect(j.forwardPorts).toEqual([1420]);
    expect(j.postCreateCommand).toBe("true");
    expect(Object.keys(j.features)).toContain("ghcr.io/devcontainers/features/go:1");
  });
});

describe("appEnv", () => {
  it("PORT + wiring das arestas (sql/cache), dedup", () => {
    expect(appEnv(node("api"), D, cat)).toEqual([
      'PORT: "8080"',
      'DATABASE_URL: "postgres://app:app@orders-db:5432/app"',
      "REDIS_URL: \"redis://cache:6379\"",
    ]);
  });
  it("app sem dependências não-gateway → só PORT", () => {
    expect(appEnv(node("web"), D, cat)).toEqual(['PORT: "8080"']);
  });
});

describe("k8sInfra / k8sDocs", () => {
  it("manifestos do design (Deployment/Service para serviços, Secret p/ apps, Ingress)", () => {
    expect(k8sInfra(D, cat)).toMatchSnapshot();
  });
  it("k8sDocs parseia o que k8sInfra gerou", () => {
    const files: Files = { "p/deploy/k8s/all.yaml": { content: k8sInfra(D, cat) } };
    const docs = k8sDocs(files);
    expect(docs.filter((d) => d.k === "Deployment").map((d) => d.n).sort()).toEqual(["cache", "orders-db"]);
    expect(docs.some((d) => d.k === "Ingress")).toBe(true);
    expect(docs.some((d) => d.k === "Secret")).toBe(true);
  });
});

describe("urlHosts", () => {
  it("extrai o host de várias formas", () => {
    expect(urlHosts("postgres://app:app@orders-db:5432/app")).toBe("orders-db");
    expect(urlHosts("redis://cache:6379")).toBe("cache");
    expect(urlHosts("http://orders-api")).toBe("orders-api");
    expect(urlHosts("host:9324")).toBe("host");
    expect(urlHosts("8080")).toBe(null);
    expect(urlHosts("")).toBe(null);
  });
});

describe("secrets (designApps / localSecrets / deriveSecrets / secretCheck)", () => {
  it("designApps = web + app", () => {
    expect(designApps(D, cat.isApp).map(slug)).toEqual(["web", "orders-api"]);
  });
  it("localSecrets por app a partir das arestas", () => {
    expect(localSecrets(D, cat)).toEqual({
      web: { PORT: "8080" },
      "orders-api": { PORT: "8080", DATABASE_URL: "postgres://app:app@orders-db:5432/app", REDIS_URL: "redis://cache:6379" },
    });
  });
  it("deriveSecrets: staging e production com as chaves do design por preencher (excepto PORT) — nada torcido (ADR-0006, R5c1)", () => {
    const L = localSecrets(D, cat), sec = deriveSecrets(L);
    for (const e of ["staging", "production"] as const) {
      expect(sec[e]["orders-api"]).toEqual({ PORT: "8080", DATABASE_URL: "", REDIS_URL: "" });
      expect(Object.keys(sec[e])).toEqual(Object.keys(L));
    }
    expect(sec.staging).not.toBe(sec.production);
  });
  it("secretCheck: chaves em falta e vazias", () => {
    const L = localSecrets(D, cat);
    const S = { web: { PORT: "8080" }, "orders-api": { PORT: "", DATABASE_URL: "x" } };
    expect(secretCheck(L, S)).toEqual({ miss: ["orders-api.REDIS_URL"], empty: ["orders-api.PORT"] });
  });
});

describe("environments (envDeps / envStateOf / envHealthOf / driftReport) — o estado vem do cluster", () => {
  const k8s: K8sState = {
    docs: [
      { k: "Deployment", n: "orders-db", file: "f", rep: 1, img: "postgres:16" },
      { k: "Deployment", n: "cache", file: "f", rep: 1, img: "redis:7" },
      { k: "Ingress", n: "gateway", file: "f", rep: 1 },
    ],
    deps: [{ n: "orders-db", rep: 1, ready: 1 }, { n: "cache", rep: 1, ready: 1 }],
    ver: "dev1", at: 0,
  };
  it("envDeps: os workloads do cluster, ok enquanto nenhum contentor está preso", () => {
    const deps = envDeps(k8s);
    expect(deps.every((d) => d.status === "ok")).toBe(true);
    expect(deps.map((d) => [d.n, d.restarts])).toEqual([["orders-db", 0], ["cache", 0]]);
    expect(envDeps(null)).toEqual([]);
  });
  it("envDeps: um contentor preso (lido do cluster) é um crash, com o motivo e os reinícios reais", () => {
    const deps = envDeps({ ...k8s, deps: [{ n: "cache", rep: 1, ready: 0, restarts: 3, err: "CrashLoopBackOff" }] });
    expect(deps[0]).toMatchObject({ n: "cache", status: "crash", err: "CrashLoopBackOff", restarts: 3 });
  });
  it("envStateOf local lê o cluster; os outros, a última leitura; envHealthOf reflecte o crash", () => {
    const s = envStateOf("local", k8s, {});
    expect(s!.ver).toBe("dev1");
    expect(s!.ingress).toBe(true); // sem leitura do Ingress, decide-se pelos manifestos
    expect(envStateOf("local", { ...k8s, ingress: false }, {})!.ingress).toBe(false);
    expect(envStateOf("staging", k8s, {})).toBe(null);
    expect(envHealthOf(s)).toBe("ok");
    expect(envHealthOf(null)).toBe("off");
    expect(envHealthOf({ deps: [{ n: "x", rep: 1, ready: 0, status: "crash", err: "e", restarts: 2 }], ingress: true })).toBe("bad");
  });
  it("driftReport: sync/behind/drift/missing conforme versão e réplicas", () => {
    const s = envStateOf("local", k8s, {});
    const sync = driftReport(s, k8s.docs, D, cat, "dev1");
    expect(sync.out.db.st).toBe("sync");
    expect(sync.out.gw.st).toBe("sync"); // ingress presente
    expect(sync.out.api.st).toBe("missing"); // app → só Secret, sem Deployment
    const behind = driftReport(s, k8s.docs, D, cat, "dev2");
    expect(behind.out.db.st).toBe("behind");
    const s2 = envStateOf("local", { ...k8s, deps: [{ n: "orders-db", rep: 3, ready: 3 }, { n: "cache", rep: 1, ready: 1 }] }, {});
    expect(driftReport(s2, k8s.docs, D, cat, "dev1").out.db.st).toBe("drift");
    expect(driftReport(null, k8s.docs, D, cat, "dev1").out.db.st).toBe("off");
  });
});

describe("parseClusterState — o JSON de kubectl get deploy/pods/ingress", () => {
  const deploy = JSON.stringify({ items: [
    { metadata: { name: "api", annotations: { [ANN_VER]: "abc1234", [ANN_AT]: "1700000000000" } }, spec: { replicas: 2, template: { spec: { containers: [{ image: "reg/api:1", ports: [{ containerPort: 8080 }] }] } } }, status: { readyReplicas: 1 } },
    { metadata: { name: "db" }, spec: { replicas: 1, template: { spec: { containers: [{ image: "postgres:16" }] } } }, status: {} },
  ] });
  const pods = JSON.stringify({ items: [
    { metadata: { ownerReferences: [{ kind: "ReplicaSet", name: "api-7d9f8" }] }, status: { containerStatuses: [{ restartCount: 0, state: { running: {} } }] } },
    { metadata: { ownerReferences: [{ kind: "ReplicaSet", name: "api-7d9f8" }] }, status: { containerStatuses: [{ restartCount: 4, state: { waiting: { reason: "CrashLoopBackOff", message: "back-off 40s restarting" } }, lastState: { terminated: { reason: "Error", exitCode: 1 } } }] } },
    { metadata: { ownerReferences: [{ kind: "ReplicaSet", name: "db-55c" }] }, status: { containerStatuses: [{ restartCount: 0, state: { waiting: { reason: "ContainerCreating" } } }] } },
  ] });
  it("réplicas, prontos, imagem, porta, reinícios e o motivo do contentor preso; versão e hora das anotações", () => {
    const st = parseClusterState(deploy, pods, JSON.stringify({ items: [{}] }));
    expect(st.ver).toBe("abc1234");
    expect(st.at).toBe(1700000000000);
    expect(st.ingress).toBe(true);
    expect(st.deps[0]).toEqual({ n: "api", rep: 2, ready: 1, img: "reg/api:1", port: "8080", restarts: 4, err: "CrashLoopBackOff (último fim: Error 1): back-off 40s restarting" });
    expect(st.deps[1]).toMatchObject({ n: "db", rep: 1, ready: 0, restarts: 0, err: null }); // a criar não é falha
  });
  it("o rótulo do último fim vem na língua da interface (parâmetro do adaptador desktop)", () => {
    const st = parseClusterState(deploy, pods, "", "last exit");
    expect(st.deps[0].err).toBe("CrashLoopBackOff (last exit: Error 1): back-off 40s restarting");
  });
  it("respostas vazias ou inválidas não rebentam", () => {
    expect(parseClusterState("", "", "")).toEqual({ deps: [], ver: undefined, at: undefined, ingress: false });
    expect(parseClusterState("{not json", "x").deps).toEqual([]);
  });
});

describe("envManifest / deploymentsIn — o que se aplica num ambiente", () => {
  const files = {
    "p/deploy/k8s/all.yaml": { content: "# cabeçalho\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: cache\nspec:\n  replicas: 1\n---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: orders-api-env\nstringData:\n  PORT: \"8080\"\n  DATABASE_URL: \"postgres://app:app@orders-db:5432/app\"\n", orig: null },
    "p/src/x.yaml": { content: "kind: Secret\nmetadata:\n  name: fora-env\n", orig: null },
  };
  it("os Secrets `<app>-env` levam os segredos do ambiente; o resto passa tal e qual; só deploy/k8s", () => {
    const m = envManifest(files, { "orders-api": { PORT: "8080", DATABASE_URL: "postgres://u:p@db.staging:5432/app" } });
    expect(m).toContain("kind: Deployment");
    expect(m).toContain('DATABASE_URL: "postgres://u:p@db.staging:5432/app"');
    expect(m).not.toContain("app:app@");
    expect(m).not.toContain("fora-env");
    expect(deploymentsIn(m)).toEqual(["cache"]);
  });
  it("um Secret sem segredos do ambiente fica como está", () => {
    expect(envManifest(files, {})).toContain("app:app@orders-db");
  });
});

describe("commitsBetween", () => {
  const commits = { c3: { h: "c3", m: "três", p: ["c2"] }, c2: { h: "c2", m: "dois", p: ["c1"] }, c1: { h: "c1", m: "um", p: [] } };
  it("BFS de to até from (exclusivo)", () => {
    expect(commitsBetween("c1", "c3", commits).map((c) => c.h)).toEqual(["c3", "c2"]);
    expect(commitsBetween(null, "c3", commits).map((c) => c.h)).toEqual(["c3", "c2", "c1"]);
  });
});

describe("observability — as métricas e os logs reais (ADR-0006, R5c2)", () => {
  it("spark produz um SVG com a série", () => {
    expect(spark([1, 2, 3], "var(--green)")).toContain("<svg");
    expect(spark([1, 2, 3], "var(--green)")).toContain("stroke=\"var(--green)\"");
  });
  it("toMiB: as unidades do docker (SI e binárias) e do kubectl", () => {
    expect(toMiB("24.68MiB")).toBeCloseTo(24.68);
    expect(toMiB("1GiB")).toBe(1024);
    expect(toMiB("45Mi")).toBe(45);
    expect(toMiB("2Gi")).toBe(2048);
    expect(toMiB("512Ki")).toBe(0.5);
    expect(toMiB("1.5GB")).toBeCloseTo(1430.5, 0);
    expect(toMiB("x")).toBeUndefined();
  });
  it("parseDockerStats: a linha do docker e o array do podman", () => {
    expect(parseDockerStats('{"CPUPerc":"12.50%","MemUsage":"24.68MiB / 30.92GiB","Name":"db"}')).toEqual({ cpu: 12.5, mem: expect.closeTo(24.68) });
    expect(parseDockerStats('[{"cpu_percent":"0.05%","mem_usage":"10MiB / 1GiB"}]')).toEqual({ cpu: 0.05, mem: 10 });
    expect(parseDockerStats("")).toEqual({ error: "sem amostra" });
    expect(parseDockerStats("{oops").error).toMatch(/inesperada/);
  });
  it("parseKubectlTop: soma os pods, CPU em % de um núcleo", () => {
    expect(parseKubectlTop("api-1   250m   120Mi\napi-2   1   1Gi\n")).toEqual({ cpu: 125, mem: 1144 });
    expect(parseKubectlTop("").error).toMatch(/nenhum pod/);
    // a língua da interface entra por parâmetro (o adaptador desktop passa os textos traduzidos)
    const en = { noSample: "no sample", badStats: "unexpected response from stats", noCpuMem: "stats returned neither CPU nor memory", noPods: "no pod with metrics" };
    expect(parseDockerStats("", en)).toEqual({ error: "no sample" });
    expect(parseDockerStats("{oops", en).error).toBe("unexpected response from stats");
    expect(parseDockerStats('{"Name":"db"}', en).error).toBe("stats returned neither CPU nor memory");
    expect(parseKubectlTop("", en).error).toBe("no pod with metrics");
  });
  it("parseLogLines: carimbo, nível dito pela linha, prefixo do compose; o «Clear» esconde as anteriores", () => {
    const out = "db-1  | 2026-11-24T10:00:00.123456789Z LOG:  database system is ready\n2026-11-24T10:00:01.000Z level=error msg=boom\nlinha sem carimbo WARNING x\n\n";
    const l = parseLogLines(out);
    expect(l.map((x) => [x.ts, x.lv, x.m])).toEqual([
      ["10:00:00.123", "LOG", "LOG:  database system is ready"],
      ["10:00:01.000", "ERROR", "level=error msg=boom"],
      ["", "WARN", "linha sem carimbo WARNING x"],
    ]);
    expect(parseLogLines(out, "2026-11-24T10:00:00.5Z").map((x) => x.lv)).toEqual(["ERROR", "WARN"]);
  });
  it("obsTarget: no local, o compose ganha ao cluster; staging/production usam o contexto do ambiente", () => {
    const envs = { ctx: "kind-dx", ns: "dx", k8sOn: true }, envx = { ctx: { staging: "stg", production: "" }, ns: { staging: "dx-stg", production: "dx" } };
    expect(obsTarget("local", "db", ["db"], envs, envx)).toEqual({ via: "compose", env: "local", n: "db" });
    expect(obsTarget("local", "api", ["db"], envs, envx)).toEqual({ via: "kubectl", env: "local", n: "api", ctx: "kind-dx", ns: "dx" });
    expect(obsTarget("local", "api", [], { ...envs, k8sOn: false }, envx)).toBe(null);
    expect(obsTarget("staging", "api", [], envs, envx)).toEqual({ via: "kubectl", env: "staging", n: "api", ctx: "stg", ns: "dx-stg" });
    expect(obsTarget("production", "api", [], envs, envx)).toBe(null);
  });
  it("pushSample: janela de OBS_POINTS; um erro fica em sampleErr e não mexe nas séries", () => {
    const o = emptyObs("local", "db");
    for (let i = 0; i < OBS_POINTS + 5; i++) pushSample(o, { cpu: i, mem: 1 });
    expect(o.cpu.length).toBe(OBS_POINTS);
    expect(o.cpu[0]).toBe(5);
    pushSample(o, { error: "metrics-server em falta" });
    expect(o.sampleErr).toBe("metrics-server em falta");
    expect(o.cpu.length).toBe(OBS_POINTS);
  });
});

describe("constantes", () => {
  it("RTN/KCTX/ENVL/DSTY + fábricas do estado inicial", () => {
    expect(Object.keys(RTN)).toEqual(["docker", "podman", "delonix"]);
    expect(KCTX).toEqual([]); // os contextos vêm do kubeconfig real ao ligar o cluster (ADR-0006, R5c1)
    expect(defaultEnvx().ctx).toEqual({ staging: "", production: "" });
    expect(ENVL.production).toBe("Production");
    expect(DSTY.sync).toEqual(["var(--green)", "in sync"]);
    expect(defaultEnvs().rtOn).toBe(false);
    expect(defaultEnvx().cur).toBe("local");
  });
});
