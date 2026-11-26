/* ═════════ feature `lsp` — o cliente do editor ═════════
   Liga o editor ao servidor de linguagem do backend:
     • ao mudar para um separador de ficheiro → arranca o servidor da pasta (uma vez) e envia
       `didOpen` (uma vez por ficheiro);
     • depois de cada edição → `didChange` com o texto inteiro e a versão seguinte;
     • hover e «ir para a definição» na posição pedida;
     • quando chegam diagnósticos do ficheiro aberto → volta a pintar o editor.
   Sem DOM e sem `window`: tudo entra pelas portas. Um ficheiro fora da pasta real, ou de uma
   linguagem que o backend não conhece, é ignorado. Se a linguagem tem servidor mas ele não está
   instalado (`lsp_server_status`), o editor mostra um aviso com o que falta e as maneiras de o instalar
   que o backend constrói a partir das receitas do registo (`lsp_install_plan`, LSP P3) — antes ficava
   calado (o backend não abre sessão nem dá erro). Se o `.dxtutor/lsp.json` do projecto pede
   um comando ainda não aprovado (LSP P2), a faixa diz qual e abre a aprovação; o registo efectivo (com os
   overrides) é posto em uso antes de abrir o primeiro ficheiro da pasta (`overrides.ready`). */

import { languageIdFor } from "../domain/languages";
import { keyToAbsolute, absoluteToKey } from "../domain/paths";
import { offsetToPosition, positionToOffset, wordAt } from "../domain/positions";
import { allTargets, firstTarget, hoverBlocks, isIndexing, renameRange, uriToPath, workspaceEditFiles, type HoverBlock, type Target } from "../domain/results";
import { applyTextEdits } from "../domain/edits";
import { MANAGER_NAMES, missingServerNotice, pendingApproval, runnable, type InstallOption, type InstallPlan, type MissingNotice, type ServerApproval, type ServerStatus } from "../domain/server-status";
import { englishCopy } from "./override-messages";
import { englishInstallCopy, type InstallCopy } from "./install-messages";
import type { Copy } from "./overrides";
import { completionItems, wordStartAt, type CompletionItem } from "../domain/completion";
import { signatureView, type SignatureView } from "../domain/signature";
import { clientSideEdit, codeActionItems, type CodeActionItem } from "../domain/code-actions";
import { caretAfterFormatting, formattingEdits } from "../domain/formatting";
import { flattenSymbols, type SymbolEntry } from "../domain/symbols";
import { locateInFile, rankWorkspaceSymbols, workspaceSymbolHits, type WorkspaceSymbolHit } from "../domain/workspace-symbols";
import { preparedTypes, typeNodes, type TypeDirection, type TypeNode } from "../domain/type-hierarchy";
import type { InstallPort, Defer, EditorNotice, EditorPort, LspPort, NoticeWay, WorkspacePort } from "./ports";

