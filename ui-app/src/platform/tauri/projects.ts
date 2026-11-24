/* ═════════ cliente IPC: projectos da pasta — ADR-0005, R2d ═════════
   Contrato de `detect_projects` (src-tauri/src/commands/search.rs): a raiz e as sub-pastas
   de primeiro nível que são projectos, pelo ficheiro-marca (Cargo.toml, go.mod, package.json,
   pyproject.toml/requirements.txt, pom.xml/build.gradle, composer.json, Gemfile). */
import { invoke, type Invoker } from "./core";

/** `ProjectInfo`: nome da pasta, caminho ABSOLUTO e o tipo (rust/go/node/python/java/php/ruby). */
export interface ProjectInfo {
  name: string;
  path: string;
  kind: string;
}

export const projectsClient = (inv: Invoker = invoke) => ({
  detect: (root: string): Promise<ProjectInfo[]> => inv<ProjectInfo[]>("detect_projects", { root }),
});

export type ProjectsClient = ReturnType<typeof projectsClient>;
