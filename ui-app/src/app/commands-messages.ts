/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "./i18n";

export const COMMANDS_MESSAGES = {
  en: { theme: "Preferences: Theme — {name}", about: "dxtutor IDE · prototype v2", containersNote: "Containers and images come from the Docker or Podman connected in Infra, in the desktop app." },
  ptAO: { theme: "Preferências: Tema — {name}", about: "dxtutor IDE · protótipo v2", containersNote: "Os contentores e as imagens vêm do Docker ou do Podman ligado em Infra, na app desktop." },
} satisfies Messages<string>;
