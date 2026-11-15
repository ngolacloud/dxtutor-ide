// Thin, typed wrapper over the real Tauri backend. No simulation: outside the desktop app
// (plain browser) `invoke` throws a clear error, so a surface either works for real or fails
// loudly — there is no demo fallback anywhere in this frontend.

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen(ev: string, cb: (e: { payload: unknown }) => void): Promise<() => void> };
}

function tauri(): TauriGlobal | null {
  const w = window as unknown as { __TAURI__?: TauriGlobal };
  return w.__TAURI__ ?? null;
}

export const isDesktop = (): boolean => tauri() !== null;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = tauri();
  if (!t) throw new Error(`"${cmd}" needs the desktop app (no Tauri backend in the browser)`);
  return t.core.invoke<T>(cmd, args ?? {});
}

export async function listen(ev: string, cb: (payload: unknown) => void): Promise<() => void> {
  const t = tauri();
  if (!t) return () => {};
  return t.event.listen(ev, (e) => cb(e.payload));
}

// ── Backend command types (mirror the Rust signatures in src-tauri/src/bridge.rs) ──

export interface FileEntry { path: string; content: string }
export interface Loaded {
  root: string;
  name: string;
  files: FileEntry[];
  skipped: number;
  truncated: boolean;
}
export interface AppInfo {
  version: string; os: string; arch: string; home: string;
  configDir: string; selftest: string | null; openAtStart: string | null;
}

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  pickFolder: () => invoke<string | null>("pick_folder"),
  expandPath: (path: string) => invoke<string>("expand_path", { path }),
  loadWorkspace: (root: string) => invoke<Loaded>("load_workspace", { root }),
  writeFile: (root: string, rel: string, content: string) =>
    invoke<void>("write_file", { root, rel, content }),
  deleteFile: (root: string, rel: string) => invoke<void>("delete_file", { root, rel }),
  selftestReport: (report: unknown) => invoke<void>("selftest_report", { report }),
  runShell: (id: string, line: string, cwd: string, env?: Record<string, string>) =>
    invoke<void>("run_shell", { id, line, cwd, env: env ?? null }),
  killShell: (id: string) => invoke<boolean>("kill_shell", { id }),
  gitChanges: (root: string) => invoke<GitChange[]>("git_changes", { root }),
  gitCommit: (root: string, message: string) => invoke<void>("git_commit", { root, message }),
  gitStageAll: (root: string) => invoke<void>("git_stage_all", { root }),
  gitLog: (root: string, max?: number) => invoke<GitCommit[]>("git_log", { root, max: max ?? 30 }),
  gitBranch: (root: string) => invoke<string | null>("git_branch", { root }),
  gitBranches: (root: string) => invoke<string[]>("git_branches", { root }),
  gitCheckout: (root: string, branch: string) => invoke<void>("git_checkout", { root, branch }),
  gitCreateBranch: (root: string, name: string) => invoke<void>("git_create_branch", { root, name }),
  // git_show passa o arg tal-e-qual ao `git show`: com "HEAD:<rel>" devolve o conteúdo do blob.
  gitShow: (root: string, hash: string) => invoke<string>("git_show", { root, hash }),
  // fsops: caminhos ABSOLUTOS (espelham src-tauri/src/fsops.rs).
  createPath: (path: string, isDir: boolean) => invoke<void>("create_path", { path, isDir }),
  renamePath: (from: string, to: string) => invoke<void>("rename_path", { from, to }),
  deletePath: (path: string) => invoke<void>("delete_path", { path }),
  exec: (program: string, args: string[], cwd: string) =>
    invoke<ExecOut>("exec", { program, args, cwd, env: null, stdin: null, timeoutMs: 300000 }),
  keysStatus: () => invoke<Record<string, boolean>>("keys_status"),
  saveKey: (provider: string, key: string) => invoke<void>("save_key", { provider, key }),
  getProvidersConfig: () => invoke<ProvidersConfig>("get_providers_config"),
  getSandboxEngine: () => invoke<string>("get_sandbox_engine"),
  setSandboxEngine: (engine: string) => invoke<string>("set_sandbox_engine", { engine }),
  listProviders: () => invoke<ProviderInfo[]>("list_providers"),
  llmChat: (req: ChatReq, mode: string) => invoke<ChatResp>("llm_chat", { req, mode }),
  resolveHover: (root: string, file: string, line: number, col: number, text?: string) =>
    invoke<string | null>("resolve_hover", { root, file, line, col, text: text ?? null }),
  resolveDefinition: (root: string, file: string, line: number, col: number, text?: string) =>
    invoke<ResolvedDef | null>("resolve_definition", { root, file, line, col, text: text ?? null }),
  resolveReferences: (root: string, file: string, line: number, col: number, text?: string) =>
    invoke<ResolvedDef[]>("resolve_references", { root, file, line, col, text: text ?? null }),
  // LSP de sessão (src-tauri/src/lsp.rs): servidores persistentes por (língua, raiz do
  // projecto). Posições 0-based (wire LSP), ao contrário da família resolve_* (1-based).
  // lsp_rename devolve o WorkspaceEdit cru do servidor, {indexing:true} enquanto indexa,
  // ou null quando não há servidor para o ficheiro (o gate/UI tratam o skip honesto).
  lspStart: (root: string) => invoke<void>("lsp_start", { root }),
  lspDidOpen: (path: string, text: string, languageId: string) =>
    invoke<void>("lsp_did_open", { path, text, languageId }),
  lspDidChange: (path: string, text: string, version: number) =>
    invoke<void>("lsp_did_change", { path, text, version }),
  lspRename: (path: string, line: number, character: number, newName: string) =>
    invoke<LspWorkspaceEdit | null>("lsp_rename", { path, line, character, newName }),
  lspPrepareRename: (path: string, line: number, character: number) =>
    invoke<unknown>("lsp_prepare_rename", { path, line, character }),
  searchProject: (root: string, query: string, max = 200, ignoreCase = true) =>
    invoke<SearchHit[]>("search_project", { root, query, max, ignoreCase }),
  devcontainerInfo: (root: string) => invoke<DevcontainerInfo>("devcontainer_info", { root }),
  devcontainerSessionUp: (root: string) => invoke<DevcontainerUp>("devcontainer_session_up", { root }),
  devcontainerSessionStatus: (root: string) => invoke<SessionStatus>("devcontainer_session_status", { root }),
  devcontainerSessionExec: (root: string, cmd: string) => invoke<DevcontainerUp>("devcontainer_session_exec", { root, cmd }),
  devcontainerSessionDown: (root: string) => invoke<void>("devcontainer_session_down", { root }),
  debugAvailable: () => invoke<boolean>("debug_available"),
  debugLaunch: (id: string, program: string, cwd?: string) => invoke<void>("debug_launch", { id, program, cwd: cwd ?? null }),
  debugBreak: (id: string, file: string, line: number) => invoke<number>("debug_break", { id, file, line }),
  debugRun: (id: string) => invoke<DebugStop>("debug_run", { id }),
  debugContinue: (id: string) => invoke<DebugStop>("debug_continue", { id }),
  debugStep: (id: string, into: boolean) => invoke<DebugStop>("debug_step", { id, into }),
  debugLocals: (id: string) => invoke<DebugVar[]>("debug_locals", { id }),
  debugStack: (id: string) => invoke<DebugFrame[]>("debug_stack", { id }),
  debugStop: (id: string) => invoke<void>("debug_stop", { id }),
  fileOutline: (code: string, lang: string, root?: string, file?: string) =>
    invoke<SymbolRange[]>("file_outline", { code, lang, root: root ?? null, file: file ?? null }),
  reviewCode: (root: string, scope: string, path?: string, version?: string) =>
    invoke<ReviewReport>("review_code", { root, scope, path: path ?? null, version: version ?? null }),
  codevPolicy: (mode: string) => invoke<CoDevPolicy>("codev_policy", { mode }),
  codevSessionStart: (root: string, name: string) =>
    invoke<SessionInfo>("codev_session_start", { root, name }),
  codevSessionDeliver: (root: string, slug: string, message: string) =>
    invoke<DeliverInfo>("codev_session_deliver", { root, slug, message }),
  codevSessionDiscard: (root: string, slug: string) =>
    invoke<void>("codev_session_discard", { root, slug }),
  codevSessionList: (root: string) => invoke<SessionInfo[]>("codev_session_list", { root }),
  // Testing (tutor_eval::testnav): descoberta sintáctica + execução real por runner.
  listTests: (root: string) => invoke<TestItem[]>("list_tests", { root }),
  runTest: (root: string, path: string, lang: string) =>
    invoke<TestRun>("run_test", { root, path, lang }),
  runAllTests: (root: string) => invoke<TestRun>("run_all_tests", { root }),
  // Services: `docker compose ps` real sob root; erro honesto quando não há docker/stack.
  composePs: (root: string) => invoke<ComposeService[]>("compose_ps", { root }),
  // PTY (src-tauri/src/pty.rs): UMA sessão interactiva; os bytes chegam como eventos
  // pty://data (string) e pty://exit (número). run_shell continua a ser o modo linha.
  ptySpawn: (rows: number, cols: number) => invoke<void>("pty_spawn", { rows, cols }),
  ptyWrite: (data: string) => invoke<void>("pty_write", { data }),
  ptyResize: (rows: number, cols: number) => invoke<void>("pty_resize", { rows, cols }),
  // Streaming do assistente (main.rs): devolve já; os tokens chegam como eventos
  // llm://token/{done,error}, guardados por requestId. O backend decide a política pelo mode.
  assistantModels: () => invoke<string[]>("assistant_models"),
  assistantChatStream: (messages: AsstMsg[], provider: string, model: string | null, requestId: string, mode: string) =>
    invoke<void>("assistant_chat_stream", { messages, provider, model, requestId, mode, stepId: null }),
  assistantCancel: (requestId: string) => invoke<void>("assistant_cancel", { requestId }),
  // Board (src-tauri/src/board.rs → crate tutor-board, SQLite real): um backlog por raiz
  // de workspace (null → "default"). board_save substitui atomicamente; board_load devolve
  // null enquanto nunca se gravou nada para esta raiz.
  boardLoad: (root: string | null) => invoke<Backlog | null>("board_load", { root }),
  boardSave: (root: string | null, backlog: Backlog) => invoke<void>("board_save", { root, backlog }),
  // Architecture Studio (tutor_eval::arch): validação pura + scaffold. arch_scaffold ESCREVE
  // no disco (nunca sobrepõe) — a UI só o chama por acção explícita confirmada; a
  // pré-visualização (arch_scaffold_preview) devolve os pares (relPath, conteúdo) sem tocar
  // no disco e é o único caminho que o harness usa.
  archValidate: (arch: Architecture) => invoke<ArchFinding[]>("arch_validate", { arch }),
  archScaffoldPreview: (arch: Architecture) => invoke<[string, string][]>("arch_scaffold_preview", { arch }),
  archScaffold: (root: string, arch: Architecture) => invoke<string[]>("arch_scaffold", { root, arch }),
  // Estudo guiado (main.rs → crates tutor-*): catálogo e árvore de cursos embutidos reais,
  // execução de drills, correcção de challenges pelos testes ocultos e pistas governadas.
  listCourses: () => invoke<CourseSummary[]>("list_courses"),
  getCourse: (language: string) => invoke<Course>("get_course", { language }),
  getStudyGuide: (language: string, unitId: string) =>
    invoke<StudyGuide>("get_study_guide", { language, unitId }),
  runDrill: (code: string, language: string, dependencies: string[]) =>
    invoke<DrillRun>("run_drill", { code, language, dependencies }),
  submitStep: (stepId: string, code: string) => invoke<Assessment>("submit_step", { stepId, code }),
  requestHint: (phaseId: string, code: string, level: number) =>
    invoke<Hint>("request_hint", { phaseId, code, level }),
  // Missões (cloud-shaped task API, RF-AG-01): submit → status → cancel sobre um worktree git
  // isolado de HEAD (worktree_patch) — o resultado é um diff unificado para revisão humana.
  agentTaskSubmit: (root: string, writes: [string, string][]) =>
    invoke<string>("agent_task_submit", { root, writes }),
  agentTaskStatus: (id: string) => invoke<AgentTask | null>("agent_task_status", { id }),
  agentTaskCancel: (id: string) => invoke<boolean>("agent_task_cancel", { id }),
  // Theatre (observabilidade honesta, main.rs): trace_execution corre o programa REAL
  // (Python via settrace; Rust por instrumentação do fonte) e devolve os passos medidos;
  // compile_pipeline emite as representações reais da toolchain (LLVM-IR/ASM/MIR/binário);
  // symbol_relations mapeia definições/referências/callers (sintáctico → "inferred",
  // homónimos → ambiguous=true). Nada é fabricado — fases em falta vêm em notes.
  traceExecution: (language: string, code: string) =>
    invoke<ExecutionTraceDto>("trace_execution", { language, code }),
  compilePipeline: (code: string) => invoke<PipelineDto>("compile_pipeline", { code }),
  symbolRelations: (root: string, symbol: string) =>
    invoke<Relations>("symbol_relations", { root, symbol }),
  // Extensions (bridge.rs::vsix_manifest): parse REAL do zip .vsix no backend — devolve o
  // extension/package.json tal-e-qual. Não há host de extensão: ler o manifesto é TUDO o
  // que o backend dá, e a vista diz isso.
  vsixManifest: (b64: string) => invoke<VsixManifest>("vsix_manifest", { b64 }),
  // fsops: leitura/escrita de UM ficheiro de texto por caminho ABSOLUTO (o registo local
  // de extensões vive em <configDir>/extensions.json — ficheiro, não localStorage, porque
  // o perfil WebKitGTK persiste entre execuções e o gate tem de ser determinista).
  readTextFile: (path: string) => invoke<string>("read_text_file", { path }),
  writeTextFile: (path: string, contents: string) =>
    invoke<void>("write_text_file", { path, contents }),
};

