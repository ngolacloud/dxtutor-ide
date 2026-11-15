import { defineConfig } from "vite";

// The new dxtutor desktop frontend, built fresh with the v7 look but ZERO demo theatre —
// every surface talks to the real Tauri backend. Built in parallel to desktop/ui (the
// current served UI) until it reaches parity; node_modules is shared from desktop/.
export default defineConfig({
  root: __dirname,
  clearScreen: false,
  server: { port: 5190, strictPort: true },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/monaco-editor")) return "monaco";
          return undefined;
        },
      },
    },
  },
});
