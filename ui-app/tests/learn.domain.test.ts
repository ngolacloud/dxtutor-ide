// Learning Track: catálogo de linguagens, conversão dos DTOs do backend e casos de uso dos
// plugins de curso (com um gateway falso — sem Tauri).
import { describe, test, expect } from "vitest";
import { LANGUAGE_CATALOG, MAX_OFFICIAL_LANGUAGES, findLanguage, indentText, languageCards } from "../src/features/learn/domain/catalog";
import { fromCourseDto, fromEmbedded, toPluginRow } from "../src/features/learn/domain/course-adapter";
import type { Course, PluginRow } from "../src/features/learn/domain/types";
import type { CourseGateway } from "../src/features/learn/application/ports";
import { gradeStep, installPlugin, loadCatalog } from "../src/features/learn/application/catalog-service";
import rust from "../src/content/courses/rust.json";

const course = (id: string, summary = "s"): Course => ({ id, title: id, summary, overview: "", units: [], origin: "backend" });
const kotlinPlugin: PluginRow = { id: "kotlin", name: "Kotlin", version: "1.0.0", source: "github:ngolacloud/dxtutor-course-kotlin", error: null, language: { id: "kotlin", name: "Kotlin", icon: "🟣", extension: "kt", indent: "    " } };
const elixirPlugin: PluginRow = { id: "elixir", name: "Elixir", version: "0.1.0", source: "github:acme/elixir", error: null, language: { id: "elixir", name: "Elixir", icon: "💧", extension: "ex", indent: "  " } };

describe("catálogo", () => {
  test("no máximo 10 linguagens oficiais, ids e extensões únicos", () => {
    expect(LANGUAGE_CATALOG.length).toBeLessThanOrEqual(MAX_OFFICIAL_LANGUAGES);
    expect(new Set(LANGUAGE_CATALOG.map(l => l.id)).size).toBe(LANGUAGE_CATALOG.length);
    expect(new Set(LANGUAGE_CATALOG.map(l => l.extension)).size).toBe(LANGUAGE_CATALOG.length);
    expect(LANGUAGE_CATALOG.map(l => l.id)).toEqual(["rust", "go", "python", "typescript", "java", "kotlin", "swift", "csharp", "cpp", "sql"]);
  });

  test("indentText", () => {
    expect(indentText("tab")).toBe("\t");
    expect(indentText("2")).toBe("  ");
    expect(indentText("lixo")).toBe("    ");
    expect(indentText("99")).toBe("    ");
  });

  test("cartões: oficial disponível só com curso; comunidade só via plugin com curso", () => {
    const cards = languageCards({ rust: course("rust", "Rust course"), kotlin: course("kotlin"), elixir: course("elixir") }, [kotlinPlugin, elixirPlugin]);
    expect(cards).toHaveLength(11);
    expect(cards[0]).toMatchObject({ state: "available", summary: "Rust course", community: false });
    expect(cards.find(c => c.language.id === "python")!.state).toBe("soon");
    expect(cards.find(c => c.language.id === "kotlin")!).toMatchObject({ state: "available", community: false });
    expect(cards[10]).toMatchObject({ language: { id: "elixir" }, community: true, state: "available" });
    // Plugin da comunidade sem curso carregado não aparece.
    expect(languageCards({}, [elixirPlugin])).toHaveLength(10);
  });

  test("findLanguage: catálogo primeiro, depois manifestos de plugin", () => {
    expect(findLanguage("go", [])!.indent).toBe("\t");
    expect(findLanguage("elixir", [elixirPlugin])!.extension).toBe("ex");
    expect(findLanguage("cobol", [elixirPlugin])).toBeNull();
  });
});