// Espelham crates/tutor-board/src/lib.rs (serde camelCase; note/branch com default).
export interface Sprint { index: number; goal: string }
export interface Story {
  id: string;            // DX-N
  sprint: number;        // índice 0-based da sprint
  role: string;          // «Como <papel>»
  want: string;          // «quero <capacidade>»
  soThat: string;        // «para <benefício>»
  acceptance: string[];  // critérios de aceitação verificáveis
  points: number;
  stage: string;         // backlog|todo|dev|test|func|done
  kind: string;          // feature|fix
  prompt: string;        // prompt-template de execução
  note: string;
  branch: string | null;
}
export interface Backlog { problem: string; seq: number; sprints: Sprint[]; stories: Story[] }

// Espelham crates/tutor-eval/src/arch.rs (Kind/Relation/Severity em kebab-case; Finding camelCase).
export type ArchKind = "service" | "store" | "broker" | "consumer" | "relay" | "gateway";
export type ArchRelation = "writes" | "reads" | "publishes" | "consumes" | "routes-to";
export interface ArchComponent { id: string; name: string; kind: ArchKind; outbox: boolean }
export interface ArchConnection { from: string; to: string; relation: ArchRelation; event: string }
export interface Architecture { components: ArchComponent[]; connections: ArchConnection[] }
export interface ArchFinding { severity: "error" | "warning"; rule: string; message: string; component: string }

