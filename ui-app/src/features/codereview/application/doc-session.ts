/* ═══════ feature Explain · Code-Review — o painel de documento ao lado do código ═══════
   O caso de uso por trás do painel à direita do editor. O Explain e a revisão com IA pedem a
   resposta ao modelo e mostram-na A CHEGAR como documento markdown (não no chat do Co-Dev).
   Da revisão sai também o ficheiro inteiro melhorado (```<lang> improved): o humano compara-o
   com o actual, aplica-o, corre os testes do projecto com ele, e reverte se não servir.

   Só importa `domain/` e as portas. Sem DOM, sem `window`, sem Tauri: o modelo, os ficheiros,
   os testes e a vista chegam por `deps`. Uma resposta de um pedido antigo (o humano pediu outro
   entretanto) nunca pinta por cima do novo: cada pedido tem o seu `id`. */

import { explainPrompt, reviewPrompt, fixTestsPrompt, applySuggestionPrompt, type DocLang } from "../domain/prompts";
import { parseTestOutput, spotsText } from "../domain/test-report";
import { improvedCode } from "../domain/markdown";
import type { ExplainCard } from "./ports";
import type { DocCopyKey } from "./messages";

export type DocKind = "explain" | "review" | "fix" | "apply";
export type DocStatus = "idle" | "streaming" | "done" | "error" | "stopped" | "local";

export interface TestOutcome {
  status: "running" | "passed" | "failed" | "unavailable" | "error";
  output: string;
}

export interface DocState {
  id: number;
  kind: DocKind;
  path: string;
  /** a selecção explicada (linha inicial), quando o Explain foi de um excerto */
  from: number | null;
  status: DocStatus;
  text: string;
  error: string | null;
  /** o ficheiro como estava quando se pediu (a base do diff e do «Revert») */
  original: string;
  improved: { lang: string; code: string } | null;
  /** o conteúdo antes de «Apply» (para «Revert»); `null` sem nada aplicado */
  applied: { prev: string } | null;
  test: TestOutcome | null;
  /** a proposta foi recusada («Deny»): o cartão do código sai */
  denied: boolean;
  /** de onde veio (o Explain, quando é «Apply» de uma sugestão): «Back» volta lá */
  back: DocState | null;
}

/* ───── portas do painel ───── */

export interface AiPort {
  /** há um modelo pronto a responder (desktop: algum provider ligado; browser: Claude ao vivo) */
  ready(): boolean;
  /** pede e devolve o texto final; `onText` recebe o texto ACUMULADO a cada pedaço */
  stream(prompt: string, o: { signal: AbortSignal; onText: (text: string) => void }): Promise<string>;
}

export interface FilesPort {
  read(path: string): string | null;
  /** escreve no editor (o autosave do desktop leva-o ao disco) */
  write(path: string, content: string): void;
  ext(path: string): string;
  short(path: string): string;
}

export interface TestsPort {
  /** porque não se pode testar aqui (sem pasta, sem comando de testes), ou `null` */
  unavailable(): string | null;
  /** grava o editor e corre os testes do projecto */
  run(): Promise<{ ran: boolean; passed: boolean; output: string }>;
}

export interface DocView {
  render(state: DocState): void;
}

export interface DocDeps {
  ai: AiPort;
  files: FilesPort;
  tests: TestsPort;
  view: DocView;
  lang(): DocLang;
  copy(key: DocCopyKey, params?: Record<string, string | number>): string;
}

export interface ExplainArgs {
  path: string;
  selection: { text: string; line: number } | null;
  card: ExplainCard;
}

