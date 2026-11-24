/* ═════════ feature `debug` (Run and Debug): legacy bridge (ADR-0002, Fase 1) ═════════
   O ÚNICO ficheiro da feature `debug` autorizado a ler ou escrever `window.*`.
   `features/debug.ts` (e o motor em `application/`, por portas) importa daqui em vez de
   usar nomes globais livres: cada acesso fica tipado e o `any` confina-se a este ficheiro.

   Como os bridges do Co-Dev/scm, os acessores lêem `window`/`G` NO ACTO da chamada,
   nunca no import: `debug.ts` avalia ANTES de `app.ts`/`v6.ts` publicarem os seus
   globais (RP/goPane/tabOf/LS/…). Capturar um valor ansiosamente aqui congelaria em
   `undefined`. Funções e getters são seguros porque só correm depois do arranque.

   ADR-0006, R1c2: saíram os acessores das sessões simuladas — a sessão `window.DBG`, o
   caminho e os helpers do lexer de demonstração (`P_LX`/`lexVariant`/`LXL`/`lexBug`), os
   ambientes/segredos do crash inventado, o checkpoint/diálogo/dono humano e os saltos
   para o Explain e os segredos de staging. */

const G = window as unknown as Record<string, any>;

/* ───── breakpoints: window-backed ─────
   `window.BPS` transporta o Set para que o editor (`window.dbgBreaks`, pintura do
   gutter) veja a MESMA referência que o motor. */
/** O Set de breakpoints (`path:line`), reutilizado se já existir no `window`. */
export const breakpoints = (): Set<string> => (G.BPS = G.BPS instanceof Set ? G.BPS : new Set<string>());

/* ───── navegação / separador actual / painel / registo de panes ───── */
export interface EditorTab { path?: string; kind?: string }
/** O separador actualmente activo (`tabOf(cur)`), ou `null`. */
export const currentTab = (): EditorTab | null => G.tabOf(G.cur) ?? null;
export const pane = (): string => G.PANE;
export const goPane = (p: string): void => G.goPane(p);
export const openPath = (p: string, line?: number): void => G.openPath(p, line);
export const paintEd = (p: string): void => G.paintEd(p);
export const setPanelTab = (pt: string, nofocus?: boolean): void => G.setPanelTab(pt, nofocus);
export const panes = (): Record<string, () => void> => G.RP;

/* ───── a pasta aberta, o FS e um comando na pasta (ADR-0006, R4) ───── */
/** A pasta aberta no desktop (null sem pasta e no browser). */
export const root = (): string | null => (G.DXR && G.DXR.root) || null;
/** O prefixo das chaves do FS (`ROOT`). */
export const fsRoot = (): string => G.ROOT;
/** O conteúdo de um ficheiro do FS (null se não existe). */
export const content = (key: string): string | null => (G.FS && G.FS[key] ? G.FS[key].content : null);
/** As chaves do FS. */
export const fsKeys = (): string[] => (G.FS ? Object.keys(G.FS) : []);
/** Corre um comando na pasta aberta (`DXR.exec`: código de saída real e a saída). */
export const exec = async (cmd: string): Promise<{ ok: boolean; out: string }> => {
  const d = G.DXR;
  if (!d || typeof d.exec !== "function") return { ok: false, out: "sem app desktop" };
  const r = await d.exec(cmd);
  return { ok: !!r.ok, out: String(r.out ?? r.sum ?? "") };
};
/** A paleta: escolher de uma lista, ou escrever um texto. Resolve com null se a paleta fechar
 *  sem escolha (senão o motor ficava à espera para sempre). */
function palettePromise(cfg: (done: (v: string) => void) => Record<string, unknown>): Promise<string | null> {
  return new Promise((res) => {
    let settled = false;
    const done = (v: string): void => { if (!settled) { settled = true; res(v); } };
    G.palette("", cfg(done));
    const watch = setInterval(() => {
      if (settled) { clearInterval(watch); return; }
      const pal = document.getElementById("pal");
      if (!pal || !pal.classList.contains("show")) { clearInterval(watch); settled = true; res(null); }
    }, 300);
  });
}
export const paletteChoose = (title: string, items: string[]): Promise<string | null> =>
  palettePromise((done) => ({ ph: title, items: items.map((l) => ({ l, run: () => done(l) })) }));
export const paletteAsk = (title: string): Promise<string | null> =>
  palettePromise((done) => ({ ph: title, verb: "Depurar", text: (q: string) => done(q) }));

/* ───── persistência (LS, para os breakpoints `bps6`) ───── */
export const lsGet = <T>(key: string, def: T): T => G.LS.get(key, def);
export const lsSet = (key: string, val: unknown): void => G.LS.set(key, val);

/* ───── publicação da superfície pública da feature no `window` ─────
   Os nomes reais resolvem o keydown (`features/shortcuts.ts`), os menus/CMD de v6.ts e
   as fachadas que o editor lê (`dbgBreaks`). */
export const publish = (surface: Record<string, unknown>): void => {
  Object.assign(window, surface);
};
