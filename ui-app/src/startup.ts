/* ═════════ dxtutor IDE — startup (arranque da cadeia de módulos) ═════════
   A sequência de arranque `boot → boot3 → … → boot7 → i18nBoot` corre aqui, no módulo
   que o main.ts importa DEPOIS do app/boot-steps.ts e ANTES do bridge.ts, do pair.ts e do painel.
   Porquê esta posição: o arranque só pode correr quando todos os donos publicaram os seus
   bootN no window (o app/boot-steps.ts é o último a avaliar antes daqui); e o bridge/pair/painel contam
   com a app já arrancada quando avaliam. Com imports estáticos não dá para intercalar
   chamadas no main.ts — por isso o arranque continua a ser um módulo da cadeia.

   ADR-0004, U4a: tipado (era @ts-nocheck). Cada passo é uma função publicada no window
   pelo seu dono (app/boot-steps.ts — boot/boot3–boot6 —, visualizer, i18n); um passo em falta é um
   erro claro. (O boot5/boot6 eram das camadas v5/v6; ADR-0004, U4g7.) */

import { mountBuildBadge } from "./app/build-info";

const STEPS = ["boot", "boot3", "boot4", "boot5", "boot6", "boot7", "i18nBoot"] as const;

const W = window as unknown as Record<(typeof STEPS)[number], (() => void) | undefined>;

for (const step of STEPS) {
  const run = W[step];
  if (typeof run !== "function") throw new Error(`arranque: o passo ${step} não foi publicado no window`);
  run();
}

/* r23 F1: a build na barra de estado (a versão da app desktop substitui-a quando o bridge a lê) */
mountBuildBadge();

export {};
