/* ═════════ feature `lsp` — realce com as gramáticas que vêm com o dxtutor (LSP P5) ═════════
   Quando nenhuma extensão instalada traz a gramática da linguagem do ficheiro (essa ganha sempre: o
   editor pergunta-lhe primeiro), o realce vem da gramática que o dxtutor traz para essa linguagem
   (`domain/grammars.ts`), pelo mesmo tokenizador TextMate «lite» das extensões.
   O tokenizador custa ~0,25 ms por linha; repintar o documento inteiro a cada tecla faria um ficheiro
   de mil linhas engasgar. Por isso o realce é INCREMENTAL: guarda, por ficheiro, o HTML e o estado
   do tokenizador depois de cada linha; uma linha com o mesmo texto e o mesmo estado à entrada dá o
   mesmo resultado (o tokenizador é determinista), e reaproveita-se. A cada pintura só se tokenizam as
   linhas que mudaram (no máximo `budget` de cada vez); o resto continua depois, em pedaços (`chunk`),
   e o editor volta a pintar quando acabar. Enquanto isso, as linhas por fazer mostram o realce antigo
   (ou nenhum, e o editor usa o de sempre). A gramática carrega-se na primeira vez (um `import()`).
   Sem DOM, sem `window`. */

import { loadGrammar, scopeClass, tokenizeLine, type Grammar, type LineState, type RawGrammar, type Token } from "../../ext/domain/textmate";
import { bundledGrammarFor } from "../domain/grammars";
import { languageFor } from "../domain/registry";

export interface GrammarFiles {
  /** o JSON de uma gramática de `languages/grammars/` (`null` se não existe) */
  load(file: string): Promise<RawGrammar | null>;
}

export interface FallbackHighlightDeps {
  files: GrammarFiles;
  /** corre `f` depois (por omissão `setTimeout(f, 0)`) — o resto de um documento grande */
  defer?: (f: () => void) => void;
  /** linhas tokenizadas de uma vez numa pintura (por omissão 300) */
  budget?: number;
  /** linhas por pedaço no resto (por omissão 400) */
  chunk?: number;
  /** ficheiros com realce guardado (por omissão 8; os menos usados saem) */
  maxDocs?: number;
}

export interface FallbackHighlighter {
  /** O HTML de cada linha (uma entrada pode faltar enquanto o resto ainda se faz), ou `null` quando
   *  nenhuma gramática do dxtutor serve o ficheiro ou ela ainda está a carregar. `repaint` é chamado
   *  quando há mais para mostrar (a gramática carregou, o resto do documento ficou pronto). */
  highlight(path: string, lines: readonly string[], repaint: () => void): Array<string | undefined> | null;
  /** Resolve quando não há nada pendente (carregamentos e o resto dos documentos) — para os testes. */
  idle(): Promise<void>;
}

interface Doc {
  path: string;
  grammar: Grammar;
  /** o texto das linhas que o realce descreve */
  lines: readonly string[];
  html: string[];
  /** o estado do tokenizador DEPOIS de cada linha */
  after: LineState[];
  /** as linhas [0, done) estão feitas para `lines` */
  done: number;
  /** o realce antigo das linhas ainda por fazer (para não piscarem) */
  stale: Array<string | undefined>;
  scheduled: boolean;
  repaint: () => void;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** O HTML de uma linha a partir dos tokens (as mesmas classes do editor que o `highlightLines`). */
function lineHtml(line: string, tokens: readonly Token[]): string {
  let html = "", pos = 0;
  for (const t of tokens) {
    if (t.start > pos) html += esc(line.slice(pos, t.start));
    const cls = scopeClass(t.scopes);
    const text = esc(line.slice(t.start, t.end));
    html += cls ? `<span class="${cls}">${text}</span>` : text;
    pos = t.end;
  }
  return html + esc(line.slice(pos));
}

/** Dois estados do tokenizador iguais: as mesmas regras abertas, com o mesmo fim e os mesmos scopes. */
function sameState(a: LineState | null, b: LineState | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x.rule !== y.rule || (x.end ? x.end.source : null) !== (y.end ? y.end.source : null) || x.scopes.join(" ") !== y.scopes.join(" ")) return false;
  }
  return true;
}

