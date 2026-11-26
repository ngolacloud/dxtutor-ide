/* ═════════ notas para a documentação oficial — registo ═════════
   As features que já têm notas, pela ordem do documento. Uma feature nova (ou que passa a ter
   notas) acrescenta-se aqui com o seu `features/<f>/notes.ts`.

   `PENDING`: acções da barra do editor que ainda não têm nota. A lista só encolhe: o teste
   reprova uma acção nova da barra sem nota, e também uma acção que já tem nota mas continua aqui. */

import type { FeatureNotes } from "./types";
import { CODEREVIEW_NOTES } from "../../features/codereview/notes";
import { LSP_NOTES } from "../../features/lsp/notes";
import { TESTING_NOTES } from "../../features/testing/notes";
import { CODEV_NOTES } from "../../features/codev/notes";

export const NOTES: FeatureNotes[] = [CODEV_NOTES, CODEREVIEW_NOTES, TESTING_NOTES, LSP_NOTES];

export const PENDING: string[] = ["tabs:startDebug", "tabs:dxRun"];
