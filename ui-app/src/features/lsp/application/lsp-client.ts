/* ═════════ feature `lsp` — o cliente do editor ═════════
   Liga o editor ao servidor de linguagem do backend:
     • ao mudar para um separador de ficheiro → arranca o servidor da pasta (uma vez) e envia
       `didOpen` (uma vez por ficheiro);
     • depois de cada edição → `didChange` com o texto inteiro e a versão seguinte;
     • hover e «ir para a definição» na posição pedida;
     • quando chegam diagnósticos do ficheiro aberto → volta a pintar o editor.
   Sem DOM e sem `window`: tudo entra pelas portas. Um ficheiro de uma linguagem sem servidor,
   ou fora da pasta real, é simplesmente ignorado (o editor continua como sempre). */

import { languageIdFor } from "../domain/languages";
import { keyToAbsolute, absoluteToKey } from "../domain/paths";
import { offsetToPosition, positionToOffset, wordAt } from "../domain/positions";
import { allTargets, firstTarget, hoverBlocks, isIndexing, renameRange, uriToPath, workspaceEditFiles, type HoverBlock, type Target } from "../domain/results";
import { applyTextEdits } from "../domain/edits";
import { completionItems, wordStartAt, type CompletionItem } from "../domain/completion";
import type { Defer, EditorPort, LspPort, WorkspacePort } from "./ports";

export interface LspClientDeps {
  lsp: LspPort;
  workspace: WorkspacePort;
  editor: EditorPort;
  defer: Defer;
  /** Esperar (os testes passam uma que não espera). */
  sleep?: (ms: number) => Promise<void>;
}

/** Quantas vezes, e com que intervalo, repetir um rename que voltou vazio. */
const RENAME_RETRIES = 2;
const RENAME_RETRY_MS = 900;

export interface LspClient {
  /** O separador activo mudou. */
  onTab(tabId: string | null): Promise<void>;
  /** O ficheiro activo foi editado. */
  onEdit(): Promise<void>;
  /** O hover no offset `offset` do ficheiro activo (`[]` se não há nada). */
  hoverAt(offset: number): Promise<HoverBlock[]>;
  /** Vai para a definição do símbolo no offset `offset` do ficheiro activo. */
  definitionAt(offset: number): Promise<void>;
  /** As referências do símbolo no offset (incluindo a declaração); `null` se não há servidor. */
  referencesAt(offset: number): Promise<Reference[] | null>;
  /** O que se vai mudar de nome no offset: o nome actual e o seu intervalo; `null` se não dá. */
  prepareRenameAt(offset: number): Promise<RenameTarget | null>;
  /** Muda o nome do símbolo no offset e aplica as edições a todos os ficheiros da pasta. */
  renameAt(offset: number, newName: string): Promise<RenameResult | null>;
  /** As sugestões de completion no offset do ficheiro activo (`null` se não há servidor).
   *  `triggerCharacter` quando foi um carácter (ex. `.`) que abriu a lista. */
  completionAt(offset: number, triggerCharacter: string | null): Promise<CompletionResult | null>;
  /** O servidor publicou diagnósticos para `uri`. */
  onDiagnostics(uri: string): void;
  /** Ficheiros abertos no servidor (caminho absoluto → versão), para inspecção. */
  opened(): ReadonlyMap<string, number>;
}

/** Uma referência: onde está (chave do editor, `null` se fora da pasta) e a linha de texto. */
export interface Reference {
  key: string | null;
  /** Caminho relativo à pasta (ou o caminho/URI completo, se estiver fora dela). */
  label: string;
  /** 1-based. */
  line: number;
  character: number;
  preview: string;
}

export interface RenameTarget {
  /** O nome actual (proposto na caixa). */
  placeholder: string;
  /** Offsets do nome no ficheiro activo. */
  start: number;
  end: number;
}

export interface CompletionResult {
  items: CompletionItem[];
  /** O servidor quer ser perguntado de novo a cada tecla (a lista é parcial). */
  incomplete: boolean;
  /** Onde começa o nome que se está a escrever (o que o item vai substituir). */
  wordStart: number;
}

export interface RenameResult {
  files: number;
  edits: number;
  /** Ficheiros com edições que não se aplicaram (fora da pasta ou não carregados). */
  skipped: string[];
}

interface Doc {
  key: string;
  path: string;
  languageId: string;
}

