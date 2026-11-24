/* ═════════ dxtutor IDE — core (fundação tipada da reestruturação por feature) ═════════
   Fase 0 da reestruturação POR FUNCIONALIDADE. Ao contrário das camadas transitórias
   v5/v6/v7 (window-globals + @ts-nocheck), este módulo é tipado a sério (strict, SEM
   @ts-nocheck) e expõe a superfície partilhada com import/export reais:

     • `S` — estado partilhado como OBJECTO tipado. As propriedades são getters/setters
       sobre `window`, a MESMA fonte única que o monólito lê/escreve pelos nomes livres
       (MODE/THRESH/cur/PANE → globalThis.*). Primitivos reatribuídos NÃO aliasam entre
       módulos (`export let x` dá cópias); um objecto com acessores sobre `window` alia.
     • helpers puros (`esc`,`$`,`$$`) — implementados aqui, para as features os importarem.
     • helpers acoplados ao monólito (`svg`,`show`,`log`,`toast`,`writeFile`,`rerender`)
       — fachada tipada sobre `window` enquanto o corpo vive no monólito (shim transitório).

   Estratégia strangler-fig: o monólito continua a resolver tudo via `window`; as features
   novas consomem este core. À medida que cada corpo migra para cá, a fachada vira dono e
   o `window.*` passa a ser só o espelho — até o residual sair e o shim cair. */

/** Um commit na timeline «O que mudou e porquê» (feature `changelog`). Espelha o
 *  DTO real `tutor_eval::git::GitCommit` do backend — a fonte simulada (GIT.c) é
 *  mapeada para esta mesma forma, para a vista não distinguir real de simulado. */
import { agentStore, editorStore, layoutStore } from "./app/store";

export interface ClCommit {
  hash: string;
  short: string;
  parents: string[];
  subject: string;
  author: string;
  date: string;
  refs: string[];
}

