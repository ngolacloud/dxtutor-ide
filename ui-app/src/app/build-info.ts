/* ═════════ a build na barra de estado (r23 F1: «the status bar shows the build») ═════════
   A versão, o commit e a data vêm do `ui:build` (o `define` do vite.config.ts). Nos testes (o vitest não usa
   esse config) e sem git, fica `dev`. Um item `#st-build` à direita da barra de estado; o título diz o resto. */

import { esc } from "../core";
import { translator } from "./i18n";
import { BUILD_INFO_MESSAGES } from "./build-info.messages";

declare const __DXT_BUILD__: { version: string; commit: string; dirty: boolean; date: string } | undefined;

export interface BuildInfo { version: string; commit: string; dirty: boolean; date: string }

export const BUILD: BuildInfo = typeof __DXT_BUILD__ !== "undefined" ? __DXT_BUILD__ : { version: "dev", commit: "", dirty: false, date: "" };

/** `0.7.0 · 5ea8115*` (o `*` marca uma árvore com alterações por commitar). */
export const buildLabel = (b: BuildInfo = BUILD): string => (b.commit ? `${b.version} · ${b.commit}${b.dirty ? "*" : ""}` : b.version);

/** Põe a build na barra de estado (uma vez); `version` é a da app desktop quando a há (app_info). */
export function mountBuildBadge(version?: string): void {
  const bar = document.getElementById("st-bell")?.parentElement;
  if (!bar) return;
  const b: BuildInfo = version ? { ...BUILD, version } : BUILD;
  const t = translator(BUILD_INFO_MESSAGES);
  const title = t(b.dirty ? "titleDirty" : "title", { label: buildLabel(b), date: b.date ? b.date.slice(0, 16).replace("T", " ") + " UTC" : "—" });
  const html = `<span class="si opt" id="st-build" title="${esc(title)}">${esc(buildLabel(b))}</span>`;
  const old = document.getElementById("st-build");
  if (old) old.outerHTML = html; else document.getElementById("st-bell")!.insertAdjacentHTML("beforebegin", html);
}
