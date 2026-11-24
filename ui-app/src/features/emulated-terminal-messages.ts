/* Textos do terminal emulado do browser (features/terminal.ts e os comandos que outras features lhe registam:
   termgit.ts, infra.ts) que nasceram sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO.
   Os valores ptAO são os textos de antes. */
import type { Messages } from "../app/i18n";

export const EMULATED_TERMINAL_MESSAGES = {
  en: {
    banner: "emulated terminal", bannerNote: "· only this workspace's files and git · the real terminal is in the desktop app · ",
    notFound: "{cmd}: command not found", notFoundNote: "— this emulated terminal only browses the files and git; the real terminal is in the desktop app",
    catMissing: "cat: missing file", catNotFound: "cat: {file}: not found", notADir: "cd: {dir}: not a directory",
    gitNoFolder: "the emulated terminal only knows the git of a folder open in the desktop app",
    staged: "{n} file(s) staged", checkoutFailed: "could not switch to '{branch}'", notFlow: "you are not on a gitflow branch",
    noRemotes: "the emulated terminal does not talk to remotes — push from the real terminal of the desktop app",
    noCluster: "the emulated terminal does not talk to the cluster — the real kubectl runs in the desktop app's terminal",
    noContainers: "the emulated terminal does not start containers — use «Attach» in Infra in the desktop app",
  },
  ptAO: {
    banner: "terminal emulado", bannerNote: "· só os ficheiros e o git deste workspace · o terminal real está na app desktop · ",
    notFound: "{cmd}: comando não encontrado", notFoundNote: "— este terminal emulado só navega nos ficheiros e no git; o terminal real está na app desktop",
    catMissing: "cat: falta o ficheiro", catNotFound: "cat: {file}: não encontrado", notADir: "cd: {dir}: não é um directório",
    gitNoFolder: "o terminal emulado só conhece o git de uma pasta aberta na app desktop",
    staged: "{n} ficheiro(s) em stage", checkoutFailed: "não foi possível mudar para '{branch}'", notFlow: "não estás num ramo de gitflow",
    noRemotes: "o terminal emulado não fala com remotos — faz o push no terminal real da app desktop",
    noCluster: "o terminal emulado não fala com o cluster — o kubectl real corre no terminal da app desktop",
    noContainers: "o terminal emulado não arranca contentores — usa «Attach» em Infra na app desktop",
  },
} satisfies Messages<string>;
