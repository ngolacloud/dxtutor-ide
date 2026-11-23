/* ═════════ dxtutor IDE — startup (arranque da cadeia de módulos) ═════════
   A sequência de arranque `boot → boot3 → … → boot7 → i18nBoot` corre aqui, no módulo
   que o main.ts importa DEPOIS do app.ts e das camadas v5/v6 e ANTES do bridge.ts, do
   pair.ts e do painel. Porquê esta posição: as camadas decoram funções do núcleo ao
   carregar (por isso carregam depois do app.ts, pela ordem v5→v6), mas o arranque só pode
   correr quando todas publicaram os seus bootN no window; e o bridge/pair/painel contam
   com a app já arrancada quando avaliam. Com imports estáticos não dá para intercalar
   chamadas no main.ts — por isso o arranque continua a ser um módulo da cadeia.

   ADR-0004, U4a: tipado (era @ts-nocheck). Cada passo é uma função publicada no window
   pelo seu dono (app.ts, v5, v6, visualizer, i18n); um passo em falta é um erro claro. */

const STEPS = ["boot", "boot3", "boot4", "boot5", "boot6", "boot7", "i18nBoot"] as const;

const W = window as unknown as Record<(typeof STEPS)[number], (() => void) | undefined>;

for (const step of STEPS) {
  const run = W[step];
  if (typeof run !== "function") throw new Error(`arranque: o passo ${step} não foi publicado no window`);
  run();
}

export {};