declare global {
  interface Window {
    /* estado partilhado (fonte única; o monólito lê/escreve pelos nomes livres) */
    MODE: string;
    THRESH: number;
    cur: string | null;
    PANE: string;
    /* helpers cujo corpo ainda vive no monólito (fachada tipada) */
    svg: (name: string, cls?: string) => string;
    show: (id: string) => void;
    log: (src: string, msg: string) => void;
    toast: (m: string) => void;
    writeFile: (p: string, content: string) => void;
    rerender: (kind: string) => void;
    /* superfície que a feature `theme` ainda resolve via window (shim transitório) */
    THEME: string;
    THEMES: Record<string, Record<string, string>>;
    save: () => void;
    tabOf: (id: string | null) => { kind?: string } | null;
    setTheme: (n: string) => void;
    /* feature `notifications`: o residual (app.ts/v6.ts) emite notas e abre o painel por nome livre */
    note: (m: string) => void;
    toggleNotes: () => void;
    /* feature `remote`: o residual delega o render do pane por nome (RP.remote → window.renderRemotePane) */
    renderRemotePane: () => void;
    /* feature `run`: o residual delega o render do pane por nome (RP.run → window.renderRunPane) */
    renderRunPane: () => void;
    /* feature `test`: motor de testes simulado (dono = monólito) + delegação do pane (RP.test → window.renderTestPane) */
    runTests: (pkg?: string) => {
      build: boolean;
      err: string;
      ok: boolean;
      tests: Array<{ n: string; ok: boolean }>;
    };
    renderTestPane: () => void;
    /* feature `account`: mapa vivo de provedores + estado por provedor (dono = monólito) + delegação do pane */
    PROV: Record<string, Prov>;
    provState: (k: string) => string;
    renderAccountPane: () => void;
    /* feature `search`: sistema de ficheiros virtual + ícone/refresh (dono = monólito),
       leaves migrados (resolvidos por nome livre: `onclick="replaceAll()"` e o comando
       Todo Tree em v6.ts chamam `doSearch`) + delegação do pane. */
    FS: Record<string, { content: string; orig: string | null }>;
    fIcon: (p: string) => string;
    refresh: (fromEd?: boolean, force?: boolean) => unknown;
    doSearch: () => void;
    replaceAll: () => void;
    renderSearchPane: () => void;
    /* feature `debug` (migrada de v6.ts): sessão de depuração simulada + lançadores.
       O estado/motor (`DBG`, `debugConfigs`, `BPS`) continua dono de v6.ts; a feature
       lê por fachada tipada e delega o pane (RP.debug → window.renderDebugPane). */
    DBG: unknown;
    debugConfigs: () => Array<{ id: string; l: string; d: string }>;
    BPS: Set<string>;
    renderDebugPane: () => void;
    /* feature `scm` (migrada de app.ts): Source Control + grafo/gitflow resumidos.
       Dados/helpers donos do monólito, lidos por fachada; estado primitivo (BRANCH,
       COMMIT_MSG) é window-backed (nomes livres do monólito aliasam estas props). */
    BRANCH: string;
    COMMIT_MSG: string;
    changes: () => string[];
    STAGED: Set<string>;
    graphLayout: () => { rows: Array<{ h: string; col: number; pl: number[] }>; idx: Record<string, number>; max: number };
    short: (p: string) => string;
    stOf: (p: string) => string;
    GIT: any;
    LANE: string[];
    authorOf: (a: string) => { n: string; col: string };
    rel: (t: number) => string;
    gfGuide: () => string;
    /* commit v4 git-aware (módulo-local do monólito), distinto de window.commit (v2):
       o onkeydown Ctrl+Enter do pane scm chama esta fachada. */
    commitGit: (msg?: string, author?: string) => unknown;
    renderScmPane: () => void;
    /* feature `graph` (migrada de app.ts): corpo do renderer da tab `graph` (DAG de
       commits). O motor git (graphLayout/GIT/LANE/BRANCH/authorOf/isFlow/GSEL/rel) é
       lido por nome livre (ambiente, declarado em bridge.ts/pair.ts), como diff.ts lê
       FS; aqui só a delegação do render (VIEW.graph → window.renderGraphView). */
    renderGraphView: (t: unknown, host: HTMLElement) => void;
    /* feature `termgit` (migrada de app.ts): handler `git` do terminal (XC.git). O motor
       git é lido por nome livre, como graph.ts; `XC.git` (features/terminal.ts) fica SHIM:
       `XC.git=(a,raw)=>window.gitCmd(a,raw)`. */
    gitCmd: (a: string[], raw: string) => { ok: boolean } | undefined;
    /* feature `diff`: corpo do renderer da tab `diff` (VIEW.diff → window.renderDiffView). */
    renderDiffView: (t: unknown, host: HTMLElement) => void;
    /* feature `router`: amostragem ao vivo disponível (router inicializa; bridge põe a true). */
    LIVE_OK: boolean;
    /* feature `diagnostics`: motor de diagnósticos/lint/testes derivado de FS; consumido por nome
       livre por codev/board/test/ext/debug e pelo residual (drawProblems/nextProblem em refresh/boot). */
    has: (p: string, re: RegExp) => boolean;
    lexBug: () => boolean;
    dsLint: () => { p: string; line: number; hex: string }[];
    diagnostics: () => { p: string; line: number; sev: string; msg: string }[];
    drawProblems: () => void;
    nextProblem: () => void;
    /* feature `changelog` (harvest da ui-next): vista «O que mudou e porquê» = timeline
       git. A fonte de dados é window-resolved para a bridge poder trocar o simulado
       (GIT.c/COMMITS, dono = scm.ts) pelo real (git_log/git_show) em desktop. O residual
       (menu Help + paleta) delega o render por nome (VIEW.analysis → renderChangelogPage). */
    COMMITS: Array<{ h: string; m: string }>;
    renderChangelogPage: (t: unknown, host: HTMLElement) => void;
    clLog: () => Promise<ClCommit[]>;
    clShow: (hash: string) => Promise<string>;
    /* feature `tutor` (migrada de app.ts): pane «Learning Track» (v4). O curso e o
       progresso (LTS) continuam donos do monólito; a feature lê por fachada. */
    LTS: { lang: string | null; levels: string[]; done: Record<string, unknown>; open: Record<string, boolean>; cur: string | null };
    course: () => { title: string; units: any[] };
    ltUnits: () => any[];
    ltDone: (id: string) => boolean;
    ltSeq: () => any[];
    ltPts: () => number;
    LT_BADGE: Record<string, string>;
    stars: (d: number, kind?: string) => string;
    renderTutorPane: () => void;
    /* feature `tasks` (migrada de v6.ts): pane «Tasks» (backlog/sprints) + vista de
       detalhe da issue (VIEW.issue). O backlog (BL), estágios (STAGES) e agentes
       (AGENTS) continuam donos do monólito/board.ts/team.ts; nfmt é do core (import). TK/
       STC/ownerName/openIssue/advice/costAvg/usd são agora donos da própria feature. */
    BL: any;
    AGENTS: Record<string, any>;
    STAGES: Array<[string, string]>;
    renderTasksPane: () => void;
    /* feature `team` (motor do harness de projecto, migrado de v5.ts): `applyTemplate`
       é reatribuído por inteiro por v6.ts (como dxRun/dxStop/setMode em app.ts), por
       isso fica `window.applyTemplate=` directo em vez de `export`/`Object.assign`. */
    applyTemplate: (id: string) => void;
    /* feature `codereview` (migrada de v6.ts): Explain / Code review / Under the hood.
       `renderCreviewView`/`renderHoodView` são donas destas duas tabs (VIEW.creview/
       VIEW.hood ficam shim em v6.ts). As restantes peças (curFile/explainCmd/reviewCmd/
       hoodCmd/reviewFindings) são publicadas por `Object.assign(window,…)` sem entrada
       aqui — só o resíduo @ts-nocheck de v6.ts as chama por nome livre. As entradas
       abaixo são fachadas que a feature CONSOME doutras features/do monólito: `symbols`
       (explorer.ts), `selText` (editor.ts), `updateAgentUI` (codev.ts), `composeServices`
       (stack.ts), `lexVariant`/`LXL` (continuam donas de v6.ts), `dbgState` (debug.ts). */
    renderCreviewView: (t: unknown, host: HTMLElement) => void;
    renderHoodView: (t: unknown, host: HTMLElement) => void;
    symbols: (p: string) => Array<{ k: string; n: string; line: number }>;
    selText: () => string;
    updateAgentUI: () => void;
    composeServices: () => Array<{ name: string; deps: string[]; image?: string; build?: string; port?: string; route?: string; hc?: boolean }> | null;
    lexVariant: () => string;
    LXL: (re: RegExp) => number;
    dbgState: () => { end?: { t: string; b: string }; feed: Array<{ h: string }> } | null;
    /* feature `ext` (motor migrado de v6.ts, @ts-nocheck): pane «Extensions» (Open VSX).
       A feature é agora dona de todo o motor (catálogo EXT, estado instalado EXS,
       instalar/remover/alternar, comandos, VSIX, formatador) e publica-o no window;
       v6 retém só os shims (RP.ext/VIEW.extd) e lê o motor por fachada vsxOn/vsxFmt/
       vsxCmds. Estas decls documentam a superfície window partilhada. */
    EXS: any;
    EXT: any[];
    projectContext: () => Array<[string, string]>;
    extAll: () => any[];
    extRow: (x: any) => string;
    renderExtPane: () => void;
    /* feature `codev` (migrada de app.ts): pane «Co-Dev» (base v3 + decoração v4
       Equipa/Backlog/Studio dobradas num só render). Missões, checkpoints, routing,
       papéis e o desenho (SD, window-backed) continuam donos do monólito. */
    MISSIONS: any[];
    DECS: any[];
    CKPT: any[];
    GAPS: Array<[string, string, string, string]>;
    badges: () => void;
    ROUTE: Record<string, string>;
    ROLE: Record<string, string>;
    ROLE_D: Record<string, string>;
    MODES: Record<string, { l: string; d: string }>;
    CRIT: Array<{ k: string; s: string; l: string; w: number }>;
    provFor: (r: string) => string;
    SD: any;
    renderCodevPane: () => void;
    renderWelcomePage: (t: unknown, host: HTMLElement) => void;
    renderSettingsPage: (t: unknown, host: HTMLElement) => void;
    renderManagerPage: (t: unknown, host: HTMLElement) => void;
    renderAgentView: (t: unknown, host: HTMLElement) => void;
    testProv: (k: string, btn: HTMLElement) => void;
    doTool: (t: { t: string; [k: string]: any }, host: Element, role?: string) => Promise<unknown>;
    runMission: (S: any, text?: any) => unknown;
    demo: (x: string) => void;
    setMode: (m: string) => void;
    /* feature `infra` (migrada de v5.ts base + v6.ts decoração): pane «Infra» (runtime
       de contentores, dev container, Kubernetes, environments). Base v5 + decoração v6
       dobradas num só render; a feature é agora dona dos dois motores (DEVC/K8S/STACK
       continuam window-backed por causa de bridge.ts/stack.ts; ENVS/RTN/KCTX/k8sDocs e
       ENVL/ENVX/envHealth/envState/openObserve nascem e vivem em features/infra.ts). */
    ENVS: any;
    RTN: Record<string, string>;
    KCTX: string[];
    DEVC: any;
    K8S: any;
    STACK: any;
    k8sDocs: () => any[];
    P_DC: string;
    ENVL: Record<string, string>;
    ENVX: any;
    envHealth: (e: string) => string;
    envState: (e: string) => any;
    openObserve: (env: string, n: string) => void;
    renderInfraPane: () => void;
    infraDraw: () => void;
    /* feature `syntax` (migrada de app.ts): realce de uma linha. O editor (paintEd),
       o diff, o `cat` do terminal e o outline — em app.ts e em v5.ts/v6.ts —
       resolvem-no por nome livre. */
    hlLine: (s: string, ext: string) => string;
    /* feature `ext`, Fase 4 (ADR-0005): contribuições declarativas de extensões VS Code.
       O editor pede o realce TextMate do documento, a expansão de snippets (Tab) e o
       toggle de comentário (Ctrl+/); ausentes no harness, por isso opcionais. */
    vsxHighlight?: (ext: string, lines: string[]) => string[] | null;
    vsxSnippet?: (ta: HTMLTextAreaElement, path: string) => boolean;
    vsxToggleComment?: (ta: HTMLTextAreaElement, path: string) => boolean;
    /* feature `palette` (migrada de app.ts): paleta de comandos / quick open. O estado
       é window-backed porque o resíduo boot/keydown de app.ts o lê por nome livre:
       boot usa PIDX/PITEMS + palDraw/palRun, o keydown usa closePal. */
    PAL: any;
    PIDX: number;
    PITEMS: any[];
    PAL_TEXT: (q: string) => void;
    palette: (pre?: string, cfg?: any) => void;
    closePal: () => void;
    fuzzy: (q: string, s: string) => boolean;
    palDraw: () => void;
    palRun: (i: number) => void;
  }
}

