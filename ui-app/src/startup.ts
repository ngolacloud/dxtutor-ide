// @ts-nocheck
/* ═════════ dxtutor IDE — startup (arranque da cadeia de módulos) ═════════
   Fase A da modularização: a sequência de arranque `boot();boot3()…boot7();i18nBoot()`
   que vivia no fim do app.ts foi separada para o ÚLTIMO módulo da cadeia (antes de
   bridge.ts/pair.ts). Porquê: as camadas v3–v6 decoram funções do núcleo (padrão
   `const _x=x; x=function…`), por isso têm de CARREGAR depois do app.ts (core) e na
   ordem v3→v4→v5→v6; mas o ARRANQUE (bootN) só pode correr quando TODAS publicaram
   os seus bootN no window. Mantendo a sequência aqui, a ordem de decoração (ordem de
   carga dos módulos) e a ordem de arranque (esta sequência explícita) ficam ambas
   correctas e desacopladas. boot/bootN/i18nBoot são referências livres resolvidas no
   window (publicadas pelo core e pelas camadas). @ts-nocheck: tipar fica para depois. */
export {};

boot();boot3();boot4();boot5();boot6();boot7();i18nBoot();
