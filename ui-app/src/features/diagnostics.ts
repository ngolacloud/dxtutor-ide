/* ═════════ dxtutor IDE — feature: Diagnósticos, Lint e Testes (motor derivado) ═════════
   Feature-folha que passou a DONA do motor de diagnósticos/lint/testes derivados do
   estado real dos ficheiros (`FS`), antes espalhado na secção «diagnósticos, lint e
   testes» do monólito `app.ts`. Padrão de inversão da sessão (scm/debug/ext): o par
   render+motor muda-se inteiro para cá e republica no `window`. Como o motor é denso
   e lê/compõe HTML do monólito. Já tipada (sem supressão de tipos): os globais dinâmicos
   do monólito estão declarados no contrato ambiente de pair.ts / core.ts.

   Fronteira: a feature DETÉM `has`/`lexBug`/`dsLint`/`diagnostics`/`runTests`/
   `drawProblems`/`nextProblem` (+contador `NP`). Os CONSUMIDORES ficam no monólito e
   nas outras features e lêem por global:
     • `diagnostics`/`runTests`/`dsLint`/`lexBug`/`has` — lidos por codev/board/test/
       ext/i18n/studio/debug e v6 SEMPRE via window.
     • `drawProblems`/`nextProblem` — chamados por `refresh`/`boot`/CMD em `app.ts`.

   As constantes de caminho `P_LX`/`P_REPO`/`P_MIG`/`P_TEST`/`P_HIST`/`P_ADR`/`P_STORE`
   NÃO são desta feature — continuam donas do monólito (lidas por codev/v5/v6) e
   resolvem-se aqui como globais publicados no window (nomes livres).

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica tudo no `window` no eval; os nomes livres
   do monólito (`FS`, `P_LX`, `$`, `esc`, `short`, `openPath`, `toast`, `diagnostics`,
   `runTests`, …) resolvem no escopo GLOBAL em runtime. Nada é lido ansiosamente no
   eval — `FS`/`P_*`/DOM só são tocados DENTRO das funções, chamadas depois do arranque. */

import { esc, jsa } from "../core";

const has = (p: string, re: RegExp) => !!FS[p] && re.test(FS[p].content);
const lexBug = () => has(P_LX, /for c in chars \{/) && has(P_LX, /chars\.peek\(\)/);
function dsLint() {
  const out: { p: string; line: number; hex: string }[] = [];
  Object.keys(FS).forEach(p => {
    if (!/desktop\/src\/.*\.(ts|css)$/.test(p)) return;
    FS[p].content.split('\n').forEach((l, i) => {
      if (/^\s*--[\w-]+\s*:/.test(l)) return;
      const m = l.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/);
      if (m) out.push({ p, line: i + 1, hex: m[0] });
    });
  });
  return out;
}
function diagnosticsBase() {
  const out: { p: string; line: number; sev: string; msg: string }[] = [], add = (p: string, re: RegExp, sev: string, msg: string) => { if (FS[p]) FS[p].content.split('\n').forEach((l, i) => { if (re.test(l)) out.push({ p, line: i + 1, sev, msg }); }); };
  if (lexBug()) add(P_LX, /chars\.peek\(\)/, 'e', 'E0382: use of moved value: `chars` (movido pelo `for` na linha 5)');
  dsLint().forEach(v => out.push({ p: v.p, line: v.line, sev: 'w', msg: `design-system: cor fixa ${v.hex} — usar um token (regras.md §4)` }));
  add(ROOT + 'desktop/src/workspace.ts', /\bany\b/, 'w', 'evitar `any` — tipar explicitamente');
  add(P_REPO, /WHERE workspace_id = \?1 LIMIT/, 'w', 'listagem sem ORDER BY — ordem não determinística');
  return out;
}
/* Com a extensão YAML (redhat.vscode-yaml) ligada: tabs na indentação e Deployments k8s sem
   resources. Era a decoração do v6.ts (ADR-0004, U4g5); o panel do desktop apanha esta
   versão em runtime (fachada real quando há pasta aberta). */
