/* ═════════ dxtutor IDE — helpers puros publicados no window (ADR-0004, U4j3) ═════════
   O `esc`/`hhmm`/`rel`/`mdFull` são do core.ts (puro, sem efeitos no eval) e os módulos tipados
   importam-nos de lá. Ainda há quem os leia pelo global (fachadas `G.rel`/`bridge.hhmm`, o
   learn.ts e o pair.ts por nome livre); este módulo publica-os — era o fim do app.ts. Shim de
   transição: a U7 remove-o quando esses consumidores importarem do core. */

import { esc, rel, mdFull } from "../core";

Object.assign(window, { esc, rel, mdFull });

export {};
