/* Textos do pane Run — nasceram em português sem par no motor de tradução; com chave (ADR-0004, U6b): en + ptAO.
   Os valores ptAO são os textos de antes. */
import type { Messages } from "../app/i18n";

export const RUN_MESSAGES = {
  en: {
    noFolder: "Open a folder (File → Open Folder…) to see the projects and the commands to run them.",
    detectError: "Could not detect the projects: {error}",
    noProjects: "No projects detected in this folder (neither at the root nor in the first-level sub-folders): Cargo.toml, go.mod, package.json, pyproject.toml, pom.xml, composer.json or Gemfile.",
    eachCommand: "Each command runs in a task terminal, in the project's folder.",
    noCommands: "No known commands for this kind of project.",
    run: "Run", runMain: "Run main.py", install: "Install dependencies", installNoScripts: "Install dependencies (package.json has no scripts)",
  },
  ptAO: {
    noFolder: "Abre uma pasta (File → Open Folder…) para ver os projectos e os comandos para os correr.",
    detectError: "Não consegui detectar os projectos: {error}",
    noProjects: "Não detectei projectos nesta pasta (nem na raiz nem nas sub-pastas de primeiro nível): Cargo.toml, go.mod, package.json, pyproject.toml, pom.xml, composer.json ou Gemfile.",
    eachCommand: "Cada comando corre num terminal de tarefa, na pasta do projecto.",
    noCommands: "Sem comandos conhecidos para este tipo de projecto.",
    run: "Correr", runMain: "Correr main.py", install: "Instalar dependências", installNoScripts: "Instalar dependências (o package.json não tem scripts)",
  },
} satisfies Messages<string>;

export type RunKey = keyof typeof RUN_MESSAGES.en;