export interface LspClientDeps {
  lsp: LspPort;
  workspace: WorkspacePort;
  editor: EditorPort;
  defer: Defer;
  /** Esperar (os testes passam uma que não espera). */
  sleep?: (ms: number) => Promise<void>;
  /** Copiar/instalar o servidor em falta (sem ela, o aviso só tem «Dismiss»). */
  installer?: InstallPort;
  /** Os overrides do registo (LSP P2): o registo efectivo da pasta e a revisão de um comando que o
   *  projecto pede. Sem eles, o registo embutido e a faixa de aprovação sem «Review…». */
  overrides?: { ready(root: string): Promise<void>; review(a: ServerApproval): Promise<boolean> };
  /** Abre o `lsp.json` do utilizador (o botão «Configure…» da faixa de servidor em falta). */
  configure?: () => void;
  /** Os textos novos na língua da interface (por omissão, inglês). */
  copy?: Copy;
  /** Os textos do aviso de servidor em falta e da instalação (LSP P3; por omissão, inglês). */
  installCopy?: InstallCopy;
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
  /** A assinatura da chamada no offset (`null` se o cursor não está numa chamada ou não há
   *  servidor). `isRetrigger` quando a assinatura já estava à vista. */
  signatureHelpAt(offset: number, triggerCharacter: string | null, isRetrigger: boolean): Promise<SignatureView | null>;
  /** As code actions para o intervalo `[start, end)` do ficheiro activo (`null` se não há servidor). */
  codeActionsAt(start: number, end: number): Promise<CodeActionItem[] | null>;
  /** Aplica a acção escolhida: a sua edição e/ou o comando (executado no servidor). */
  applyCodeAction(item: CodeActionItem): Promise<void>;
  /** O servidor pediu para aplicar uma edição (`workspace/applyEdit`, de um comando). */
  onApplyEdit(edit: unknown): Promise<void>;
  /** Formata o ficheiro activo (ou só a selecção `[start, end)`, se não for vazia). */
  formatAt(start: number, end: number): Promise<FormatOutcome>;
  /** Os símbolos do ficheiro `key`, pela ordem do ficheiro (Go to Symbol e Outline); `null` se não
   *  há servidor para ele. */
  symbolsFor(key: string): Promise<SymbolEntry[] | null>;
  /** Os símbolos da pasta que servem para `query` (Go to Symbol in Workspace), de cada servidor
   *  que já corre nela; `null` sem pasta real. */
  workspaceSymbolsFor(query: string): Promise<WorkspaceSymbolSearch | null>;
  /** Abre o símbolo escolhido; sem posição (kotlin-language-server), procura-a no ficheiro. */
  openWorkspaceSymbol(s: WorkspaceSymbolResult): Promise<void>;
  /** O tipo no offset do ficheiro activo, para a hierarquia de tipos (`null` sem servidor). */
  typeHierarchyAt(offset: number): Promise<TypeHierarchyStart | null>;
  /** Os supertipos ou subtipos de um tipo da hierarquia. */
  typeHierarchyChildren(t: TypeEntry, direction: TypeDirection): Promise<TypeEntry[]>;
  /** Abre o tipo escolhido (no nome dele). */
  openType(t: TypeEntry): void;
  /** O servidor publicou diagnósticos para `uri`. */
  onDiagnostics(uri: string): void;
  /** Ficheiros abertos no servidor (caminho absoluto → versão), para inspecção. */
  opened(): ReadonlyMap<string, number>;
  /** O editor desenhou o ficheiro `key`: repõe o aviso de servidor em falta, se for o caso. */
  onFileView(key: string): Promise<void>;
  /** Um ficheiro de overrides mudou (o registo novo já está em uso): esquece o estado dos servidores
   *  e revê o ficheiro aberto (a faixa, e abre-o no servidor se agora tem um). */
  onConfigChanged(): Promise<void>;
  /** Um separador fechou (`key`: o ficheiro dele): o servidor recebe o `didClose` (LSP P6). */
  onTabClosed(key: string | null): Promise<void>;
  /** O workspace mudou: um documento aberto cujo ficheiro desapareceu (apagado, renomeado) fecha no servidor. */
  onWorkspaceChanged(): Promise<void>;
  /** Abriu-se a pasta `root`: se é outra, os servidores da anterior param e os documentos dela esquecem-se. */
  onFolder(root: string): Promise<void>;
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

/** Um símbolo da pasta: onde abri-lo (`key` nula se não está na pasta aberta) e o caminho a mostrar. */
/** Um tipo da hierarquia: onde abri-lo (`key` nula se não está na pasta) e o caminho a mostrar. */
export interface TypeEntry extends TypeNode {
  key: string | null;
  /** Caminho relativo à pasta, o absoluto se estiver fora dela, ou `""` sem ficheiro (ex. JDK). */
  file: string;
}

/** O início da hierarquia: o tipo no cursor, nenhum tipo ali, ou o servidor não a suporta. */
export type TypeHierarchyStart =
  | { status: "ok"; root: TypeEntry }
  | { status: "none" }
  | { status: "unsupported"; language: string };

export interface WorkspaceSymbolResult extends WorkspaceSymbolHit {
  key: string | null;
  /** Caminho relativo à pasta (ou o absoluto, se estiver fora dela). */
  file: string;
}

export interface WorkspaceSymbolSearch {
  items: WorkspaceSymbolResult[];
  /** Quantos servidores responderam (0: nenhum a correr na pasta — abre um ficheiro primeiro). */
  servers: number;
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

/** O que a formatação fez: `formatted` (texto mudou), `unchanged` (já estava formatado),
 *  `failed` (o servidor não formatou a selecção — avisado), `fallback` (sem servidor, ou ele
 *  não formatou o documento: a UI usa o «Format Document» do dxtutor). */
export type FormatOutcome = "formatted" | "unchanged" | "failed" | "fallback";

/** A indentação do editor: 4 espaços (o Tab insere 4 espaços). */
const TAB_SIZE = 4;

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
  /** O `lsp_start` de cada pasta, e o `didOpen` em curso de cada documento: uma chamada que
   *  chega a meio (ex. o Outline enquanto o separador abre o ficheiro) ESPERA por eles, em vez
   *  de mandar pedidos ao servidor antes de o documento estar aberto. */
  const starting = new Map<string, Promise<void>>();
  const opening = new Map<string, Promise<boolean>>();
  const versions = new Map<string, number>();
  /** O último texto que o servidor recebeu de cada documento (para não repetir `didChange`). */
  const sent = new Map<string, string>();
  /** O estado do servidor por linguagem (perguntado uma vez) e as linguagens cujo aviso se fechou. */
  const servers = new Map<string, Promise<ServerStatus | null>>();
  /** As maneiras de instalar o servidor de cada linguagem em falta (perguntadas uma vez, com o estado). */
  const plans = new Map<string, Promise<InstallPlan | null>>();
  const dismissed = new Set<string>();
  const copy: Copy = d.copy ?? englishCopy;
  const ic: InstallCopy = d.installCopy ?? englishInstallCopy;
  /** A chave do editor de cada documento aberto no servidor (caminho → chave): fecha-se quando o separador
   *  fecha ou o ficheiro desaparece. */
  const keys = new Map<string, string>();
  /** A pasta dos documentos abertos: quando abre outra, os servidores desta param. */
  let folder: string | null = null;

