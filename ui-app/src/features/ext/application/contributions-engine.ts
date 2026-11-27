/* ═══════════ feature `ext` — motor das contribuições declarativas (ADR-0005, Fase 4) ═══════════
   Usa o que uma extensão VS Code contribui sem precisar de um extension host: lê do VSIX
   as gramáticas, temas, snippets e language-configuration; guarda-os; e serve ao editor o
   realce (TextMate «lite»), a expansão de snippets, o marcador de comentário e o tema de
   cor activo. Importa só `domain/` e as portas abaixo: sem DOM, sem `window` (A7/A8).
   LSP P4: o editor pergunta por LINGUAGEM (o id que o registo de linguagens dá ao ficheiro — que inclui
   as linguagens destas extensões, pela lista `languages()`), não pela extensão do ficheiro; as gramáticas
   podem ser JSON ou uma property list XML (`.tmLanguage`); uma extensão desactivada não contribui nada;
   instalar, remover ou ligar/desligar avisa `onChange`. */

import type { ExtensionContributions, Contributes, FileRef, LanguageConfig } from "../domain/contributions";
import { contributedLanguages, filesToRead, languagesOf, parseLanguageConfig, resolveRelative, KNOWN_LANGUAGE_SERVERS } from "../domain/contributions";
import type { ContributedLanguage } from "../../lsp/domain/registry";
import { parseJsonc } from "../domain/jsonc";
import { looksLikeXml, parsePlist } from "../domain/plist";
import { mergeThemes, themeToCss, type VsTheme } from "../domain/theme";
import { parseSnippets, matchSnippet, expandSnippet, type Snippet, type Expansion } from "../domain/snippets";
import { highlightLines, loadGrammar, type Grammar, type RawGrammar } from "../domain/textmate";
import type { JSZipArchive } from "./ports";

/** Guarda as contribuições de todas as extensões (no protótipo, `localStorage`). */
export interface ContribStore {
  load(): ExtensionContributions[];
  /** Persiste; devolve `false` se não couber (quota). */
  save(all: ExtensionContributions[]): boolean;
}

/** Uma folha de estilos única, controlada pelo motor (o tema activo). */
export interface StyleSheet {
  set(css: string): void;
}

export interface Prefs {
  get(key: string): string | null;
  set(key: string, value: string | null): void;
}

export interface ContribDeps {
  store: ContribStore;
  style: StyleSheet;
  prefs: Prefs;
  /** Selector CSS do contentor do editor, onde o tema se aplica. */
  editorScope?: string;
  /** A extensão está ligada? (por omissão, todas; uma desligada não contribui nada) */
  active?: (extId: string) => boolean;
  /** As contribuições mudaram (instalar, remover, `refresh` depois de ligar/desligar). */
  onChange?: () => void;
}

export interface ThemeRef {
  extId: string;
  label: string;
  uiTheme: string;
}

export interface ContribEngine {
  /** Lê as contribuições de um VSIX já aberto (`zip`) com o manifesto `contributes`. */
  readFromVsix(zip: JSZipArchive, id: string, contributes: Contributes | undefined): Promise<ExtensionContributions>;
  install(c: ExtensionContributions): boolean;
  remove(id: string): void;
  get(id: string): ExtensionContributions | undefined;
  /** As linguagens das extensões instaladas e ligadas, juntadas por id (LSP P4). */
  languages(): ContributedLanguage[];
  /** Uma extensão foi ligada/desligada: volta a calcular o que contribui e avisa `onChange`. */
  refresh(): void;
  themes(): ThemeRef[];
  activeTheme(): string | null;
  /** Aplica o tema `label` (ou volta ao tema do dxtutor com `null`). */
  applyTheme(label: string | null): void;
  /** Re-aplica o tema guardado (arranque). */
  restore(): void;
  /** HTML por linha com a gramática da linguagem `language` (o id), ou `null` se nenhuma extensão a traz. */
  highlight(language: string, lines: string[]): string[] | null;
  /** Os snippets da linguagem (e os de `*`; sem linguagem, só esses). */
  snippetsFor(language: string | null): Snippet[];
  /** Expande o snippet cujo prefixo acaba em `lineBefore`; `null` se nenhum casar. */
  expandAt(language: string | null, lineBefore: string, ctx: { filename?: string; selectedText?: string; now?: Date }, indent: string, tab: string):
    | { prefix: string; expansion: Expansion }
    | null;
  /** O comentário de linha do `language-configuration.json` da linguagem, se alguma extensão o traz. */
  lineCommentFor(language: string | null): string | null;
  /** O comentário de bloco (`["<!--", "-->"]`), idem. */
  blockCommentFor(language: string | null): [string, string] | null;
  languageServerFor(extId: string): { language: string; server: string } | undefined;
}

const THEME_PREF = "vsx-theme";

