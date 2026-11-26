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
      /* a faixa de servidor em falta (LSP P3): as maneiras que o backend construiu, a escolhida com o seu
         comando exacto e uma frase; «Install» só para uma maneira que o dxtutor corre (apt/brew: «Copy») */
      const L = n.labels;
      const ways = n.ways ?? [];
      const sel = ways.find((w) => w.id === n.way) ?? ways[0];
      const pick = ways.length > 1
        ? `<select class="lsp-way" aria-label="${esc(L?.way ?? "Way to install")}">${ways.map((w) => `<option value="${esc(w.id)}"${w === sel ? " selected" : ""}${w.available ? "" : " disabled"}>${esc(w.label)}</option>`).join("")}</select> `
        : sel ? `<span class="lsp-way-one">${esc(sel.label)}</span> ` : "";
      const shown = sel ? sel.shown : (n.install ?? "");
      el.innerHTML = `<b>⚠ ${esc(n.title)}</b><span class="lsp-detail">${esc(n.detail)}</span><span class="lsp-install">${esc(L?.toInstall ?? "To install:")} ${pick}<code>${esc(shown)}</code></span>${sel ? `<span class="lsp-way-note">${esc(sel.note)}</span>` : ""}${hint}<span class="lsp-acts">${acts?.copy ? `<button class="mini" type="button" data-k="copy">${esc(L?.copy ?? "Copy")}</button>` : ""}${acts?.install ? `<button class="mini pri" type="button" data-k="install" title="${esc(L?.installTip ?? "")}">${esc(L?.install ?? "Install")}</button>` : ""}${acts?.recheck ? `<button class="mini" type="button" data-k="recheck">${esc(L?.recheck ?? "Check again")}</button>` : ""}${acts?.configure ? `<button class="mini" type="button" data-k="configure">${esc(L?.configure ?? t("configure"))}</button>` : ""}<button class="mini" type="button" data-k="dismiss">${esc(L?.dismiss ?? "Dismiss")}</button></span>`;
      let current = sel?.id ?? null;
      const installBtn = el.querySelector('[data-k="install"]') as HTMLButtonElement | null;
      const sync = (): void => {
        const w = ways.find((x) => x.id === current);
        if (installBtn) installBtn.hidden = !w?.runnable;
        if (w) {
          el.querySelector(".lsp-install code")!.textContent = w.shown;
          const note = el.querySelector(".lsp-way-note");
          if (note) note.textContent = w.note;
        }
      };
      sync();
      el.querySelector(".lsp-way")?.addEventListener("change", (e) => { current = (e.target as HTMLSelectElement).value; sync(); });
      el.querySelector('[data-k="copy"]')?.addEventListener("click", () => acts?.copy?.(current));
      installBtn?.addEventListener("click", () => { if (current) acts?.install?.(current); });
      el.querySelector('[data-k="recheck"]')?.addEventListener("click", () => acts?.recheck?.());
    }
    el.querySelector('[data-k="dismiss"]')!.addEventListener("click", () => { el.remove(); onDismiss?.(); });
    el.querySelector('[data-k="configure"]')?.addEventListener("click", () => acts?.configure?.());
    el.querySelector('[data-k="review"]')?.addEventListener("click", () => acts?.review?.());
    ed.parentElement.insertBefore(el, ed);
  },
};

/** Uma pasta abriu (o `dx:workspace` do desktop, depois de fechar os separadores da anterior). */
export function onFolderOpened(cb: (root: string) => void): void {
  document.addEventListener("dx:workspace", (e) => {
    const root = (e as CustomEvent<{ root?: unknown }>).detail?.root;
    if (typeof root === "string" && root) cb(root);
  });
}

/** Corre a linha de um plano de instalação num terminal de tarefa (no desktop, um PTY: `sh -c`, na pasta e
 *  com o ambiente do plano — o PATH da shell de login, para o `npm` achar o node do nvm) e resolve com o
 *  código de saída; sem terminais reais, `-1`. */
export const runTerminalTask = async (command: string, cwd: string, env: Record<string, string>, label: string): Promise<number> => {
  const term = (G as unknown as { DXR?: { term?: { runTask?: (c: string, o?: { cwd?: string; label?: string; env?: Record<string, string> }) => Promise<number> } } }).DXR?.term;
  if (term?.runTask) return term.runTask(command, { cwd, label, env });
  return -1;
};