/* ───── provedores de LLM (tipo partilhado; dono do dado = monólito) ───── */
export interface Prov {
  name: string;
  vendor: string;
  model: string;
  ep: string;
  on: boolean;
  col: string;
  local?: boolean;
}

/** Mapa vivo de provedores de LLM indexado por chave (`claude`/`gemini`/…).
 *  Fachada: lê `window.PROV` NO ACTO da chamada — nunca captura no eval do módulo,
 *  porque o monólito só publica `window.PROV` depois das features carregarem. */
export const prov = (): Record<string, Prov> => window.PROV;

/** Rótulo do estado de um provedor ligado (ex. «ao vivo», «local · simulado»).
 *  Corpo no monólito; fachada resolve `window.provState` no acto. */
export const provState = (k: string): string => window.provState(k);

/* ───── estado partilhado ───── */
export interface SharedState {
  MODE: string;
  THRESH: number;
  cur: string | null;
  PANE: string;
}

/** Estado partilhado tipado. Acessores sobre `window` → alia com os nomes livres do
 *  monólito (MODE/THRESH/cur/PANE). Converter `export let` soltos não aliasaria. */
export const S: SharedState = {
  /* U3 (ADR-0004): os donos destes valores são os stores de app/store — o S fica como
     fachada de compatibilidade para os legacy-bridges das features. */
  get MODE() {
    return agentStore.mode;
  },
  set MODE(v) {
    agentStore.mode = v;
  },
  get THRESH() {
    return agentStore.threshold;
  },
  set THRESH(v) {
    agentStore.threshold = v;
  },
  get cur() {
    return editorStore.currentTabId;
  },
  set cur(v) {
    editorStore.currentTabId = v;
  },
  get PANE() {
    return layoutStore.pane;
  },
  set PANE(v) {
    layoutStore.pane = v;
  },
};

