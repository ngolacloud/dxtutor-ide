/* ═════════ notas para a documentação oficial — registo ═════════
   As features que já têm notas, pela ordem do documento. Uma feature nova (ou que passa a ter
   notas) acrescenta-se aqui com o seu `features/<f>/notes.ts`.

   `PENDING`: acções da barra do editor que ainda não têm nota. A lista só encolhe: o teste
   reprova uma acção nova da barra sem nota, e também uma acção que já tem nota mas continua aqui. */

import type { FeatureNotes } from "./types";
import { CODEREVIEW_NOTES } from "../../features/codereview/notes";
import { BOARD_NOTES } from "../../features/board/notes";
import { LSP_NOTES } from "../../features/lsp/notes";
import { TESTING_NOTES } from "../../features/testing/notes";
import { CODEV_NOTES } from "../../features/codev/notes";
import { PROJECT_NOTES } from "../../features/project/notes";
import { OPS_NOTES, PLATFORM_NOTES } from "../../features/ops/notes";
import { VAULT_NOTES } from "../../features/vault/notes";
import { DEPLOY_NOTES } from "../../features/deploy/notes";
import { PROTECT_NOTES } from "../../features/protect/notes";
import { LEARN_NOTES } from "../../features/learn/notes";
import { INTEGRATION_NOTES } from "../../features/integration/notes";

export const NOTES: FeatureNotes[] = [
  CODEV_NOTES, INTEGRATION_NOTES, CODEREVIEW_NOTES, BOARD_NOTES, PROJECT_NOTES, TESTING_NOTES, LSP_NOTES,
  /* r23 F4–F5 */
  PROTECT_NOTES, OPS_NOTES, PLATFORM_NOTES, VAULT_NOTES, DEPLOY_NOTES,
  LEARN_NOTES,
];

export const PENDING: string[] = ["tabs:startDebug", "tabs:dxRun"];
