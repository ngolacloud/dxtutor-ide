// Learning Track: catálogo de linguagens, conversão dos DTOs do backend e casos de uso dos
// plugins de curso (com um gateway falso — sem Tauri).
import { describe, test, expect } from "vitest";
import { FRAMEWORK_CATALOG, LANGUAGE_CATALOG, MAX_OFFICIAL_LANGUAGES, findLanguage, findSubject, indentText, languageCards, subjectCards, trackKey } from "../src/features/learn/domain/catalog";
import { fromCourseDto, fromEmbedded, toPluginRow } from "../src/features/learn/domain/course-adapter";
import { baseName, editablePaths, projectPaths, projectSubmission } from "../src/features/learn/domain/project";
import type { Course, PluginRow } from "../src/features/learn/domain/types";
import type { CourseGateway, CourseSummary } from "../src/features/learn/application/ports";
import { gradeStep, installPlugin, loadCatalog } from "../src/features/learn/application/catalog-service";
import rust from "../src/content/courses/rust.json";

const course = (id: string, summary = "s"): Course => ({ id, language: id, category: "language", subject: "", title: id, summary, overview: "", units: [], origin: "backend" });
const fwCourse = (subject: string, language = "python", summary = "fw"): Course => ({ ...course(`${subject}-course`, summary), language, category: "framework", subject });
const python = { id: "python", name: "Python", icon: "🐍", extension: "py", indent: "    " };
const kotlinPlugin: PluginRow = { id: "kotlin", name: "Kotlin", version: "1.0.0", source: "github:ngolacloud/dxtutor-course-kotlin", error: null, subject: null, language: { id: "kotlin", name: "Kotlin", icon: "🟣", extension: "kt", indent: "    " } };
const elixirPlugin: PluginRow = { id: "elixir", name: "Elixir", version: "0.1.0", source: "github:acme/elixir", error: null, subject: null, language: { id: "elixir", name: "Elixir", icon: "💧", extension: "ex", indent: "  " } };
const flaskPlugin: PluginRow = { id: "flask", name: "Flask", version: "0.1.0", source: "github:acme/flask", error: null, language: python, subject: { id: "flask", name: "Flask", icon: "🧪", category: "framework", docs: "https://flask.palletsprojects.com/", install: "", repo: "" } };

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

  test("frameworks e ferramentas: catálogo à parte, que não conta para o tecto das linguagens", () => {
    expect(FRAMEWORK_CATALOG.map(f => f.id)).toEqual(["dxjs", "seiva", "django", "delonix", "docker", "podman", "kubernetes", "odoo"]);
    expect(new Set(FRAMEWORK_CATALOG.map(f => f.id)).size).toBe(FRAMEWORK_CATALOG.length);
    // Nenhum id choca com uma linguagem (seriam o mesmo percurso).
    expect(FRAMEWORK_CATALOG.filter(f => LANGUAGE_CATALOG.some(l => l.id === f.id))).toEqual([]);
    for (const f of FRAMEWORK_CATALOG) {
      expect(f.repo).toBe(`ngolacloud/dxtutor-course-${f.id}`);
      expect(f.docs).toMatch(/^https:\/\/[^ ]+\/$/);
      expect(f.install.length, f.id).toBeGreaterThan(5);
      expect(["framework", "tool"]).toContain(f.category);
    }
    expect(FRAMEWORK_CATALOG.find(f => f.id === "dxjs")!.docs).toBe("https://ngolacloud.github.io/dxjs/");
    expect(FRAMEWORK_CATALOG.find(f => f.id === "odoo")!.install).toMatch(/18 to 20.*Community.*Enterprise only with an Odoo licence/);
    expect(LANGUAGE_CATALOG).toHaveLength(MAX_OFFICIAL_LANGUAGES);
  });

  test("cartões de frameworks: «soon» sem curso, como uma linguagem sem plugin; comunidade só com curso", () => {
    const none = subjectCards({}, []);
    expect(none.map(c => c.state)).toEqual(Array(8).fill("soon"));
    expect(none.every(c => c.summary === "" && !c.community)).toBe(true);
    const cards = subjectCards({ django: fwCourse("django", "python", "Django course"), flask: fwCourse("flask") }, [flaskPlugin]);
    expect(cards.find(c => c.subject.id === "django")).toMatchObject({ state: "available", summary: "Django course", community: false });
    expect(cards[8]).toMatchObject({ subject: { id: "flask" }, state: "available", community: true });
    expect(subjectCards({}, [flaskPlugin])).toHaveLength(8);
    // Um curso de LINGUAGEM com a mesma chave não acende um cartão de framework (nem o contrário).
    expect(subjectCards({ django: course("django") }, []).find(c => c.subject.id === "django")!.state).toBe("soon");
    expect(languageCards({ python: fwCourse("python") }, []).find(c => c.language.id === "python")!.state).toBe("soon");
    // O plugin de framework não vira cartão «Community» de linguagem.
    expect(languageCards({ python: course("python") }, [flaskPlugin])).toHaveLength(10);
  });

  test("findSubject e trackKey", () => {
    expect(findSubject("docker", [])!.category).toBe("tool");
    expect(findSubject("flask", [flaskPlugin])!.name).toBe("Flask");
    expect(findSubject("rails", [flaskPlugin])).toBeNull();
    expect(trackKey({ category: "language", language: "go", subject: "" })).toBe("go");
    expect(trackKey({ category: "framework", language: "python", subject: "django" })).toBe("django");
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
    expect(c.units[0].steps[0].project).toBeUndefined();
    expect(c).toMatchObject({ category: "language", subject: "" });
  });

  test("CourseDto de framework com passo de projecto", () => {
    const c = fromCourseDto({
      id: "django-basics", language: "python", category: "framework", subject: "django", title: "Django", summary: "s", overview: "",
      units: [{ id: "u1", title: "U1", intro: "", concepts: "", difficulty: 1, level: "basic", steps: [{
        kind: "challenge", id: "dj-p1", title: "P", points: 30, intro: "", difficulty: 1, body: "", prompt: "", target: "",
        explanation: "", lineComments: [], placeholderPolicy: "shown", instructions: "Do it", entry: "", starter: "",
        project: { main: "app/views.py", files: { "app/__init__.py": "", "app/views.py": "x" }, readonly: ["app/__init__.py"] },
      }] }],
    });
    expect(c).toMatchObject({ language: "python", category: "framework", subject: "django" });
    expect(c.units[0].steps[0].project).toEqual({ main: "app/views.py", files: { "app/__init__.py": "", "app/views.py": "x" }, readonly: ["app/__init__.py"] });
  });

  test("cursos embutidos ganham overview/concepts vazios e origem embedded", () => {
    const c = fromEmbedded(rust as never, "rust");
    expect(c.origin).toBe("embedded");
    expect(c).toMatchObject({ language: "rust", category: "language", subject: "" });
    expect(c.units.length).toBe(rust.units.length);
    expect(c.units.every(u => typeof u.concepts === "string")).toBe(true);
  });

  test("plugin estragado vira linha com erro e sem linguagem", () => {
    const row = toPluginRow({ entry: { id: "x", name: "X", version: "1.0.0", source: "s" }, manifest: null, error: "bad json" });
    expect(row).toMatchObject({ id: "x", language: null, subject: null, error: "bad json" });
  });

  test("plugin de framework: o subject vem do manifesto; num de linguagem fica null", () => {
    const fw = toPluginRow({ entry: { id: "django", name: "Django", version: "1.0.0", source: "s" }, error: null,
      manifest: { language: { ...python, indent: "4" }, category: "framework", subject: { id: "django", name: "Django", icon: "", docs: "https://docs.djangoproject.com/" } } });
    expect(fw.subject).toMatchObject({ id: "django", category: "framework", icon: "🧩", docs: "https://docs.djangoproject.com/" });
    expect(fw.language!.id).toBe("python");
    const lang = toPluginRow({ entry: { id: "py", name: "Py", version: "1.0.0", source: "s" }, error: null, manifest: { language: { ...python, indent: "4" } } });
    expect(lang.subject).toBeNull();
  });
});

