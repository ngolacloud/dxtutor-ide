/* Texto NOVO do item da build na barra de estado (app/build-info.ts, r23 F1): o i18n.catalogs.test verifica-lhe só a estrutura. */
import type { Messages } from "./i18n";

export const BUILD_INFO_MESSAGES = {
  en: { title: "Build {label} · {date}", titleDirty: "Build {label} · {date} · built with uncommitted changes" },
  ptAO: { title: "Build {label} · {date}", titleDirty: "Build {label} · {date} · feita com alterações por commitar" },
} satisfies Messages<string>;
