/* ═════════ dxtutor IDE — feature: Diagnósticos (painel Problems + barra de estado) ═════════
   Dona do desenho dos problemas (`drawProblems`: lista do painel, contadores e barra de
   estado) e do «próximo problema» (`nextProblem`, F8). `diagnostics()` é a fonte: no
   browser não há verificador e devolve vazio; no desktop o painel (features/panel)
   substitui-a, e ao `drawProblems`, pelos problemas reais do workspace.

   O motor simulado que vivia aqui — o E0382 do lexer de demonstração, o lint de cores
   preso a `desktop/src/`, o `runTests()` que derivava testes de caminhos fixos — saiu
   (ADR-0006, R1c1), e com o debug simulado o `lexBug` (R1c2). Fica `has` (o ficheiro casa a
   regex?), lido pelo board.

   Mecânica: avalia ANTES de `app.ts` e publica no `window`; os nomes livres do monólito
   (`FS`, `$`, `short`, `openPath`, `toast`) só se tocam DENTRO das funções. */

import { esc } from "../core";
import { registerActions, callGlobal, args } from "../app/actions";

const has = (p: string, re: RegExp) => !!FS[p] && re.test(FS[p].content);
/* Sem verificador real no browser, a base não tem diagnósticos: a regra do E0382, o lint de
   cores do `desktop/src/` e os testes derivados dos caminhos do projecto de demonstração saíram
   (ADR-0006, R1c1). No desktop, o painel (features/panel) substitui `diagnostics`/
   `drawProblems` pelos problemas reais do workspace (cargo check, tsc, eslint…).
   Com «YAML checks» ligado (funcionalidade do dxtutor no pane Extensions; era a extensão YAML a
   fingir — ADR-0006, R6b): tabs na indentação e Deployments k8s sem resources, lidos do conteúdo real dos ficheiros. Era a decoração do v6.ts (ADR-0004, U4g5). */
const builtinOn = (key: string): boolean => (window as unknown as { builtinOn: (key: string) => boolean }).builtinOn(key);
window.diagnostics = function () {
  const d: { p: string; line: number; sev: string; msg: string }[] = [];
  if (!builtinOn('yaml')) return d; /* «YAML checks», do dxtutor (era a extensão YAML a fingir — ADR-0006, R6b) */
  Object.keys(FS).filter((p) => /\.ya?ml$/.test(p)).forEach((p) => {
    const ls = FS[p].content.split('\n');
    ls.forEach((l, i) => { if (/^\t/.test(l)) d.push({ p, line: i + 1, sev: 'e', msg: 'yaml: tabs are not allowed for indentation' }); });
    if (/deploy\/k8s\//.test(p)) FS[p].content.split(/^---$/m).reduce((off, doc) => { if (/^kind:\s*Deployment/m.test(doc) && !/resources:/.test(doc)) { const ln = off + doc.split('\n').findIndex((l) => /^kind:\s*Deployment/.test(l)) + 1; d.push({ p, line: Math.max(1, ln), sev: 'w', msg: 'yaml(k8s): Deployment without resources.requests/limits' }); } return off + doc.split('\n').length; }, 0);
  });
  return d;
};
function drawProblems() {
  const d = window.diagnostics(), e = d.filter(x => x.sev === 'e').length, w = d.length - e;
  $('#pc-problems')!.innerHTML = d.length ? d.map(x => `<div class="prob" data-action="diagnostics:open" data-on="${esc(JSON.stringify([x.p, x.line]))}"><span class="pi ${x.sev}">${x.sev === 'e' ? '✖' : '⚠'}</span><span><span>${esc(x.msg)}</span> <span class="ploc">${short(x.p)}:${x.line}</span></span></div>`).join('') : '<div class="sec-empty">Sem problemas no workspace.</div>';
  $('#pb-prob')!.textContent = String(d.length); const s = $('#st-prob')!; s.innerHTML = `✖ ${e} ⚠ ${w}`; s.style.color = e ? 'var(--red)' : w ? 'var(--yellow)' : 'var(--git-u)';
}
let NP = -1;
function nextProblem() { const d = window.diagnostics(); if (!d.length) { toast('Sem problemas'); return; } NP = (NP + 1) % d.length; openPath(d[NP].p, d[NP].line); }

/* ── publicação no window (residual do monólito + features lêem por nome livre) ── */
window.has = has;
window.drawProblems = drawProblems;
window.nextProblem = nextProblem;

/* acções do pane (ADR-0004, U5b): eram `onclick="…"` inline, que resolviam os nomes no window ao clicar; as acções chamam o mesmo, no acto. */
registerActions({ "diagnostics:open": { click: (c) => void callGlobal("openPath", ...args<[string, number]>(c)) } });
