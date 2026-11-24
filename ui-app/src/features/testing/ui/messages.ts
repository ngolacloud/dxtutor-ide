/* Textos do pane Testing — nasceram em português sem par no motor de tradução; com chave (ADR-0004, U6b): en + ptAO.
   Os valores ptAO são os textos de antes. */
import type { Messages } from "../../../app/i18n";

export const TESTING_MESSAGES = {
  en: {
    noFolder: "Open a folder (File → Open Folder…) to discover and run the project's tests.",
    searching: "Looking for tests…", noTests: "No Rust, Go or Python tests found in this folder.",
    noCommand: "No test command detected either. Define it in {file}.",
  },
  ptAO: {
    noFolder: "Abre uma pasta (File → Open Folder…) para descobrir e correr os testes do projecto.",
    searching: "A procurar testes…", noTests: "Não encontrei testes Rust, Go ou Python nesta pasta.",
    noCommand: "Também não detectei um comando de testes. Define-o em {file}.",
  },
} satisfies Messages<string>;
