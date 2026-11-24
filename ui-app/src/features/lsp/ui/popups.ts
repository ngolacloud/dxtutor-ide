/* ═════════ feature `lsp` — a lista de referências e a caixa de rename ═════════
   Dois cartões flutuantes junto ao cursor, donos do seu DOM (`#lsp-refs`, `#lsp-rename`):
     • referências (Shift+F12): uma linha por ocorrência (`ficheiro:linha` + o texto da linha);
       clicar, ou ↑/↓ + Enter, abre-a; Escape ou clicar fora fecha;
     • rename (F2): caixa com o nome actual seleccionado; Enter aplica, Escape cancela;
     • code actions (Ctrl+.): menu de correcções e refactorings (`#lsp-actions`);
     • Go to Symbol (Ctrl+Shift+O): os símbolos do ficheiro com um campo de filtro (`#lsp-symbols`);
     • Go to Symbol in Workspace (Ctrl+T): pesquisa nos servidores da pasta (`#lsp-wsymbols`).
   Listeners ligados aos elementos (sem `onclick` inline). Não toca em `window`. */

import type { Reference, WorkspaceSymbolResult, WorkspaceSymbolSearch } from "../application/lsp-client";
import { kindLabel, type CodeActionItem } from "../domain/code-actions";
import { filterSymbols, type SymbolEntry } from "../domain/symbols";

const CLOSERS = new Map<string, () => void>();

/** O menu de code actions junto a (x, y): uma linha por acção (tipo + título); Enter, clique
 *  ou ↑/↓ + Enter aplicam; Escape ou clicar fora fecham. As desactivadas mostram a razão. */
export function showActionMenu(actions: readonly CodeActionItem[], x: number, y: number, onPick: (a: CodeActionItem) => void, onClose: () => void): void {
  const el = floating("lsp-actions", "lsp-pop lsp-refs lsp-actions", x, y);
  const head = document.createElement("div");
  head.className = "lsp-pop-h";
  head.textContent = actions.length ? `${actions.length} action${actions.length === 1 ? "" : "s"}` : "No code actions here";
  el.appendChild(head);
  const rows = actions.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lsp-ref lsp-action" + (a.preferred ? " preferred" : "");
    b.disabled = !!a.disabled;
    if (a.disabled) b.title = a.disabled;
    const kind = document.createElement("span");
    kind.className = "lsp-act-kind";
    kind.textContent = kindLabel(a.kind);
    const title = document.createElement("span");
    title.className = "lsp-act-title";
    title.textContent = a.title;
    b.append(kind, title);
    b.addEventListener("click", () => {
      closePopup("lsp-actions");
      onPick(a);
    });
    el.appendChild(b);
    return b;
  });
  const enabled = rows.filter((b) => !b.disabled);
  enabled[0]?.focus();
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup("lsp-actions");
      onClose();
      return;
    }
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = enabled.length;
      if (n) enabled[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n].focus();
    }
  });
  const onDown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) closePopup("lsp-actions");
  };
  document.addEventListener("mousedown", onDown, true);
  CLOSERS.set("lsp-actions", () => document.removeEventListener("mousedown", onDown, true));
}

function floating(id: string, cls: string, x: number, y: number): HTMLElement {
  closePopup(id);
  const el = document.createElement("div");
  el.id = id;
  el.className = cls;
  document.body.appendChild(el);
  const place = (): void => {
    const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
    const r = el.getBoundingClientRect();
    el.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
    el.style.top = `${y + r.height > vh - 8 ? Math.max(8, y - r.height - 30) : y}px`;
  };
  queueMicrotask(place);
  return el;
}

/** Fecha um cartão (e larga os seus listeners globais). */
export function closePopup(id: string): void {
  CLOSERS.get(id)?.();
  CLOSERS.delete(id);
  document.getElementById(id)?.remove();
}

