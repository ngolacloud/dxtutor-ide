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
import { offsetToPosition } from "../domain/positions";
import { firstTarget, hoverBlocks, isIndexing, uriToPath, type HoverBlock } from "../domain/results";
import type { Defer, EditorPort, LspPort, WorkspacePort } from "./ports";

export interface LspClientDeps {
  lsp: LspPort;
  workspace: WorkspacePort;
  editor: EditorPort;
  defer: Defer;
}

export interface LspClient {
  /** O separador activo mudou. */
  onTab(tabId: string | null): Promise<void>;
  /** O ficheiro activo foi editado. */
  onEdit(): Promise<void>;
  /** O hover no offset `offset` do ficheiro activo (`[]` se não há nada). */
  hoverAt(offset: number): Promise<HoverBlock[]>;
  /** Vai para a definição do símbolo no offset `offset` do ficheiro activo. */
  definitionAt(offset: number): Promise<void>;
  /** O servidor publicou diagnósticos para `uri`. */
  onDiagnostics(uri: string): void;
  /** Ficheiros abertos no servidor (caminho absoluto → versão), para inspecção. */
  opened(): ReadonlyMap<string, number>;
}

interface Doc {
  key: string;
  path: string;
  languageId: string;
}

export function makeLspClient(d: LspClientDeps): LspClient {
  const started = new Set<string>();
  const versions = new Map<string, number>();

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
    try {
      await d.lsp.didOpen(doc.path, text, doc.languageId);
      return true;
    } catch {
      versions.delete(doc.path);
      return false;
    }
  }

  async function onTab(tabId: string | null): Promise<void> {
    const doc = docOf(d.workspace.fileKeyOfTab(tabId));
    if (doc) await ensureOpen(doc);
  }

  async function onEdit(): Promise<void> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc) return;
    if (!versions.has(doc.path)) {
      await ensureOpen(doc);
      return;
    }
    const text = d.workspace.text(doc.key);
    if (text == null) return;
    const version = (versions.get(doc.path) ?? 1) + 1;
    versions.set(doc.path, version);
    await d.lsp.didChange(doc.path, text, version).catch(() => {});
  }

  /** O ficheiro activo, aberto no servidor, e a posição LSP do offset. */
  async function at(offset: number): Promise<{ doc: Doc; line: number; character: number } | null> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) return null;
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

  function onDiagnostics(uri: string): void {
    const path = uriToPath(uri);
    const root = d.workspace.diskRoot();
    if (!path || !root) return;
    const key = absoluteToKey(path, d.workspace.virtualPrefix(), root);
    // Depois dos outros subscritores (o Problems do painel actualiza-se no mesmo evento).
    if (key && key === d.workspace.currentFileKey()) d.defer(() => d.editor.repaint(key));
  }

  return { onTab, onEdit, hoverAt, definitionAt, onDiagnostics, opened: () => versions };
}