  function statusOf(doc: Doc): Promise<ServerStatus | null> {
    let p = servers.get(doc.languageId);
    if (!p) {
      p = d.lsp.serverStatus(doc.path).catch(() => null); // sem resposta: não bloqueia o editor
      servers.set(doc.languageId, p);
    }
    return p;
  }

  /** O servidor da linguagem está instalado (e, se o projecto o pede com outro comando, aprovado)? Se
   *  não, mostra o aviso no editor (até ser fechado). */
  async function serverOk(doc: Doc): Promise<boolean> {
    const st = await statusOf(doc);
    const appr = pendingApproval(st);
    if (st && appr) {
      // só definições/initOptions: o servidor corre (com as de confiança) e a faixa pede a revisão
      const fields = appr.changed.filter((f) => f === "settings" || f === "initOptions").join(", ");
      const text = appr.blocksStart
        ? { title: copy("approvalTitle", { label: appr.label }), detail: copy("approvalDetail", { command: appr.command }) }
        : { title: copy("approvalSettingsTitle", { label: appr.label }), detail: copy("approvalSettingsDetail", { label: appr.label, fields }) };
      const n = dismissed.has(st.language) ? null : { kind: "approval" as const, ...text, hint: appr.insideProject ? copy("approvalInside") : undefined };
      const ov = d.overrides;
      d.editor.notice(doc.key, n, () => dismissed.add(st.language), ov ? { review: () => void reviewApproval(doc, appr) } : undefined);
      return !appr.blocksStart;
    }
    const plan = st && !st.installed && !dismissed.has(st.language) && d.installer ? await planOf(doc) : null;
    const miss = st && !dismissed.has(st.language) ? missingServerNotice(st, plan) : null;
    const n = miss ? missingText(miss) : null;
    const ins = d.installer;
    const acts = n && miss
      ? {
          copy: ins
            ? (way: string | null) => {
                const text = (way && miss.options.find((o) => o.id === way)?.command) || n.install || "";
                void ins.copy(text).then((ok) => d.editor.notify(ic(ok ? "copied" : "copyFailed", { text })));
              }
            : undefined,
          install: ins && miss.options.some(runnable) ? (way: string) => void installServer(doc, plan!, way) : undefined,
          recheck: () => void recheck(doc),
          configure: d.configure,
        }
      : undefined;
    d.editor.notice(doc.key, n, st ? () => dismissed.add(st.language) : undefined, acts);
    return !st || st.installed;
  }