// Espelha tutor_llm::chat::ChatMsg (sem rename serde: role/content tal-e-qual).
export interface AsstMsg { role: string; content: string }
// Payloads dos eventos de streaming emitidos por assistant_chat_stream.
export interface StreamToken { requestId: string; delta: string }
export interface StreamDone { requestId: string; model: string }
export interface StreamError { requestId: string; error: string }

// Espelha tutor_eval::testnav::TestItem/TestRun (serde camelCase).
export interface TestItem { name: string; path: string; file: string; line: number; ignored: boolean; lang: string }
export interface TestRun { ran: boolean; passed: boolean; output: string }

// Espelha ComposeService em src-tauri/src/main.rs (campos minúsculos, sem renomeação).
export interface ComposeService { name: string; service: string; state: string; status: string; image: string; ports: string[] }

// Mirrors tutor_llm::chat::ProviderInfo (serde camelCase). The Team panel uses id/name/
// available + capabilities; `available` is the real, live state from the backend.
export interface ProviderInfo {
  id: string; name: string; available: boolean;
  streaming: boolean; cancel: boolean; tools: boolean; context: boolean;
  note: string; models: string[];
}

// Mirrors tutor_llm::chat::ProvidersConfig (serde camelCase). Secrets included — the UI must
// never render the *_key fields; only non-secret fields (ollamaHost/ollamaModel) are shown.
export interface ProvidersConfig {
  provider: string;
  anthropicKey: string;
  anthropicWorkspaceId: string;
  openaiKey: string;
  geminiKey: string;
  ollamaHost: string;
  ollamaModel: string;
  assistantModel: string;
}