export function makeDocSession(deps: DocDeps) {
  const { ai, files, tests, view, copy } = deps;
  let seq = 0;
  let state: DocState | null = null;
  let abort: AbortController | null = null;
  /** o último pedido, para «Regenerate» */
  let last: (() => void) | null = null;

  const fresh = (kind: DocKind, path: string, from: number | null): DocState => ({
    id: ++seq, kind, path, from, status: "idle", text: "", error: null,
    original: files.read(path) ?? "", improved: null, applied: null, test: null, denied: false, back: null,
  });
  const paint = () => { if (state) view.render(state); };

  function stop(): void {
    if (abort) { abort.abort(); abort = null; }
    if (state && state.status === "streaming") { state.status = "stopped"; paint(); }
  }

  async function ask(s: DocState, prompt: string): Promise<void> {
    stop();
    state = s;
    if (!ai.ready()) { s.status = "error"; s.error = "no-model"; paint(); return; }
    s.status = "streaming";
    paint();
    const ctl = new AbortController();
    abort = ctl;
    try {
      const text = await ai.stream(prompt, {
        signal: ctl.signal,
        onText: (t) => { if (state !== s || ctl.signal.aborted) return; s.text = t; paint(); },
      });
      if (state !== s || ctl.signal.aborted) return;
      s.text = text || s.text;
      s.status = "done";
      if (s.kind !== "explain") s.improved = improvedCode(s.text, s.original);
    } catch (e) {
      if (state !== s) return;
      if (ctl.signal.aborted) s.status = "stopped";
      else { s.status = "error"; s.error = e instanceof Error ? e.message : String(e); }
      if (s.kind !== "explain") s.improved = improvedCode(s.text, s.original);
    } finally {
      if (abort === ctl) abort = null;
    }
    paint();
  }

  /** O resumo local (sem modelo), em markdown, a partir dos factos que o motor colheu. */
  function localExplain(c: ExplainCard): string {
    const parts: string[] = [`## ${copy("summary")}`];
    const defs = c.symbols.slice(0, 8).map(s => (s.line ? `\`${s.n}\` (L${s.line})` : `\`${s.n}\``));
    parts.push(`**${files.short(c.path)}** — ${copy("lines", { n: c.lineCount })}${defs.length ? ", " + copy("defines", { list: defs.join(", ") }) : ""}.`);
    if (c.firstComment) parts.push(c.firstComment);
    if (c.diagnostics.length) parts.push(`## ${copy("rightNow")}`, c.diagnostics.map(d => `- L${d.line}: ${d.msg}`).join("\n"));
    if (c.findings.length) parts.push(`## ${copy("watch")}`, c.findings.map(f => `- ${f.t.replace(/<[^>]+>/g, "")} (L${f.l})`).join("\n"));
    parts.push(`> ${copy("noModel")}`);
    return parts.join("\n\n");
  }

  function explain(a: ExplainArgs): void {
    const run = () => {
      const s = fresh("explain", a.path, a.selection ? a.selection.line : null);
      if (!ai.ready()) {
        stop();
        state = s;
        s.status = "local";
        s.text = localExplain(a.card);
        paint();
        return;
      }
      void ask(s, explainPrompt({ path: files.short(a.path), ext: files.ext(a.path), content: s.original, selection: a.selection, lang: deps.lang() }));
    };
    last = run;
    run();
  }

  /** A revisão com IA do ficheiro inteiro, ou só de um achado (`focus`, o «Fix with AI»). */
  function review(path: string, findings: { line: number; sev: string; title: string }[], focus: { line: number; title: string } | null = null): void {
    const run = () => {
      const s = fresh(focus ? "fix" : "review", path, null);
      void ask(s, reviewPrompt({ path: files.short(path), ext: files.ext(path), content: s.original, findings, focus, lang: deps.lang() }));
    };
    last = run;
    run();
  }

  function regenerate(): void { if (last) last(); }

  /** «Apply» num bloco de código do documento (as sugestões do Explain): o modelo integra-o no ficheiro
   *  e devolve-o inteiro; o painel mostra as diferenças para «Accept» ou «Deny». «Back» volta ao documento. */
  function applySuggestion(snippet: string, snippetLang: string): void {
    const from = state;
    if (!from) return;
    const path = from.path;
    const run = () => {
      const s = fresh("apply", path, null);
      s.back = from.kind === "apply" ? from.back : from;
      void ask(s, applySuggestionPrompt({ path: files.short(path), ext: files.ext(path), content: s.original, snippet, snippetLang, context: from.text, lang: deps.lang() }));
    };
    last = run;
    run();
  }

  /** «Back»: volta ao documento de onde veio a proposta (o Explain). Nada aplicado é desfeito. */
  function goBack(): void {
    const s = state;
    if (!s || !s.back) return;
    stop();
    state = s.back;
    last = null;
    paint();
  }

  /** «Deny»: recusa a proposta (o ficheiro não muda; se já estava aplicada, repõe-no). */
  function deny(): void {
    const s = state;
    if (!s || !s.improved) return;
    if (s.applied) { files.write(s.path, s.applied.prev); s.applied = null; }
    s.improved = null;
    s.denied = true;
    s.test = null;
    paint();
  }

  /** «Accept»: aplica e, onde há testes, corre-os logo para provar que nada quebrou. */
  async function accept(): Promise<void> {
    const s = state;
    if (!s || !s.improved) return;
    if (tests.unavailable()) { apply(); if (state === s) { s.test = { status: "unavailable", output: tests.unavailable() ?? "" }; paint(); } return; }
    await test();
  }

  /** Põe o código melhorado no ficheiro (guarda o anterior para «Revert»). */
  function apply(): boolean {
    const s = state;
    if (!s || !s.improved) return false;
    const now = files.read(s.path);
    if (now === null) return false;
    if (!s.applied) s.applied = { prev: now };
    files.write(s.path, s.improved.code);
    s.test = null;
    paint();
    return true;
  }

  function revert(): void {
    const s = state;
    if (!s || !s.applied) return;
    files.write(s.path, s.applied.prev);
    s.applied = null;
    s.test = null;
    paint();
  }

  /** «Apply & test»: aplica (se ainda não) e corre os testes do projecto com o código novo. */
  async function test(): Promise<void> {
    const s = state;
    if (!s || !s.improved) return;
    const why = tests.unavailable();
    if (why) { s.test = { status: "unavailable", output: why }; paint(); return; }
    if (!s.applied && !apply()) return;
    s.test = { status: "running", output: "" };
    paint();
    try {
      const r = await tests.run();
      if (state !== s || !s.test) return;
      s.test = { status: !r.ran ? "error" : r.passed ? "passed" : "failed", output: r.output };
    } catch (e) {
      if (state !== s) return;
      s.test = { status: "error", output: e instanceof Error ? e.message : String(e) };
    }
    paint();
  }

  /** Os testes falharam com o código aplicado: pede a correcção ao modelo, a partir da saída. */
  function fixTests(): void {
    const s = state;
    if (!s || !s.test || s.test.status !== "failed") return;
    const cur = files.read(s.path) ?? "", out = s.test.output, prev = s.applied;
    const run = () => {
      const n = fresh("fix", s.path, null);
      n.applied = prev;            // continua a ser possível voltar ao ficheiro de antes de tudo
      if (prev) n.original = prev.prev;
      n.back = s.back;
      void ask(n, fixTestsPrompt(files.short(s.path), files.ext(s.path), cur, out, deps.lang(), spotsText(parseTestOutput(out))));
    };
    last = run;
    run();
  }

  return {
    explain, review, regenerate, stop, apply, revert, test, fixTests, applySuggestion, goBack, deny, accept,
    state: (): DocState | null => state,
    /** fecha o painel: pára o pedido em curso e esquece o estado (o que foi aplicado fica) */
    close(): void { stop(); state = null; last = null; },
  };
}

export type DocSession = ReturnType<typeof makeDocSession>;
