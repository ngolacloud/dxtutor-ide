import { defineConfig } from "vite";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* r23 F1: a build que a barra de estado mostra (app/build-info.ts) — a versão da app, o commit e se a árvore
   tinha alterações por commitar, fixados aqui no `ui:build` (o Tauri embute o dist em compile-time). */
const git = (args: string): string => {
  try { return execSync(`git ${args}`, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; }
};
const BUILD = {
  version: (JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf8")) as { version: string }).version,
  commit: git("rev-parse --short=7 HEAD"),
  dirty: git("status --porcelain --untracked-files=no") !== "",
  date: new Date().toISOString(),
};

// Componentização do monólito ui/ por fases. Fase 1: index.html tal-e-qual,
// <style> extraído para public/styles.css e os <script> inline movidos para
// public/boot.js + public/app.js — scripts clássicos que o vite não toca
// (o JS vive de globais — FS, ROOT, TABS, MENUS…). Fase 2: pair.js virou
// src/pair.ts, módulo ESM tipado embalado pelo vite. Fase 3: bridge.js virou
// src/bridge.ts, módulo ANTES do pair.ts — módulos são deferred e correm por
// ordem de documento depois dos clássicos, por isso converte-se sempre do fim
// da cadeia para o início, um por sessão. ui/ fica intocado como referência.
export default defineConfig({
  root: __dirname,
  clearScreen: false,
  server: { port: 5191, strictPort: true },
  define: { __DXT_BUILD__: JSON.stringify(BUILD) },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
