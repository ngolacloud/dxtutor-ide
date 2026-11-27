/* Textos do New Project (texto NOVO, sem par no motor de tradução). */
import type { Messages } from "../../../app/i18n";

export const NEW_PROJECT_MESSAGES = {
  en: {
    title: "New Project",
    intro: "Pick a language, a framework or a server. The project comes complete — code, tests, Dockerfile, compose, CI, ADRs and runbooks — from the same templates as `delonix init -t`, and opens as your workspace.",
    language: "Languages", framework: "Frameworks", server: "Web servers", app: "Applications", other: "Other",
    files: "{n} files", loading: "Loading the templates…", close: "Close", back: "← Back",
    name: "Project name", nameHint: "Lowercase letters, digits and hyphens — it becomes the folder, the image tag and the package name.",
    nameEmpty: "Give the project a name.", nameShape: "Use lowercase letters, digits and inner hyphens (at most 63), e.g. {slug}.",
    parent: "Create in", choose: "Choose…", version: "Version", where: "It will be created in {dir}.",
    port: "Port {port}", tls: "HTTPS {port}", create: "Create project", creating: "Creating the project…",
    done: "Project {name} created ({files} files) and opened as your workspace.",
    gitCommitted: "Git repository on main with the commit «chore: scaffold».",
    gitInside: "The folder is inside another git repository, so no repository was created in it.",
    gitAuthor: "Git repository created and staged; the commit needs your git user.name and user.email.",
    gitFailed: "Git: {detail}",
    lockGenerated: "{file} generated for reproducible builds.",
    lockMissing: "{file} was not generated: install the package manager and run `{command}` in the project.",
    lockFailed: "{file} was not generated (`{command}`): {detail}",
    tlsNote: "It serves HTTPS on {port}: create its local certificate in tls/ with scripts/tls.sh or `delonix init`.",
    approveTitle: "Create the project {name} ({template})", badResponse: "invalid response from the project generator",
    needsDesktop: "New Project needs the desktop app (folders on disk, git).",
  },
  ptAO: {
    title: "Novo projecto",
    intro: "Escolhe uma linguagem, um framework ou um servidor. O projecto vem completo — código, testes, Dockerfile, compose, CI, ADRs e runbooks — dos mesmos templates do `delonix init -t`, e abre-se como o teu workspace.",
    language: "Linguagens", framework: "Frameworks", server: "Servidores web", app: "Aplicações", other: "Outros",
    files: "{n} ficheiros", loading: "A carregar os templates…", close: "Fechar", back: "← Voltar",
    name: "Nome do projecto", nameHint: "Letras minúsculas, dígitos e hífenes — vira o nome da pasta, a tag da imagem e o nome do pacote.",
    nameEmpty: "Dá um nome ao projecto.", nameShape: "Usa letras minúsculas, dígitos e hífenes no meio (até 63), p.ex. {slug}.",
    parent: "Criar em", choose: "Escolher…", version: "Versão", where: "Vai ser criado em {dir}.",
    port: "Porta {port}", tls: "HTTPS {port}", create: "Criar projecto", creating: "A criar o projecto…",
    done: "Projecto {name} criado ({files} ficheiros) e aberto como o teu workspace.",
    gitCommitted: "Repositório git em main com o commit «chore: scaffold».",
    gitInside: "A pasta está dentro de outro repositório git, por isso não se criou um repositório nela.",
    gitAuthor: "Repositório git criado e tudo em stage; o commit precisa do teu user.name e user.email do git.",
    gitFailed: "Git: {detail}",
    lockGenerated: "{file} gerado, para builds reproduzíveis.",
    lockMissing: "{file} não foi gerado: instala o gestor de pacotes e corre `{command}` no projecto.",
    lockFailed: "{file} não foi gerado (`{command}`): {detail}",
    tlsNote: "Serve HTTPS na porta {port}: cria o certificado local em tls/ com scripts/tls.sh ou o `delonix init`.",
    approveTitle: "Criar o projecto {name} ({template})", badResponse: "resposta inválida do gerador de projectos",
    needsDesktop: "O Novo projecto precisa da app desktop (pastas no disco, git).",
  },
} satisfies Messages<string>;

export type NewProjectKey = keyof typeof NEW_PROJECT_MESSAGES.en;
