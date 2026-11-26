/* ═══════════ feature Explain · Code-Review — domínio (pedidos ao modelo) ═══════════
   O texto que o Explain e a revisão com IA mandam ao modelo. A resposta vai para o painel de
   documento ao lado do código (não para o chat), por isso pede-se um DOCUMENTO markdown com
   secções fixas e referências de linha `L12` (o painel torna-as clicáveis). A revisão pede o
   ficheiro inteiro melhorado num bloco ```<lang> improved, que o painel mostra com realce e
   com «Compare», «Apply» e «Apply & test». PURO. */

export type DocLang = "en" | "ptAO";

const LANG_RULE: Record<DocLang, string> = {
  en: "Write the document in English.",
  ptAO: "Escreve o documento em português (ortografia pré-AO90, de Angola). Os títulos das secções também em português.",
};

const FENCE: Record<string, string> = { rs: "rust", ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", py: "python", go: "go", java: "java", kt: "kotlin", cs: "csharp", cpp: "cpp", cc: "cpp", h: "c", c: "c", swift: "swift", sql: "sql", sh: "bash", yml: "yaml", yaml: "yaml", json: "json", css: "css", html: "html", md: "markdown", toml: "toml" };
/** A etiqueta do bloco de código para a extensão do ficheiro. */
export const fenceLang = (ext: string): string => FENCE[ext] || ext || "text";

/** Numera as linhas para o modelo citar `L12` com exactidão. */
export function numbered(code: string, from = 1): string {
  return code.split("\n").map((l, i) => `${String(i + from).padStart(4)}| ${l}`).join("\n");
}

const MAX = 24000;
const clip = (s: string) => (s.length > MAX ? s.slice(0, MAX) + "\n… (truncated)" : s);

export interface ExplainRequest {
  path: string;
  ext: string;
  content: string;
  /** a selecção do editor e a linha onde começa (o Explain de um excerto) */
  selection?: { text: string; line: number } | null;
  lang: DocLang;
}

export function explainPrompt(r: ExplainRequest): string {
  const what = r.selection ? `the excerpt of \`${r.path}\` that starts at line ${r.selection.line}` : `the file \`${r.path}\``;
  const code = r.selection ? numbered(r.selection.text, r.selection.line) : numbered(r.content);
  return `You are a senior engineer writing a short technical document that explains ${what} to a colleague. The document is shown in a side panel next to the code, rendered as markdown.

Structure (use these sections, as markdown headings, in this order; skip one only if it truly does not apply):
## Summary — two or three sentences: what this code is for.
## How it works — the flow, step by step, citing lines as L12 or L12-L20.
## Key pieces — a bullet list of the important functions/types/values, each with its line (L12) and one line on its role.
## Watch out — concrete risks, edge cases and bugs, each with its line. Say so if there are none.
## Suggestions — small, concrete improvements (show short code snippets in fenced blocks with the language).

Be concrete and brief; no filler, no restating the code line by line. ${LANG_RULE[r.lang]}

\`\`\`${fenceLang(r.ext)}
${clip(code)}
\`\`\``;
}

export interface ReviewRequest {
  path: string;
  ext: string;
  content: string;
  /** os achados das regras locais e dos analisadores, para o modelo confirmar ou descartar */
  findings: { line: number; sev: string; title: string }[];
  lang: DocLang;
  /** rever só um achado e propor a correcção (o «Fix with AI» de um cartão) */
  focus?: { line: number; title: string } | null;
}

export function reviewPrompt(r: ReviewRequest): string {
  const lang = fenceLang(r.ext);
  const known = r.findings.length ? `\nThe automatic checks reported (confirm or dismiss each, with evidence):\n${r.findings.map(f => `- L${f.line} [${f.sev}] ${f.title}`).join("\n")}\n` : "";
  const task = r.focus
    ? `Fix this one problem in \`${r.path}\`: L${r.focus.line} — ${r.focus.title}. Explain the cause and the fix briefly, then give the whole corrected file.`
    : `Review \`${r.path}\` as a senior engineer: bugs first, then risks, performance and style.`;
  return `${task}
${known}
Write a markdown document for a side panel next to the code:
## Verdict — one paragraph and a score out of 100.
## Findings — one ### heading per finding: \`[bug|risk|perf|style] title (L12)\`, then why it matters and the fix.
## Improved code — the WHOLE file with every fix applied, in ONE fenced block whose info string is exactly \`${lang} improved\` (\`\`\`${lang} improved). Complete file, never an excerpt; keep the behaviour that is correct and the existing style. Add a comment only where a change is not obvious.
## How to test — the tests (or manual checks) that prove the fixes; if a test should be added, show it.

Cite lines as L12. ${LANG_RULE[r.lang]}

\`\`\`${lang}
${clip(numbered(r.content))}
\`\`\``;
}

/** Aplicar UMA sugestão (um bloco de código do Explain) ao ficheiro: o modelo integra-a e devolve o
 *  ficheiro inteiro, para o painel mostrar as diferenças e o humano aceitar ou recusar. */
export function applySuggestionPrompt(r: { path: string; ext: string; content: string; snippet: string; snippetLang: string; context: string; lang: DocLang }): string {
  const lang = fenceLang(r.ext);
  return `Apply this suggestion to \`${r.path}\`. Integrate it where it belongs, keep everything else exactly as it is (same behaviour, style and comments), and do not make other changes.

Start with a short "## What changes" section (two or three bullets, citing lines as L12), then give the WHOLE updated file in ONE fenced block whose info string is exactly \`${lang} improved\`. ${LANG_RULE[r.lang]}

The suggestion:
\`\`\`${r.snippetLang || lang}
${r.snippet}
\`\`\`

Why it was suggested (from the explanation):
${r.context.slice(0, 4000)}

Current file:
\`\`\`${lang}
${clip(numbered(r.content))}
\`\`\``;
}

/** Pedido de correcção quando os testes falharam depois de aplicar o código melhorado. `spots`: onde
 *  quebrou, lido da saída (domain/test-report). */
export function fixTestsPrompt(path: string, ext: string, content: string, output: string, lang: DocLang, spots = ""): string {
  return `The improved \`${path}\` was applied and the project tests failed. Find the cause from the output and give the whole corrected file in ONE fenced block with the info string \`${fenceLang(ext)} improved\`. Start with a short "## Why it failed" section. ${LANG_RULE[lang]}
${spots ? `\nWhere it broke:\n${spots}\n` : ""}
Test output (last part):
\`\`\`text
${output.slice(-6000)}
\`\`\`

Current file:
\`\`\`${fenceLang(ext)}
${clip(content)}
\`\`\``;
}