export interface SessionInfo { slug: string; branch: string; base: string; worktree: string }
export interface DeliverInfo { merged: boolean; base: string; commit: string; note: string }

// Espelha tutor_llm::policy::CoDevPolicy (serde camelCase) — a matriz do dock é renderizada
// EXACTAMENTE destes campos; destructiveAlwaysAsks é a garantia independente do modo.
export interface CoDevPolicy {
  mode: string;
  editsNeedApproval: boolean;
  commandsNeedApproval: boolean;
  chains: boolean;
  destructiveAlwaysAsks: boolean;
}

// ── Estudo guiado: espelham os DTOs de main.rs. Step/Unit/Course/Complexity são serde
// camelCase; Correctness/Gabarito/Hint/DrillRun têm campos de uma palavra (sem renomeação). ──
export interface CourseSummary { id: string; language: string; title: string; level: string; summary: string }
export interface Step {
  kind: string; id: string; title: string; points: number; intro: string; difficulty: number;
  body: string; prompt: string; target: string; explanation: string; lineComments: string[];
  placeholderPolicy: string; installCommands: string[]; runCommand: string; dependencies: string[];
  instructions: string; entry: string; starter: string;
}
export interface Unit { id: string; title: string; intro: string; difficulty: number; level: string; steps: Step[] }
export interface Course { id: string; language: string; title: string; level: string; summary: string; units: Unit[] }
export interface StudyGuide { title: string; body: string }
export interface DrillRun { ok: boolean; stdout: string; stderr: string }
export interface Correctness { passed: boolean; summary: string; raw: string }
// O gabarito só vem do backend quando os testes passam (gabarito === null numa falha).
export interface Gabarito { solution: string; time: string; space: string; justification: string }
export interface Complexity { bigO: string; rSquared: number; exponent: number; confidence: string; ranking: [string, number][] }
export interface Assessment { correctness: Correctness; complexity: Complexity | null; expected: string | null; gabarito: Gabarito | null }
export interface Hint { text: string; provider: string; level: number }

