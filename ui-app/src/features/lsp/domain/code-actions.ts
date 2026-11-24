/* ═════════ feature `lsp` — code actions (correcções e refactorings) ═════════
   A resposta de `textDocument/codeAction` é uma lista de `CodeAction` (com `edit` e/ou
   `command`) ou de `Command` simples. Aqui viram uma forma só, ordenada para o menu: as
   correcções (`quickfix`) primeiro — a preferida à frente —, depois refactorings, depois
   acções de código-fonte. Também reconhece os comandos que são só «aplica esta edição» (ex.
   `java.apply.workspaceEdit` do jdtls), que a UI aplica sem ir ao servidor. PURO. */

export interface CodeActionItem {
  title: string;
  /** `quickfix`, `refactor.extract`, `source.organizeImports`… (`""` se o servidor não diz). */
  kind: string;
  preferred: boolean;
  /** Razão por que a acção está desactivada (o menu mostra-a mas não a aplica). */
  disabled: string | null;
  /** A `WorkspaceEdit` a aplicar (`null` se a acção é só um comando). */
  edit: unknown | null;
  /** O comando a executar no servidor depois da edição (ou em vez dela). */
  command: { command: string; arguments: unknown[] | null } | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function asCommand(v: unknown): CodeActionItem["command"] {
  if (!isObj(v) || typeof v.command !== "string") return null;
  return { command: v.command, arguments: Array.isArray(v.arguments) ? v.arguments : null };
}

/** Ordem no menu: preferida, correcções, refactorings, código-fonte, o resto. */
function rank(a: CodeActionItem): number {
  if (a.preferred) return 0;
  if (a.kind.startsWith("quickfix")) return 1;
  if (a.kind.startsWith("refactor")) return 2;
  if (a.kind.startsWith("source")) return 3;
  return 4;
}

/** As acções da resposta, ordenadas para o menu (estável dentro de cada grupo). */
export function codeActionItems(result: unknown): CodeActionItem[] {
  if (!Array.isArray(result)) return [];
  const items = result.flatMap((a): CodeActionItem[] => {
    if (!isObj(a) || typeof a.title !== "string") return [];
    // um `Command` simples tem `command` em texto; uma `CodeAction` tem-no como objecto
    if (typeof a.command === "string") {
      return [{ title: a.title, kind: "", preferred: false, disabled: null, edit: null, command: asCommand(a) }];
    }
    return [{
      title: a.title,
      kind: typeof a.kind === "string" ? a.kind : "",
      preferred: a.isPreferred === true,
      disabled: isObj(a.disabled) && typeof a.disabled.reason === "string" ? a.disabled.reason : null,
      edit: isObj(a.edit) ? a.edit : null,
      command: asCommand(a.command),
    }];
  });
  return items.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map((x) => x.a);
}

/** Um comando que só transporta uma `WorkspaceEdit` para o cliente aplicar (ex.
 *  `java.apply.workspaceEdit`): devolve a edição; `null` se é um comando a sério. */
export function clientSideEdit(cmd: CodeActionItem["command"]): unknown | null {
  if (!cmd || !/apply\.?workspaceedit$/i.test(cmd.command)) return null;
  const arg = cmd.arguments?.[0];
  return isObj(arg) && (isObj(arg.changes) || Array.isArray(arg.documentChanges)) ? arg : null;
}

/** Uma etiqueta curta para o tipo da acção, no menu. */
export function kindLabel(kind: string): string {
  if (kind.startsWith("quickfix")) return "fix";
  if (kind.startsWith("refactor")) return "refactor";
  if (kind.startsWith("source")) return "source";
  return kind ? kind.split(".")[0] : "";
}
