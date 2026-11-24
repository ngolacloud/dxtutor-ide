import { describe, expect, it, vi } from "vitest";
import { makeTesting } from "../src/features/testing/application/testing-service";
import { testKey } from "../src/features/testing/domain/results";
import type { TestsPort } from "../src/features/testing/application/ports";
import type { TestItem, TestRun } from "../src/features/testing/domain/types";

/* O serviço do pane Testing (ADR-0006, R2a) contra um IPC falso (a porta `TestsPort`). */

const A: TestItem = { name: "soma", path: "tests::soma", file: "src/lib.rs", line: 3, ignored: false, lang: "rust" };
const B: TestItem = { name: "falha", path: "tests::falha", file: "src/lib.rs", line: 9, ignored: false, lang: "rust" };

function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(port: Partial<TestsPort>, root: { v: string | null } = { v: "/p" }) {
  const tests: TestsPort = {
    list: vi.fn(async () => [A, B]),
    run: vi.fn(async (): Promise<TestRun> => ({ ran: true, passed: true, output: "ok" })),
    runAll: vi.fn(async (): Promise<TestRun> => ({ ran: true, passed: false, output: "test tests::soma ... ok\ntest tests::falha ... FAILED" })),
    ...port,
  };
  const svc = makeTesting({ tests, workspace: { root: () => root.v } });
  return { svc, tests, root };
}

describe("descoberta", () => {
  it("ensure descobre uma vez para a pasta aberta; sem pasta não chama o backend", async () => {
    const { svc, tests, root } = setup({});
    root.v = null;
    svc.ensure();
    expect(tests.list).not.toHaveBeenCalled();
    root.v = "/p";
    svc.ensure();
    await vi.waitFor(() => expect(svc.state().loaded).toBe(true));
    svc.ensure();
    expect(tests.list).toHaveBeenCalledTimes(1);
    expect(tests.list).toHaveBeenCalledWith("/p");
    expect(svc.state().items).toEqual([A, B]);
  });

  it("um erro de IPC fica no estado, não rebenta", async () => {
    const { svc } = setup({ list: vi.fn(async () => { throw new Error("IPC indisponível"); }) });
    await svc.refresh();
    expect(svc.state().error).toBe("IPC indisponível");
    expect(svc.state().loaded).toBe(true);
  });
});

describe("corridas", () => {
  it("runOne passa o caminho e a língua ao backend e guarda o veredicto e a saída", async () => {
    const { svc, tests } = setup({ run: vi.fn(async () => ({ ran: true, passed: false, output: "assertion failed" })) });
    await svc.refresh();
    await svc.runOne(testKey(B));
    expect(tests.run).toHaveBeenCalledWith("/p", "tests::falha", "rust");
    expect(svc.state().states[testKey(B)]).toEqual({ status: "failed", output: "assertion failed" });
    expect(svc.state().running).toBe(false);
  });

  it("enquanto corre, o teste está «running» e não se lança outra corrida", async () => {
    const d = deferred<TestRun>();
    const { svc, tests } = setup({ run: vi.fn(() => d.promise) });
    await svc.refresh();
    const p = svc.runOne(testKey(A));
    expect(svc.state().states[testKey(A)].status).toBe("running");
    await svc.runAll(); // ignorado: já há uma corrida
    expect(tests.runAll).not.toHaveBeenCalled();
    d.resolve({ ran: true, passed: true, output: "" });
    await p;
    expect(svc.state().states[testKey(A)].status).toBe("passed");
  });

  it("runAll lê o estado de cada teste na saída da suíte", async () => {
    const { svc } = setup({});
    await svc.refresh();
    await svc.runAll();
    expect(svc.state().states[testKey(A)].status).toBe("passed");
    expect(svc.state().states[testKey(B)].status).toBe("failed");
    expect(svc.state().suite?.passed).toBe(false);
  });

  it("trocar de pasta a meio descarta o resultado da pasta antiga", async () => {
    const d = deferred<TestRun>();
    const { svc, root } = setup({ runAll: vi.fn(() => d.promise) });
    await svc.refresh();
    const p = svc.runAll();
    root.v = "/outra";
    svc.ensure(); // a vista redesenha com a pasta nova
    d.resolve({ ran: true, passed: true, output: "test tests::soma ... ok" });
    await p;
    expect(svc.state().root).toBe("/outra");
    expect(svc.state().suite).toBe(null);
    expect(svc.state().states).toEqual({});
  });

  it("notifica quem subscreve em cada mudança", async () => {
    const { svc } = setup({});
    const f = vi.fn();
    svc.subscribe(f);
    await svc.refresh();
    expect(f).toHaveBeenCalled();
  });
});