// Espelha AgentTask de main.rs (serde camelCase): status "running" | "done" | "error".
export interface AgentTask { id: string; status: string; patch: string; error: string }

export interface SymbolRange { name: string; kind: string; startLine: number; endLine: number }
export interface Span { file: string; startLine: number; startCol: number; endLine: number; endCol: number }
export interface Finding { analyzer: string; rule: string | null; class: string; severity: string; message: string; primary: Span }
export interface AnalyzerRun { analyzer: string; ran: boolean; note?: string }
export interface ReviewReport { findings: Finding[]; analyzers: AnalyzerRun[]; version: string | null }

export interface DebugStop { stopped: boolean; reason: string; func: string; file: string; line: number; exited: boolean; exitCode: number | null }
export interface DebugVar { name: string; value: string }
export interface DebugFrame { level: number; func: string; file: string; line: number }

export interface DevcontainerInfo { present: boolean; name: string | null; image: string | null; path: string | null }
export interface DevcontainerUp { ok: boolean; image: string; built: boolean; ran: string; stdout: string; stderr: string }
export interface SessionStatus { running: boolean; name: string }

export interface ResolvedDef { file: string; line: number; col: number }

// ── Tipos wire LSP (só os campos lidos; 0-based, espelham src-tauri/src/lsp.rs) ──
export interface LspPos { line: number; character: number }
export interface LspRange { start: LspPos; end: LspPos }
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{ textDocument: { uri: string }; edits: LspTextEdit[] }>;
  // Sinal do backend (semantic): o servidor ainda está a indexar — tentar de novo.
  indexing?: boolean;
}
export interface LspDiagnostic { range: LspRange; message: string; severity?: number; source?: string }
export interface SearchHit { file: string; line: number; col: number; text: string }