export function makeLspClient(d: LspClientDeps): LspClient {
  const started = new Set<string>();
  const versions = new Map<string, number>();
  /** O último texto que o servidor recebeu de cada documento (para não repetir `didChange`). */
  const sent = new Map<string, string>();

  /** O documento LSP de uma chave do editor, ou `null` se não há servidor para ele. */
  function docOf(key: string | null): Doc | null {
    if (!key) return null;
    const root = d.workspace.diskRoot();
    const languageId = languageIdFor(key);
    if (!root || !languageId) return null;
    const path = keyToAbsolute(key, d.workspace.virtualPrefix(), root);
    return path ? { key, path, languageId } : null;
  }

  /** Arranca o servidor da pasta e abre o documento, se ainda não estiverem. */
  async function ensureOpen(doc: Doc): Promise<boolean> {
    const root = d.workspace.diskRoot();
    if (!root) return false;
    if (!started.has(root)) {
      started.add(root);
      await d.lsp.start(root).catch(() => started.delete(root));
    }
    if (versions.has(doc.path)) return true;
    const text = d.workspace.text(doc.key);
    if (text == null) return false;
    versions.set(doc.path, 1);
    sent.set(doc.path, text);
    try {
      await d.lsp.didOpen(doc.path, text, doc.languageId);
      return true;
    } catch {
      versions.delete(doc.path);
      sent.delete(doc.path);
      return false;
    }
  }

  async function onTab(tabId: string | null): Promise<void> {
    const doc = docOf(d.workspace.fileKeyOfTab(tabId));
    if (doc) await ensureOpen(doc);
  }

  /** Dá ao servidor o texto actual do documento, se mudou desde o último que recebeu. */
  async function sync(doc: Doc): Promise<void> {
    if (!versions.has(doc.path)) {
      await ensureOpen(doc);
      return;
    }
    const text = d.workspace.text(doc.key);
    if (text == null || sent.get(doc.path) === text) return;
    const version = (versions.get(doc.path) ?? 1) + 1;
    versions.set(doc.path, version);
    sent.set(doc.path, text);
    await d.lsp.didChange(doc.path, text, version).catch(() => {});
  }

  async function onEdit(): Promise<void> {
    const doc = docOf(d.workspace.currentFileKey());
    if (doc) await sync(doc);
  }

  async function completionAt(offset: number, triggerCharacter: string | null): Promise<CompletionResult | null> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) return null;
    // o pedido vem logo a seguir a uma tecla: o servidor tem de ter esse texto, não o de há 180 ms
    await sync(doc);
    const text = d.workspace.text(doc.key) ?? "";
    const pos = offsetToPosition(text, offset);
    try {
      const { items, incomplete } = completionItems(await d.lsp.completion(doc.path, pos.line, pos.character, triggerCharacter));
      return { items, incomplete, wordStart: wordStartAt(text, offset) };
    } catch {
      return null;
    }
  }

  /** O ficheiro activo, aberto no servidor, e a posição LSP do offset. */
  async function at(offset: number): Promise<{ doc: Doc; line: number; character: number } | null> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) return null;
    // o servidor tem de responder sobre o texto que se vê — o didChange normal só sai 180 ms
    // depois da última tecla (escrever e carregar logo em F2 perguntava sobre o texto antigo)
    await sync(doc);
    const text = d.workspace.text(doc.key) ?? "";
    return { doc, ...offsetToPosition(text, offset) };
  }

  async function hoverAt(offset: number): Promise<HoverBlock[]> {
    const p = await at(offset);
    if (!p) return [];
    try {
      return hoverBlocks(await d.lsp.hover(p.doc.path, p.line, p.character));
    } catch {
      return [];
    }
  }

  async function definitionAt(offset: number): Promise<void> {
    const p = await at(offset);
    if (!p) {
      d.editor.notify("No language server for this file");
      return;
    }
    let result: unknown;
    try {
      result = await d.lsp.definition(p.doc.path, p.line, p.character);
    } catch (e) {
      d.editor.notify(`Language server: ${String(e)}`);
      return;
    }
    if (isIndexing(result)) {
      d.editor.notify("The language server is still indexing — try again in a moment");
      return;
    }
    const target = firstTarget(result);
    if (!target) {
      d.editor.notify("No definition found");
      return;
    }
    const root = d.workspace.diskRoot();
    const key = target.path && root ? absoluteToKey(target.path, d.workspace.virtualPrefix(), root) : null;
    if (!key) {
      d.editor.notify(`The definition is outside this folder: ${target.path ?? target.uri}`);
      return;
    }
    d.editor.open(key, target.line + 1, target.character);
  }

  /** Chave do editor de um caminho absoluto (`null` se fora da pasta aberta). */
  function keyOf(path: string | null): string | null {
    const root = d.workspace.diskRoot();
    return path && root ? absoluteToKey(path, d.workspace.virtualPrefix(), root) : null;
  }

  async function referencesAt(offset: number): Promise<Reference[] | null> {
    const p = await at(offset);
    if (!p) {
      d.editor.notify("No language server for this file");
      return null;
    }
    // Pergunta na DECLARAÇÃO, não no uso: alguns servidores (o kotlin-language-server) num uso
    // devolvem as referências da declaração que o envolve (em `val m = greet()`, as de `m`).
    // Na declaração todos respondem bem; e a declaração entra na lista se o servidor a omitir.
    let decl: Target | null = null;
    try {
      const def = await d.lsp.definition(p.doc.path, p.line, p.character);
      decl = isIndexing(def) ? null : firstTarget(def);
    } catch {
      decl = null;
    }
    const declKey = decl ? keyOf(decl.path) : null;
    const declDoc = declKey ? docOf(declKey) : null;
    if (declDoc) await ensureOpen(declDoc);
    const q = decl && declDoc ? { path: declDoc.path, line: decl.line, character: decl.character } : { path: p.doc.path, line: p.line, character: p.character };
    let result: unknown;
    try {
      result = await d.lsp.references(q.path, q.line, q.character);
    } catch (e) {
      d.editor.notify(`Language server: ${String(e)}`);
      return null;
    }
    if (isIndexing(result)) {
      d.editor.notify("The language server is still indexing — try again in a moment");
      return null;
    }
    const targets = allTargets(result);
    const at0 = decl;
    if (at0 && declDoc && !targets.some((t) => t.path === at0.path && t.line === at0.line)) targets.unshift(at0);
    const prefix = d.workspace.virtualPrefix();
    return targets.map((t) => {
      const key = keyOf(t.path);
      const text = key ? d.workspace.text(key) : null;
      return {
        key,
        label: key ? key.slice(prefix.length) : t.path ?? t.uri,
        line: t.line + 1,
        character: t.character,
        preview: text ? (text.split("\n")[t.line] ?? "").trim() : "",
      };
    });
  }

  async function prepareRenameAt(offset: number): Promise<RenameTarget | null> {
    const p = await at(offset);
    if (!p) {
      d.editor.notify("No language server for this file");
      return null;
    }
    const text = d.workspace.text(p.doc.key) ?? "";
    let prepared: ReturnType<typeof renameRange> = { range: null, placeholder: null };
    try {
      const res = await d.lsp.prepareRename(p.doc.path, p.line, p.character);
      // `null` também é o que chega de um servidor sem prepareRename: aí decide o rename.
      if (res !== null && res !== undefined) prepared = renameRange(res);
    } catch {
      /* sem prepareRename: usa a palavra no cursor */
    }
    if (prepared === null) {
      d.editor.notify("This symbol can't be renamed");
      return null;
    }
    if (prepared.range) {
      const start = positionToOffset(text, prepared.range.start), end = positionToOffset(text, prepared.range.end);
      return { placeholder: prepared.placeholder ?? text.slice(start, end), start, end };
    }
    const w = wordAt(text, offset);
    if (!w) {
      d.editor.notify("Put the cursor on a name to rename it");
      return null;
    }
    return { placeholder: prepared.placeholder ?? w.word, start: w.start, end: w.end };
  }

  async function renameAt(offset: number, newName: string): Promise<RenameResult | null> {
    const name = newName.trim();
    const p = await at(offset);
    if (!p || !name) return null;
    // Logo depois de uma edição, o jdtls ainda está a reprocessar o documento e responde ao
    // rename com `null`; uns instantes depois responde bem (medido no auto-teste). Um `null`
    // pergunta-se de novo; uma resposta vazia mas não nula aceita-se à primeira.
    const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let result: unknown = null;
    for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
      if (attempt) await sleep(RENAME_RETRY_MS);
      try {
        result = await d.lsp.rename(p.doc.path, p.line, p.character, name);
      } catch (e) {
        d.editor.notify(`Rename failed: ${String(e)}`);
        return null;
      }
      if (result !== null && result !== undefined) break;
    }
    if (isIndexing(result)) {
      d.editor.notify("The language server is still indexing — try again in a moment");
      return null;
    }
    const { files, fileOps } = workspaceEditFiles(result);
    if (!files.length) {
      d.editor.notify("Nothing to rename here");
      return null;
    }
    const out: RenameResult = { files: 0, edits: 0, skipped: [] };
    for (const f of files) {
      const key = keyOf(f.path);
      const text = key ? d.workspace.text(key) : null;
      if (!key || text == null) {
        out.skipped.push(f.path ?? f.uri);
        continue;
      }
      let next: string;
      try {
        next = applyTextEdits(text, f.edits);
      } catch {
        out.skipped.push(f.path ?? f.uri);
        continue;
      }
      d.editor.writeFile(key, next);
      out.files++;
      out.edits += f.edits.length;
      // o servidor tem o ficheiro aberto: dá-lhe o texto novo (os outros lê do disco)
      if (f.path && versions.has(f.path)) {
        const v = (versions.get(f.path) ?? 1) + 1;
        versions.set(f.path, v);
        sent.set(f.path, next);
        await d.lsp.didChange(f.path, next, v).catch(() => {});
      }
      d.editor.reload(key);
    }
    const extra = [out.skipped.length ? `${out.skipped.length} file(s) skipped` : "", fileOps ? `${fileOps} file operation(s) not applied` : ""].filter(Boolean).join(", ");
    d.editor.notify(`Renamed to ${name}: ${out.edits} change(s) in ${out.files} file(s)${extra ? ` — ${extra}` : ""}`);
    return out;
  }

  function onDiagnostics(uri: string): void {
    const path = uriToPath(uri);
    const root = d.workspace.diskRoot();
    if (!path || !root) return;
    const key = absoluteToKey(path, d.workspace.virtualPrefix(), root);
    // Depois dos outros subscritores (o Problems do painel actualiza-se no mesmo evento).
    if (key && key === d.workspace.currentFileKey()) d.defer(() => d.editor.repaint(key));
  }

  return { onTab, onEdit, hoverAt, definitionAt, referencesAt, prepareRenameAt, renameAt, completionAt, onDiagnostics, opened: () => versions };
}
