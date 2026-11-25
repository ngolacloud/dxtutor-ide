/* ═════════ dxtutor IDE — feature: Co-Dev (pane lateral) ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado por
   import real e detém o render do pane «Co-Dev» que vivia no monólito `app.ts`.

   No monólito este pane era DECORADO: uma base v3 (`RP.codev`, Missões/Conhecimento/
   Checkpoints/Routing) e uma decoração v4 (`const _codev=RP.codev;RP.codev=()=>{…}`)
   que injectava Equipa/Backlog/Studio no topo das `.sections`. Aqui as duas dobram-se
   num único `renderCodevPane()` — base primeiro, depois o `insertAdjacentHTML` — para
   que o resultado DOM seja idêntico.

   ADR-0002, Phase 1: toda a leitura de globais passa pelo
   `./codev/infrastructure/legacy-bridge` (único ficheiro autorizado a tocar `window.*`).
   Phase 2: o domínio puro (types/policy/scoring/scenarios) vive em `./codev/domain/`.
   Phase 3: o MOTOR (runMission/decideQ/council/execSteps/evaluate/reflect/doTool/
   liveChat) mudou-se para `./codev/application/` como casos de uso sem HTML, com
   dependências por argumento e `AbortSignal`; o DOM/HTML do transcript vive em
   `./codev/ui/chat-view.ts`; `./codev/index.ts` é a raiz de composição. Este ficheiro
   deixa de conter o motor: importa-o já ligado e publica o `window.*` que o resíduo
   `app.ts`, os `onclick` inline e `features/board.ts` ainda resolvem por global. O que
   fica aqui é a cola da UI do agente (modos/providers), as páginas e o pane — alvo da
   Phase 4. */

import { $, hd, svg, esc } from "../core";
import { RP, VIEW } from "../app/store/registry";
import * as bridge from "./codev/infrastructure/legacy-bridge";
import { bindActions, type ActionTable } from "./codev/ui/actions";
import { bus } from "../app/bus";
import { registerActions, callGlobal } from "../app/actions";
import { desktopPorts } from "../app/desktop";
import { agentStore } from "../app/store";
import { composerActions, composerAsk, mountComposer, refreshComposer, resetComposer, submit, type ComposerHost, type SpeechLike } from "./codev/ui/composer";
import { presenter } from "./codev/ui/chat-view";
import { makeAsk } from "./codev/application/ask";
import type { Sampler } from "./codev/application/ports";
import { hunkContext, selectionContext, type AskContext, type AskRequest } from "./codev/domain/ask";
import { codevAsk as codevAskRegistry } from "../app/codev-ask";
import { codevIssue } from "../app/codev-issue";
import { exportMarkdown, parseDictationLang, parseEffort } from "./codev/domain/composer";
import { dictationGateway } from "./codev/infrastructure/dictation-gateway";
import { ollamaModels } from "../platform/tauri/assistant";
import { isDesktop } from "../platform/tauri/core";
import { currentLocale, translator } from "../app/i18n";
import { CODEV_ENGINE_MESSAGES } from "./codev/application/messages";
import { CODEV_CHAT_MESSAGES } from "./codev/ui/chat-messages";
import {
  codevEngine,
  decisions as DECS_ARR,
  ctxPill,
  scrollMsgs,
  user,
  card,
  md,
  beat,
  runState,
  runLabel,
  agCtl,
  waiting,
  ask,
  tl,
  hunkReview,
  codevRun,
} from "./codev/index";
import { services } from "../app/services";
import type { ChatMessage } from "../app/store/agent";

const tc = translator(CODEV_CHAT_MESSAGES);

/* ───── dados de config/estado do Co-Dev: exportados; o config e a ponte (avaliam antes) lêem-nos pelo registo (U7j) ───── */
export const ROLE: Record<string, string> = { plan: 'Planeador', code: 'Programador', review: 'Revisor', judge: 'Juiz', local: 'Privado / offline' };
export const ROLE_D: Record<string, string> = { plan: 'requisitos, arquitectura, plano', code: 'escreve e edita código', review: 'testes, lint, auto-avaliação', judge: 'escolhe entre propostas', local: 'autocomplete e dados sensíveis' };
export const ROUTE: Record<string, string> = { plan: 'claude', code: 'codex', review: 'gemini', judge: 'claude', local: 'ollama' };
export const MODES: Record<string, { l: string; d: string }> = {
  manual: { l: 'Manual', d: 'Tu decides tudo: respostas, proposta, plano, cada edição e cada comando.' },
  assist: { l: 'Assistido', d: 'O Co-Dev decide o que é seguro e reversível; pergunta-te quando a confiança é baixa.' },
  auto: { l: 'Auto', d: 'Autónomo de ponta a ponta, com auto-avaliação e correcção. Só pára para push e acções destrutivas.' },
};
/* as decisões e os checkpoints: lidos por import (ADR-0004, U7j — eram window.DECS/window.CKPT) */
export const DECS = DECS_ARR;
export const CKPT: any[] = [];