  function planOf(doc: Doc): Promise<InstallPlan | null> {
    let p = plans.get(doc.languageId);
    if (!p) {
      p = d.installer!.plan(doc.path).catch(() => null); // sem resposta: só a instrução
      plans.set(doc.languageId, p);
    }
    return p;
  }

  /** O rótulo de uma maneira (o gestor; `(corres tu)` para apt/brew; o que falta, se falta). */
  function wayLabel(o: InstallOption, platform: string): string {
    const name = o.manager === "github" ? ic("wayGithub") : MANAGER_NAMES[o.manager] ?? o.manager;
    const way = o.mode === "manual" ? ic("wayManual", { manager: name }) : name;
    if (o.available) return way;
    return o.missing === "platform" ? ic("wayNoPlatform", { way, platform }) : ic("wayMissing", { way, program: o.missing ?? "?" });
  }

  /** A frase de uma maneira: onde fica e como corre (ou porque não serve). */
  function wayNote(o: InstallOption, platform: string): string {
    if (!o.available) return o.missing === "platform" ? ic("noteNoPlatform", { platform }) : ic("noteMissing", { program: o.missing ?? "?" });
    if (o.mode === "manual") return ic("noteManual");
    if (o.mode === "download") return ic("noteDownload", { dir: o.target });
    return o.target === "toolchain" ? ic("noteToolchain") : ic("noteUser", { dir: o.target });
  }

  /** O aviso de servidor em falta com o texto na língua da interface. */
  function missingText(m: MissingNotice): EditorNotice {
    const ways: NoticeWay[] = m.options.map((o) => ({
      id: o.id,
      label: wayLabel(o, m.platform),
      shown: o.mode === "download" ? (o.url ?? "") : o.command,
      runnable: runnable(o),
      available: o.available,
      note: wayNote(o, m.platform),
    }));
    const detail = ic("missingDetail", { server: m.server });
    const why = m.withheld === "project" ? ic("withheldProject") : m.withheld === "command" ? ic("withheldCommand") : "";
    return {
      kind: "missing",
      title: ic("missingTitle", { language: m.languageName }),
      detail: why ? `${detail} ${why}` : detail,
      install: m.manual ?? ic("noWay", { server: m.server }),
      ways: ways.length ? ways : undefined,
      way: m.selected ?? ways.find((w) => w.available)?.id ?? ways[0]?.id ?? null,
      hint: copy("overridesHint"),
      labels: {
        toInstall: ic("toInstall"), way: ic("way"), copy: ic("copy"), install: ic("install"), installTip: ic("installTip"),
        recheck: ic("recheck"), dismiss: ic("dismiss"), configure: copy("configure"),
      },
    };
  }

  /** «Review…» na faixa: o diálogo de aprovação; aprovado, o servidor arranca para o ficheiro. */
  async function reviewApproval(doc: Doc, a: ServerApproval): Promise<void> {
    if (!d.overrides) return;
    const ok = await d.overrides.review(a);
    servers.delete(doc.languageId);
    if (ok) dismissed.delete(doc.languageId);
    if (ok && (await ensureOpen(doc))) d.editor.repaint(doc.key);
    else await serverOk(doc);
  }

  /** Esquece o estado e as maneiras de instalar da linguagem (o servidor pode ter aparecido). */
  function forget(doc: Doc): void {
    servers.delete(doc.languageId);
    plans.delete(doc.languageId);
    dismissed.delete(doc.languageId);
  }

