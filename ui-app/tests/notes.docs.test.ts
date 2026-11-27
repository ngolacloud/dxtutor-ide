import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { NOTES, PENDING } from "../src/app/notes/registry";
import { renderNotes } from "../src/app/notes/render";
import { bootApp } from "./harness";

/* As notas para a documentação oficial (`docs/notes/NOTAS.md`) mantêm-se em dia sozinhas:
 * cada acção da interface tem de estar coberta por uma nota (`features/<f>/notes.ts`) e o
 * ficheiro gravado tem de ser o que o registo gera. Para regenerar: `npm run docs:notes`
 * (corre este teste com UPDATE_NOTES=1). */

const FILE = resolve(__dirname, "../../docs/notes/NOTAS.md");
const covered = new Set(NOTES.flatMap((f) => f.actions.flatMap((a) => a.covers)));

describe("notas para a documentação oficial", () => {
  it("o ficheiro gravado é o que as notas geram (regenera com `npm run docs:notes`)", () => {
    const md = renderNotes(NOTES, PENDING);
    if (process.env.UPDATE_NOTES) {
      mkdirSync(resolve(FILE, ".."), { recursive: true });
      writeFileSync(FILE, md);
    }
    let disk = "";
    try { disk = readFileSync(FILE, "utf-8"); } catch { /* ainda não existe */ }
    expect(disk, "docs/notes/NOTAS.md está desactualizado — corre `npm run docs:notes`").toBe(md);
  });

  it("cada nota diz o que faz, onde, como usar e o fluxo", () => {
    for (const f of NOTES) {
      expect(f.actions.length, f.id).toBeGreaterThan(0);
      for (const a of f.actions) {
        expect(a.what.trim(), `${f.id} › ${a.title}`).not.toBe("");
        expect(a.where.length, `${f.id} › ${a.title}: where`).toBeGreaterThan(0);
        expect(a.howTo.length, `${f.id} › ${a.title}: howTo`).toBeGreaterThan(0);
        expect(a.flow.length, `${f.id} › ${a.title}: flow`).toBeGreaterThan(0);
        expect(a.covers.length, `${f.id} › ${a.title}: covers`).toBeGreaterThan(0);
      }
    }
  });

  it("os comandos da paleta citados existem", () => {
    const src = ["../src/app/boot-steps.ts", "../src/app/commands.ts"].map((p) => readFileSync(resolve(__dirname, p), "utf-8")).join("\n");
    for (const c of [...covered].filter((c) => c.startsWith("cmd:"))) expect(src, c).toContain(`'${c.slice(4)}'`);
  });

  it("nenhuma acção fica sem nota: as da feature codereview e as da barra do editor", async () => {
    await bootApp();
    const CR = await import("../src/features/codereview");
    const missing = (CR.CODEREVIEW_ACTION_NAMES as string[]).filter((n) => !covered.has(n));
    expect(missing, "acções do codereview sem nota em features/codereview/notes.ts").toEqual([]);
    const tabs = await import("../src/features/tabs");
    const bar = (tabs.EACT as [string, string, string, string][]).map((a) => `tabs:${a[3]}`);
    expect(bar.filter((b) => !covered.has(b) && !PENDING.includes(b)), "acção nova na barra do editor sem nota").toEqual([]);
    expect(PENDING.filter((p) => covered.has(p)), "já tem nota: tira-a do PENDING").toEqual([]);
    expect(PENDING.filter((p) => !bar.includes(p)), "já não existe na barra: tira-a do PENDING").toEqual([]);
  });
});