/* ───── interface do agente ───── */
function updateAgentUIBase(): void {
  const p = bridge.providers()[bridge.monolith.activeProvider];
  $('#ag-model-l')!.textContent = p.name + ' · ' + p.model;
  ($('#ag-model .live') as HTMLElement).style.background = p.on ? 'var(--green)' : 'var(--fg-muted)';
  $('#st-model-l')!.textContent = p.name; $('#st-mode')!.textContent = 'Co-Dev: ' + MODES[bridge.monolith.mode].l;
  $('#modebar')!.innerHTML = `<div class="seg">${Object.entries(MODES).map(([k, m]) => `<button class="${k === bridge.monolith.mode ? 'on' : ''}" data-action="set-mode" data-on="${esc(k)}">${m.l}</button>`).join('')}</div><div class="mode-d">${MODES[bridge.monolith.mode].d}</div>`;
  const n = $('#live-note'); if (n) n.innerHTML = bridge.sample() ? `<span class="tag live">${tc('liveTag')}</span> ${tc('liveNote')}` : `<span class="tag">${tc('offTag')}</span> ${tc('offNote')}`;
  ctxPill();
  refreshComposer();
}
/* ADR-0004, U4h5: o updateAgentUI e o testProv PUBLICADOS consultam a porta desktop (o runMission saiu — ADR-0006, R1b)
   (`desktopPorts.codev`, injectada por platform/desktop/llm.ts e demos.ts); antes o desktop
   reatribuía-os no `window`. Os chamadores internos já usavam o `window.X`. */
window.updateAgentUI = function () { const d = desktopPorts.codev; if (d && d.updateAgentUI) d.updateAgentUI(updateAgentUIBase); else updateAgentUIBase(); };
/* U3b (ADR-0004): o Co-Dev reage às mudanças de estado pelo bus, venham de onde vierem
   (modebar, compositor, paleta, Definições, harness do projecto, restauro no arranque) —
   em vez de cada sítio que muda o modo/provedor/contexto chamar updateAgentUI/ctxPill. */
bus.on('agent:mode', ({ mode }) => { codevEngine.agentModeChanged(mode); window.updateAgentUI(); });
bus.on('agent:provider', () => window.updateAgentUI());
bus.on('agent:providers', () => window.updateAgentUI());
bus.on('agent:context', () => ctxPill());
bus.on('editor:tab', () => ctxPill());
/* ───── políticas do harness do projecto sobre o Co-Dev (ADR-0004, U4g4) ─────
   Eram decorações do v5.ts, dobradas aqui no dono das funções (sem republicar no window):
   o tecto de autonomia no setMode e os direitos humanos no doTool (o «o código é teu» do
   runMission saiu com o motor de missões, ADR-0006 R1b). Os dados do harness (HARN/MORD/RIGHTS/RIGHT_RE/isHuman) são do
   features/team.ts e lêem-se no acto, como o v5 os lia por nome livre. NOTA (pré-existente,
   preservado): só o doTool PUBLICADO leva o gate de direitos — o chat usa o doTool local
   do motor (codev/index.ts), que nunca teve o gate do v5. */
