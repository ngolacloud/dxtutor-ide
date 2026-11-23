import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";

// A ordem de arranque vem do src/main.ts (o ponto de entrada único — ADR-0004, U1),
// até app.ts inclusive: uma só fonte de verdade, em vez de uma cópia da lista aqui.
// v5/v6/startup/bridge/pair/panel ficam de fora: nada no que os goldens caracterizam
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
  (window as any).loadSeed();
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

/** Atravessa um fluxo interactivo do Co-Dev até à resolução, clicando sempre no
 * primeiro botão do gate que aparecer — sem assumir quantos gates vai haver.
 * Usa temporizadores falsos (já activos no beforeEach do ficheiro que chama
 * isto); nunca espera relógio real. */
export async function driveToCompletion(p: Promise<unknown>, rounds = 80): Promise<void> {
  let done = false;
  p.finally(() => {
    done = true;
  });
  for (let i = 0; i < rounds && !done; i++) {
    await vi.advanceTimersByTimeAsync(500);
    if (done) break;
    // só os botões de `ask()` — criados via `.onclick=fn` (propriedade JS, sem
    // atributo HTML) — são um gate real a bloquear a promessa. Os cartões de
    // entrega também têm uma `.gate` decorativa (atalhos, não aprovação): dantes
    // com `onclick="goPane(...)"`, desde a Fase 4 com `data-action` servido pelo
    // listener delegado. Clicar nesses não desbloqueia nada e dispararia a
    // navegação, por isso excluem-se por AMBOS os atributos.
    const btn = document.querySelector("#ag-msgs .gate .gb:not([onclick]):not([data-action])") as HTMLButtonElement | null;
    if (btn) btn.click();
  }
  await p;
}

/** Igual a `driveToCompletion`, mas para entradas como `demo()` que não
 * devolvem a promessa de `runMission` — observa `window.RUN.active` (fica
 * `false` quando a missão termina, com sucesso, erro ou parada). */
export async function driveUntilRunEnds(w: any, rounds = 80): Promise<void> {
  for (let i = 0; i < rounds && w.RUN.active; i++) {
    await vi.advanceTimersByTimeAsync(500);
    if (!w.RUN.active) break;
    // só os botões de `ask()` — criados via `.onclick=fn` (propriedade JS, sem
    // atributo HTML) — são um gate real a bloquear a promessa. Os cartões de
    // entrega também têm uma `.gate` decorativa (atalhos, não aprovação): dantes
    // com `onclick="goPane(...)"`, desde a Fase 4 com `data-action` servido pelo
    // listener delegado. Clicar nesses não desbloqueia nada e dispararia a
    // navegação, por isso excluem-se por AMBOS os atributos.
    const btn = document.querySelector("#ag-msgs .gate .gb:not([onclick]):not([data-action])") as HTMLButtonElement | null;
    if (btn) btn.click();
  }
}