describe("conversão de DTOs", () => {
  test("CourseDto camelCase → forma snake_case do motor", () => {
    const c = fromCourseDto({
      id: "kotlin-basics", title: "Kotlin", summary: "s", overview: "Kotlin is…",
      units: [{ id: "u1", title: "U1", intro: "", concepts: "Values", difficulty: 1, level: "basic", steps: [{
        kind: "drill", id: "k-d1", title: "Hi", points: 10, intro: "", difficulty: 1, body: "", prompt: "p",
        target: "fun main() {}\n", explanation: "", lineComments: ["entry point"], placeholderPolicy: "on_demand",
        instructions: "", entry: "", starter: "",
      }] }],
    });
    expect(c.origin).toBe("backend");
    expect(c.overview).toBe("Kotlin is…");
    expect(c.units[0].concepts).toBe("Values");
    expect(c.units[0].steps[0]).toMatchObject({ line_comments: ["entry point"], placeholder_policy: "on_demand" });
    expect(c.units[0].steps[0].tests).toBeUndefined();
  });

  test("cursos embutidos ganham overview/concepts vazios e origem embedded", () => {
    const c = fromEmbedded(rust as never);
    expect(c.origin).toBe("embedded");
    expect(c.units.length).toBe(rust.units.length);
    expect(c.units.every(u => typeof u.concepts === "string")).toBe(true);
  });

  test("plugin estragado vira linha com erro e sem linguagem", () => {
    const row = toPluginRow({ entry: { id: "x", name: "X", version: "1.0.0", source: "s" }, manifest: null, error: "bad json" });
    expect(row).toMatchObject({ id: "x", language: null, error: "bad json" });
  });
});

function fakeGateway(over: Partial<CourseGateway> = {}): CourseGateway & { installed: string[] } {
  const installed: string[] = [];
  return {
    installed,
    available: () => true,
    listPlugins: async () => [kotlinPlugin],
    install: async (s) => { installed.push(s); return { id: "kotlin", version: "1.0.0", languageName: "Kotlin", replaced: null, warnings: [] }; },
    remove: async () => {},
    courseLanguages: async () => ["rust", "go", "kotlin", "broken"],
    getCourse: async (lang) => { if (lang === "broken") throw new Error("parse error"); return course(lang); },
    submitStep: async () => ({ passed: true, summary: "3/3 tests", raw: "", gabarito: null }),
    ...over,
  };
}

describe("casos de uso", () => {
  test("loadCatalog: embutidos ganham, backend acrescenta, falhas viram problemas", async () => {
    const embedded = { rust: { ...course("rust"), origin: "embedded" as const } };
    const st = await loadCatalog(fakeGateway(), embedded);
    expect(st.courses.rust.origin).toBe("embedded");
    expect(Object.keys(st.courses).sort()).toEqual(["go", "kotlin", "rust"]);
    expect(st.plugins).toEqual([kotlinPlugin]);
    expect(st.problems).toEqual(["broken: parse error"]);
  });

  test("loadCatalog no browser: só os embutidos, sem chamar o backend", async () => {
    const st = await loadCatalog(fakeGateway({ available: () => false, listPlugins: async () => { throw new Error("não devia"); } }), { rust: course("rust") });
    expect(Object.keys(st.courses)).toEqual(["rust"]);
    expect(st.problems).toEqual([]);
  });

  test("installPlugin recusa origem vazia e o browser; passa a origem aparada", async () => {
    const gw = fakeGateway();
    await expect(installPlugin(gw, "  ")).rejects.toThrow(/plugin source/);
    await expect(installPlugin(fakeGateway({ available: () => false }), "kotlin")).rejects.toThrow(/desktop/);
    await installPlugin(gw, "  ngolacloud/dxtutor-course-kotlin@v1 ");
    expect(gw.installed).toEqual(["ngolacloud/dxtutor-course-kotlin@v1"]);
  });

  test("loadCatalog: um plugin da linguagem substitui o curso embutido", async () => {
    const rustPlugin: PluginRow = { ...kotlinPlugin, id: "rust", language: { id: "rust", name: "Rust", icon: "🦀", extension: "rs", indent: "    " } };
    const embedded = { rust: { ...course("rust"), origin: "embedded" as const } };
    const st = await loadCatalog(fakeGateway({ listPlugins: async () => [rustPlugin] }), embedded);
    expect(st.courses.rust.origin).toBe("backend");
  });

  test("gradeStep delega no backend com a linguagem e não simula no browser", async () => {
    const seen: string[] = [];
    const gw = fakeGateway({ submitStep: async (id, _c, lang) => { seen.push(`${lang}:${id}`); return { passed: true, summary: "", raw: "", gabarito: null }; } });
    expect((await gradeStep(gw, "ch1-greet", "code", "go")).passed).toBe(true);
    expect(seen).toEqual(["go:ch1-greet"]);
    await expect(gradeStep(fakeGateway({ available: () => false }), "k-x1", "code", "kotlin")).rejects.toThrow(/desktop/);
  });
});