interface HarnessGlobals {
  short: (p: string) => string; log: (s: string, m: string) => void;
}
const HG = window as unknown as HarnessGlobals;
/* o harness do features/team.ts, que avalia depois deste módulo: pelo registo, no acto (ADR-0004, U7h) */
const HS = () => services.team!;
type DoToolArgs = Parameters<typeof codevEngine.doTool>;
async function harnessDoTool(t: DoToolArgs[0], host: DoToolArgs[1], role?: DoToolArgs[2]): Promise<unknown> {
  if (t.t === 'edit') {
    const p = String((t as { p?: unknown }).p);
    if (HS().isHuman('code') && !/\/learn\//.test(p)) { (tl(host, 'harness', HG.short(p)).querySelector('.tr') as HTMLElement).innerHTML = '<span class="bad">✖ writing code is yours in this project</span>'; HG.log('harness', 'edit blocked: code is human-only'); return false; }
    const r = Object.keys(HS().RIGHT_RE).find((k) => HS().isHuman(k) && HS().RIGHT_RE[k].test(p));
    if (r && agentStore.mode !== 'manual') { const d = tl(host, 'your call', HS().RIGHTS[r] + ' · ' + HG.short(p)); const v = await ask(d, [{ l: 'Approve', v: 1, pri: 1, done: '✓ approved by you' }, { l: 'Reject', v: 0, done: '✗ rejected by you' }]); if (!v) { HG.log('humano', 'rejected ' + HG.short(p)); return false; } }
  }
  return codevEngine.doTool(t, host, role);
}
window.setMode = function (m) { if (HS().MORD.indexOf(m) > HS().MORD.indexOf(HS().HARN.ceiling)) { bridge.toast(`This project's harness caps autonomy at ${MODES[HS().HARN.ceiling].l}`); return; } bridge.monolith.mode = m; bridge.save(); bridge.toast('Modo ' + MODES[m].l); const t = bridge.tabOf(bridge.monolith.currentTabId); if (t && t.kind === 'settings') bridge.show(bridge.monolith.currentTabId!); };
function cycleMode() { const k = Object.keys(MODES); window.setMode(k[(k.indexOf(bridge.monolith.mode) + 1) % k.length]); }
function pickModel() { bridge.palette('', { ph: 'Modelo para a conversa…', items: Object.entries(bridge.providers()).map(([k, p]: [string, any]) => ({ l: `${p.name} — ${p.model}`, d: p.on ? bridge.provState(k) : 'desligado', run: () => { if (!p.on) { bridge.toast(p.name + ' está desligado — liga-o nas Definições'); return; } bridge.monolith.activeProvider = k; bridge.save(); } })) }); }
function toggleProv(k: string) { const p = bridge.providers(); p[k].on = !p[k].on; bridge.save(); agentStore.providerChanged(k); const panes = bridge.panes(); if (panes[bridge.monolith.pane]) panes[bridge.monolith.pane](); const t = bridge.tabOf(bridge.monolith.currentTabId); if (t && t.kind === 'settings') bridge.show(bridge.monolith.currentTabId!); }
function newChat() {
  if (bridge.run().active) { bridge.toast('Pára a missão primeiro'); return; }
  bridge.chat().length = 0;
  codevEngine.agentReset();
  resetComposer();
  $('#ag-msgs')!.innerHTML = `<div class="intro" id="ag-intro"><div class="i-t">Co-Dev</div><div class="i-s">Entendo requisitos, proponho arquitectura, escrevo, testo, avalio o meu próprio trabalho e corrijo-o — contigo a orientar.</div>
  <button class="chip" data-action="handle-prompt" data-on="Explica o ficheiro activo e aponta riscos de arquitectura."><b>Explica o ficheiro activo</b><small>Pergunta livre — respondida pelo Claude ao vivo.</small></button>
  <div class="i-n" id="live-note"></div></div>`; window.updateAgentUI();
}

/* ───── `ctx` da barra de estado: o uso real da conversa (ADR-0006, R2e1) ─────
   O backend devolve, no fim de cada volta, os tokens que o provider reportou
   (platform/desktop/llm.ts anuncia-os em `dx:llm-usage`). O `ctx` mostra o tamanho do último
   contexto enviado (tokens de entrada da última volta) e o título dá a soma da conversa; antes
   da primeira volta (e no browser, sem backend) fica vazio. «Nova conversa» repõe-no. */
const CTX = { turns: 0, last: 0, lastOut: 0, inTotal: 0, outTotal: 0 };
const fmtTok = (n: number): string => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n));
function drawCtx(): void {
  const st = $('#st-ctx');
  if (!st) return;
  st.textContent = CTX.turns && CTX.last ? 'ctx ' + fmtTok(CTX.last) : '';
  st.title = !CTX.turns ? 'Contexto usado na conversa' : CTX.last
    ? tc('ctxLast', { in: CTX.last, out: CTX.lastOut, inTotal: CTX.inTotal, outTotal: CTX.outTotal, turns: CTX.turns })
    : tc('ctxNoUsage');
}
document.addEventListener('dx:llm-usage', (e) => {
  const d = (e as CustomEvent<{ input?: number; output?: number }>).detail || {};
  const i = Number(d.input) || 0, o = Number(d.output) || 0;
  CTX.turns++; CTX.last = i; CTX.lastOut = o; CTX.inTotal += i; CTX.outTotal += o;
  drawCtx();
});
const _newChatBase = newChat;
function newChatWithCtx() { _newChatBase(); Object.assign(CTX, { turns: 0, last: 0, lastOut: 0, inTotal: 0, outTotal: 0 }); drawCtx(); }

/* publica no window os helpers de transcript/UI (donos agora do chat-view) + a cola local
   de modos/providers, p/ o resíduo app.ts, os onclick inline e as outras features (board) */
Object.assign(window, { user, card, waiting, ask });

/* o doTool com o gate de direitos do harness acima: exportado (ADR-0004, U7k — era publicado no window, que só os
   testes liam). O motor de missões guionadas e os cenários de demonstração foram removidos (ADR-0006, R1b). */
export { harnessDoTool as doTool };
/* os helpers do transcript que o board, os separadores e o arranque usam: por import (ADR-0004, U7l — eram publicados no window) */
export { ctxPill, scrollMsgs, beat, runState, runLabel, tl, md };
/* os botões da moldura (app/chrome-actions.ts), os comandos e o arranque importam-nos (ADR-0004, U7n — eram publicados no window) */
export { cycleMode, pickModel, newChatWithCtx as newChat, agCtl, assistantCenter, toggleAgent, openManager };

/* ───── conversa livre: ponto de entrada (o motor liveChat vive em application/) ───── */
function handlePrompt(q: string) {
  if (bridge.run().active) { bridge.toast(tc('runActive')); return; } focusAgent(true);
  if (/^\/plano(\s|$)/.test(q)) {
    const pedido = q.replace(/^\/plano\s*/, '');
    if (!pedido) { user(q); card('co-dev', tc('planUsage', { example: `<code>${esc(tc('planExample'))}</code>` })); return; }
    if (!codevEngine.agentPlan(pedido)) { user(q); card('co-dev', tc('needsDesktopPlan')); }
    return;
  }
  if (q === '/comandos') {
    user(q);
    if (!codevEngine.agentCommands()) card('co-dev', tc('needsDesktopCommands'));
    return;
  }
  if (q === '/reverter') {
    user(q);
    if (!codevEngine.agentRewind()) card('co-dev', tc('needsDesktopRewind'));
    return;
  }
  if (q === '/retomar' || q === '/sessoes' || q === '/sessões') {
    user(q);
    if (!codevEngine.agentResume()) card('co-dev', tc('needsDesktopResume'));
    return;
  }
  if (q === '/test' || q === '/lint') {
    user(q);
    const k = q === '/test' ? 'test' : 'lint', real = bridge.realExec();
    if (real) {
      // pasta real: o comando detectado do projecto, a correr a sério
      const v = bridge.projectCommand(k);
      if (!v) { card('co-dev', tc('noProjectCmd', { kind: tc(k === 'test' ? 'kindTests' : 'kindLint'), file: '<code>.dxtutor/commands.json</code>' })); return; }
      bridge.setPanelTab('terminal', true);
      void real(v.cmd).then(r => card('co-dev', `<code>${esc(v.cmd)}</code> → ${r.ok ? '✓' : '✖'} ${esc(r.sum)}`));
      return;
    }
    card('co-dev', tc('openFolderToRun', { what: tc(k === 'test' ? 'whatTests' : 'whatLint') }));
    return;
  }
  void codevEngine.chat(q);
}
/* Enter/enviar: o compositor junta anexos, modo Plano e fila, e chama handlePrompt */
function agSend() { submit(); }

