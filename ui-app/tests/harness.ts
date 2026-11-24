import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import { applySampleWorkspace } from "./fixtures/sample-workspace";
import { applySampleHistory } from "./fixtures/sample-history";

// A ordem de arranque vem do src/main.ts (o ponto de entrada único — ADR-0004, U1),
// até app.ts inclusive: uma só fonte de verdade, em vez de uma cópia da lista aqui.
// startup/bridge/pair/panel ficam de fora (o v5/v6 já não existem — ADR-0004, U4g7): nada no que os goldens caracterizam
// depende deles, e trazê-los juntaria a cadeia de arranque completa (temporizadores,
// ponte Tauri) sem necessidade para caracterizar o comportamento actual.
const MAIN_TS = readFileSync(resolve(__dirname, "../src/main.ts"), "utf-8");
const ALL_MODULES = [...MAIN_TS.matchAll(/^import "\.\/([^"]+)";$/gm)].map((m) =>
  m[1] === "app/store" ? "../src/app/store/index.ts" : `../src/${m[1]}.ts`,
);
const MODULE_CHAIN = ALL_MODULES.slice(0, ALL_MODULES.indexOf("../src/app.ts") + 1);
if (MODULE_CHAIN.length < 30 || MODULE_CHAIN[0] !== "../src/app/store/index.ts" || MODULE_CHAIN[1] !== "../src/boot.ts" || MODULE_CHAIN.at(-1) !== "../src/app.ts") {
  throw new Error(`harness: a ordem lida do main.ts não é a esperada (${MODULE_CHAIN.length} módulos)`);
}

const INDEX_HTML = readFileSync(resolve(__dirname, "../index.html"), "utf-8");
const BODY = INDEX_HTML.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";

/** Repõe o esqueleto HTML real e reimporta a cadeia de módulos do zero, para
 * que cada teste arranque com um estado do Co-Dev limpo (FS, MISSIONS, DECS,
 * CKPT, RUN, ...), tal como aconteceria num refresh da página. */
export async function bootApp(): Promise<typeof window> {
  vi.resetModules();
  document.open();
  document.write(`<!doctype html><html><head></head><body>${BODY}</body></html>`);
  document.close();
  for (const mod of MODULE_CHAIN) {
    await import(/* @vite-ignore */ mod);
  }
  const w = window as any;
  w.resetWorkspace();
  applySampleWorkspace(w); // o projecto-exemplo é dado de teste (ADR-0005, R1a)
  w.gitInit(); // o modelo git de um workspace sem repositório (vazio)
  applySampleHistory(w); // o histórico do projecto-exemplo + espelho ligado, como se a pasta fosse um repo (ADR-0005, R1d)
  return window;
}

/* Regra de stripping dos goldens (Fase 0 do prompt de refactor): só estes
 * atributos são removidos antes de comparar — onclick/onchange/oninput (ligam
 * a window.* por nome livre, mudam na Fase 4 para data-action) e data-action/
 * data-on (os parâmetros de acção já planeados para a Fase 4). `data-ic`
 * (nome do ícone, consumido por hydrate()) NÃO é um parâmetro de acção e por
 * isso fica — nada mais é normalizado. */
const STRIPPED_ATTRS = ["onclick", "onchange", "oninput", "data-action", "data-on"];

export function golden(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const node of [clone, ...Array.from(clone.querySelectorAll("*"))]) {
    for (const attr of STRIPPED_ATTRS) node.removeAttribute(attr);
  }
  return clone.innerHTML;
}
