// U4e (ADR-0004): o terminal emulado de base em features/terminal.ts.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
const term = () => document.querySelector("#term")!.textContent || "";
const enter = (v: string) => {
  const c = document.querySelector("#cmd") as HTMLInputElement;
  c.value = v;
  c.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
};
const key = (k: string) => document.querySelector("#cmd")!.dispatchEvent(new KeyboardEvent("keydown", { key: k }));

beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  w.CWD = ["~", "workspaces", "NgolaCloud", "projects"];
  w.termClear();
});

it("termClear desenha o cabeçalho e um prompt com o utilizador e a máquina", () => {
  expect(term()).toContain("delonix shell");
  expect(document.querySelector("#inputwrap .pr")!.textContent).toContain("walter@delonix:");
});

it("cd/pwd/ls navegam na árvore; comando desconhecido avisa", () => {
  enter("cd dxtutor");
  enter("pwd");
  expect(term()).toContain("/home/walter/workspaces/NgolaCloud/projects/dxtutor");
  enter("ls");
  expect(term()).toMatch(/crates\//);
  enter("cd nao-existe");
  expect(term()).toContain("cd: nao-existe: não é um directório");
  enter("xyz");
  expect(term()).toContain("xyz: comando não encontrado");
});

it("o histórico: Enter guarda, ↑/↓ percorre, history lista", () => {
  enter("whoami");
  enter("date");
  key("ArrowUp");
  expect((document.querySelector("#cmd") as HTMLInputElement).value).toBe("date");
  key("ArrowUp");
  expect((document.querySelector("#cmd") as HTMLInputElement).value).toBe("whoami");
  key("ArrowDown");
  key("ArrowDown");
  expect((document.querySelector("#cmd") as HTMLInputElement).value).toBe("");
  enter("history");
  expect(term()).toMatch(/1\s+whoami/);
});

it("Tab completa o nome único da pasta; o registo XC tem prioridade sobre os comandos de base", () => {
  enter("cd dxtutor");
  const c = document.querySelector("#cmd") as HTMLInputElement;
  c.value = "cd cra";
  key("Tab");
  expect((document.querySelector("#cmd") as HTMLInputElement).value).toBe("cd crates");
  // help vem do XC do terminal.ts (não do help de base)
  w.XC.__xcteste = () => w.echo("via XC");
  enter("__xcteste");
  expect(term()).toContain("via XC");
});
