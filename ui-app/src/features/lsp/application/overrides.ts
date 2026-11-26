/* ═════════ feature `lsp` — os overrides do registo de linguagens (LSP P2) ═════════
   O caso de uso por trás da paleta e dos avisos:
     • ao abrir uma pasta → pergunta ao backend o registo efectivo (embutido + `lsp.json` do utilizador +
       `.dxtutor/lsp.json` do projecto) e põe-no em uso (`useRegistry`); avisa dos ficheiros ignorados;
     • quando um desses ficheiros muda (o backend vigia-os e já reiniciou os servidores afectados) → volta a
       ler e o editor revê a faixa do ficheiro aberto;
     • abre o ficheiro do utilizador (num editor próprio: vive fora da pasta) ou o do projecto (num
       separador, criado com um modelo comentado se não existe);
     • mostra a entrada efectiva de cada servidor (de onde veio, as definições, a aprovação);
     • revê o comando que um projecto pede: o diálogo partilhado com o comando EXACTO → o backend audita a
       decisão e guarda a aprovação (a regra está no Rust: sem ela, o servidor não arranca).
   Sem DOM e sem `window`: tudo entra pelas portas. */

import { languageFor, useRegistry } from "../domain/registry";
import { effectiveRegistry, errorsKey, invalidFiles, projectFileKey, type LspConfigView } from "../domain/overrides";
import type { ServerApproval } from "../domain/server-status";
import { englishCopy, type LspOverrideKey } from "./override-messages";
import type { EditorPort, HumanPort, LspConfigPort, OverridesView, WorkspacePort } from "./ports";

/** O texto de uma chave na língua da interface (a composição injecta o `translator`). */
export type Copy = (key: LspOverrideKey, params?: Record<string, string | number>) => string;

export interface OverridesDeps {
  config: LspConfigPort;
  workspace: WorkspacePort;
  editor: EditorPort;
  human: HumanPort;
  view: OverridesView;
  copy?: Copy;
  /** Depois de uma decisão de aprovação: o editor revê o ficheiro aberto (o cliente LSP). */
  onChanged?: () => void | Promise<void>;
}

export interface Overrides {
  /** O registo efectivo da pasta `root` está em uso (perguntado uma vez por pasta). */
  ready(root: string): Promise<void>;
  /** Um ficheiro de overrides mudou: volta a ler e põe o registo novo em uso. */
  reload(): Promise<void>;
  /** «LSP: Open User Language Server Settings»: o `lsp.json` do utilizador, num editor próprio. */
  openUserFile(): Promise<void>;
  /** «LSP: Open Project Language Server Settings»: o `.dxtutor/lsp.json`, num separador. */
  openProjectFile(): Promise<void>;
  /** «LSP: Show Effective Language Server Configuration» (o servidor do ficheiro aberto primeiro). */
  showEffective(serverId?: string | null): Promise<void>;
  /** Revê um servidor que o projecto pede; true se o humano o aprovou (e o backend o guardou). */
  review(a: ServerApproval): Promise<boolean>;
  /** A última resposta do backend (`null` antes da primeira). */
  current(): LspConfigView | null;
}

