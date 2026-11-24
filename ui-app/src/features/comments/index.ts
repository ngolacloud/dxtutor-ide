/* ═════════ dxtutor IDE — feature: comentários de linha para o Co-Dev ═════════
   Como no Antigravity: na margem do editor, um botão na linha sob o ponteiro abre «Start
   discussion» por baixo dela; «Add Comment to Chat» (ou Ctrl+Enter) põe o comentário no
   compositor do Co-Dev como um chip com o código dessas linhas, sem enviar — juntam-se vários
   e escreve-se o pedido. Com uma selecção que contém a linha, o comentário abrange-a toda.
   Raiz de composição: o caso de uso recebe o editor (infrastructure/editor) e o `codev.ask`
   partilhado (app/codev-ask); a UI liga-se ao rato e ao despachante. Corre no browser e na app. */

import { toast } from "../../core";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { makeLineComments } from "./application/line-comments";
import { domEditor } from "./infrastructure/editor";
import { bindCommentHooks } from "./ui/hooks";
import { COMMENT_MESSAGES } from "./ui/messages";

const t = translator(COMMENT_MESSAGES);

const comments = makeLineComments({
  editor: domEditor,
  ask: { available: () => codevAsk.available(), ask: (r) => codevAsk.ask(r) },
  words: () => ({ line: t("ctxLine"), lines: t("ctxLines"), comment: t("ctxComment") }),
});

bindCommentHooks({ comments, t, toast });
