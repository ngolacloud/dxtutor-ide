import { defineConfig } from "vite";

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
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
