import { defineConfig } from "vite";

// Fase 0 do refactor Co-Dev (rede de segurança): corre os testes de caracterização
// e os goldens sobre o código REAL de app.ts/core.ts/features/*.ts, sem os reescrever.
// VITE_SEED=1 fixo aqui (não no ambiente): os testes precisam do workspace semeado
// para exercitar as missões de demonstração do Co-Dev (cenário a/b).
// Fuso horário fixo: os goldens mostram horas locais (ex.: o transcript do Co-Dev) e foram
// gravados em UTC+1. Sem isto, uma máquina ou runner de CI noutro fuso (UTC) desenha
// «10:00» em vez de «11:00» e o golden falha sem o código ter mudado. Definido aqui, antes
// de os workers arrancarem, para que todos o herdem.
process.env.TZ = "Africa/Luanda";

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
    // os goldens e os testes de integração arrancam a app inteira (harness.ts): ~4-5 s com
    // a máquina carregada — o limite de 5 s por omissão dava falsos negativos (ADR-0004, U4c)
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