/* ───── posicionamento do painel ───── */
const renderAgentView = (_t: unknown, host: HTMLElement): void => { host.innerHTML = `<div class="agent-center"><div class="ac-head"><div class="ag-mark">${svg('sparkle')}</div><div class="ag-name">Co-Dev</div><button class="ac-dock" data-action="assistant-dock">${svg('dock-right')} Fixar à direita</button></div><div class="ac-body"><div id="agent-slot"></div></div></div>`; $('#agent-slot')!.appendChild($('#ag-body')!); bridge.setVar('--agent-w', '0px'); $('#tgl-agent')!.classList.remove('on'); scrollMsgs(); };
function assistantCenter() { bridge.openTab({ id: 'agent', title: 'Co-Dev', kind: 'agent' }); }
function assistantDock() { bridge.closeTab('agent'); }
function toggleAgent() { if (bridge.tabOf('agent')) { bridge.closeTab('agent'); return; } const show = bridge.getVar('--agent-w') === '0px'; bridge.setVar('--agent-w', show ? '380px' : '0px'); $('#tgl-agent')!.classList.toggle('on', show); }
function focusAgent(nofocus?: boolean) { if (bridge.tabOf('agent')) { if (bridge.monolith.currentTabId !== 'agent') bridge.show('agent'); } else if (bridge.getVar('--agent-w') === '0px') toggleAgent(); if (!nofocus) ($('#ag-input') as HTMLElement)!.focus(); }
/* publica o ponto de entrada de conversa livre + posicionamento; VIEW.agent fica como shim em app.ts (VIEW nasce depois) */
Object.assign(window, { handlePrompt, agSend, liveChat: codevEngine.liveChat, focusAgent });
/* Board (opção 2 do ADR-0003): o Board pede ao Co-Dev pelo seu legacy-bridge, sem importar a feature */
Object.assign(window, { codevAgentStory: codevEngine.agentStory, codevAgentAvailable: codevEngine.agentAvailable });

/* ───── codev.ask (A2.4): the one way other features ask Co-Dev ─────
   `explain` answers straight away in the chat; the rest lands in the composer as chips +
   text (sent at once with `send`). Registered in app/codev-ask for the other features. */
const codevAsk = makeAsk({
  copy: translator(CODEV_ENGINE_MESSAGES),
  replyLanguage: currentLocale,
  sample: () => bridge.sample() as unknown as Sampler | null,
  presenter,
  speaker: () => bridge.agents()[bridge.monolith.activeAgent].n.toLowerCase() + " · " + tc("explanation"),
  focus: () => focusAgent(true),
  compose: (text, context, send) => composerAsk(text, context, send),
});
/** Ctrl+I / «Enviar selecção ao Co-Dev»: the editor's selection (or the file) as context. */
function codevAskFromEditor(): void {
  const t = bridge.tabOf(bridge.monolith.currentTabId);
  const ta = document.getElementById('ed-ta') as HTMLTextAreaElement | null;
  const rel = t && t.path ? (t.path.startsWith(bridge.root()) ? t.path.slice(bridge.root().length) : t.path) : null;
  const sel = ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : '';
  const ctx: AskContext[] = !rel ? [] : sel
    ? [selectionContext(rel, ta!.value.slice(0, ta!.selectionStart).split('\n').length, sel)]
    : [{ kind: 'file', label: rel.split('/').pop() || rel, path: rel }];
  void codevAsk({ intent: 'chat', context: ctx, send: false });
}
codevAskRegistry.register((r: AskRequest) => codevAsk(r), codevAskFromEditor);
/* F4: the Project sends an issue with the prompt assembled from the template (no window global) */
codevIssue.register((r) => codevEngine.agentIssue(r));

