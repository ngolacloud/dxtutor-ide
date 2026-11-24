/* ═════════ estilos da app (ADR-0004, U6a) ═════════
   O styles.css (servido do public/) partiu-se por dono: os tokens em app/styles/theme.css, a base partilhada
   em app/styles/base.css, a moldura em features/shell.css e cada feature no seu ficheiro, junto do código.
   ESTA LISTA É A ORDEM DA CASCATA: o Vite junta o CSS pela ordem dos imports. Foi escolhida para que nenhuma
   regra mude de efeito — cada par de regras que trocou de ordem foi analisado (mesma especificidade,
   propriedade em comum e sujeito que pode coincidir) e os estilos computados de todos os elementos, em 44
   estados da app, ficaram iguais aos do styles.css. Uma regra nova vai para o ficheiro do dono; se depender
   de ganhar a outra regra com a mesma especificidade noutro ficheiro, a ordem daqui conta.
   O codev/harness.css (separador «Co-Dev run») vem logo a seguir aos tokens, ANTES da base: a raiz do
   separador era `.hx` e apanhava o `<div class="rowline hx">` da página Team (reportado no ADR-0004, U6a).
   Desde o merge da A6 a raiz é `.hx-run` e a colisão acabou; a posição fica onde estava (já não decide nada). */
import "./styles/theme.css";
import "../features/codev/harness.css";
import "./styles/base.css";
import "../features/shell.css";
import "../features/explorer.css";
import "../features/editor.css";
import "../features/lsp/styles.css";
import "../features/terminal.css";
import "../features/diagnostics.css";
import "../features/codev/styles.css";
import "../features/project/styles.css";
import "../features/diff/styles.css";
import "../features/welcome.css";
import "../features/palette.css";
import "../features/notifications.css";
import "../features/scm/styles.css";
import "../features/graph.css";
import "../features/studio.css";
import "../features/board/styles.css";
import "../features/learn/styles.css";
import "../features/ext/styles.css";
import "../features/stack.css";
import "../features/infra/styles.css";
import "../features/team.css";
import "../features/tasks.css";
import "../features/debug/styles.css";
import "../features/codereview/styles.css";
import "../features/visualizer/styles.css";
import "../features/panel/styles.css";
/* A6: o pane Testing (runners, resultados, histórico); tudo sob #pane-test, a posição não decide nada */
import "../features/testing/styles.css";
/* A8: o «Under the hood» e o traço reais (prefixo hd-); a posição não decide nada */
import "../features/hood/styles.css";
/* A9: o separador Ops (prefixo ops-); a posição não decide nada */
import "../features/ops/styles.css";
