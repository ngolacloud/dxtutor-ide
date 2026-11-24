import { describe, expect, it } from "vitest";
import { approvalFor, type CommandRules } from "../src/features/codev/domain/policy";
import type { Mode } from "../src/features/codev/domain/types";

/* Testes unitários do DOMÍNIO puro do Co-Dev (ADR-0002, Fase 2). Sem DOM, sem
 * window, sem bootApp: importam directamente os módulos extraídos e exercitam-nos
 * com fakes. A rede de segurança de comportamento (golden + caracterização) vive
 * nos outros ficheiros; aqui prova-se que cada função extraída decide o que devia. */

const MODES: Mode[] = ["manual", "assist", "auto"];

/* Os mesmos regexes SAFE/DANGER do monólito (app.ts), aqui como `CommandRules`
 * fake — é o que o `legacy-bridge` embrulha em produção. */
const SAFE = /^(cargo (test|build|clippy)|dx lint|npm run lint)/;
const DANGER = /git push|rm -rf|drop table|--force/i;
const rules: CommandRules = { isSafe: (c) => SAFE.test(c), isDestructive: (c) => DANGER.test(c) };

describe("policy.approvalFor — a única fonte da regra de aprovação", () => {
  it("read nunca pede aprovação, em qualquer modo", () => {
    for (const mode of MODES) expect(approvalFor(mode, { kind: "read" }, rules)).toBe("auto");
  });

  it("edit só pede em manual; assist/auto aplicam automaticamente", () => {
    expect(approvalFor("manual", { kind: "edit" }, rules)).toBe("ask");
    expect(approvalFor("assist", { kind: "edit" }, rules)).toBe("auto");
    expect(approvalFor("auto", { kind: "edit" }, rules)).toBe("auto");
  });

  it.each([
    ["manual", "cargo test", "ask"],
    ["assist", "cargo test", "auto"],
    ["auto", "cargo test", "auto"],
    ["manual", "curl example.org", "ask"],
    ["assist", "curl example.org", "ask"],
    ["auto", "curl example.org", "auto"],
    ["manual", "git push --force", "ask"],
    ["assist", "git push --force", "ask"],
    ["auto", "git push --force", "ask"],
  ] as const)("run %s + %s -> %s", (mode, cmd, expected) => {
    expect(approvalFor(mode, { kind: "run", cmd }, rules)).toBe(expected);
  });

  it("comando destrutivo pede aprovação mesmo em auto (defesa que não depende do modo)", () => {
    for (const mode of MODES) expect(approvalFor(mode, { kind: "run", cmd: "rm -rf /" }, rules)).toBe("ask");
  });

  it("run sem cmd trata como comando vazio (não-seguro) — manual/assist pedem, auto não", () => {
    expect(approvalFor("manual", { kind: "run" }, rules)).toBe("ask");
    expect(approvalFor("assist", { kind: "run" }, rules)).toBe("ask");
    expect(approvalFor("auto", { kind: "run" }, rules)).toBe("auto");
  });

  /* A tabela POLICY das Definições (codev.ts) descreve a MESMA regra em prosa.
   * Em vez de a reescrever às cegas, fixa-se aqui as 4 linhas governadas por
   * `approvalFor` (verbatim do const POLICY) e prova-se que a política concorda:
   * uma célula "aprovas…" == ask; "automático…" == auto. */
  const POLICY_TOOL_ROWS: Array<{ row: [string, string, string, string]; call: () => Parameters<typeof approvalFor>[1] }> = [
    { row: ["Editar ficheiros", "aprovas cada edição", "automático, com diff", "automático, com diff"], call: () => ({ kind: "edit" }) },
    { row: ["Terminal: testes, build, lint", "aprovas", "automático", "automático"], call: () => ({ kind: "run", cmd: "cargo test" }) },
    { row: ["Terminal: outros comandos", "aprovas", "aprovas", "automático"], call: () => ({ kind: "run", cmd: "curl example.org" }) },
    { row: ["Push e acções destrutivas", "aprovas", "aprovas", "aprovas — sempre"], call: () => ({ kind: "run", cmd: "git push" }) },
  ];

  it("concorda com a tabela POLICY das Definições nas linhas de ferramentas", () => {
    const cellApproval = (cell: string) => (cell.startsWith("aprovas") ? "ask" : "auto");
    for (const { row, call } of POLICY_TOOL_ROWS) {
      MODES.forEach((mode, i) => {
        expect(approvalFor(mode, call(), rules), `${row[0]} / ${mode}`).toBe(cellApproval(row[i + 1]));
      });
    }
  });
});
