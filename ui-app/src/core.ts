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
  get MODE() {
    return window.MODE;
  },
  set MODE(v) {
    window.MODE = v;
  },
  get THRESH() {
    return window.THRESH;
  },
  set THRESH(v) {
    window.THRESH = v;
  },
  get cur() {
    return window.cur;
  },
  set cur(v) {
    window.cur = v;
  },
  get PANE() {
    return window.PANE;
  },
  set PANE(v) {
    window.PANE = v;
  },
};

/* ───── helpers puros (dono = core) ───── */

/** Escapa texto para interpolação segura em HTML. */
export const esc = (s: unknown): string =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

/** Escreve conteúdo no ficheiro virtual `p` e refresca a árvore. */
export const writeFile = (p: string, content: string): void =>
  window.writeFile(p, content);

/** Re-renderiza a vista `kind` se for a vista activa. */
export const rerender = (kind: string): void => window.rerender(kind);
