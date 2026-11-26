/* Textos NOVOS da feature `lsp` para os overrides do registo de linguagens (LSP P2): o `lsp.json` do
   utilizador, o `.dxtutor/lsp.json` do projecto e a aprovação dos comandos que um projecto pede. Dados
   puros: a aplicação recebe-os por uma porta `copy(chave)` e a UI por `translator`. O editor (`.ed`) está
   fora do motor de tradução (TR_SKIP), por isso cada texto vem já na língua da interface. */
import type { Messages } from "../../../app/i18n";

export const LSP_OVERRIDE_MESSAGES = {
  en: {
    // a faixa do editor quando o projecto pede um comando por aprovar
    approvalTitle: "{label} is waiting for your approval",
    approvalDetail: "This project's .dxtutor/lsp.json asks dxtutor to run {command}. It came with the repository, so it does not run until you approve it.",
    approvalInside: "The program is inside the project folder.",
    approvalSettingsTitle: "{label}: this project's settings are waiting for your approval",
    approvalSettingsDetail: "This project's .dxtutor/lsp.json gives {label} its own {fields}. Settings can make a language server run commands, so they are not applied until you approve them; until then it runs with yours.",
    dialogSettingsTitle: "Apply this project's {fields} to the {label} language server",
    review: "Review…",
    // o diálogo de aprovação partilhado
    dialogTitle: "Run the {label} language server from this project's settings",
    dialogScope: "folder {cwd} · asked by {file} · changes {changed}",
    dialogInside: " · the program is inside the project folder (it came with the repository)",
    approvedToast: "{label} approved for this project — starting it.",
    deniedToast: "{label} was not approved: it will not run. Change .dxtutor/lsp.json or review it again from the banner.",
    approveFailed: "Not approved: {error}",
    // a faixa de servidor em falta
    overridesHint: "Have the server somewhere else, or want another one? Set it in your lsp.json.",
    configure: "Configure…",
    dismiss: "Dismiss",
    // a paleta
    cmdUser: "LSP: Open User Language Server Settings (lsp.json)",
    cmdProject: "LSP: Open Project Language Server Settings (.dxtutor/lsp.json)",
    cmdShow: "LSP: Show Effective Language Server Configuration",
    // o editor do ficheiro do utilizador
    userTitle: "Your language servers",
    userLede: "Merged over the bundled registry for every folder; a project's .dxtutor/lsp.json goes over it. Saving applies it at once.",
    save: "Save",
    close: "Close",
    saved: "Saved — applied to the running servers.",
    savedInvalid: "Saved, but ignored until it is fixed:",
    saveFailed: "Not saved: {error}",
    noFolder: "Open a folder first.",
    notLoaded: "{path} is not loaded in the editor — open it from your file manager.",
    // a vista do registo efectivo
    effTitle: "Effective language server configuration",
    effServer: "Server",
    effSources: "from: {sources}",
    effPending: "Waiting for your approval: {command}",
    effApproved: "The project's command is approved.",
    effFiles: "Override files",
    effMissing: "not created",
    effApplied: "applied",
    effIgnored: "ignored",
    effLanguages: "Languages: {list}",
    effNone: "none",
    // o aviso de ficheiros inválidos
    invalidTitle: "Language server settings ignored",
    invalidLede: "These override files have errors, so dxtutor uses the settings under them:",
    open: "Open",
    unavailable: "Language server settings are only in the desktop app with a folder open.",
  },
  ptAO: {
    approvalTitle: "{label} espera pela tua aprovação",
    approvalDetail: "O .dxtutor/lsp.json deste projecto pede ao dxtutor para correr {command}. Veio com o repositório, por isso não corre até o aprovares.",
    approvalInside: "O programa está dentro da pasta do projecto.",
    approvalSettingsTitle: "{label}: as definições deste projecto esperam pela tua aprovação",
    approvalSettingsDetail: "O .dxtutor/lsp.json deste projecto dá ao {label} as suas {fields}. As definições podem pôr um servidor de linguagem a correr comandos, por isso não se aplicam até as aprovares; até lá, ele corre com as tuas.",
    dialogSettingsTitle: "Aplicar as {fields} deste projecto ao servidor de linguagem {label}",
    review: "Rever…",
    dialogTitle: "Correr o servidor de linguagem {label} das definições deste projecto",
    dialogScope: "pasta {cwd} · pedido por {file} · muda {changed}",
    dialogInside: " · o programa está dentro da pasta do projecto (veio com o repositório)",
    approvedToast: "{label} aprovado para este projecto — a arrancá-lo.",
    deniedToast: "{label} não foi aprovado: não corre. Muda o .dxtutor/lsp.json ou revê-o outra vez na faixa.",
    approveFailed: "Não aprovado: {error}",
    overridesHint: "Tens o servidor noutro sítio, ou queres outro? Define-o no teu lsp.json.",
    configure: "Configurar…",
    dismiss: "Fechar",
    cmdUser: "LSP: Abrir as definições de servidores de linguagem do utilizador (lsp.json)",
    cmdProject: "LSP: Abrir as definições de servidores de linguagem do projecto (.dxtutor/lsp.json)",
    cmdShow: "LSP: Mostrar a configuração efectiva dos servidores de linguagem",
    userTitle: "Os teus servidores de linguagem",
    userLede: "Junta-se ao registo embutido em todas as pastas; o .dxtutor/lsp.json de um projecto fica por cima. Gravar aplica-o logo.",
    save: "Gravar",
    close: "Fechar",
    saved: "Gravado — aplicado aos servidores a correr.",
    savedInvalid: "Gravado, mas ignorado até ser corrigido:",
    saveFailed: "Não gravado: {error}",
    noFolder: "Abre uma pasta primeiro.",
    notLoaded: "{path} não está carregado no editor — abre-o no gestor de ficheiros.",
    effTitle: "Configuração efectiva dos servidores de linguagem",
    effServer: "Servidor",
    effSources: "de: {sources}",
    effPending: "Espera pela tua aprovação: {command}",
    effApproved: "O comando do projecto está aprovado.",
    effFiles: "Ficheiros de overrides",
    effMissing: "não criado",
    effApplied: "aplicado",
    effIgnored: "ignorado",
    effLanguages: "Linguagens: {list}",
    effNone: "nenhuma",
    invalidTitle: "Definições de servidores de linguagem ignoradas",
    invalidLede: "Estes ficheiros de overrides têm erros, por isso o dxtutor usa as definições por baixo deles:",
    open: "Abrir",
    unavailable: "As definições de servidores de linguagem só existem na app desktop com uma pasta aberta.",
  },
} satisfies Messages<string>;
export type LspOverrideKey = keyof typeof LSP_OVERRIDE_MESSAGES.en;

/** O texto em inglês de uma chave (o que a aplicação usa quando ninguém lhe dá uma porta `copy`). */
export function englishCopy(key: LspOverrideKey, params?: Record<string, string | number>): string {
  const s = LSP_OVERRIDE_MESSAGES.en[key];
  return params ? s.replace(/\{(\w+)\}/g, (all, n: string) => (n in params ? String(params[n]) : all)) : s;
}
