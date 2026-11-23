// Regressão do falso positivo de verificação: no desktop com pasta real, run_tests /
// design_lint recebiam sempre {ok:true} porque o terminal real devolvia `undefined` e o
// doTool caía num "ok" por omissão. Agora o resultado vem do exit code real e, sem
// terminal nenhum, é uma falha explícita.
import { test, expect, vi } from "vitest";
import { makeDoTool } from "../src/features/codev/application/tool-executor";
import type { RealRun, ToolDeps } from "../src/features/codev/application/ports";

/** Presenter/fakes mínimos: tudo o que não interessa ao teste é um no-op. */
function deps(terminal: ToolDeps["terminal"]) {
  const results: Array<{ ok: boolean; sum: string }> = [];
  const noop = new Proxy({}, { get: () => () => undefined });
  const presenter = new Proxy(
    {},
    {
      get: (_t, k) =>
        k === "toolRunResult" ? (_ref: unknown, ok: boolean, sum: string) => results.push({ ok, sum }) : () => undefined,
    },
  );
  const d = {
    workspace: noop,
    providers: noop,
    notifier: noop,
    presenter,
    gate: { ask: vi.fn(async () => 1) },
    rules: { isSafe: () => true, isDestructive: () => false },
    clock: { now: () => 0, beat: async () => undefined },
    mode: () => "auto",
    terminal,
  } as unknown as ToolDeps;
  return { d, results };
}

test("pasta real: o resultado é o do comando, com exit code ≠ 0 a falhar", async () => {
  const run: RealRun = { ok: false, code: 101, sum: "✖ exit 101 · test result: FAILED. 1 failed", out: "exit 101\n…" };
  const real = vi.fn(async () => run);
  const exec = vi.fn(() => undefined);
  const { d, results } = deps({ exec, realRun: () => real });
  const r = await makeDoTool(d)({ t: "run", cmd: "cargo test" }, null);
  expect(real).toHaveBeenCalledWith("cargo test");
  expect(exec).not.toHaveBeenCalled();
  expect(r).toEqual(run);
  expect(results).toEqual([{ ok: false, sum: run.sum }]);
});

test("sem terminal real nem simulado: falha explícita, nunca um 'ok' por omissão", async () => {
  const { d, results } = deps({ exec: () => undefined, realRun: () => null });
  const r = (await makeDoTool(d)({ t: "run", cmd: "cargo test" }, null)) as { ok: boolean; sum: string };
  expect(r.ok).toBe(false);
  expect(r.sum).toMatch(/não executado/);
  expect(results[0].ok).toBe(false);
});

test("protótipo: o terminal simulado continua a mandar", async () => {
  const { d } = deps({ exec: () => ({ ok: true, sum: "2 passed" }) });
  expect(await makeDoTool(d)({ t: "run", cmd: "cargo test" }, null)).toEqual({ ok: true, sum: "2 passed" });
});