const vsxOn = (id: string): boolean => (window as unknown as { vsxOn: (id: string) => boolean }).vsxOn(id);
window.diagnostics = function () {
  const d = diagnosticsBase();
  if (!vsxOn('redhat.vscode-yaml')) return d;
  Object.keys(FS).filter((p) => /\.ya?ml$/.test(p)).forEach((p) => {
    const ls = FS[p].content.split('\n');
    ls.forEach((l, i) => { if (/^\t/.test(l)) d.push({ p, line: i + 1, sev: 'e', msg: 'yaml: tabs are not allowed for indentation' }); });
    if (/deploy\/k8s\//.test(p)) FS[p].content.split(/^---$/m).reduce((off, doc) => { if (/^kind:\s*Deployment/m.test(doc) && !/resources:/.test(doc)) { const ln = off + doc.split('\n').findIndex((l) => /^kind:\s*Deployment/.test(l)) + 1; d.push({ p, line: Math.max(1, ln), sev: 'w', msg: 'yaml(k8s): Deployment without resources.requests/limits' }); } return off + doc.split('\n').length; }, 0);
  });
  return d;
};
function runTests(pkg?: string) {
  const R: { n: string; ok: boolean }[] = [];
  if (!pkg || pkg === 'lexer') {
    if (lexBug()) return { ok: false, build: false, tests: [], err: 'error[E0382]: use of moved value: `chars`\n  --> crates/lexer/src/lib.rs:10:8' };
    R.push({ n: 'lexer::tokenize_digits', ok: true }); R.push({ n: 'lexer::tokenize_emits_eof', ok: has(P_LX, /Token::Eof\)/) && !has(P_LX, /chars\.clone\(\)/) });
  }
  if (!pkg || pkg === 'store') {
    R.push({ n: 'store::workspaces_roundtrip', ok: true });
    if (FS[P_TEST]) { R.push({ n: 'store::save_and_load_roundtrip', ok: !!FS[P_REPO] && !!FS[P_MIG] && has(P_STORE, /pub mod conversations/) }); R.push({ n: 'store::list_recent_orders_by_newest', ok: has(P_REPO, /ORDER BY created_at DESC/) }); R.push({ n: 'store::cascade_delete_messages', ok: has(P_MIG, /ON DELETE CASCADE/) }); }
  }
  return { ok: R.every(t => t.ok), build: true, tests: R, err: '' };
}
function drawProblems() {
  const d = window.diagnostics(), e = d.filter(x => x.sev === 'e').length, w = d.length - e;
  $('#pc-problems')!.innerHTML = d.length ? d.map(x => `<div class="prob" onclick="openPath(${jsa(x.p)},${x.line})"><span class="pi ${x.sev}">${x.sev === 'e' ? '✖' : '⚠'}</span><span><span>${esc(x.msg)}</span> <span class="ploc">${short(x.p)}:${x.line}</span></span></div>`).join('') : '<div class="sec-empty">Sem problemas no workspace.</div>';
  $('#pb-prob')!.textContent = String(d.length); const s = $('#st-prob')!; s.innerHTML = `✖ ${e} ⚠ ${w}`; s.style.color = e ? 'var(--red)' : w ? 'var(--yellow)' : 'var(--git-u)';
  const t = runTests(), st = $('#st-tests')!; st.innerHTML = !t.build ? '✖ build' : `${t.ok ? '✓' : '✖'} ${t.tests.filter(x => x.ok).length}/${t.tests.length} testes`; st.style.color = t.ok ? 'var(--git-u)' : 'var(--red)';
}
let NP = -1;
function nextProblem() { const d = window.diagnostics(); if (!d.length) { toast('Sem problemas'); return; } NP = (NP + 1) % d.length; openPath(d[NP].p, d[NP].line); }

/* ── publicação no window (residual do monólito + features lêem por nome livre) ── */
window.has = has;
window.lexBug = lexBug;
window.dsLint = dsLint;
window.runTests = runTests;
window.drawProblems = drawProblems;
window.nextProblem = nextProblem;
