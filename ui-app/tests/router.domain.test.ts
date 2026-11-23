import { test, expect } from "vitest";
import { rankProviders, topCapabilities, CAP, TASKP } from "../src/features/router/domain/model-routing";

const ALL = Object.keys(CAP);

test("arquitectura favorece o Claude (raciocínio + contexto)", () => {
  const r = rankProviders("arch", ALL);
  expect(r[0].p).toBe("claude");
  // 10*5 + 9*3 + 9*1
  expect(r[0].s).toBe(86);
});

test("implementação favorece o Codex; dados sensíveis o Ollama local", () => {
  expect(rankProviders("code", ALL)[0].p).toBe("codex");
  expect(rankProviders("sens", ALL)[0].p).toBe("ollama");
});

test("só ordena os provedores pedidos e conhecidos", () => {
  const r = rankProviders("arch", ["ollama", "desconhecido", "gemini"]);
  expect(r.map((x) => x.p)).toEqual(["gemini", "ollama"]);
  expect(rankProviders("arch", [])).toEqual([]);
  expect(rankProviders("tarefa-que-nao-existe", ALL)).toEqual([]);
});

test("ordem descendente por pontuação em todas as tarefas", () => {
  for (const task of Object.keys(TASKP)) {
    const s = rankProviders(task, ALL).map((x) => x.s);
    expect([...s].sort((a, b) => b - a)).toEqual(s);
  }
});

test("topCapabilities descreve o que pesa mais", () => {
  expect(topCapabilities("arch")).toBe("raciocínio e contexto");
  expect(topCapabilities("sens", 1)).toBe("privacidade");
  expect(topCapabilities("nada")).toBe("");
});
