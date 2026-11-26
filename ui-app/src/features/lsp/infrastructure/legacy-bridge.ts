/* ═════════ feature `lsp`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/lsp/` autorizado a ler `window.*` (A8 do
   arch-check). Lê o workspace aberto pelo desktop (`DXR.root`), o prefixo das chaves
   (`ROOT`), o `FS` em memória e o separador activo (`cur` + `tabOf`); chama o pintor
   publicado (`paintEd`), o `openPath`, o `writeFile` (edições do rename; o autosave leva-as ao
   disco) e o `show` (volta a mostrar o ficheiro activo); acrescenta o «Go to Symbol» ao `CMD` da
   paleta. Não publica nada no `window`. Acessores lêem
   `window` NO ACTO (a pasta abre de forma assíncrona). */

import { toast, esc } from "../../../core";
import { translator } from "../../../app/i18n";
import { positionToOffset } from "../domain/positions";
import { LSP_OVERRIDE_MESSAGES } from "../application/override-messages";
import type { EditorPort, WorkspacePort } from "../application/ports";

interface Tab {
  kind?: string;
  path?: string;
}
interface Globals {
  DXR?: { root?: string | null };
  ROOT?: string;
  FS?: Record<string, { content: string } | undefined>;
  cur?: string | null;
  tabOf?: (id: string | null) => Tab | null | undefined;
  paintEd?: (key: string) => void;
  openPath?: (key: string, line?: number) => void;
  stPos?: () => void;
  writeFile?: (key: string, content: string) => void;
  show?: (id: string | null) => void;
  vsxFmt?: () => void;
  CMD?: [string, string, () => void, string?][];
}
const G = window as unknown as Globals;
const t = translator(LSP_OVERRIDE_MESSAGES);

/** Acrescenta uma entrada à paleta de comandos (o array `CMD` já publicado; não cria globais). */
export function addPaletteCommand(label: string, key: string, run: () => void): void {
  const cmd = G.CMD;
  if (cmd && !cmd.some((c) => c[0] === label)) cmd.push([label, key, run]);
}

function fileKeyOfTab(tabId: string | null): string | null {
  const t = G.tabOf?.(tabId);
  return t && t.kind === "file" && typeof t.path === "string" ? t.path : null;
}

export const workspace: WorkspacePort = {
  diskRoot: () => G.DXR?.root ?? null,
  virtualPrefix: () => String(G.ROOT ?? ""),
  fileKeyOfTab,
  currentFileKey: () => fileKeyOfTab(G.cur ?? null),
  text: (key) => G.FS?.[key]?.content ?? null,
};

export const editor: EditorPort = {
  repaint: (key) => {
    if (fileKeyOfTab(G.cur ?? null) === key && document.getElementById("ed-ta")) G.paintEd?.(key);
  },
  open: (key, line, character) => {
    G.openPath?.(key, line);
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    if (!ta) return;
    const o = positionToOffset(ta.value, { line: line - 1, character });
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(o, o);
    G.stPos?.();
  },
  notify: (message) => toast(message),
  writeFile: (key, text) => G.writeFile?.(key, text),
  reload: (key) => {
    if (fileKeyOfTab(G.cur ?? null) === key) G.show?.(G.cur ?? null);
  },
  replaceText: (key, text, caret) => {
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    if (!ta || fileKeyOfTab(G.cur ?? null) !== key) {
      G.writeFile?.(key, text);
      return;
    }
    ta.value = text;
    ta.setSelectionRange(caret, caret);
    // como uma edição: o editor actualiza o FS, repinta, e o servidor recebe o didChange
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  },
  builtinFormat: () => G.vsxFmt?.(),
  /* a faixa no topo da vista do ficheiro (antes do `.ed`): o servidor em falta, ou um servidor que o
     projecto pede e espera pela aprovação (`kind: "approval"`, com «Review…») */
  notice: (key, n, onDismiss, acts) => {
    if (fileKeyOfTab(G.cur ?? null) !== key) return;
    const ed = document.getElementById("ed-ta")?.closest(".ed");
    if (!ed || !ed.parentElement) return;
    ed.parentElement.querySelector(":scope > #lsp-missing")?.remove();
    if (!n) return;
    const el = document.createElement("div");
    el.id = "lsp-missing"; el.className = "lsp-missing"; el.setAttribute("role", "status");
    const hint = n.hint ? `<span class="lsp-hint">${esc(n.hint)}</span>` : "";
    if (n.kind === "approval") {
      el.classList.add("lsp-approval");
      el.innerHTML = `<b>⚠ ${esc(n.title)}</b><span class="lsp-detail">${esc(n.detail)}</span>${hint}<span class="lsp-acts">${acts?.review ? `<button class="mini pri" type="button" data-k="review">${esc(t("review"))}</button>` : ""}<button class="mini" type="button" data-k="dismiss">${esc(t("dismiss"))}</button></span>`;
    } else {
      el.innerHTML = `<b>⚠ ${esc(n.title)}</b><span class="lsp-detail">${esc(n.detail)}</span><span class="lsp-install">To install: <code>${esc(n.install ?? "")}</code></span>${hint}<span class="lsp-acts">${acts?.copy ? '<button class="mini" type="button" data-k="copy">Copy</button>' : ""}${acts?.install ? '<button class="mini pri" type="button" data-k="install" title="Runs the command in a terminal with your login shell (e.g. the node from nvm), after you approve it">Install</button>' : ""}${acts?.configure ? `<button class="mini" type="button" data-k="configure">${esc(t("configure"))}</button>` : ""}<button class="mini" type="button" data-k="dismiss">Dismiss</button></span>`;
    }
    el.querySelector('[data-k="dismiss"]')!.addEventListener("click", () => { el.remove(); onDismiss?.(); });
    el.querySelector('[data-k="copy"]')?.addEventListener("click", () => acts?.copy?.());
    el.querySelector('[data-k="install"]')?.addEventListener("click", () => acts?.install?.());
    el.querySelector('[data-k="configure"]')?.addEventListener("click", () => acts?.configure?.());
    el.querySelector('[data-k="review"]')?.addEventListener("click", () => acts?.review?.());
    ed.parentElement.insertBefore(el, ed);
  },
};

/** Corre um comando num terminal de tarefa (no desktop, um PTY com a shell de login — o `npm` do nvm,
 *  o `go`, o `dotnet`…) e resolve com o código de saída; sem terminais reais, `-1`. */
export const runTerminalTask = async (command: string, cwd: string): Promise<number> => {
  const term = (G as unknown as { DXR?: { term?: { runTask?: (c: string, o?: { cwd?: string; label?: string }) => Promise<number> } } }).DXR?.term;
  if (term?.runTask) return term.runTask(command, { cwd, label: command });
  return -1;
};