/* ───── páginas: boas-vindas, definições, gestor, análise ───── */
export function openSettings() { bridge.openTab({ id: 'settings', title: 'Definições', kind: 'settings' }); }
function openManager() { bridge.openTab({ id: 'manager', title: 'Gestor de missões', kind: 'manager' }); }
export function openAnalysis() { bridge.openTab({ id: 'analysis', title: tc('analysisTitle'), kind: 'analysis' }); }
function testProvBase(k: string, btn: HTMLElement): void { btn.textContent = 'a testar…'; setTimeout(() => { btn.textContent = 'Testar ligação'; const o = btn.parentElement!.querySelector('.pd')!; const PROV = bridge.providers(); o.innerHTML = k === 'claude' ? (bridge.sample() ? '<span style="color:var(--green)">✓ ao vivo</span> ' + tc('testLive') : tc('testLiveOff')) : `<span style="color:var(--yellow)">simulado</span> ${tc('testSimulated', { ep: esc(PROV[k].ep) })}`; }, 500); }
const testProv = function (k: string, btn: HTMLElement): unknown { const d = desktopPorts.codev; return d && d.testProv ? d.testProv(k, btn, testProvBase) : testProvBase(k, btn); };
const POLICY = [['Responder a perguntas de clarificação', 'tu', 'Co-Dev se confiança ≥ 80%; senão pergunta', 'Co-Dev; abaixo de 80% assume a opção reversível e assinala'], ['Escolher entre propostas dos modelos', 'tu, com recomendação do juiz', 'juiz', 'juiz'], ['Aprovar o plano', 'tu', 'automático', 'automático'], ['Editar ficheiros', 'aprovas cada edição', 'automático, com diff', 'automático, com diff'], ['Terminal: testes, build, lint', 'aprovas', 'automático', 'automático'], ['Terminal: outros comandos', 'aprovas', 'aprovas', 'automático'], ['Corrigir depois de falhar a auto-avaliação', 'aprovas', 'automático (máx. 2)', 'automático (máx. 2)'], ['Commit local', 'aprovas', 'aprovas', 'automático'], ['Push e acções destrutivas', 'aprovas', 'aprovas', 'aprovas — sempre']];
export const renderSettingsPage = (_t: unknown, host: HTMLElement): void => {
  const mi = Object.keys(MODES).indexOf(bridge.monolith.mode); const PROV = bridge.providers();
  host.innerHTML = `<div class="page"><h1>Definições</h1><div class="sub">Guardadas neste browser. Chaves e endpoints reais ficam no keychain da aplicação — aqui servem para mostrar o contrato.</div>
  <h2>Modelos e provedores</h2><div class="pgrid">${Object.entries(PROV).map(([k, p]: [string, any]) => `<div class="pcard"><div class="ph"><span class="pdot${p.on ? '' : ' off'}" style="background:${p.col}"></span>${p.name}<span class="tag ${k === 'claude' && bridge.sample() ? 'live' : ''}">${bridge.provState(k)}</span><button class="sw${p.on ? ' on' : ''}" title="Ligar / desligar" data-action="toggle-prov" data-on="${esc(k)}"></button></div>
    <div><label>Modelo</label><input value="${esc(p.model)}" data-action="set-prov-model" data-on="${esc(k)}"></div><div><label>Endpoint</label><input value="${esc(p.ep)}" data-action="set-prov-ep" data-on="${esc(k)}"></div>
    <div><label>${p.local ? 'Chave (não é necessária)' : 'Chave de API'}</label><input type="password" placeholder="${p.local ? '—' : 'guardada no keychain'}" ${p.local ? 'disabled' : ''}></div><button class="mini" data-action="test-prov" data-on="${esc(k)}">Testar ligação</button><div class="pd"></div></div>`).join('')}</div>
  <h2>Routing por papel</h2><div class="tbl-wrap">${Object.keys(ROUTE).map(r => `<div class="rowline"><span class="pdot" style="background:${PROV[bridge.provFor(r)].col}"></span><b>${ROLE[r]}</b><span style="color:var(--fg-muted)">${ROLE_D[r]}</span><span class="sp"></span><select style="width:150px" data-action="set-route" data-on="${esc(r)}">${Object.entries(PROV).map(([k, p]: [string, any]) => `<option value="${k}"${ROUTE[r] === k ? ' selected' : ''}>${p.name}${p.on ? '' : ' (desligado)'}</option>`).join('')}</select></div>`).join('')}</div><div class="sub" style="margin-top:8px">Se o provedor de um papel estiver desligado, o Co-Dev recorre ao primeiro que estiver ligado.</div>
  <h2>Autonomia</h2><div class="pgrid">${Object.entries(MODES).map(([k, m]) => `<button class="pcard${k === bridge.monolith.mode ? ' sel' : ''}" data-action="set-mode" data-on="${esc(k)}"><div class="ph">${m.l}${k === bridge.monolith.mode ? '<span class="tag acc">activo</span>' : ''}</div><div class="pd">${m.d}</div></button>`).join('')}</div>
  <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><tr><th>Acção</th><th>Manual</th><th>Assistido</th><th>Auto</th></tr>${POLICY.map(r => `<tr><td>${r[0]}</td>${[1, 2, 3].map(i => `<td class="${i - 1 === mi ? 'on' : 'c'}">${r[i]}</td>`).join('')}</tr>`).join('')}</table></div>
  <h2>Aparência</h2><div class="pgrid">${Object.keys(bridge.themes()).map(n => `<button class="pcard${n === bridge.monolith.theme ? ' sel' : ''}" data-action="set-theme" data-on="${esc(n)}"><div class="ph">${n}${n === bridge.monolith.theme ? '<span class="tag acc">activo</span>' : ''}</div></button>`).join('')}</div>
  <h2>Atalhos de teclado</h2><div class="tbl-wrap">${bridge.commands().filter(c => c[1]).map(c => `<div class="rowline"><span>${c[0]}</span><span class="sp"></span><kbd>${c[1]}</kbd></div>`).join('')}</div></div>`;
};
export const renderManagerPage = (_t: unknown, host: HTMLElement): void => {
  const PROV = bridge.providers(); const usage = bridge.usage();
  host.innerHTML = `<div class="page"><h1>Gestor de missões</h1><div class="sub">Tudo o que o Co-Dev fez, decidiu e pode desfazer.</div>
  <h2>Checkpoints</h2><div class="tbl-wrap">${CKPT.map((c: any) => `<div class="rowline"><span style="color:var(--fg-muted);font-family:var(--font-mono);font-size:11px">${c.t}</span><span>${esc(c.label)}</span><span class="sp"></span><button class="mini" data-action="restore-ckpt" data-on="${c.id}">Restaurar ficheiros</button></div>`).join('') || '<div class="rowline" style="color:var(--fg-muted)">Criados antes de cada missão e de cada correcção.</div>'}</div>
  <h2>Uso por provedor <span style="text-transform:none;letter-spacing:0;font-weight:400">(estimativa)</span></h2><div class="tbl-wrap">${Object.entries(PROV).map(([k, p]: [string, any]) => `<div class="rowline"><span class="pdot${p.on ? '' : ' off'}" style="background:${p.col}"></span><b>${p.name}</b><span style="color:var(--fg-muted)">${Object.keys(ROUTE).filter(r => ROUTE[r] === k).map(r => ROLE[r]).join(', ') || 'sem papel'}</span><span class="sp"></span><span>${usage[k].calls} chamadas · ${(usage[k].tok / 1000).toFixed(1)}k tokens</span></div>`).join('')}</div></div>`;
};
/* A antiga página estática
   `renderAnalysisPage` («O que mudou e porquê» = comparação auto-elogiosa com VS Code/
   Antigravity) foi SUBSTITUÍDA pelo harvest da ui-next: VIEW.analysis delega agora em
   `features/changelog.ts` (timeline git real). `openAnalysis` (o ponto de entrada do
   menu Help + paleta) mantém-se e passa a abrir o changelog. */
