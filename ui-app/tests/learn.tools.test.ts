// Learning Track — os cursos de ferramentas (Learn P2b: Kubernetes e Delonix). Escrevem-se em YAML,
// avaliam-se no backend por verificações, e aparecem como «Available» na secção «Frameworks & tools».
import { describe, test, expect } from "vitest";
import { EVALUATION_LANGUAGES, FRAMEWORK_CATALOG, LANGUAGE_CATALOG, MAX_OFFICIAL_LANGUAGES, findLanguage, findSubject, languageCards, subjectCards } from "../src/features/learn/domain/catalog";
import type { Course } from "../src/features/learn/domain/types";
import type { CourseGateway, CourseSummary } from "../src/features/learn/application/ports";
import { loadCatalog } from "../src/features/learn/application/catalog-service";

const toolCourse = (subject: string): Course => ({ id: `${subject}-basics`, language: "yaml", category: "tool", subject, title: subject, summary: `${subject} course`, overview: "", units: [], origin: "backend" });

const gateway = (list: CourseSummary[]): CourseGateway => ({
  available: () => true,
  listPlugins: async () => [],
  install: async () => { throw new Error("not used"); },
  remove: async () => {},
  listCourses: async () => list,
  getCourse: async (language, subject) => {
    if (language !== "yaml" || !subject) throw new Error(`unexpected ${language}/${subject}`);
    return toolCourse(subject);
  },
  submitStep: async () => ({ passed: false, summary: "", raw: "", gabarito: null }),
});

describe("cursos de ferramentas", () => {
  test("o YAML é uma linguagem de avaliação, não uma linguagem do catálogo", () => {
    expect(EVALUATION_LANGUAGES.map(l => l.id)).toEqual(["yaml", "dockerfile", "odoo-module"]);
    expect(LANGUAGE_CATALOG.some(l => l.id === "yaml")).toBe(false);
    expect(LANGUAGE_CATALOG).toHaveLength(MAX_OFFICIAL_LANGUAGES);
    // O editor tira daqui a extensão e a indentação (2 espaços, a convenção dos manifestos).
    expect(findLanguage("yaml", [])).toMatchObject({ extension: "yaml", indent: "  " });
    // Nunca vira um cartão de linguagem, nem com um curso indexado por `yaml`.
    expect(languageCards({ yaml: toolCourse("yaml") }, []).some(c => c.language.id === "yaml")).toBe(false);
    // O curso de Odoo (Learn P3c) escreve-se em ficheiros de módulos: Python por omissão, 4 espaços.
    expect(findLanguage("odoo-module", [])).toMatchObject({ extension: "py", indent: "    " });
    expect(LANGUAGE_CATALOG.some(l => l.id === "odoo-module")).toBe(false);
  });

  test("Kubernetes e Delonix ficam «Available» quando o backend serve os cursos", async () => {
    const list: CourseSummary[] = [
      { id: "kubernetes-basics", language: "yaml", category: "tool", subject: "kubernetes" },
      { id: "delonix-basics", language: "yaml", category: "tool", subject: "delonix" },
    ];
    const st = await loadCatalog(gateway(list), {});
    expect(st.problems).toEqual([]);
    expect(Object.keys(st.courses).sort()).toEqual(["delonix", "kubernetes"]);
    const cards = subjectCards(st.courses, st.plugins);
    for (const id of ["kubernetes", "delonix"]) {
      expect(cards.find(c => c.subject.id === id)).toMatchObject({ state: "available", community: false, summary: `${id} course` });
    }
    // Os outros continuam «Coming soon» (sem conteúdo inventado).
    expect(cards.find(c => c.subject.id === "docker")!.state).toBe("soon");
  });

  test("o que instalar: kubectl para o Kubernetes, o delonix 0.2.0 para o Delonix, e nenhum cluster", () => {
    expect(findSubject("kubernetes", [])!.install).toMatch(/kubectl \(https:\/\/kubernetes\.io\/docs\/tasks\/tools\/\).*No cluster/);
    expect(findSubject("delonix", [])!.install).toMatch(/delonix 0\.2\.0.*never touch the engine/);
    expect(FRAMEWORK_CATALOG.filter(f => f.id === "kubernetes" || f.id === "delonix").every(f => f.category === "tool")).toBe(true);
  });
});

describe("cursos de contentores (Learn P3a)", () => {
  const containerCourse = (subject: string): Course => ({ ...toolCourse(subject), language: "dockerfile" });
  const gw: CourseGateway = {
    ...gateway([
      { id: "docker-basics", language: "dockerfile", category: "tool", subject: "docker" },
      { id: "podman-basics", language: "dockerfile", category: "tool", subject: "podman" },
    ]),
    getCourse: async (language, subject) => {
      if (language !== "dockerfile" || !subject) throw new Error(`unexpected ${language}/${subject}`);
      return containerCourse(subject);
    },
  };

  test("Docker e Podman escrevem-se em Dockerfile e ficam «Available»", async () => {
    expect(findLanguage("dockerfile", [])).toMatchObject({ extension: "dockerfile", indent: "    " });
    expect(LANGUAGE_CATALOG.some(l => l.id === "dockerfile")).toBe(false);
    const st = await loadCatalog(gw, {});
    expect(st.problems).toEqual([]);
    const cards = subjectCards(st.courses, st.plugins);
    for (const id of ["docker", "podman"]) expect(cards.find(c => c.subject.id === id)!.state).toBe("available");
  });

  test("o que instalar diz a verdade: Podman rootless, nunca o daemon do Docker", () => {
    expect(findSubject("docker", [])!.install).toMatch(/Podman 4\.4.*never through the Docker daemon/);
    expect(findSubject("podman", [])!.install).toMatch(/rootless.*your own images and containers are not touched/);
  });
});
