import { defineConfig } from "vite";

// Fase 0 do refactor Co-Dev (rede de segurança): corre os testes de caracterização
// e os goldens sobre o código REAL de app.ts/core.ts/features/*.ts, sem os reescrever.
// O projecto-exemplo sobre o qual os goldens desenham é uma fixture de teste
// (tests/fixtures/sample-workspace.ts), aplicada pelo harness (ADR-0005, R1a).
// Fuso horário fixo: os goldens mostram horas locais (ex.: o transcript do Co-Dev) e foram
// gravados em UTC+1. Sem isto, uma máquina ou runner de CI noutro fuso (UTC) desenha
// «10:00» em vez de «11:00» e o golden falha sem o código ter mudado. Definido aqui, antes
// de os workers arrancarem, para que todos o herdem.
process.env.TZ = "Africa/Luanda";

export default defineConfig({
  root: import.meta.dirname,
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
