/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "../app/i18n";

export const STUDIO_DESKTOP_MESSAGES = {
  en: { invalidDesign: ".dxtutor/studio.json is not a valid design — the Studio opens empty" },
  ptAO: { invalidDesign: ".dxtutor/studio.json não é um desenho válido — o Studio abre vazio" },
} satisfies Messages<string>;