  /** Onde o backend diz que o servidor está, para o aviso (`?` se não diz). */
  async function whereOf(doc: Doc): Promise<string> {
    return (await statusOf(doc))?.foundAt ?? "?";
  }

  /** Instala o servidor em falta pela maneira `way` do plano do backend: aprovação com o comando EXACTO
   *  do plano → auditoria (sem ela, não corre) → terminal de tarefa com a pasta e o ambiente do plano, ou o
   *  download conferido pelo backend (`lsp_install_download`) → auditoria do resultado → volta a perguntar
   *  se está instalado e, se sim, arranca-o (sem reiniciar a app). apt/brew nunca correm daqui. */
  let installing = false;
  async function installServer(doc: Doc, plan: InstallPlan, way: string): Promise<void> {
    const ins = d.installer, root = d.workspace.diskRoot();
    const opt = plan.options.find((o) => o.id === way);
    if (!ins || !root || installing || !opt || !runnable(opt)) return;
    const manager = MANAGER_NAMES[opt.manager] ?? opt.manager;
    const download = opt.mode === "download";
    const title = download ? ic("dialogTitleDownload", { label: plan.label }) : ic("dialogTitle", { label: plan.label, manager });
    const scope = download ? ic("scopeDownload", { dir: opt.target }) : opt.target === "toolchain" ? ic("scopeToolchain") : ic("scopeUser", { dir: opt.target });
    const dec = await ins.approve({ title, command: opt.command, scope });
    const row = { action: "lsp.install", command: opt.command, scope, approved: dec.approved, reason: dec.reason, decidedAt: dec.decidedAt };
    if (!dec.approved) { void ins.audit(root, row).catch(() => undefined); return; }
    try { await ins.audit(root, { ...row, outcome: "sent" }); } catch (e) { d.editor.notify(ic("notAudited", { error: e instanceof Error ? e.message : String(e) })); return; }
    installing = true;
    let failure: string | null = null;
    try {
      if (download) {
        d.editor.notify(ic("downloading", { label: plan.label }));
        await ins.download(doc.path, opt.id);
      } else {
        d.editor.notify(ic("installing", { label: plan.label }));
        const code = await ins.run(opt.command, opt.cwd, opt.env, `install ${plan.label}`).catch(() => -1);
        if (code !== 0) failure = ic("failedExit", { label: plan.label, code });
      }
    } catch (e) {
      failure = ic("failedDownload", { label: plan.label, error: e instanceof Error ? e.message : String(e) });
    } finally {
      installing = false;
    }
    void ins.audit(root, { ...row, outcome: failure ? "failed" : "ok" }).catch(() => undefined);
    if (failure) { d.editor.notify(failure); return; }
    forget(doc);
    if (await ensureOpen(doc)) { d.editor.notify(ic("installed", { label: plan.label, where: await whereOf(doc) })); d.editor.repaint(doc.key); }
    else d.editor.notify(ic("installedNotFound", { label: plan.label }));
  }

  /** «Check again»: depois de instalado à mão (apt, brew, um download), procura outra vez sem reiniciar. */
  async function recheck(doc: Doc): Promise<void> {
    const before = await statusOf(doc);
    forget(doc);
    const label = before?.server ?? doc.languageId;
    if (await ensureOpen(doc)) { d.editor.notify(ic("found", { label, where: await whereOf(doc) })); d.editor.repaint(doc.key); }
    else d.editor.notify(ic("stillMissing", { label }));
  }

  /** O documento LSP de uma chave do editor, ou `null` se não há servidor para ele. */
  function docOf(key: string | null): Doc | null {
    if (!key) return null;
    const root = d.workspace.diskRoot();
    const languageId = languageIdFor(key, d.workspace.text(key)); // o texto só conta se o nome não diz nada (shebang)
    if (!root || !languageId) return null;
    const path = keyToAbsolute(key, d.workspace.virtualPrefix(), root);
    return path ? { key, path, languageId } : null;
  }

