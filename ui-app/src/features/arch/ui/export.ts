/* ═════════ feature `arch` — exportação SVG e PNG (a porta Renderer) ═════════
   O SVG exportado é o MESMO do canvas (`canvasSvg`), tornado autónomo: as variáveis CSS do
   tema passam a cores fixas (abre em qualquer visualizador, não só num browser com o tema
   carregado), sai a grelha de pontos, saem as áreas de clique e os atributos de interacção,
   e entra um fundo sólido. O PNG desenha esse SVG num <canvas> a 2×. Sem window. */

import type { Renderer } from "../application/ports";
import type { Design } from "../domain/types";
import { canvasSvg } from "./view";

/** As variáveis do tema que o canvas usa. */
export const THEME_VARS = [
  "--bg-base", "--bg-elevated", "--bg-hover", "--border-strong", "--fg", "--fg-dim", "--fg-muted",
  "--accent", "--green", "--guide", "--font-ui", "--font-mono",
] as const;

/** Os valores do tema escuro por omissão (styles.css), para quando o tema não responde. */
const FALLBACK: Record<string, string> = {
  "--bg-base": "#0f0f11", "--bg-elevated": "#1b1b1e", "--bg-hover": "#242428", "--border-strong": "#37373c",
  "--fg": "#e8e8ea", "--fg-dim": "#8a8a90", "--fg-muted": "#6e6e75", "--accent": "#e06c3b", "--green": "#5cc9a7",
  "--guide": "#2f2f34", "--font-ui": "Inter, -apple-system, 'Segoe UI', system-ui, Roboto, sans-serif",
  "--font-mono": "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
};

/** O SVG autónomo do desenho, com as cores do tema resolvidas. */
export function standaloneSvg(d: Design, vars: Record<string, string>): { svg: string; w: number; h: number } {
  const { svg, bounds: b } = canvasSvg(d, {}, null);
  const value = (name: string): string => (vars[name] || FALLBACK[name] || "#888888").replace(/"/g, "'");
  const body = svg
    .replace(/<pattern id="arch-grid"[\s\S]*?<\/pattern>/, "")
    .replace(/<rect [^>]*fill="url\(#arch-grid\)"\/>/, "")
    .replace(/<path [^>]*stroke="transparent"[^>]*\/>/g, "")
    .replace(/ data-[a-z]+="[^"]*"/g, "")
    .replace(/ style="cursor:[^"]*"/g, "")
    .replace(/var\((--[a-z-]+)\)/g, (_, n: string) => value(n));
  const out = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w}" height="${b.h}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">` +
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${value("--bg-base")}"/>${body}</svg>\n`;
  return { svg: out, w: b.w, h: b.h };
}

/** Desenha um SVG num <canvas> e devolve os bytes PNG. */
export async function svgToPng(svg: string, w: number, h: number, scale = 2): Promise<Uint8Array> {
  const img = new Image();
  await new Promise<void>((ok, ko) => {
    img.addEventListener("load", () => ok());
    img.addEventListener("error", () => ko(new Error("the SVG could not be rendered as an image")));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas to draw the PNG");
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) throw new Error("the PNG could not be encoded");
  return new Uint8Array(await blob.arrayBuffer());
}

/** A porta Renderer, com as cores do tema lidas no acto. */
export function makeRenderer(theme: () => Record<string, string>): Renderer {
  return {
    svg: (d) => standaloneSvg(d, theme()).svg,
    png: async (d) => {
      const { svg, w, h } = standaloneSvg(d, theme());
      return svgToPng(svg, w, h);
    },
  };
}