/* ───── helpers puros (dono = core) ───── */

/** Escapa texto para interpolação segura em HTML. */
export const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Uma contagem curta (1.2k, 3.4M) — os tokens nos cartões, no Tasks e no custo. Era
 *  léxica do v6.ts (ADR-0004, U4g3). */
export const nfmt = (n: number): string => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n | 0));

/** Literal JS seguro para interpolar num atributo de handler inline:
 *  `onclick="openPath(${jsa(p)})"`. JSON.stringify fecha o contexto JS (aspas,
 *  barras, quebras de linha, U+2028) e `esc` fecha o contexto do atributo HTML
 *  (o browser descodifica as entidades antes de correr o handler). Nunca usar
 *  `'${x}'` dentro de on*="…": um caminho ou nome vindo do disco, do git, de um
 *  VSIX ou do par remoto com `'` torna-se código. */
/** Tempo relativo em português («agora», «há 5 min», «há 2 h», «há 3 d»). Era do app.ts (ADR-0004, U4j3). */
export const rel=(t: number): string=>{const m=Math.round((Date.now()-t)/60000);return m<1?'agora':m<60?`há ${m} min`:m<1440?`há ${Math.round(m/60)} h`:`há ${Math.round(m/1440)} d`;};

/** Markdown completo (títulos, listas, código em bloco, negrito/itálico/código em linha) para HTML,
 *  com o texto escapado. Era o `mdFull` do app.ts (ADR-0004, U4j3). */
