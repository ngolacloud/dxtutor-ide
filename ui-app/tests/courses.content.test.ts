// Guarda dos dados dos cursos (src/content/courses/*.json): a forma que o motor do
// Learning Track (features/learn.ts) lê e a unicidade dos ids, que indexam o progresso
// guardado do aluno (LTS). Um JSON editado à mão que parta isto falha aqui, não na UI.
import { test, expect } from "vitest";
import rust from "../src/content/courses/rust.json";
import go from "../src/content/courses/go.json";

const COURSES = { rust, go };
const LEVELS = new Set(["basic", "intermediate", "advanced"]); // os de LTS.levels

for (const [lang, c] of Object.entries(COURSES)) {
  test(`${lang}: curso com id, título e unidades`, () => {
    expect(typeof c.id).toBe("string");
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.units.length).toBeGreaterThan(0);
  });

  test(`${lang}: unidades e passos com os campos que o motor lê`, () => {
    for (const u of c.units) {
      expect(u.id, "unit.id").toBeTypeOf("string");
      expect(u.title, `${u.id}.title`).toBeTypeOf("string");
      expect(u.steps.length, `${u.id} sem passos`).toBeGreaterThan(0);
      for (const s of u.steps) {
        expect(s.id, `${u.id}: step.id`).toBeTypeOf("string");
        expect(s.kind, `${s.id}.kind`).toBeTypeOf("string");
        expect(s.title, `${s.id}.title`).toBeTypeOf("string");
      }
    }
  });

  test(`${lang}: níveis conhecidos`, () => {
    const levels = new Set(c.units.map((u) => u.level));
    for (const l of levels) expect(LEVELS.has(l), `nível desconhecido: ${l}`).toBe(true);
  });

  test(`${lang}: ids de unidades e de passos únicos`, () => {
    const units = c.units.map((u) => u.id);
    const steps = c.units.flatMap((u) => u.steps.map((s) => s.id));
    expect(new Set(units).size).toBe(units.length);
    expect(new Set(steps).size).toBe(steps.length);
  });
}