export function makeFallbackHighlighter(d: FallbackHighlightDeps): FallbackHighlighter {
  const defer = d.defer ?? ((f: () => void) => void setTimeout(f, 0));
  const budget = d.budget ?? 300, chunk = d.chunk ?? 400, maxDocs = d.maxDocs ?? 8;
  /** a gramática de cada ficheiro de `languages/grammars/` (`null`: não carregou) */
  const grammars = new Map<string, Grammar | null>();
  const loading = new Map<string, Promise<void>>();
  const docs = new Map<string, Doc>();
  let jobs = 0;
  let waiters: Array<() => void> = [];
  const settle = (): void => {
    if (loading.size || jobs) return;
    const w = waiters;
    waiters = [];
    w.forEach((f) => f());
  };

  /** Põe o realce de `doc` em dia com `lines`, tokenizando no máximo `limit` linhas. `true` se acabou. */
  function sync(doc: Doc, lines: readonly string[], limit: number): boolean {
    const old = doc;
    const shift = old.lines.length - lines.length;
    const html: string[] = new Array(lines.length);
    const after: LineState[] = new Array(lines.length);
    const stale: Array<string | undefined> = new Array(lines.length);
    let state: LineState | null = null, spent = 0, j = 0;
    /** uma linha já feita com o mesmo texto e o mesmo estado à entrada: o mesmo resultado */
    const reuse = (k: number): boolean => k >= 0 && k < old.done && old.lines[k] === lines[j] && sameState(k > 0 ? old.after[k - 1] : null, state);
    for (; j < lines.length; j++) {
      // a mesma linha no mesmo sítio, ou deslocada pelas linhas que entraram/saíram antes dela
      const k = reuse(j) ? j : shift !== 0 && reuse(j + shift) ? j + shift : -1;
      if (k >= 0) {
        html[j] = old.html[k];
        after[j] = old.after[k];
      } else {
        if (spent >= limit) break;
        const r = tokenizeLine(doc.grammar, lines[j], state);
        html[j] = lineHtml(lines[j], r.tokens);
        after[j] = r.state;
        spent++;
      }
      state = after[j];
    }
    const done = j;
    // o que falta: o realce antigo da mesma linha (no sítio, ou deslocada), até ficar feito
    for (let m = done; m < lines.length; m++) {
      const same = (k: number) => k >= 0 && k < old.lines.length && old.lines[k] === lines[m];
      stale[m] = same(m) ? (old.html[m] ?? old.stale[m]) : same(m + shift) ? (old.html[m + shift] ?? old.stale[m + shift]) : undefined;
    }
    doc.lines = lines.slice(); // uma cópia: quem chama pode mudar o array dele depois
    doc.html = html;
    doc.after = after;
    doc.done = done;
    doc.stale = stale;
    return done === lines.length;
  }

  /** O resto de um documento grande, em pedaços; pinta outra vez quando acaba. */
  function schedule(doc: Doc): void {
    if (doc.scheduled) return;
    doc.scheduled = true;
    jobs++;
    defer(function step() {
      // o ficheiro saiu da cache (ou trocou de gramática): já não há nada a fazer por ele
      if (docs.get(doc.path) !== doc) {
        doc.scheduled = false;
        jobs--;
        settle();
        return;
      }
      if (!sync(doc, doc.lines, chunk)) {
        defer(step);
        return;
      }
      doc.scheduled = false;
      jobs--;
      try {
        doc.repaint();
      } finally {
        settle();
      }
    });
  }

  function highlight(path: string, lines: readonly string[], repaint: () => void): Array<string | undefined> | null {
    const lang = languageFor(path, lines[0] ?? "");
    const bundled = bundledGrammarFor(lang?.id);
    if (!bundled) return null;
    if (!grammars.has(bundled.file)) {
      if (!loading.has(bundled.file)) {
        const p = d.files
          .load(bundled.file)
          .then((raw) => grammars.set(bundled.file, raw ? loadGrammar(raw) : null), () => grammars.set(bundled.file, null))
          .then(() => {
            loading.delete(bundled.file);
            try {
              repaint();
            } finally {
              settle();
            }
          });
        loading.set(bundled.file, p);
      }
      return null;
    }
    const grammar = grammars.get(bundled.file);
    if (!grammar) return null;
    let doc = docs.get(path);
    if (!doc || doc.grammar !== grammar) {
      doc = { path, grammar, lines: [], html: [], after: [], done: 0, stale: [], scheduled: false, repaint };
    }
    // o mais recente fica no fim (os menos usados saem primeiro)
    docs.delete(path);
    docs.set(path, doc);
    while (docs.size > maxDocs) docs.delete(docs.keys().next().value as string);
    doc.repaint = repaint;
    if (!sync(doc, lines, budget)) schedule(doc);
    return lines.map((_, i) => (i < doc.done ? doc.html[i] : doc.stale[i]));
  }

  return {
    highlight,
    idle: () => new Promise<void>((resolve) => {
      waiters.push(resolve);
      settle();
    }),
  };
}
