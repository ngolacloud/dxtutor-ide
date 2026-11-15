import { defineConfig } from "vite";

// Fase 1 da componentização do monólito ui/: embala o index.html tal-e-qual,
// com o <style> extraído para public/styles.css e os <script> inline movidos
// para public/boot.js + public/app.js. TUDO continua a ser script clássico
// (o JS vive de globais window — FS, ROOT, TABS, MENUS… — e pair.js
// re-atribui funções globais), por isso os ficheiros ficam em public/ e o
// vite não os toca; a conversão para módulos ESM tipados vem nas fases
// seguintes, um módulo por sessão. ui/ fica intocado como referência.
export default defineConfig({
  root: __dirname,
  clearScreen: false,
  server: { port: 5191, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
