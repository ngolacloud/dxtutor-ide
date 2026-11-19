import { defineConfig } from "vite";

// Fase 0 do refactor Co-Dev (rede de segurança): corre os testes de caracterização
// e os goldens sobre o código REAL de app.ts/core.ts/features/*.ts, sem os reescrever.
// VITE_SEED=1 fixo aqui (não no ambiente): os testes precisam do workspace semeado
// para exercitar as missões de demonstração do Co-Dev (cenário a/b).
export default defineConfig({
  root: import.meta.dirname,
  define: {
    "import.meta.env.VITE_SEED": JSON.stringify("1"),
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    isolate: true,
  },
});
