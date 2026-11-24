/* ═════════ feature `arch` — raiz de composição (Studio de arquitectura de sistema) ═════════
   Liga os adaptadores (gateway Tauri + bridge do window) ao caso de uso e à vista, regista
   o separador `VIEW.arch` e instala o listener delegado. Quem abre o Studio importa
   `openArch` (app.ts: menu «Project» e paleta de comandos) — não há global no window.

   É uma feature NOVA, separada do Studio do catálogo cloud (features/studio.ts), que
   continua a alimentar os geradores e o «Generate backlog». A base é o canvas de eventos
   do antigo ui-next (removido em e2a89b3), agora tipado e em camadas. */

import { VIEW } from "../../app/store/registry";
import { makeArchStudio } from "./application/studio";
import type { Repaint } from "./application/ports";
import { makeArchView } from "./ui/view";
import { bindActions } from "./ui/actions";
import { archActions } from "./ui/table";
import { tauriArchGateway } from "./infrastructure/tauri";
import { designStore, openTab, workspace } from "./infrastructure/legacy-bridge";

let view: ReturnType<typeof makeArchView> | null = null;
const studio = makeArchStudio({
  gateway: tauriArchGateway,
  store: designStore,
  workspace,
  repaint: (scope: Repaint) => view?.repaint(scope),
});
view = makeArchView({ studio, root: workspace.root });

VIEW.arch = (_t, host) => view!.mount(host);

bindActions(archActions(studio, workspace.prompt));

/** Abre (ou foca) o separador do Studio de arquitectura. */
export function openArch(): void {
  openTab({ id: "arch", title: "Architecture", kind: "arch" });
}

/** Para testes e para o harness (F6): o caso de uso composto. */
export const archStudio = studio;
