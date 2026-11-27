/* ═══════════ feature `ext` (Open VSX) — casos de uso do motor (ADR-0002, Fase 3) ═══════════
   O motor de extensões extraído do resíduo `features/ext.ts`: instalar, alternar,
   remover, registar comandos na paleta, carregar VSIX e formatar o documento. Importa
   SÓ `domain/` (as formas) e `ports.ts` (as capacidades do mundo). Sem DOM, sem
   `window`, sem Tauri — tudo o que precisa chega por `deps` (verificado por A7/A8).

   Fiel ao comportamento anterior (UI/comportamento congelados): a mesma ordem de
   efeitos de cada operação, o mesmo registo de comandos. Só mudou a PROVENIÊNCIA das
   capacidades — antes globais resolvidos pelo bridge, agora injectadas por argumento.
   O formatador passou a ser o seguro da LSP P5 (`formatter`, injectado).

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
  extInstall(id: string): Promise<void>;
  extRemove(id: string): void;
  extToggle(id: string): void;
  loadVsix(file: Blob | Uint8Array): Promise<void>;
  formatDoc(): void;
}

export function makeExtEngine(deps: ExtDeps): ExtEngine {
  const { catalogue, remote, state, storage, palette, editor, tabs, vsix, notifier, rerender, contrib, formatter } = deps;

  /** Os VSIX instalados + o que se conhece do Open VSX (pesquisa e recomendações), sem repetir ids. */
  const extAll = (): ExtItem[] => { const v = state.read().vsix; return v.concat(catalogue().filter((x) => !v.some((y) => y.id === x.id))); };

  /** Uma extensão está instalada E ligada? (truthy/falsy, como o original.) */
  const extOn = (id: string): number | boolean | undefined => {
    const inst = state.read().inst[id];
    return inst && inst.on;
  };

  /** Re-regista na paleta (`CMD`) os comandos das extensões activas (tag `'ext'`):
   *  limpa os antigos e empurra os das instaladas. Comandos sem acção própria
   *  dizem que precisam de um extension host (o JavaScript das extensões não corre). */
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
            c[2] || (() => notifier.toast(`${c[0]} needs a VS Code extension host, which dxtutor does not have`)),
            "ext",
          ]),
        ),
      );
    // Fase 4: os temas de cor das extensões instaladas por VSIX, como no VS Code.
    if (contrib) {
      const themes = contrib.themes().filter(t => extOn(t.extId));
      const apply = (label: string | null) => () => {
        contrib.applyTheme(label);
        notifier.toast(label ? `Color theme: ${label}` : "Color theme: dxtutor default");
        rerender();
      };
      themes.forEach(t => CMD.push([`Color Theme: ${t.label}`, "", apply(t.label), "ext"]));
      if (themes.length) CMD.push(["Color Theme: dxtutor default", "", apply(null), "ext"]);
    }
  }

  /** Persiste o estado instalado e re-regista os comandos. */
  const saveExt = (): void => {
    storage.save(state.read());
    extCmds();
  };

  /** Instala `id` do Open VSX: descarrega o VSIX real e instala-o como um VSIX do disco
   *  (ADR-0006, R6b — antes só marcava a extensão como instalada). */
  async function extInstall(id: string): Promise<void> {
    const r = remote();
    if (!r) { notifier.toast("Installing from Open VSX needs the desktop app — or install a .vsix file with +"); return; }
    notifier.toast(`Downloading ${id} from Open VSX…`);
    try { await loadVsix(await r.fetch(id)); } catch (e) { notifier.toast(`Open VSX: ${(e as Error).message || e}`); }
  }

  function extRemove(id: string): void {
    const s = state.read();
    const x = extAll().find(e => e.id === id);
    delete s.inst[id];
    if (x && x.vsix) {
      s.vsix = s.vsix.filter(v => v.id !== id);
      if (contrib) contrib.remove(id);
    }
    saveExt();
    rerender();
  }

  function extToggle(id: string): void {
    const inst = state.read().inst;
    if (!inst[id]) return;
    inst[id].on = !inst[id].on;
    saveExt();
    // LSP P4: uma extensão desligada deixa de contribuir linguagens, gramáticas e comentários
    if (contrib && state.read().vsix.some(v => v.id === id)) contrib.refresh();
    rerender();
  }

  /** Carrega um VSIX: unzip → lê `extension/package.json` → monta o `ExtItem`,
   *  instala-o, persiste, re-renderiza e abre o separador de detalhe. */
  async function loadVsix(file: Blob | Uint8Array): Promise<void> {
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
      // Fase 4: o que a extensão contribui de forma declarativa passa a ser aplicado.
      if (contrib) {
        const c = await contrib.readFromVsix(zip, id, m.contributes);
        if (!contrib.install(c)) c.warnings.push("not enough local storage to keep this extension's grammars/themes");
        x.contrib = {
          themes: c.themes.map(t => t.label),
          grammars: c.grammars.map(g => g.language),
          snippets: c.snippets.reduce((n, s) => n + s.snippets.length, 0),
          languages: c.languages.map(l => l.id),
          lsp: (contrib.languageServerFor(id) || {}).server,
          warnings: c.warnings,
        };
      }
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

  /** «Format Document» do dxtutor (Shift+Alt+F, ou quando o servidor de linguagem não formata): só o
   *  que é seguro, pelo `formatter` (LSP P5: espaços no fim, a indentação no estilo do próprio ficheiro,
   *  a quebra de linha final; nunca reescreve código), e o aviso diz o que fez. Não é o Prettier. */
  function formatDoc(): void {
    const t = editor.tabOf(editor.current());
    if (!t || t.kind !== "file" || !t.path) {
      notifier.toast("Open a file first");
      return;
    }
    const f = editor.files()[t.path];
    const r = formatter.format(t.path, f.content);
    if (r.changed) {
      f.content = r.text;
      editor.refresh();
    }
    notifier.toast(r.message);
  }

  return { extAll, extOn, extCmds, saveExt, extInstall, extRemove, extToggle, loadVsix, formatDoc };
}