/* publica openManager/openSettings/openAnalysis (testProv é window.* acima); os VIEW.* ficam shims em app.ts */

/** Renderiza o pane «Co-Dev»: base (conhecimento, checkpoints, routing) e,
 *  por cima, a camada v4 (equipa, backlog, studio). */
export function renderCodevPane(): void {
  const fs = bridge.files(), PROV = bridge.providers(), agents = bridge.agents(), backlog = bridge.backlog(), stages = bridge.stages(), studio = bridge.studioDesign();
  // ── base v3 ──
  const kn = Object.keys(fs).filter(p => p.includes("/.dxtutor/")).sort();
  const el = $("#pane-codev");
  if (!el) return;
  el.innerHTML = hd("Co-Dev", `<button title="Gestor de missões" data-action="open-manager">${svg("graph")}</button><button title="Definições" data-action="open-settings">${svg("settings")}</button>`) + `<div class="sections">
   <div class="scm-grp">Conhecimento do projecto<span class="cnt">${kn.length}</span></div>${kn.map(p => `<div class="scm-row" data-action="open-path" data-on="${esc(p)}">${bridge.fIcon(p)}<span class="nm" style="max-width:none">${esc((p.split("/").pop() as string).replace(".md", ""))}</span></div>`).join("")}
   <div class="scm-grp">Checkpoints<span class="cnt">${CKPT.length}</span></div>${CKPT.slice(0, 6).map((c: any) => `<div class="scm-row" style="cursor:default"><span class="ic">${svg("history")}</span><span class="nm">${esc(c.label)}</span><span class="ra" style="display:flex"><button title="Restaurar" data-action="restore-ckpt" data-on="${c.id}">↶</button></span></div>`).join("") || '<div class="sec-empty">Criados automaticamente antes de cada missão e de cada correcção.</div>'}
   <div class="scm-grp">Routing</div>${Object.keys(ROUTE).map(r => `<div class="kv"><span class="pdot" style="background:${PROV[bridge.provFor(r)].col}"></span>${ROLE[r]}<span class="v">${PROV[bridge.provFor(r)].name}</span></div>`).join("")}</div>`;
  // ── decoração v4 (Equipa / Backlog / Studio) ──
  const sec = $("#pane-codev .sections");
  if (sec) sec.insertAdjacentHTML("afterbegin", `<div class="scm-grp">Equipa<span class="cnt">${Object.keys(agents).length}</span></div>${Object.entries(agents).map(([, a]: [string, any]) => `<div class="scm-row" data-action="open-team" title="${esc(a.d)}"><span class="pdot" style="background:${a.col}"></span><span class="nm">${a.n}</span><span class="pth">${esc(a.paths.join(", ") || "só leitura")}</span></div>`).join("")}<div class="scm-grp">Backlog<span class="cnt">${backlog.issues.length}</span></div><div class="scm-row" data-action="open-board"><span class="ic">${svg("split")}</span><span class="nm">Quadro</span><span class="pth">${stages.map(s => backlog.issues.filter((i: any) => i.stage === s[0]).length).join(" · ")}</span></div><div class="scm-row" data-action="open-studio"><span class="ic">${svg("cube")}</span><span class="nm">Studio</span><span class="pth">${studio.nodes.filter((n: any) => n.st === "plan").length} planeados</span></div>`);
}

/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.codev = renderCodevPane;
VIEW.agent = renderAgentView;
VIEW.manager = renderManagerPage;

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   O único sítio que liga o nome de acção (emitido como `data-action` pelos
   componentes) ao efeito. É aqui porque só este ficheiro tem à mão tanto as
   funções locais do Co-Dev (toggleProv/…) como o bridge para os nomes que
   vivem noutras features (restoreCkpt/openPath/goPane/openTeam/openBoard/
   openStudio/palette/setTheme). `on` é o `data-on` já descodificado pelo
   browser; `el`/`value` servem os handlers que liam `this`/`this.value`.
   Cada entrada declara o evento DOM a que responde — `click` ou `change` (os selects/
   inputs de texto, como era `onchange`). */