/** A lista de referências junto a (x, y). `onPick` recebe a referência escolhida. */
export function showReferences(refs: readonly Reference[], x: number, y: number, onPick: (r: Reference) => void, onClose: () => void): void {
  const el = floating("lsp-refs", "lsp-pop lsp-refs", x, y);
  const head = document.createElement("div");
  head.className = "lsp-pop-h";
  const files = new Set(refs.map((r) => r.label)).size;
  head.textContent = refs.length ? `${refs.length} reference${refs.length === 1 ? "" : "s"} in ${files} file${files === 1 ? "" : "s"}` : "No references found";
  el.appendChild(head);
  const rows: HTMLButtonElement[] = refs.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lsp-ref";
    b.disabled = !r.key;
    const where = document.createElement("span");
    where.className = "lsp-ref-w";
    where.textContent = `${r.label}:${r.line}`;
    const what = document.createElement("span");
    what.className = "lsp-ref-t";
    what.textContent = r.key ? r.preview : "outside this folder";
    b.append(where, what);
    b.addEventListener("click", () => {
      closePopup("lsp-refs");
      onPick(r);
    });
    el.appendChild(b);
    return b;
  });
  const enabled = rows.filter((b) => !b.disabled);
  enabled[0]?.focus();
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup("lsp-refs");
      onClose();
      return;
    }
    const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = enabled.length;
      if (n) enabled[(i + (e.key === "ArrowDown" ? 1 : n - 1) + n) % n].focus();
    }
  };
  const onDown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) closePopup("lsp-refs");
  };
  el.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDown, true);
  CLOSERS.set("lsp-refs", () => document.removeEventListener("mousedown", onDown, true));
}

/** A caixa de rename junto a (x, y), com `placeholder` seleccionado. */
export function showRenameBox(placeholder: string, x: number, y: number, onSubmit: (name: string) => void, onClose: () => void): void {
  const el = floating("lsp-rename", "lsp-pop lsp-rename", x, y);
  const input = document.createElement("input");
  input.className = "inp notr";
  input.value = placeholder;
  input.spellcheck = false;
  input.setAttribute("aria-label", "New name");
  const hint = document.createElement("div");
  hint.className = "lsp-pop-hint";
  hint.textContent = "Enter to rename · Esc to cancel";
  el.append(input, hint);
  input.focus();
  input.select();
  let done = false;
  const finish = (name: string | null): void => {
    if (done) return;
    done = true;
    closePopup("lsp-rename");
    onClose();
    if (name !== null && name.trim() && name.trim() !== placeholder) onSubmit(name.trim());
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(input.value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  });
  input.addEventListener("blur", () => finish(null));
}

/** O Go to Symbol junto a (x, y): um campo de filtro e a lista dos símbolos (indentados pela
 *  profundidade; com filtro, os que começam pelo texto primeiro). ↑/↓ escolhem, Enter ou clique
 *  abrem; Escape ou clicar fora fecham. */
export function showSymbolPicker(entries: readonly SymbolEntry[], x: number, y: number, onPick: (s: SymbolEntry) => void, onClose: () => void): void {
  const el = floating("lsp-symbols", "lsp-pop lsp-refs lsp-symbols", x, y);
  const input = document.createElement("input");
  input.className = "inp notr";
  input.spellcheck = false;
  input.placeholder = entries.length ? "Go to symbol in file…" : "No symbols in this file";
  input.setAttribute("aria-label", "Filter symbols");
  const list = document.createElement("div");
  list.className = "lsp-sym-list";
  list.setAttribute("role", "listbox");
  el.append(input, list);
  let shown: SymbolEntry[] = [];
  let sel = 0;
  let done = false;
  const finish = (pick: SymbolEntry | null): void => {
    if (done) return;
    done = true;
    closePopup("lsp-symbols");
    if (pick) onPick(pick);
    else onClose();
  };
  const mark = (): void => {
    list.querySelectorAll<HTMLElement>(".lsp-ref").forEach((b, i) => {
      b.classList.toggle("sel", i === sel);
      b.setAttribute("aria-selected", String(i === sel));
      if (i === sel) b.scrollIntoView?.({ block: "nearest" });
    });
  };
  const render = (): void => {
    const q = input.value.trim();
    shown = filterSymbols(entries, q);
    sel = 0;
    list.textContent = "";
    for (const s of shown) {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "lsp-ref lsp-sym";
      b.setAttribute("role", "option");
      if (!q) b.style.paddingLeft = `${12 + s.depth * 14}px`;
      const kind = document.createElement("span");
      kind.className = "lsp-act-kind";
      kind.textContent = s.label;
      const name = document.createElement("span");
      name.className = "lsp-sym-n";
      name.textContent = s.name;
      const where = document.createElement("span");
      where.className = "lsp-ref-t";
      where.textContent = [s.detail, q && s.container ? `in ${s.container}` : "", `:${s.line}`].filter(Boolean).join("  ");
      b.append(kind, name, where);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // o foco fica no campo
      b.addEventListener("click", () => finish(s));
      list.appendChild(b);
    }
    if (entries.length && !shown.length) {
      const none = document.createElement("div");
      none.className = "lsp-pop-hint lsp-sym-none";
      none.textContent = "No matching symbols";
      list.appendChild(none);
    }
    mark();
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (["Escape", "Enter", "ArrowDown", "ArrowUp"].includes(e.key)) e.stopPropagation(); // são do cartão, não dos atalhos globais
    if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[sel]) finish(shown[sel]);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      if (n) {
        sel = (sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        mark();
      }
    }
  });
  const onDown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) finish(null);
  };
  document.addEventListener("mousedown", onDown, true);
  CLOSERS.set("lsp-symbols", () => document.removeEventListener("mousedown", onDown, true));
  render();
  input.focus();
}