  /** Arranca o servidor da pasta e abre o documento, se ainda não estiverem. */
  async function ensureOpen(doc: Doc): Promise<boolean> {
    const root = d.workspace.diskRoot();
    if (!root) return false;
    if (!(await serverOk(doc))) return false;
    let st = starting.get(root);
    if (!st) {
      st = d.lsp.start(root).catch(() => void starting.delete(root));
      starting.set(root, st);
    }
    await st;
    const pending = opening.get(doc.path);
    if (pending) return pending;
    if (versions.has(doc.path)) return true;
    const text = d.workspace.text(doc.key);
    if (text == null) return false;
    folder ??= root;
    versions.set(doc.path, 1);
    sent.set(doc.path, text);
    keys.set(doc.path, doc.key);
    const p = d.lsp.didOpen(doc.path, text, doc.languageId).then(
      () => true,
      () => {
        forget(doc.path);
        return false;
      },
    );
    opening.set(doc.path, p);
    void p.finally(() => opening.delete(doc.path));
    return p;
  }

  /** Esquece um documento (o servidor deixa de o ter aberto). */
  function forget(path: string): void {
    versions.delete(path);
    sent.delete(path);
    keys.delete(path);
  }

  /** Fecha um documento no servidor (depois do `didOpen` em curso, se houver). */
  async function closeDoc(path: string): Promise<void> {
    await opening.get(path);
    if (!versions.has(path)) return;
    forget(path);
    await d.lsp.didClose(path).catch(() => {});
  }

  async function onTabClosed(key: string | null): Promise<void> {
    if (!key) return;
    // pela chave (a pasta pode já ser outra: ao abrir uma pasta, os separadores da anterior fecham depois)
    for (const [path, k] of [...keys]) if (k === key) await closeDoc(path);
  }

  async function onWorkspaceChanged(): Promise<void> {
    for (const [path, k] of [...keys]) if (d.workspace.text(k) == null) await closeDoc(path);
  }

  async function onFolder(root: string): Promise<void> {
    const prev = folder;
    folder = root;
    if (!prev || prev === root) return;
    // o backend esquece os documentos dela e pára os servidores dela; aqui só se esquece o estado
    for (const path of [...keys.keys()]) if (path === prev || path.startsWith(`${prev}/`)) forget(path);
    starting.delete(prev);
    servers.clear();
    await d.lsp.closeFolder(prev).catch(() => {});
  }

  /** O registo efectivo da pasta aberta em uso, antes de decidir que linguagem é um ficheiro. */
  async function registryReady(): Promise<void> {
    const root = d.workspace.diskRoot();
    if (root && d.overrides) await d.overrides.ready(root);
  }

  async function onTab(tabId: string | null): Promise<void> {
    await registryReady();
    const doc = docOf(d.workspace.fileKeyOfTab(tabId));
    if (doc) await ensureOpen(doc);
  }

  /** Dá ao servidor o texto actual do documento, se mudou desde o último que recebeu. */
  async function sync(doc: Doc): Promise<void> {
    await opening.get(doc.path); // o didOpen em curso vai primeiro
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

  async function signatureHelpAt(offset: number, triggerCharacter: string | null, isRetrigger: boolean): Promise<SignatureView | null> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) return null;
    await sync(doc);
    const pos = offsetToPosition(d.workspace.text(doc.key) ?? "", offset);
    try {
      return signatureView(await d.lsp.signatureHelp(doc.path, pos.line, pos.character, triggerCharacter, isRetrigger));
    } catch {
      return null;
    }
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
    const applied = await applyEdit(result);
    if (!applied) {
      d.editor.notify("Nothing to rename here");
      return null;
    }
    const { out, fileOps } = applied;
    d.editor.notify(`Renamed to ${name}: ${editSummary(out, fileOps)}`);
    return out;
  }

  /** «N change(s) in M file(s)», mais o que saltou. */
  function editSummary(out: RenameResult, fileOps: number): string {
    const extra = [out.skipped.length ? `${out.skipped.length} file(s) skipped` : "", fileOps ? `${fileOps} file operation(s) not applied` : ""].filter(Boolean).join(", ");
    return `${out.edits} change(s) in ${out.files} file(s)${extra ? ` — ${extra}` : ""}`;
  }

