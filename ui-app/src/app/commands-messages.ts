/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "./i18n";

export const COMMANDS_MESSAGES = {
  en: {
    theme: "Preferences: Theme — {name}", themeGrafite: "Graphite orange", themeSlate: "Slate indigo", themePapel: "Light paper", about: "dxtutor IDE · prototype v2",
  },
  ptAO: {
    theme: "Preferências: Tema — {name}", themeGrafite: "Grafite laranja", themeSlate: "Slate índigo", themePapel: "Papel claro", about: "dxtutor IDE · protótipo v2",
  },
} satisfies Messages<string>;

/** O nome de um tema na língua da interface (o id do tema — a chave de `THEMES`, gravada nas definições — não muda). */
export const THEME_LABEL: Record<string, "themeGrafite" | "themeSlate" | "themePapel"> = {
  "Grafite laranja": "themeGrafite", "Slate índigo": "themeSlate", "Papel claro": "themePapel",
};
