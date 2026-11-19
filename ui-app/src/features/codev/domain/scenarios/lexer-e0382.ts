/* ═══════════ Co-Dev scenario `a` — fix E0382 in the lexer ═══════════
   Pure data + predicates. Everything that touches the running workspace (file
   contents, test runs, the "is the bug still there?" check) comes through the
   injected `ScenarioEnv`; this module imports no `window`, no DOM, no bridge.
   Verbatim transcription of the former `SCN_()[0]` in `codev.ts`. */

import type { Scenario, ScenarioEnv, Step } from "../types";

export function buildLexerE0382(env: ScenarioEnv): Scenario {
  const { lx: P_LX, root: ROOT } = env.paths;
  const SEED = env.seed;
  const lxStep = (l: string, fn: (s: string) => string): Step[] => [
    { l: "Ler lib.rs e o erro do compilador", tools: [{ t: "read", p: P_LX }] },
    { l, tools: [{ t: "edit", p: P_LX, make: fn }] },
  ];
  return {
    id: "a",
    title: "Corrigir E0382 no lexer",
    prompt: "Corrige o erro E0382 (use of moved value) em crates/lexer/src/lib.rs.",
    match: /e0382|moved value|lexer|tokeniz/i,
    pkg: "lexer",
    flow: { kind: "fix", branch: "e0382-lexer" },
    ready: () =>
      env.lexBug()
        ? null
        : "O E0382 já não existe em <code>lib.rs</code> — não há nada para corrigir. Usa a paleta (<kbd>Ctrl+Shift+P</kbd> → «Repor protótipo») para recomeçar.",
    reads: [ROOT + ".dxtutor/regras.md", P_LX],
    understand:
      "O <code>for</code> move o iterador <code>chars</code>; a linha 10 volta a usá-lo. O objectivo é compilar sem mudar o comportamento.",
    reqs: [
      { t: "O crate lexer compila", ac: ["<code>cargo build</code> sem E0382"] },
      { t: "O comportamento mantém-se", ac: ["<code>tokenize_emits_eof</code> continua a passar", "a assinatura pública de <code>tokenize</code> não muda"] },
    ],
    questions: [
      {
        q: "Posso alterar a assinatura pública de tokenize()?",
        opts: [
          { l: "Não — manter a API", why: "a correcção é interna à função" },
          { l: "Sim — devolver um iterador", why: "mais idiomático, mas quebra quem usa o crate" },
        ],
        best: 0,
        conf: 0.97,
        basis: "regras.md §2",
      },
    ],
    cands: [
      { prov: "claude", title: "Emprestar o iterador com by_ref()", sum: "Uma linha alterada: o ciclo consome o iterador por referência e ele continua válido para o peek() final.", sc: { c: 10, a: 9, t: 9, r: 9, k: 10 }, steps: lxStep("Aplicar by_ref() no ciclo", (o) => o.replace("for c in chars {", "for c in chars.by_ref() {")) },
      { prov: "codex", title: "Reescrever com while let", sum: "Ciclo explícito com chars.next(). Correcto, mas menos directo de rever.", sc: { c: 10, a: 8, t: 9, r: 8, k: 8 }, steps: lxStep("Reescrever o ciclo com while let", (o) => o.replace("for c in chars {", "while let Some(c) = chars.next() {")) },
      { prov: "ollama", title: "Clonar o iterador", sum: "Compila, mas o original fica por consumir: o peek() final deixa de detectar o fim da entrada.", sc: { c: 4, a: 5, t: 3, r: 4, k: 9 }, steps: lxStep("Clonar o iterador no ciclo", (o) => o.replace("for c in chars {", "for c in chars.clone() {")) },
    ],
    best: 0,
    verify: ["cargo test -p lexer"],
    fix: { strategy: "switch" },
    checks: [
      { id: "build", l: "O crate compila sem E0382", w: 40, fn: () => env.runTests("lexer").build, cause: "o iterador continua a ser movido pelo ciclo.", fixd: "emprestar o iterador em vez de o mover." },
      { id: "tests", l: "Testes do lexer passam (incl. tokenize_emits_eof)", w: 40, fn: () => env.runTests("lexer").ok, cause: "ao clonar, o iterador original nunca é consumido e o <code>peek()</code> final nunca vê o fim.", fixd: "consumir o próprio iterador por referência com <code>by_ref()</code>." },
      { id: "min", l: "Alteração mínima e API pública intacta", w: 20, fn: () => { const fs = env.files(); return fs[P_LX] && env.fileDiffStat(SEED.base["crates/lexer/src/lib.rs"], fs[P_LX].content).add <= 2 && env.has(P_LX, /pub fn tokenize\(src: &str\) -> Vec<Token>/); }, cause: "a alteração tocou em mais do que o necessário.", fixd: "limitar a alteração à linha do ciclo." },
    ],
    done: ["<code>lib.rs</code>: o ciclo passa a emprestar o iterador", "<code>cargo test -p lexer</code>: 2 passados"],
    commit: "fix(lexer): borrow the iterator in the loop (E0382)",
  };
}