describe("passos de projecto (domínio)", () => {
  const p = { main: "shop/cart.py", files: { "shop/__init__.py": "", "shop/cart.py": "C0", "shop/prices.py": "P0", "README.md": "r" }, readonly: ["shop/__init__.py", "README.md"] };
  test("o principal primeiro, os editáveis, e a entrega", () => {
    expect(projectPaths(p)).toEqual(["shop/cart.py", "README.md", "shop/__init__.py", "shop/prices.py"]);
    expect(editablePaths(p)).toEqual(["shop/cart.py", "shop/prices.py"]);
    const seen: Record<string, string> = { "shop/cart.py": "C1", "shop/__init__.py": "hack" };
    // O que o aluno nunca abriu vai com o conteúdo inicial; os só de leitura nunca vão.
    expect(projectSubmission(p, f => seen[f])).toEqual({ "shop/cart.py": "C1", "shop/prices.py": "P0" });
    expect(baseName("shop/cart.py")).toBe("cart.py");
    expect(baseName("README.md")).toBe("README.md");
  });
});

const summary = (language: string, subject = ""): CourseSummary => ({ id: `${subject || language}-c`, language, category: subject ? "framework" : "language", subject });

function fakeGateway(over: Partial<CourseGateway> = {}): CourseGateway & { installed: string[] } {
  const installed: string[] = [];
  return {
    installed,
    available: () => true,
    listPlugins: async () => [kotlinPlugin],
    install: async (s) => { installed.push(s); return { id: "kotlin", version: "1.0.0", languageName: "Kotlin", replaced: null, warnings: [] }; },
    remove: async () => {},
    listCourses: async () => ["rust", "go", "kotlin", "broken"].map(l => summary(l)),
    getCourse: async (lang, subject) => { if (lang === "broken") throw new Error("parse error"); return subject ? fwCourse(subject, lang) : course(lang); },
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

  test("loadCatalog: frameworks pelo subject, pedidos com a linguagem do runtime; choque com uma linguagem recusado", async () => {
    const asked: string[] = [];
    const gw = fakeGateway({
      listPlugins: async () => [flaskPlugin],
      listCourses: async () => [summary("python", "django"), summary("python"), summary("python", "python"), summary("python", "flask")],
      getCourse: async (lang, subject) => { asked.push(`${lang}/${subject ?? ""}`); return subject ? fwCourse(subject, lang) : course(lang); },
    });
    const st = await loadCatalog(gw, {});
    expect(Object.keys(st.courses).sort()).toEqual(["django", "flask", "python"]);
    expect(st.courses.django).toMatchObject({ category: "framework", language: "python" });
    expect(st.courses.python.category).toBe("language");
    expect(asked.sort()).toEqual(["python/", "python/django", "python/flask"]);
    expect(st.problems).toEqual(["python-c: `python` is already a language track"]);
  });

  test("loadCatalog: um plugin de FRAMEWORK em python não troca o curso embutido da linguagem", async () => {
    const embedded = { rust: { ...course("rust"), origin: "embedded" as const } };
    const rustFw: PluginRow = { ...flaskPlugin, language: { ...python, id: "rust", extension: "rs" } };
    const st = await loadCatalog(fakeGateway({ listPlugins: async () => [rustFw] }), embedded);
    expect(st.courses.rust.origin).toBe("embedded");
  });

  test("gradeStep entrega os ficheiros de um projecto", async () => {
    const seen: unknown[] = [];
    const gw = fakeGateway({ submitStep: async (id, code, lang, files) => { seen.push([id, code, lang, files]); return { passed: false, summary: "", raw: "", gabarito: null }; } });
    await gradeStep(gw, "dj-p1", "main", "python", { "app/views.py": "main" });
    expect(seen).toEqual([["dj-p1", "main", "python", { "app/views.py": "main" }]]);
  });

  test("gradeStep delega no backend com a linguagem e não simula no browser", async () => {
    const seen: string[] = [];
    const gw = fakeGateway({ submitStep: async (id, _c, lang) => { seen.push(`${lang}:${id}`); return { passed: true, summary: "", raw: "", gabarito: null }; } });
    expect((await gradeStep(gw, "ch1-greet", "code", "go")).passed).toBe(true);
    expect(seen).toEqual(["go:ch1-greet"]);
    await expect(gradeStep(fakeGateway({ available: () => false }), "k-x1", "code", "kotlin")).rejects.toThrow(/desktop/);
  });
});