export function mdFull(s: unknown): string {const out: string[]=[],inl=(x: string)=>esc(x).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g,'$1<i>$2</i>');
  String(s||'').split(/```/).forEach((p: string,i: number)=>{if(i%2){out.push(`<pre>${esc(p.replace(/^[a-z]*\n/,'').replace(/\n$/,''))}</pre>`);return;}
    p.split(/\n{2,}/).forEach((b: string)=>{b=b.trim();if(!b)return;
      if(/^#{1,4}\s/.test(b)){const[h,...r]=b.split('\n');out.push(`<h3>${inl(h.replace(/^#+\s*/,''))}</h3>`);if(r.length)out.push(`<p>${inl(r.join(' '))}</p>`);}
      else if(/^\s*[-*]\s/.test(b))out.push('<ul>'+b.split(/\n(?=\s*[-*]\s)/).map((l: string)=>`<li>${inl(l.replace(/^\s*[-*]\s+/,'').replace(/\n\s*/g,' '))}</li>`).join('')+'</ul>');
      else out.push(`<p>${inl(b.replace(/\n/g,' '))}</p>`);});});return out.join('');}

export const jsa = (s: unknown): string =>
  esc(JSON.stringify(String(s == null ? "" : s)));

/** `document.querySelector` tipado. */
export const $ = (sel: string): HTMLElement | null =>
  document.querySelector<HTMLElement>(sel);