export interface ExecOut { code: number; stdout: string; stderr: string; timedOut: boolean }

// llm_chat wire types (mirror src-tauri/src/llm.rs, serde camelCase).
export interface LlmToolCall { id: string; name: string; input: unknown }
export interface LlmTool { name: string; description: string; inputSchema: unknown }
export interface LlmMsg {
  role: string;
  text?: string;
  toolCalls?: LlmToolCall[];
  toolResults?: { id: string; content: string }[];
}
export interface ChatReq {
  provider: string; endpoint: string; model: string; system?: string;
  messages: LlmMsg[]; tools: LlmTool[]; maxTokens?: number;
}
export interface ChatResp {
  text: string; toolCalls: LlmToolCall[]; stop: string;
  inputTokens: number; outputTokens: number; origin: string; tutored: boolean;
}

// Backend stream events for a running shell command.
export interface ProcLine { id: string; line: string; err: boolean }
export interface ProcExit { id: string; code: number }

export interface GitChange { path: string; status: string; index: string; work: string }
export interface GitCommit {
  hash: string; short: string; parents: string[];
  subject: string; author: string; date: string; refs: string[];
}

// ── Theatre: espelham os DTOs de observabilidade honesta em src-tauri/src/main.rs ──
// (serde camelCase). Cada campo é MEDIDO da execução/toolchain reais; o que a toolchain
// não produz vem vazio com a razão em notes — nunca preenchido pelo cliente.
export interface VarDto { name: string; value: string; ty: string }
export interface TraceStepDto {
  line: number;
  /** "line" | "call" | "return" — o evento observado na execução real. */
  event: string;
  func: string;
  depth: number;
  locals: VarDto[];
  stdoutLen: number;
}
export interface ExecutionTraceDto { supported: boolean; notes: string; steps: TraceStepDto[]; stdout: string }
export interface PipelineDto {
  mir: string; llvmIr: string; asm: string;
  binaryBytes: number; disasm: string; notes: string;
}

// O package.json REAL lido do zip .vsix (vsix.rs devolve o JSON tal-e-qual; campos opcionais
// porque um manifesto alheio pode omitir qualquer um — a vista mostra só o que existe).
export interface VsixManifest {
  name?: string;
  publisher?: string;
  version?: string;
  displayName?: string;
  description?: string;
  engines?: Record<string, string>;
  contributes?: Record<string, unknown>;
}

// Espelham tutor_eval::codemap (Resolution/SymbolKind lowercase; SymbolRef/Relations camelCase).
// resolution="inferred" = correspondência sintáctica por nome; ambiguous=true = homónimos —
// a UI TEM de dizer qual (regra da skill editor-code-intelligence), nunca fingir resolução.
export type Resolution = "resolved" | "inferred";
export interface SymbolRef { name: string; kind: string; file: string; line: number; col: number }
export interface Relations {
  symbol: string;
  resolution: Resolution;
  definitions: SymbolRef[];
  references: SymbolRef[];
  callers: SymbolRef[];
  ambiguous: boolean;
}
