/* Textos da feature `lsp` para o aviso de servidor em falta e a instalação a partir das receitas do
   registo (LSP P3). Dados puros: a aplicação recebe-os por uma porta `copy(chave)` e a UI por
   `translator`. O editor (`.ed`) está fora do motor de tradução (TR_SKIP), por isso cada texto vem já na
   língua da interface. */
import type { Messages } from "../../../app/i18n";

export const LSP_INSTALL_MESSAGES = {
  en: {
    // a faixa
    missingTitle: "No {language} language server",
    missingDetail: "dxtutor looked for {server} and did not find it, so this file has no live diagnostics, hover or go to definition.",
    toInstall: "To install:",
    way: "Way to install",
    copy: "Copy",
    install: "Install",
    installTip: "Runs after you approve the exact command; it goes to the audit log.",
    recheck: "Check again",
    dismiss: "Dismiss",
    // as maneiras
    wayGithub: "GitHub release",
    wayManual: "{manager} (you run it)",
    wayMissing: "{way} — {program} not found",
    wayNoPlatform: "{way} — no build for {platform}",
    noteUser: "Installs into dxtutor's own folder ({dir}); nothing global changes. Runs in a terminal.",
    noteToolchain: "Adds the component to your Rust toolchain. Runs in a terminal.",
    noteDownload: "dxtutor downloads this pinned release, checks its SHA-256 and unpacks it into {dir}.",
    noteManual: "A system package manager: it may ask for sudo, so dxtutor does not run it. Run it in your terminal, then «Check again».",
    noteMissing: "Install {program} first, or choose another way.",
    noteNoPlatform: "There is no build of this release for {platform}: choose another way.",
    withheldProject: "This project's .dxtutor/lsp.json chooses this server: dxtutor installs only the servers of its own registry or of your lsp.json.",
    withheldCommand: "Your lsp.json runs another program than the bundled one: give it recipes there, or install it yourself.",
    noWay: "install {server} and put it on PATH",
    // copiar
    copied: "Copied: {text}",
    copyFailed: "Could not copy — select the command: {text}",
    // a aprovação
    dialogTitle: "Install the {label} language server with {manager}",
    dialogTitleDownload: "Download the {label} language server",
    scopeUser: "terminal · installs into {dir} · your login shell's PATH (e.g. nvm's node)",
    scopeToolchain: "terminal · your Rust toolchain (rustup)",
    scopeDownload: "dxtutor · pinned GitHub release, SHA-256 checked before unpacking · {dir}",
    // o resultado
    installing: "Installing {label} in the terminal…",
    downloading: "Downloading {label} and checking its SHA-256…",
    notAudited: "Not installed: the audit log failed ({error})",
    failedExit: "{label} was not installed (exit code {code}). Read the terminal for the reason.",
    failedDownload: "{label} was not installed: {error}",
    installed: "{label} installed ({where}) — live diagnostics, hover and go to definition are on.",
    installedNotFound: "{label} installed, but dxtutor still does not find it. Read the terminal output.",
    found: "{label} found ({where}) — starting it.",
    stillMissing: "{label} is still not found.",
  },
  ptAO: {
    missingTitle: "Sem servidor de linguagem de {language}",
    missingDetail: "O dxtutor procurou o {server} e não o encontrou, por isso este ficheiro não tem diagnósticos ao vivo, hover nem «ir para a definição».",
    toInstall: "Para instalar:",
    way: "Maneira de instalar",
    copy: "Copiar",
    install: "Instalar",
    installTip: "Corre depois de aprovares o comando exacto; fica no registo de auditoria.",
    recheck: "Verificar outra vez",
    dismiss: "Fechar",
    wayGithub: "Release do GitHub",
    wayManual: "{manager} (corres tu)",
    wayMissing: "{way} — {program} não encontrado",
    wayNoPlatform: "{way} — sem versão para {platform}",
    noteUser: "Instala na pasta do próprio dxtutor ({dir}); nada global muda. Corre num terminal.",
    noteToolchain: "Acrescenta o componente à tua toolchain de Rust. Corre num terminal.",
    noteDownload: "O dxtutor descarrega esta release fixada, confere o SHA-256 e desempacota-a em {dir}.",
    noteManual: "Um gestor de pacotes do sistema: pode pedir sudo, por isso o dxtutor não o corre. Corre-o no teu terminal e depois «Verificar outra vez».",
    noteMissing: "Instala primeiro o {program}, ou escolhe outra maneira.",
    noteNoPlatform: "Esta release não tem versão para {platform}: escolhe outra maneira.",
    withheldProject: "O .dxtutor/lsp.json deste projecto escolhe este servidor: o dxtutor só instala os servidores do seu próprio registo ou do teu lsp.json.",
    withheldCommand: "O teu lsp.json corre outro programa que não o embutido: dá-lhe receitas lá, ou instala-o tu.",
    noWay: "instala o {server} e põe-no no PATH",
    copied: "Copiado: {text}",
    copyFailed: "Não foi possível copiar — selecciona o comando: {text}",
    dialogTitle: "Instalar o servidor de linguagem {label} com {manager}",
    dialogTitleDownload: "Descarregar o servidor de linguagem {label}",
    scopeUser: "terminal · instala em {dir} · o PATH da tua shell de login (p.ex. o node do nvm)",
    scopeToolchain: "terminal · a tua toolchain de Rust (rustup)",
    scopeDownload: "dxtutor · release do GitHub fixada, SHA-256 conferido antes de desempacotar · {dir}",
    installing: "A instalar o {label} no terminal…",
    downloading: "A descarregar o {label} e a conferir o SHA-256…",
    notAudited: "Não instalado: o registo de auditoria falhou ({error})",
    failedExit: "O {label} não foi instalado (código de saída {code}). Lê o terminal para saber porquê.",
    failedDownload: "O {label} não foi instalado: {error}",
    installed: "{label} instalado ({where}) — diagnósticos ao vivo, hover e «ir para a definição» ligados.",
    installedNotFound: "{label} instalado, mas o dxtutor ainda não o encontra. Lê a saída do terminal.",
    found: "{label} encontrado ({where}) — a arrancá-lo.",
    stillMissing: "O {label} continua sem ser encontrado.",
  },
} satisfies Messages<string>;
export type LspInstallKey = keyof typeof LSP_INSTALL_MESSAGES.en;
export type InstallCopy = (key: LspInstallKey, params?: Record<string, string | number>) => string;

/** O texto em inglês de uma chave (o que a aplicação usa quando ninguém lhe dá uma porta `copy`). */
export function englishInstallCopy(key: LspInstallKey, params?: Record<string, string | number>): string {
  const s = LSP_INSTALL_MESSAGES.en[key];
  return params ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in params ? String(params[n]) : all)) : s;
}
