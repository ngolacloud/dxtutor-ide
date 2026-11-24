/* ═════════ dxtutor IDE — feature: checkpoints Git-aware + Gitflow ═════════
   Feature-folha da reestruturação por funcionalidade. Tipada a sério (strict,
   SEM @ts-nocheck) — é quase-pura: só manipula o estado partilhado FS/GIT/
   BRANCH/CKPT/STAGED (donos do monólito/scm.ts/codev.ts, lidos por nome livre,
   ambiente declarado em pair.ts/bridge.ts) e o DOM via `$` do core.

   `checkpoint`/`restoreCkpt` tiram e restauram uma fotografia de FS+GIT+BRANCH
   antes/depois de cada missão ou correcção do Co-Dev (CKPT, dono = features/
   codev.ts). `gfAsk` propõe fechar o ramo gitflow aberto depois de uma missão
   entregue — só se não houver alterações por commitar.

   Shim transitório: publica checkpoint/restoreCkpt/gfAsk no window, porque o
   resíduo (CMD «Restaurar último checkpoint», onclick inline nos painéis
   Co-Dev/scm, e o motor de missões em features/codev.ts) resolve-os por nome
   livre. GOTCHA C: as defs saíram do monólito `app.ts`, por isso a entrada
   checkpoint/restoreCkpt/gfAsk saiu também do Object.assign(window,…) de
   app.ts (senão ReferenceError travava o chunk). */

import { $, esc, hhmm, log, toast } from "../core";
import { translator } from "../app/i18n";
import { CHECKPOINT_MESSAGES } from "./checkpoint.messages";
import { services } from "../app/services";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(CHECKPOINT_MESSAGES);

let CID = 0;

/** Tira uma fotografia de FS+GIT+BRANCH, identificada por `label`; devolve o id. */
function checkpoint(label: string): number {
  const c = { id: ++CID, label, t: hhmm(), fs: JSON.stringify(FS), git: JSON.stringify(GIT), br: BRANCH };
  CKPT.unshift(c);
  log("checkpoint", label);
  return c.id;
}

/** Restaura a fotografia `id`; `silent` evita o toast (usado em correcções internas). */
export function restoreCkpt(id: number, silent?: boolean): void {
  const c = CKPT.find((x) => x.id === id);
  if (!c) return;
  Object.keys(FS).forEach((k) => delete FS[k]);
  Object.assign(FS, JSON.parse(c.fs));
  Object.assign(GIT, JSON.parse(c.git));
  BRANCH = c.br;
  const el = $("#st-branch-l");
  if (el) el.textContent = BRANCH;
  STAGED.clear();
  refresh(false, true);
  termRefreshPrompt();
  log("checkpoint", "restaurado: " + c.label);
  if (!silent) toast("Restaurado: " + c.label);
}

/** O trecho de Mission que `gfAsk` precisa — o resto (decs/score/…) fica em codev.ts. */
interface GfAskMission {
  files: Set<string>;
}

/** No fim de uma missão entregue num ramo gitflow, propõe fechar o ramo — ou avisa
 *  que fica aberto se ainda houver alterações por commitar. */
export async function gfAsk(host: HTMLElement, M: GfAskMission): Promise<void> {
  const b = BRANCH;
  if (!/^(feature|fix)\//.test(b)) return;
  if ([...M.files].some((p) => stOf(p))) {
    host.insertAdjacentHTML("beforeend", `<p>${txt("gitflowTheBranch")} <code>${esc(b)}</code> ${txt("staysOpenWithUncommitted")}</p>`);
    return;
  }
  const go = MODE === "auto" ? 1 : await ask(host, [
    { l: `Finalizar: merge de ${b} em develop`, v: 1, pri: 1, done: "✓ merge aprovado por ti" },
    { l: "Manter o ramo aberto", v: 0, done: "ramo mantido" },
  ]);
  if (go) {
    const m = gfFinish(b);
    if (m) host.insertAdjacentHTML("beforeend", `<p>Gitflow: <code>${esc(b)}</code> → <code>develop</code> (merge <code>${esc(m.h)}</code>${txt("branchDeletedTheRelease")} <code>main</code> ${txt("alwaysStaysWithYou")}</p>`);
  }
}

Object.assign(window, { checkpoint });
/* a ponte do Co-Dev (avalia antes) restaura pelo registo (ADR-0004, U7h) */
services.checkpoint = { restoreCkpt };