const ACTIONS: ActionTable = {
  /* click */
  "set-mode": { on: "click", run: (e) => window.setMode(e.on) },
  "handle-prompt": { on: "click", run: (e) => handlePrompt(e.on) },
  "toggle-prov": { on: "click", run: (e) => toggleProv(e.on) },
  "test-prov": { on: "click", run: (e) => testProv(e.on, e.el as HTMLElement) },
  "set-theme": { on: "click", run: (e) => bridge.setTheme(e.on) },
  "restore-ckpt": { on: "click", run: (e) => bridge.restoreCkpt(+e.on) },
  "open-path": { on: "click", run: (e) => bridge.openPath(e.on) },
  "go-pane": { on: "click", run: (e) => bridge.goToPane(e.on) },
  palette: { on: "click", run: (e) => bridge.palette(e.on) },
  "open-manager": { on: "click", run: () => openManager() },
  "open-settings": { on: "click", run: () => openSettings() },
  "open-analysis": { on: "click", run: () => openAnalysis() },
  "assistant-dock": { on: "click", run: () => assistantDock() },
  "open-team": { on: "click", run: () => bridge.openTeam() },
  "open-board": { on: "click", run: () => bridge.openBoard() },
  "open-studio": { on: "click", run: () => bridge.openStudio() },
  /* live hunks in the editor (RF-CODEV-STREAM §8) */
  "hunk-accept": { on: "click", run: (e) => hunkReview.decide(e.on, true) },
  "hunk-reject": { on: "click", run: (e) => hunkReview.decide(e.on, false) },
  "hunk-pause": { on: "click", run: () => hunkReview.togglePause() },
  "hunk-faster": { on: "click", run: () => hunkReview.faster() },
  "hunk-stop": { on: "click", run: () => hunkReview.stop() },
  "hunk-back": { on: "click", run: () => hunkReview.backToCodev() },
  /* the «Co-Dev run» tab (A3) */
  "hx-open": { on: "click", run: (e) => { const [p, l] = e.on.split('|'); codevRun.open(p, l ? Number(l) : undefined); } },
  "hx-rewind": { on: "click", run: (e) => { const [id, c] = e.on.split('|'); void codevRun.rewind(Number(id), c === '1'); } },
  "hx-perm-save": {
    on: "click",
    run: (e) => {
      const form = e.el.closest('.hx-sec')?.querySelector('.hx-form');
      const lines = (n: string) => ((form?.querySelector(`[name="${n}"]`) as HTMLTextAreaElement | null)?.value ?? '').split('\n');
      void codevRun.savePermissions(lines('allow'), lines('deny'));
    },
  },
  "hx-trust": { on: "click", run: (e) => void codevRun.trust(e.on as 'hooks' | 'mcp') },
  "hx-refresh": { on: "click", run: () => void codevRun.refresh() },
  "hunk-explain": {
    on: "click",
    run: (e) => {
      const h = hunkReview.state().hunks.find((x) => x.id === e.on);
      if (h) void codevAsk({ intent: 'explain', text: 'Explica esta alteração proposta: o que muda e porquê.', context: [hunkContext(h.path, h.anchor, h.old, h.text)], send: true });
    },
  },
  /* change — espelha os antigos onchange */
  "set-prov-model": {
    on: "change",
    run: (e) => { bridge.providers()[e.on].model = e.value; bridge.save(); agentStore.providerChanged(e.on); },
  },
  "set-prov-ep": { on: "change", run: (e) => { bridge.providers()[e.on].ep = e.value; } },
  "set-route": {
    on: "change",
    run: (e) => { ROUTE[e.on] = e.value; bridge.save(); bridge.show(bridge.monolith.currentTabId as string); },
  },
};
bindActions({ ...ACTIONS, ...composerActions() });