/** `document.querySelectorAll` como array tipado. */
export const $$ = (sel: string): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>(sel),
];

/** Hora de parede em HH:MM. (O monólito mantém a sua cópia residual até migrar.) */
export const hhmm = (): string => {
  const d = new Date(),
    p = (n: number): string => String(n).padStart(2, "0");
  return p(d.getHours()) + ":" + p(d.getMinutes());
};

/** Cabeçalho de um painel lateral: título + acções opcionais à direita.
 *  (Helper puro partilhado pelos renders de pane; o monólito mantém a sua cópia
 *  residual `const hd` até os panes migrarem.) */
export const hd = (t: string, acts?: string): string =>
  `<div class="side-hd"><span class="t">${t}</span><span class="acts">${acts || ""}</span></div>`;

/* ───── helpers acoplados ao monólito (fachada tipada → window; migram depois) ───── */

/** SVG de ícone (corpo em boot.ts; usa a biblioteca `P`). */
export const svg = (name: string, cls?: string): string => window.svg(name, cls);

/** Renderiza o separador `id` no editor. */
export const show = (id: string): void => window.show(id);

/** Linha de log na consola de saída. */
export const log = (src: string, msg: string): void => window.log(src, msg);

/** Notificação efémera (toast). */
export const toast = (m: string): void => window.toast(m);

/** Opções do diálogo modal: título e corpo em HTML, campo de texto opcional (`input` é o
 *  placeholder) com validação, rótulo do botão e bloqueio do OK. */
export interface DlgOptions {
  title: string;
  body: string;
  input?: string | null;
  rows?: number;
  ok?: string;
  block?: boolean | number;
  validate?: (v: string) => string;
  onOk?: (v: string) => void;
}

/** O diálogo modal partilhado (`#dlg`, criado na primeira vez). Era do v6.ts (ADR-0004,
 *  U4g7); os legacy-bridges do debug/infra/board importam-no daqui. Como no original, o OK
 *  chama `onOk` sem verificar (todos os chamadores o passam). */
export function dlg(o: DlgOptions): void {
  let d = $("#dlg");
  if (!d) {
    document.body.insertAdjacentHTML("beforeend", '<div id="dlg"></div>');
    d = $("#dlg") as HTMLElement;
  }
  const box = d;
  box.innerHTML = `<div class="dlg-box"><h2>${o.title}</h2><div class="dlg-b">${o.body}</div>${o.input ? `<textarea id="dlg-in" rows="${o.rows || 3}" placeholder="${esc(o.input)}"></textarea><div class="dlg-err" id="dlg-err"></div>` : ""}<div class="dlg-f"><button class="mini" id="dlg-no">Cancel</button><button class="mini pri" id="dlg-ok"${o.block ? " disabled" : ""}>${o.ok || "OK"}</button></div></div>`;
  box.classList.add("show");
  const close = (): void => box.classList.remove("show"),
    i = $("#dlg-in") as HTMLTextAreaElement | null;
  ($("#dlg-no") as HTMLElement).onclick = close;
  box.onclick = (e) => {
    if (e.target === box) close();
  };
  ($("#dlg-ok") as HTMLElement).onclick = () => {
    const v = i ? i.value.trim() : "";
    const err = o.validate ? o.validate(v) : "";
    if (err) {
      ($("#dlg-err") as HTMLElement).textContent = err;
      return;
    }
    close();
    (o.onOk as (v: string) => void)(v);
  };
  if (i) setTimeout(() => i.focus(), 0);
}

/** Escreve conteúdo no ficheiro virtual `p` e refresca a árvore. */
export const writeFile = (p: string, content: string): void =>
  window.writeFile(p, content);

/** Re-renderiza a vista `kind` se for a vista activa. */
export const rerender = (kind: string): void => window.rerender(kind);