  /** Aplica uma `WorkspaceEdit` aos ficheiros da pasta (rename, code actions e o
   *  `workspace/applyEdit` do servidor). `null` se não traz edições de texto. */
  async function applyEdit(result: unknown): Promise<{ out: RenameResult; fileOps: number } | null> {
    const { files, fileOps } = workspaceEditFiles(result);
    if (!files.length) return null;
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
    return { out, fileOps };
  }

  async function codeActionsAt(start: number, end: number): Promise<CodeActionItem[] | null> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) {
      d.editor.notify("No language server for this file");
      return null;
    }
    await sync(doc);
    const text = d.workspace.text(doc.key) ?? "";
    const s = offsetToPosition(text, start), e = offsetToPosition(text, end);
    try {
      return codeActionItems(await d.lsp.codeAction(doc.path, s.line, s.character, e.line, e.character));
    } catch (err) {
      d.editor.notify(`Language server: ${String(err)}`);
      return null;
    }
  }

  async function applyCodeAction(item: CodeActionItem): Promise<void> {
    if (item.disabled) {
      d.editor.notify(`${item.title}: ${item.disabled}`);
      return;
    }
    let changed: { out: RenameResult; fileOps: number } | null = null;
    if (item.edit) changed = await applyEdit(item.edit);
    // um comando que só traz a edição (java.apply.workspaceEdit): aplica-a aqui
    const local = clientSideEdit(item.command);
    if (local) changed = await applyEdit(local);
    else if (item.command) {
      const doc = docOf(d.workspace.currentFileKey());
      if (doc) {
        try {
          // as edições do comando, se houver, chegam por `onApplyEdit` (workspace/applyEdit)
          await d.lsp.executeCommand(doc.path, item.command.command, item.command.arguments);
        } catch (err) {
          d.editor.notify(`${item.title} failed: ${String(err)}`);
          return;
        }
      }
    }
    d.editor.notify(changed ? `${item.title}: ${editSummary(changed.out, changed.fileOps)}` : item.title);
  }

  async function formatAt(start: number, end: number): Promise<FormatOutcome> {
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc || !(await ensureOpen(doc))) return "fallback";
    await sync(doc);
    const text = d.workspace.text(doc.key) ?? "";
    const range = start !== end ? { start: offsetToPosition(text, Math.min(start, end)), end: offsetToPosition(text, Math.max(start, end)) } : null;
    let result: unknown;
    try {
      result = await d.lsp.format(doc.path, TAB_SIZE, true, range);
    } catch {
      result = null;
    }
    const edits = formattingEdits(result);
    if (!edits) {
      if (!range) return "fallback";
      // ex.: o kotlin-language-server (ktfmt) não formata fragmentos
      d.editor.notify("The language server could not format the selection — try Shift+Alt+F with no selection to format the whole file");
      return "failed";
    }
    if (!edits.length) return "unchanged";
    let next: string;
    try {
      next = applyTextEdits(text, edits);
    } catch {
      d.editor.notify("The language server returned overlapping edits — nothing was changed");
      return "failed";
    }
    if (next === text) return "unchanged";
    d.editor.replaceText(doc.key, next, caretAfterFormatting(text, next, Math.max(start, end)));
    return "formatted";
  }

  async function symbolsFor(key: string): Promise<SymbolEntry[] | null> {
    const doc = docOf(key);
    if (!doc || !(await ensureOpen(doc))) return null;
    await sync(doc);
    try {
      const r = await d.lsp.documentSymbols(doc.path);
      return r == null ? null : flattenSymbols(r); // null: sem sessão (o backend não a abriu)
    } catch {
      return null;
    }
  }

  async function workspaceSymbolsFor(query: string): Promise<WorkspaceSymbolSearch | null> {
    const root = d.workspace.diskRoot();
    if (!root) return null;
    const cur = docOf(d.workspace.currentFileKey());
    if (cur && versions.has(cur.path)) await sync(cur); // as edições por enviar contam
    let res: unknown;
    try {
      res = await d.lsp.workspaceSymbols(root, query);
    } catch {
      return { items: [], servers: 0 };
    }
    const prefix = d.workspace.virtualPrefix();
    const items = rankWorkspaceSymbols(workspaceSymbolHits(res), query).map((h) => {
      const key = keyOf(h.path);
      return { ...h, key: key && d.workspace.text(key) != null ? key : null, file: key ? key.slice(prefix.length) : h.path };
    });
    return { items, servers: Array.isArray(res) ? res.length : 0 };
  }

  async function openWorkspaceSymbol(s: WorkspaceSymbolResult): Promise<void> {
    if (!s.key) return;
    if (s.line !== null) {
      d.editor.open(s.key, s.line, s.character ?? 0);
      return;
    }
    d.editor.open(s.key, 1, 0);
    const at = locateInFile(s, (await symbolsFor(s.key)) ?? []);
    if (at) d.editor.open(s.key, at.line, at.character);
  }

  /** O documento de onde partiu a hierarquia: escolhe a sessão para os pedidos seguintes. */
  let typeDocPath: string | null = null;

  function typeEntry(n: TypeNode): TypeEntry {
    const key = keyOf(n.path);
    const prefix = d.workspace.virtualPrefix();
    return { ...n, key: key && d.workspace.text(key) != null ? key : null, file: key ? key.slice(prefix.length) : n.path ?? "" };
  }

  async function typeHierarchyAt(offset: number): Promise<TypeHierarchyStart | null> {
    const p = await at(offset);
    if (!p) return null;
    let res: unknown;
    try {
      res = await d.lsp.prepareTypeHierarchy(p.doc.path, p.line, p.character);
    } catch {
      return { status: "none" };
    }
    const r = preparedTypes(res);
    if (!r) return null;
    if (!r.supported) return { status: "unsupported", language: p.doc.languageId };
    if (!r.items.length) return { status: "none" };
    typeDocPath = p.doc.path;
    return { status: "ok", root: typeEntry(r.items[0]) };
  }

  async function typeHierarchyChildren(t: TypeEntry, direction: TypeDirection): Promise<TypeEntry[]> {
    const path = typeDocPath ?? t.path;
    if (!path) return [];
    try {
      return typeNodes(await d.lsp.typeHierarchy(path, t.raw, direction)).map(typeEntry);
    } catch {
      return [];
    }
  }

  function openType(t: TypeEntry): void {
    if (t.key) d.editor.open(t.key, t.line, t.character);
  }

  async function onApplyEdit(edit: unknown): Promise<void> {
    await applyEdit(edit);
  }

  function onDiagnostics(uri: string): void {
    const path = uriToPath(uri);
    const root = d.workspace.diskRoot();
    if (!path || !root) return;
    const key = absoluteToKey(path, d.workspace.virtualPrefix(), root);
    // Depois dos outros subscritores (o Problems do painel actualiza-se no mesmo evento).
    if (key && key === d.workspace.currentFileKey()) d.defer(() => d.editor.repaint(key));
  }

  async function onFileView(key: string): Promise<void> {
    await registryReady();
    const doc = docOf(key);
    if (doc) await serverOk(doc);
  }

  async function onConfigChanged(): Promise<void> {
    servers.clear();
    plans.clear();
    const doc = docOf(d.workspace.currentFileKey());
    if (!doc) {
      const key = d.workspace.currentFileKey();
      if (key) d.editor.notice(key, null); // a linguagem deixou de ter servidor: tira a faixa
      return;
    }
    if (await ensureOpen(doc)) d.editor.repaint(doc.key);
  }

  return { onTab, onEdit, hoverAt, definitionAt, referencesAt, prepareRenameAt, renameAt, completionAt, signatureHelpAt, codeActionsAt, applyCodeAction, onApplyEdit, formatAt, symbolsFor, workspaceSymbolsFor, openWorkspaceSymbol, typeHierarchyAt, typeHierarchyChildren, openType, onDiagnostics, opened: () => versions, onFileView, onConfigChanged, onTabClosed, onWorkspaceChanged, onFolder };
}