/* ───── o compositor da conversa (ui/composer.ts): o mundo chega por este host ───── */
function exportConversation() {
  const turns = Array.from(document.querySelectorAll('#ag-msgs .m')).map((m) => ({
    who: m.querySelector('.br2')?.textContent || '',
    text: (m.querySelector('.bd') as HTMLElement | null)?.innerText ?? m.querySelector('.bd')?.textContent ?? '',
  })).filter((t) => t.text.trim());
  if (!turns.length) { bridge.toast('A conversa está vazia'); return; }
  const when = new Date().toLocaleString('pt-PT');
  const blob = new Blob([exportMarkdown('Conversa Co-Dev', turns, when)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `co-dev-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const composerHost: ComposerHost = {
  send: (q) => handlePrompt(q),
  stop: () => agCtl('stop'),
  // o compositor monta antes de o app.ts criar RUN/PROV: tolera-os ainda por definir
  running: () => !!bridge.run()?.active,
  mode: () => bridge.monolith.mode,
  setMode: (m) => window.setMode(m),
  provider: () => bridge.monolith.activeProvider,
  model: () => bridge.providers()?.[bridge.monolith.activeProvider]?.model ?? '',
  providers: () => Object.entries(bridge.providers() ?? {}).map(([key, p]) => ({ key, name: p.name, model: p.model, on: !!p.on })),
  selectModel: (p, m) => { const all = bridge.providers(); all[p].model = m; bridge.monolith.activeProvider = p; bridge.save(); agentStore.providerChanged(p); },
  effort: () => parseEffort(bridge.effort()),
  setEffort: (e) => { bridge.setEffort(e); refreshComposer(); },
  ctxOn: () => bridge.monolith.contextEnabled,
  toggleCtx: () => { bridge.monolith.contextEnabled = !bridge.monolith.contextEnabled; },
  projectFiles: () => Object.keys(bridge.files() ?? {}).map((p) => bridge.shortPath(p)),
  palette: (ph, items) => bridge.palette('', { ph, items }),
  newChat: () => newChatWithCtx(),
  exportConversation,
  toast: (m) => bridge.toast(m),
  speech: () => bridge.speechRecognition() as (new () => SpeechLike) | null,
  pickPersona: () => bridge.pickPersona(),
  refreshPersona: () => bridge.refreshPersona(),
  openModelSettings: () => openSettings(),
  switchProvider: () => pickModel(),
  dictation: () => dictationGateway,
  dictationLang: () => parseDictationLang(bridge.dictationLang()),
  writePace: () => bridge.writePace() ?? "normal",
  setWritePace: (id) => bridge.setWritePace(id),
  setDictationLang: (l) => bridge.setDictationLang(l),
  localModels: () => (isDesktop() ? ollamaModels() : Promise.resolve([])),
};
mountComposer(composerHost);

/* ═════════ o estado do Co-Dev que vivia no app.ts (ADR-0004, U4j4b) ═════════
   Os provedores (`PROV`), a conversa (`CHAT`), a execução (`RUN`) e o sampler (`SAMPLE`) criam-se aqui, DEPOIS
   do `mountComposer` acima: o compositor monta com eles ainda por definir, como antes (o app.ts avaliava no
   fim); o agentStore adopta os objectos ao publicá-los. O MODE/ACTIVE/THRESH/CTX_ON nascem no agentStore
   com os mesmos valores que o app.ts lhes voltava a atribuir. Seguem o STOP/SAFE/DANGER, o provFor/who, o
   provState com a porta desktop e o VIEW.settings composto (página + secção Language do i18n + porta). */
const CW = window as unknown as { connected: () => string[]; LOCALE: string; SAMPLE: unknown };
const PROV: Record<string, { name: string; vendor: string; model: string; ep: string; on: boolean; local?: boolean; col: string }>={
  claude:{name:'Claude',vendor:'Anthropic',model:'claude-opus-5-5',ep:'https://api.anthropic.com',on:true,col:'var(--accent-hover)'},
  gemini:{name:'Gemini',vendor:'Google',model:'gemini-pro',ep:'https://generativelanguage.googleapis.com',on:true,col:'var(--blue)'},
  codex:{name:'Codex',vendor:'OpenAI',model:'gpt-codex',ep:'https://api.openai.com',on:true,col:'var(--green)'},
  ollama:{name:'Ollama',vendor:'local',model:'qwen2.5-coder:14b',ep:'http://localhost:11434',on:true,local:true,col:'var(--purple)'},
};
const CHAT: unknown[]=[];
const RUN={active:false,paused:false,stop:false,pend:null,abort:null,label:'',t0:0};
export const STOP='__STOP__',SAFE=/^(cargo (test|build|clippy)|dx lint|npm run lint)/,DANGER=/git push|rm -rf|drop table|--force/i;
Object.assign(window, { PROV });
/* a conversa e a execução vão para o dono, sem o window (ADR-0004, U7i) */
agentStore.chat = CHAT as ChatMessage[];
agentStore.run = RUN;
CW.SAMPLE = null;
export const provFor=(r: string): string=>PROV[ROUTE[r]].on?ROUTE[r]:(CW.connected()[0]||ROUTE[r]);
export const who=(r: string): string=>`${ROLE[r].split(' ')[0].toLowerCase()} · ${PROV[provFor(r)].name.toLowerCase()}`;
const provStateBase=(k: string): string=>k==='claude'?(CW.SAMPLE?'ao vivo':'ao vivo indisponível aqui'):PROV[k].local?'local · simulado':'simulado';
export const provState=(k: string): string=>{const d=desktopPorts.codev;return d&&d.provState?d.provState(k,provStateBase):provStateBase(k);};
const settingsWithLanguage=(t: unknown,host: HTMLElement)=>{renderSettingsPage(t,host);host.querySelector('.sub')!.insertAdjacentHTML('afterend',`<h2>Language</h2><div class="pgrid">${services.i18n!.LOCALES.map(l=>`<button class="pcard${CW.LOCALE===l[0]?' sel':''}" data-action="codev:setLocale" data-on="${esc(l[0])}"><div class="ph notr">${l[1]}${CW.LOCALE===l[0]?'<span class="tag acc">✓</span>':''}</div><div class="pd">${l[2]}</div></button>`).join('')}</div>`);};
VIEW.settings=(t,host)=>{const d=desktopPorts.codev;if(d&&d.settings)d.settings(t,host,settingsWithLanguage);else settingsWithLanguage(t,host);};
/* o que a ponte do Co-Dev e a conta lêem (ADR-0004, U7h): avaliam antes deste módulo, por isso usam o registo */
services.codev = { STOP, SAFE, DANGER, provFor, who, openSettings, MODES, ROUTE, provState, agCtl, openManager };
/* a escolha da língua nas Definições chama o setLocale publicado, no acto (era `onclick` inline — ADR-0004, U5c) */
registerActions({ "codev:setLocale": { click: (c) => void callGlobal("setLocale", c.on) } });
