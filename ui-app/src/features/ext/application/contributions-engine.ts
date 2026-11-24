/* ═══════════ feature `ext` — motor das contribuições declarativas (ADR-0005, Fase 4) ═══════════
   Usa o que uma extensão VS Code contribui sem precisar de um extension host: lê do VSIX
   as gramáticas, temas, snippets e language-configuration; guarda-os; e serve ao editor o
   realce (TextMate «lite»), a expansão de snippets, o marcador de comentário e o tema de
   cor activo. Importa só `domain/` e as portas abaixo: sem DOM, sem `window` (A7/A8). */

import type { ExtensionContributions, Contributes, FileRef, LanguageConfig } from "../domain/contributions";
import { filesToRead, languageOf, parseLanguageConfig, resolveRelative, KNOWN_LANGUAGE_SERVERS } from "../domain/contributions";
import { parseJsonc } from "../domain/jsonc";
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
  themes(): ThemeRef[];
  activeTheme(): string | null;
  /** Aplica o tema `label` (ou volta ao tema do dxtutor com `null`). */
  applyTheme(label: string | null): void;
  /** Re-aplica o tema guardado (arranque). */
  restore(): void;
  /** HTML por linha com a gramática da linguagem do ficheiro, ou `null` se não houver. */
  highlight(fileExt: string, lines: string[]): string[] | null;
  snippetsFor(fileExt: string): Snippet[];
  /** Expande o snippet cujo prefixo acaba em `lineBefore`; `null` se nenhum casar. */
  expandAt(fileExt: string, lineBefore: string, ctx: { filename?: string; selectedText?: string; now?: Date }, indent: string, tab: string):
    | { prefix: string; expansion: Expansion }
    | null;
  lineCommentFor(fileExt: string): string | null;
  languageServerFor(extId: string): { language: string; server: string } | undefined;
}

const THEME_PREF = "vsx-theme";

export function makeContribEngine(deps: ContribDeps): ContribEngine {
  const scope = deps.editorScope || ".ed";
  let all: ExtensionContributions[] | null = null;
  const grammarCache = new Map<string, Grammar>();
  const list = () => (all ??= deps.store.load());

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
      languages: (contributes?.languages || [])
        .filter(l => l.id)
        .map(l => ({ id: l.id!, extensions: (l.extensions || []).filter(e => typeof e === "string") })),
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
      if (!/\.json$/i.test(ref.zipPath)) throw new Error("only JSON grammars are supported (not .tmLanguage plist)");
      const grammar = (await readJson(zip, ref.zipPath)) as RawGrammar;
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
    const next = list().filter(x => x.id !== c.id).concat(c);
    all = next;
    grammarCache.clear();
    return deps.store.save(next);
  }

  function remove(id: string): void {
    const removedActive = themes().some(t => t.extId === id && t.label === activeTheme());
    all = list().filter(x => x.id !== id);
    grammarCache.clear();
    deps.store.save(all);
    if (removedActive) applyTheme(null);
  }

  const themes = (): ThemeRef[] => list().flatMap(c => c.themes.map(t => ({ extId: c.id, label: t.label, uiTheme: t.uiTheme })));
  const activeTheme = (): string | null => deps.prefs.get(THEME_PREF);

  function applyTheme(label: string | null): void {
    const found = label ? list().flatMap(c => c.themes).find(t => t.label === label) : undefined;
    deps.style.set(found ? themeToCss(found.theme, scope) : "");
    deps.prefs.set(THEME_PREF, found ? label : null);
  }

  const restore = (): void => applyTheme(activeTheme());

  const language = (fileExt: string) => languageOf(fileExt, list());

  function highlight(fileExt: string, lines: string[]): string[] | null {
    const lang = language(fileExt);
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

  function snippetsFor(fileExt: string): Snippet[] {
    const lang = language(fileExt);
    return list().flatMap(c => c.snippets.filter(s => s.language === lang || s.language === "*").flatMap(s => s.snippets));
  }

  function expandAt(fileExt: string, lineBefore: string, ctx: { filename?: string; selectedText?: string; now?: Date }, indent: string, tab: string) {
    const m = matchSnippet(lineBefore, snippetsFor(fileExt));
    if (!m) return null;
    return { prefix: m.prefix, expansion: expandSnippet(m.snippet.body, ctx, indent, tab) };
  }

  function lineCommentFor(fileExt: string): string | null {
    const lang = language(fileExt);
    let cfg: LanguageConfig | undefined;
    for (const c of list()) cfg ??= c.configs.find(x => x.language === lang)?.config;
    return cfg?.lineComment || null;
  }

  return {
    readFromVsix,
    install,
    remove,
    get: id => list().find(c => c.id === id),
    themes,
    activeTheme,
    applyTheme,
    restore,
    highlight,
    snippetsFor,
    expandAt,
    lineCommentFor,
    languageServerFor: id => KNOWN_LANGUAGE_SERVERS[id.toLowerCase()],
  };
}
