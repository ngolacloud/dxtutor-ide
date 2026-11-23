// Domínio puro do Co-Dev: comandos de verificação do projecto (testes/lint).
import { test, expect } from "vitest";
import { detectCommands, summarizeRun } from "../src/features/codev/domain/project-commands";

test("Cargo: convenção do ecossistema, confiável", () => {
  const c = detectCommands({ "Cargo.toml": "[workspace]", "src/main.rs": "" });
  expect(c.test).toEqual({ cmd: "cargo test", from: "Cargo.toml", trusted: true });
  expect(c.lint?.cmd).toBe("cargo clippy --all-targets");
});

test("package.json ganha à convenção e usa o gestor do lockfile; não é auto-confiável", () => {
  const files = {
    "Cargo.toml": "",
    "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }),
    "pnpm-lock.yaml": "",
  };
  const c = detectCommands(files);
  expect(c.test).toEqual({ cmd: "pnpm test", from: "package.json", trusted: false });
  expect(c.lint?.cmd).toBe("pnpm run lint");
});

test("o placeholder do npm init não conta como testes", () => {
  const c = detectCommands({ "package.json": JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  expect(c.test).toBe(null);
});

test("typecheck serve de lint quando não há lint", () => {
  const c = detectCommands({ "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }) });
  expect(c.lint?.cmd).toBe("npm run typecheck");
});

test(".dxtutor/commands.json sobrepõe-se a tudo, por chave", () => {
  const c = detectCommands({ "Cargo.toml": "", ".dxtutor/commands.json": '{"test":"cargo nextest run"}' });
  expect(c.test).toEqual({ cmd: "cargo nextest run", from: "commands.json", trusted: false });
  expect(c.lint?.cmd).toBe("cargo clippy --all-targets");
});

test("override inválido é ignorado", () => {
  expect(detectCommands({ ".dxtutor/commands.json": "{nope" }).test).toBe(null);
});

test("Makefile com alvos test/lint (e não variáveis test:=)", () => {
  const c = detectCommands({ Makefile: "test:\n\tgo test ./...\nlint := x\n" });
  expect(c.test?.cmd).toBe("make test");
  expect(c.lint).toBe(null);
});

test("Go, Python (com e sem ruff), Maven, .NET; e projecto desconhecido", () => {
  expect(detectCommands({ "go.mod": "" }).test?.cmd).toBe("go test ./...");
  expect(detectCommands({ "pyproject.toml": "[tool.ruff]\n" }).lint?.cmd).toBe("ruff check .");
  expect(detectCommands({ "pyproject.toml": "" }).lint).toBe(null);
  expect(detectCommands({ "pom.xml": "" }).test?.cmd).toBe("mvn -q test");
  expect(detectCommands({ "App.sln": "" }).test?.cmd).toBe("dotnet test");
  expect(detectCommands({ "sub/App.csproj": "" }).test).toBe(null);
  expect(detectCommands({ "README.md": "" })).toEqual({ test: null, lint: null });
});

test("summarizeRun reporta o exit real e a linha relevante", () => {
  expect(summarizeRun(101, false, "running 3 tests\ntest result: FAILED. 2 passed; 1 failed", "")).toBe("✖ exit 101 · test result: FAILED. 2 passed; 1 failed");
  expect(summarizeRun(0, false, "", "")).toBe("✓ exit 0");
  expect(summarizeRun(null, true, "x", "")).toBe("excedeu o tempo limite");
});
