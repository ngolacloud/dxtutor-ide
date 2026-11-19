/* ═══════════ feature `ext` (Open VSX) — casos de uso do motor (ADR-0002, Fase 3) ═══════════
   O motor de extensões extraído do resíduo `features/ext.ts`: instalar, alternar,
   remover, registar comandos na paleta, carregar VSIX e formatar (Prettier). Importa
   SÓ `domain/` (as formas) e `ports.ts` (as capacidades do mundo). Sem DOM, sem
   `window`, sem Tauri — tudo o que precisa chega por `deps` (verificado por A7/A8).

   Fiel ao comportamento anterior (UI/comportamento congelados): a mesma ordem de
   efeitos de cada operação, o mesmo registo de comandos, a mesma heurística do
   formatador. Só mudou a PROVENIÊNCIA das capacidades — antes globais resolvidos
   pelo bridge, agora injectadas por argumento.

   O estado instalado (`EXS`) continua a atravessar o bridge: `deps.state.read()`
   devolve o objecto JÁ hidratado (window-backed no resíduo) e o motor muta-o no
   sítio; as mutações persistem porque é a mesma referência. */

import type { ExtItem, ExtCmd, VsixManifest } from "../domain/types";
import type { ExtDeps } from "./ports";

/** A superfície pública do motor — o resíduo liga estes nomes ao `window`
 *  (os `onclick` inline e o resíduo de `v6.ts` resolvem-nos por global). */
export interface ExtEngine {
  extAll(): ExtItem[];
  extOn(id: string): number | boolean | undefined;
  extCmds(): void;
  saveExt(): void;
  extInstall(id: string): void;
  extRemove(id: string): void;
  extToggle(id: string): void;
  loadVsix(file: File): Promise<void>;
  formatDoc(): void;
}

export function makeExtEngine(deps: ExtDeps): ExtEngine {
  const { catalogue, state, storage, palette, editor, tabs, vsix, notifier, rerender } = deps;

  /** Catálogo + VSIX instalados — a base de «todas as extensões». */
  const extAll = (): ExtItem[] => catalogue.concat(state.read().vsix);

  /** Uma extensão está instalada E ligada? (truthy/falsy, como o original.) */
  const extOn = (id: string): number | boolean | undefined => {
    const inst = state.read().inst[id];
    return inst && inst.on;
  };

  /** Re-regista na paleta (`CMD`) os comandos das extensões activas (tag `'ext'`):
   *  limpa os antigos e empurra os das instaladas. Comandos sem acção própria
   *  caem para um placeholder (VSIX = toast de «corre no desktop»; Prettier =
   *  `formatDoc`; resto = no-op), fiel ao motor anterior. */
  function extCmds(): void {
    const CMD = palette.entries();
    for (let i = CMD.length - 1; i >= 0; i--) if (CMD[i][3] === "ext") CMD.splice(i, 1);
    extAll()
      .filter(x => extOn(x.id))
      .forEach(x =>
        (x.cmds || []).forEach(c =>
          CMD.push([
            c[0],
            c[1],
            c[2] ||
              (x.vsix
                ? () => notifier.toast(`${c[0]} runs in the desktop app's extension host`)
                : x.eff === "prettier"
                  ? formatDoc
                  : () => {}),
            "ext",
          ]),
        ),
      );
  }

  /** Persiste o estado instalado e re-regista os comandos. */
  const saveExt = (): void => {
    storage.save(state.read());
    extCmds();
  };

  function extInstall(id: string): void {
    state.read().inst[id] = { on: 1 };
    saveExt();
    notifier.toast("Installed " + (extAll().find(x => x.id === id) || { n: id }).n);
    rerender();
  }

  function extRemove(id: string): void {
    const s = state.read();
    const x = extAll().find(e => e.id === id);
    if (x && x.bundled) return;
    delete s.inst[id];
    if (x && x.vsix) s.vsix = s.vsix.filter(v => v.id !== id);
    saveExt();
    rerender();
  }

  function extToggle(id: string): void {
    const inst = state.read().inst;
    inst[id].on = !inst[id].on;
    saveExt();
    rerender();
  }

  /** Carrega um VSIX: unzip → lê `extension/package.json` → monta o `ExtItem`,
   *  instala-o, persiste, re-renderiza e abre o separador de detalhe. */
  async function loadVsix(file: File): Promise<void> {
    try {
      const Z = await vsix.load();
      const zip = await Z.loadAsync(file);
      const pj = zip.file("extension/package.json");
      if (!pj) throw new Error("extension/package.json not found — is this a VSIX?");
      const m = JSON.parse(await pj.async("string")) as VsixManifest;
      const id = `${m.publisher}.${m.name}`.toLowerCase();
      const kb = (m.contributes && m.contributes.keybindings) || [];
      const x: ExtItem = {
        id,
        n: m.displayName || m.name,
        pub: m.publisher || "unknown",
        d: m.description || "",
        ctx: [],
        vsix: 1,
        ver: m.version,
        engines: (m.engines || {}).vscode,
        cmds: ((m.contributes && m.contributes.commands) || []).map(
          (c): ExtCmd => [
            (c.category ? c.category + ": " : "") + c.title,
            (kb.find(k => k.command === c.command) || {}).key || "",
          ],
        ),
        cfg: Object.keys(((m.contributes || {}).configuration || {}).properties || {}).slice(0, 20),
        act: (m.activationEvents || []).slice(0, 8),
      };
      const s = state.read();
      s.vsix = s.vsix.filter(v => v.id !== id);
      s.vsix.push(x);
      s.inst[id] = { on: 1 };
      saveExt();
      rerender();
      notifier.toast(`Installed ${x.n} ${x.ver || ""} from VSIX`);
      tabs.open({ id: "extd:" + id, title: x.n, kind: "extd", ext: id });
    } catch (e) {
      notifier.toast("VSIX: " + (e as Error).message);
    }
  }

  /** Formatador «Prettier» do protótipo: apara espaços finais, normaliza
   *  indentação (tabs→4 espaços, excepto Go/Makefile) e a última linha. */
  function formatDoc(): void {
    const t = editor.tabOf(editor.current());
    if (!t || t.kind !== "file" || !t.path) {
      notifier.toast("Open a file first");
      return;
    }
    const f = editor.files()[t.path];
    const ext = editor.extOf(t.path);
    const keepTabs = ext === "go" || /Makefile$/.test(t.path);
    const c = f.content
      .split("\n")
      .map(l => l.replace(/\s+$/, ""))
      .map(l => (keepTabs ? l : l.replace(/^\t+/, m => "    ".repeat(m.length))))
      .join("\n")
      .replace(/\n*$/, "\n");
    if (c === f.content) {
      notifier.toast("Already formatted");
      return;
    }
    f.content = c;
    editor.refresh();
    notifier.toast("Formatted with Prettier");
  }

  return { extAll, extOn, extCmds, saveExt, extInstall, extRemove, extToggle, loadVsix, formatDoc };
}
