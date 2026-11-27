/* ═════════ feature `newproject` — raiz de composição (New Project) ═════════
   O mesmo princípio do `delonix init -t`, com os mesmos templates (embutidos pelo `tutor-scaffold`): um modal
   como o do Learning Track, o plano do backend aprovado no diálogo partilhado, o projecto criado (git em `main`,
   `chore: scaffold`, auditado) e aberto como workspace. Quem o abre importa `openNewProject` (boas-vindas, menu
   File, paleta). */

import { translator } from "../../app/i18n";
import { requestApproval } from "../../app/approval";
import { makeNewProject } from "./application/new-project";
import { parentOf } from "./domain/catalog";
import { NEW_PROJECT_MESSAGES } from "./ui/messages";
import { mountNewProject } from "./ui/view";
import { tauriScaffold, pickFolder } from "./infrastructure/tauri";
import { home, openFolder, openRoot } from "./infrastructure/legacy-bridge";

const t = translator(NEW_PROJECT_MESSAGES);

export const newProject = makeNewProject({
  scaffold: tauriScaffold(),
  workspace: {
    defaultParent: () => { const r = openRoot(); return r ? parentOf(r) : home(); },
    pickFolder,
    open: openFolder,
  },
  human: { approve: (r) => requestApproval(r) },
  copy: (k, p) => t(k, p),
});
mountNewProject(newProject, t);

/** Abre o diálogo New Project. */
export function openNewProject(): void {
  newProject.open();
}