export function makeOverrides(d: OverridesDeps): Overrides {
  const copy: Copy = d.copy ?? englishCopy;
  let loadedRoot: string | null = null;
  let loading: Promise<void> | null = null;
  let last: LspConfigView | null = null;
  let shownErrors = "";

  function showInvalid(v: LspConfigView | null): void {
    const files = invalidFiles(v);
    const key = errorsKey(files);
    if (key === shownErrors) return;
    shownErrors = key;
    d.view.showInvalid(files, (f) => void openFile(f.path));
  }

  async function load(root: string): Promise<void> {
    try {
      const v = await d.config.config(root);
      if (d.workspace.diskRoot() !== root) return; // trocou de pasta entretanto
      last = v;
      useRegistry(effectiveRegistry(v));
      showInvalid(v);
    } catch {
      // sem resposta: o editor fica com o registo embutido
      last = null;
      useRegistry(null);
    }
  }

  function ready(root: string): Promise<void> {
    if (loadedRoot === root && loading) return loading;
    loadedRoot = root;
    loading = load(root);
    return loading;
  }

  async function reload(): Promise<void> {
    const root = d.workspace.diskRoot();
    if (!root) return;
    loadedRoot = root;
    loading = load(root);
    await loading;
  }

  /** Abre um ficheiro de overrides pelo caminho do relatório (o do projecto num separador; o do
   *  utilizador no seu editor). */
  async function openFile(path: string): Promise<void> {
    const v = last;
    if (v?.projectFile && v.projectFile.path === path) return openProjectFile();
    return openUserFile();
  }

  async function openUserFile(): Promise<void> {
    let file: { path: string; exists: boolean; text: string };
    try {
      file = await d.config.configFile("user", null);
    } catch (e) {
      d.editor.notify(copy("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
      return;
    }
    d.view.editUserFile(file, async (text) => {
      const rep = await d.config.saveUserConfig(text);
      await reload();
      return rep;
    });
  }

  async function openProjectFile(): Promise<void> {
    const root = d.workspace.diskRoot();
    if (!root) {
      d.editor.notify(copy("noFolder"));
      return;
    }
    const key = projectFileKey(d.workspace.virtualPrefix());
    if (d.workspace.text(key) == null) {
      // não está no editor: o do disco (se existe e o carregador o saltou) ou o modelo comentado
      let file: { path: string; exists: boolean; text: string };
      try {
        file = await d.config.configFile("project", root);
      } catch (e) {
        d.editor.notify(copy("saveFailed", { error: e instanceof Error ? e.message : String(e) }));
        return;
      }
      d.editor.writeFile(key, file.text);
    }
    d.editor.open(key, 1, 0);
  }

  async function showEffective(serverId?: string | null): Promise<void> {
    const root = d.workspace.diskRoot();
    if (!root) {
      d.editor.notify(copy("unavailable"));
      return;
    }
    let v: LspConfigView;
    try {
      v = await d.config.config(root);
    } catch (e) {
      d.editor.notify(String(e instanceof Error ? e.message : e));
      return;
    }
    last = v;
    useRegistry(effectiveRegistry(v));
    const key = d.workspace.currentFileKey();
    const ofFile = key ? languageFor(key, d.workspace.text(key))?.server ?? null : null;
    d.view.showEffective(v, serverId ?? ofFile, (id) => {
      const a = v.servers.find((s) => s.id === id)?.approval;
      if (a) void review(a);
    });
  }

  async function review(a: ServerApproval): Promise<boolean> {
    const scope = copy("dialogScope", { cwd: a.cwd, file: a.file, changed: a.changed.join(", ") }) + (a.insideProject ? copy("dialogInside") : "");
    const fields = a.changed.filter((f) => f === "settings" || f === "initOptions").join(", ");
    const title = a.blocksStart ? copy("dialogTitle", { label: a.label }) : copy("dialogSettingsTitle", { label: a.label, fields });
    // o comando e, por baixo, as definições/initOptions que o projecto dá (e o que substituem)
    const command = a.config ? `${a.command}\n\n${a.config}` : a.command;
    const dec = await d.human.approve({ title, command, scope });
    try {
      // o backend audita a decisão ANTES de guardar a aprovação (sem auditoria, não aprova)
      await d.config.approveServer(a.project, a.server, a.hash, dec.approved, dec.reason, dec.decidedAt);
    } catch (e) {
      d.editor.notify(copy("approveFailed", { error: e instanceof Error ? e.message : String(e) }));
      return false;
    }
    d.editor.notify(copy(dec.approved ? "approvedToast" : "deniedToast", { label: a.label }));
    await reload();
    await d.onChanged?.();
    return dec.approved;
  }

  return { ready, reload, openUserFile, openProjectFile, showEffective, review, current: () => last };
}