/** Quanto esperar depois da última tecla antes de perguntar aos servidores. */
const WS_DEBOUNCE_MS = 150;

/** O Go to Symbol in Workspace junto a (x, y): a cada tecla (com uma pausa curta) pergunta
 *  `search(q)` e mostra os símbolos (tipo, nome, contentor, ficheiro:linha). ↑/↓ escolhem, Enter
 *  ou clique abrem; Escape ou clicar fora fecham. Os que estão fora da pasta ficam desactivados. */
export function showWorkspaceSymbolPicker(
  x: number,
  y: number,
  search: (q: string) => Promise<WorkspaceSymbolSearch | null>,
  onPick: (s: WorkspaceSymbolResult) => void,
  onClose: () => void,
): void {
  const el = floating("lsp-wsymbols", "lsp-pop lsp-refs lsp-symbols lsp-wsymbols", x, y);
  const input = document.createElement("input");
  input.className = "inp notr";
  input.spellcheck = false;
  input.placeholder = "Go to symbol in workspace…";
  input.setAttribute("aria-label", "Search symbols in the folder");
  const status = document.createElement("div");
  status.className = "lsp-pop-hint lsp-sym-none";
  const list = document.createElement("div");
  list.className = "lsp-sym-list";
  list.setAttribute("role", "listbox");
  el.append(input, status, list);
  let shown: WorkspaceSymbolResult[] = [];
  let sel = 0;
  let done = false;
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (pick: WorkspaceSymbolResult | null): void => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    closePopup("lsp-wsymbols");
    if (pick) onPick(pick);
    else onClose();
  };
  const rows = (): HTMLElement[] => [...list.querySelectorAll<HTMLElement>(".lsp-ref")];
  const mark = (): void => {
    rows().forEach((b, i) => {
      b.classList.toggle("sel", i === sel);
      b.setAttribute("aria-selected", String(i === sel));
      if (i === sel) b.scrollIntoView?.({ block: "nearest" });
    });
  };
  const render = (res: WorkspaceSymbolSearch | null, q: string): void => {
    shown = res ? res.items : [];
    sel = Math.max(0, shown.findIndex((s) => s.key));
    list.textContent = "";
    status.textContent = !res
      ? "Open a folder to search its symbols"
      : !res.servers
        ? "No language server is running in this folder yet — open one of its files first"
        : shown.length
          ? ""
          : q.trim()
            ? "No matching symbols"
            : "Type to search the symbols of the folder";
    status.hidden = !status.textContent;
    for (const s of shown) {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "lsp-ref lsp-sym";
      b.setAttribute("role", "option");
      b.disabled = !s.key;
      const kind = document.createElement("span");
      kind.className = "lsp-act-kind";
      kind.textContent = s.label;
      const name = document.createElement("span");
      name.className = "lsp-sym-n";
      name.textContent = s.name;
      const where = document.createElement("span");
      where.className = "lsp-ref-t";
      where.textContent = [s.container ? `in ${s.container}` : "", s.key ? `${s.file}${s.line !== null ? `:${s.line}` : ""}` : "outside this folder"].filter(Boolean).join("  ");
      b.append(kind, name, where);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // o foco fica no campo
      b.addEventListener("click", () => finish(s));
      list.appendChild(b);
    }
    mark();
  };
  const run = (): void => {
    const q = input.value, mine = ++seq;
    void search(q).then((res) => {
      if (!done && mine === seq) render(res, q);
    });
  };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, WS_DEBOUNCE_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (["Escape", "Enter", "ArrowDown", "ArrowUp"].includes(e.key)) e.stopPropagation(); // são do cartão
    if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = shown[sel];
      if (s && s.key) finish(s);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = shown.length;
      if (!n) return;
      // salta os desactivados (fora da pasta)
      for (let k = 0; k < n; k++) {
        sel = (sel + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
        if (shown[sel].key) break;
      }
      mark();
    }
  });
  const onDown = (e: MouseEvent): void => {
    if (!el.contains(e.target as Node)) finish(null);
  };
  document.addEventListener("mousedown", onDown, true);
  CLOSERS.set("lsp-wsymbols", () => {
    clearTimeout(timer);
    document.removeEventListener("mousedown", onDown, true);
  });
  status.textContent = "Searching…";
  input.focus();
  run();
}