export function makeContribEngine(deps: ContribDeps): ContribEngine {
  const scope = deps.editorScope || ".ed";
  let all: ExtensionContributions[] | null = null;
  const grammarCache = new Map<string, Grammar>();
  const stored = () => (all ??= deps.store.load());
  /** As instaladas e ligadas: o que contribui. */
  const list = () => stored().filter(c => !deps.active || deps.active(c.id));
  let langs: ContributedLanguage[] | null = null;
  const changed = () => {
    langs = null;
    grammarCache.clear();
    deps.onChange?.();
  };

  async function readJson(zip: JSZipArchive, path: string): Promise<unknown> {
    const f = zip.file(path);
    if (!f) throw new Error(`${path} not found in the VSIX`);
    return parseJsonc(await f.async("string"));
  }

  /** Um tema com `include` herda de outro ficheiro do mesmo VSIX (até 3 níveis). */
  async function readTheme(zip: JSZipArchive, path: string, depth = 0): Promise<VsTheme> {
    const t = (await readJson(zip, path)) as VsTheme & { include?: string };
    if (t.include && depth < 3) {
      const base = await readTheme(zip, resolveRelative(path, t.include), depth + 1);
      return mergeThemes(base, t);
    }
    return t;
  }

  async function readFromVsix(zip: JSZipArchive, id: string, contributes: Contributes | undefined): Promise<ExtensionContributions> {
    const out: ExtensionContributions = {
      id,
      languages: languagesOf(contributes),
      grammars: [],
      themes: [],
      snippets: [],
      configs: [],
      warnings: [],
    };
    const themeMeta = new Map((contributes?.themes || []).map(t => [t.label || t.id || t.path || "", t.uiTheme || "vs-dark"]));
    for (const ref of filesToRead(contributes)) {
      try {
        await readOne(zip, ref, out, themeMeta);
      } catch (e) {
        out.warnings.push(`${ref.kind} ${ref.zipPath}: ${(e as Error).message}`);
      }
    }
    return out;
  }

  async function readOne(zip: JSZipArchive, ref: FileRef, out: ExtensionContributions, themeMeta: Map<string, string>) {
    if (ref.kind === "grammar") {
      // JSON (`.tmLanguage.json`) ou uma property list XML (`.tmLanguage`, `.plist`): decide o conteúdo
      const f = zip.file(ref.zipPath);
      if (!f) throw new Error(`${ref.zipPath} not found in the VSIX`);
      const text = await f.async("string");
      const grammar = (looksLikeXml(text) ? parsePlist(text) : parseJsonc(text)) as RawGrammar;
      if (!grammar || typeof grammar !== "object" || Array.isArray(grammar) || !(grammar.patterns || grammar.repository))
        throw new Error("not a TextMate grammar (no patterns)");
      out.grammars.push({ language: ref.language!, scopeName: ref.scopeName || grammar.scopeName || "source", grammar });
    } else if (ref.kind === "theme") {
      out.themes.push({ label: ref.label!, uiTheme: themeMeta.get(ref.label!) || "vs-dark", theme: await readTheme(zip, ref.zipPath) });
    } else if (ref.kind === "snippets") {
      out.snippets.push({ language: ref.language!, snippets: parseSnippets(await readJson(zip, ref.zipPath)) });
    } else {
      out.configs.push({ language: ref.language!, config: parseLanguageConfig(await readJson(zip, ref.zipPath)) });
    }
  }

  function install(c: ExtensionContributions): boolean {
    const next = stored().filter(x => x.id !== c.id).concat(c);
    all = next;
    const ok = deps.store.save(next);
    changed();
    return ok;
  }

  function remove(id: string): void {
    const removedActive = themes().some(t => t.extId === id && t.label === activeTheme());
    all = stored().filter(x => x.id !== id);
    deps.store.save(all);
    if (removedActive) applyTheme(null);
    changed();
  }

  // os temas continuam a ser de todas as instaladas (a paleta só mostra os das ligadas, como antes)
  const themes = (): ThemeRef[] => stored().flatMap(c => c.themes.map(t => ({ extId: c.id, label: t.label, uiTheme: t.uiTheme })));
  const activeTheme = (): string | null => deps.prefs.get(THEME_PREF);

  function applyTheme(label: string | null): void {
    const found = label ? stored().flatMap(c => c.themes).find(t => t.label === label) : undefined;
    deps.style.set(found ? themeToCss(found.theme, scope) : "");
    deps.prefs.set(THEME_PREF, found ? label : null);
  }

  const restore = (): void => applyTheme(activeTheme());

  function highlight(lang: string, lines: string[]): string[] | null {
    if (!lang) return null;
    for (const c of list()) {
      const g = c.grammars.find(x => x.language === lang);
      if (!g) continue;
      const key = `${c.id}:${g.scopeName}`;
      if (!grammarCache.has(key)) grammarCache.set(key, loadGrammar(g.grammar));
      return highlightLines(grammarCache.get(key)!, lines);
    }
    return null;
  }

  function snippetsFor(lang: string | null): Snippet[] {
    return list().flatMap(c => c.snippets.filter(s => (lang !== null && s.language === lang) || s.language === "*").flatMap(s => s.snippets));
  }

  function expandAt(lang: string | null, lineBefore: string, ctx: { filename?: string; selectedText?: string; now?: Date }, indent: string, tab: string) {
    const m = matchSnippet(lineBefore, snippetsFor(lang));
    if (!m) return null;
    return { prefix: m.prefix, expansion: expandSnippet(m.snippet.body, ctx, indent, tab) };
  }

  /** O primeiro `language-configuration.json` da linguagem que tem o campo pedido. */
  function configWith<K extends keyof LanguageConfig>(lang: string | null, key: K): LanguageConfig[K] | undefined {
    if (!lang) return undefined;
    for (const c of list()) for (const x of c.configs) if (x.language === lang && x.config[key]) return x.config[key];
    return undefined;
  }

  return {
    readFromVsix,
    install,
    remove,
    get: id => stored().find(c => c.id === id),
    themes,
    activeTheme,
    applyTheme,
    restore,
    languages: () => (langs ??= contributedLanguages(list())),
    refresh: changed,
    highlight,
    snippetsFor,
    expandAt,
    lineCommentFor: lang => configWith(lang, "lineComment") || null,
    blockCommentFor: lang => configWith(lang, "blockComment") || null,
    languageServerFor: id => KNOWN_LANGUAGE_SERVERS[id.toLowerCase()],
  };
}
