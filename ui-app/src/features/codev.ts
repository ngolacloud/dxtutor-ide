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

import { $, hd, svg, esc, jsa } from "../core";
import { RP, VIEW } from "../app/store/registry";
import * as bridge from "./codev/infrastructure/legacy-bridge";
import { bindActions, type ActionTable } from "./codev/ui/actions";
import { bus } from "../app/bus";
import { desktopPorts } from "../app/desktop";
import { agentStore } from "../app/store";
import { composerActions, mountComposer, refreshComposer, resetComposer, submit, type ComposerHost, type SpeechLike } from "./codev/ui/composer";
import { exportMarkdown, parseDictationLang, parseEffort } from "./codev/domain/composer";
import { dictationGateway } from "./codev/infrastructure/dictation-gateway";
import { ollamaModels } from "../platform/tauri/assistant";
import { isDesktop } from "../platform/tauri/core";
import { RUBRIC } from "./codev/domain/scoring";
import { buildScenarios, scenarioForPrompt } from "./codev/domain/scenarios";
import type { Scenario, ScenarioEnv } from "./codev/domain/types";
import {
  codevEngine,
  missions as MISSIONS_ARR,
  decisions as DECS_ARR,
  ctxPill,
  scrollMsgs,
  user,
  card,
  phase,
  md,
  beat,
  runState,
  runLabel,
  agCtl,
  waiting,
  ask,
  tl,
  hunkReview,
} from "./codev/index";

/* ───── dados de config/estado do Co-Dev (window-backed; app.ts residual lê por global) ───── */
const ROLE: Record<string, string> = window.ROLE = { plan: 'Planeador', code: 'Programador', review: 'Revisor', judge: 'Juiz', local: 'Privado / offline' };
const ROLE_D: Record<string, string> = window.ROLE_D = { plan: 'requisitos, arquitectura, plano', code: 'escreve e edita código', review: 'testes, lint, auto-avaliação', judge: 'escolhe entre propostas', local: 'autocomplete e dados sensíveis' };
const ROUTE: Record<string, string> = window.ROUTE = { plan: 'claude', code: 'codex', review: 'gemini', judge: 'claude', local: 'ollama' };
const MODES: Record<string, { l: string; d: string }> = window.MODES = {
  manual: { l: 'Manual', d: 'Tu decides tudo: respostas, proposta, plano, cada edição e cada comando.' },
  assist: { l: 'Assistido', d: 'O Co-Dev decide o que é seguro e reversível; pergunta-te quando a confiança é baixa.' },
  auto: { l: 'Auto', d: 'Autónomo de ponta a ponta, com auto-avaliação e correcção. Só pára para push e acções destrutivas.' },
};
const CRIT = window.CRIT = RUBRIC;
const MISSIONS: any[] = window.MISSIONS = MISSIONS_ARR;
const DECS: any[] = window.DECS = DECS_ARR;
const CKPT: any[] = window.CKPT = [];

/* ───── interface do agente ───── */
function updateAgentUIBase(): void {
  const p = bridge.providers()[bridge.monolith.activeProvider];
  $('#ag-model-l')!.textContent = p.name + ' · ' + p.model;
  ($('#ag-model .live') as HTMLElement).style.background = p.on ? 'var(--green)' : 'var(--fg-muted)';
  $('#st-model-l')!.textContent = p.name; $('#st-mode')!.textContent = 'Co-Dev: ' + MODES[bridge.monolith.mode].l;
  $('#modebar')!.innerHTML = `<div class="seg">${Object.entries(MODES).map(([k, m]) => `<button class="${k === bridge.monolith.mode ? 'on' : ''}" data-action="set-mode" data-on="${esc(k)}">${m.l}</button>`).join('')}</div><div class="mode-d">${MODES[bridge.monolith.mode].d}</div>`;
  const n = $('#live-note'); if (n) n.innerHTML = bridge.sample() ? '<span class="tag live">Claude ao vivo</span> perguntas livres são respondidas pelo Claude real, com acesso aos ficheiros deste workspace. Gemini, Codex e Ollama são simulados.' : '<span class="tag">simulado</span> nesta vista as missões são guionadas; a ligação ao vivo ao Claude activa-se quando o artefacto é aberto em claude.ai.';
  ctxPill();
  refreshComposer();
}
/* ADR-0004, U4h5: o updateAgentUI, o testProv e o runMission PUBLICADOS consultam a porta desktop
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
   o tecto de autonomia no setMode, os direitos humanos no doTool e o «o código é teu» no
   runMission. Os dados do harness (HARN/MORD/RIGHTS/RIGHT_RE/isHuman/codeGuard) são do
   features/team.ts e lêem-se no acto, como o v5 os lia por nome livre. NOTA (pré-existente,
   preservado): só o doTool PUBLICADO leva o gate de direitos — as missões e o chat usam o
   doTool local do motor (codev/index.ts), que nunca teve o gate do v5. */
interface HarnessGlobals {
  HARN: { ceiling: string }; MORD: string[]; RIGHTS: Record<string, string>; RIGHT_RE: Record<string, RegExp>;
  isHuman: (r: string) => boolean; codeGuard: (what: string) => boolean;
  MODE: string; short: (p: string) => string; log: (s: string, m: string) => void;
}
const HG = window as unknown as HarnessGlobals;
type DoToolArgs = Parameters<typeof codevEngine.doTool>;
async function harnessDoTool(t: DoToolArgs[0], host: DoToolArgs[1], role?: DoToolArgs[2]): Promise<unknown> {
  if (t.t === 'edit') {
    const p = String((t as { p?: unknown }).p);
    if (HG.isHuman('code') && !/\/learn\//.test(p)) { (tl(host, 'harness', HG.short(p)).querySelector('.tr') as HTMLElement).innerHTML = '<span class="bad">✖ writing code is yours in this project</span>'; HG.log('harness', 'edit blocked: code is human-only'); return false; }
    const r = Object.keys(HG.RIGHT_RE).find((k) => HG.isHuman(k) && HG.RIGHT_RE[k].test(p));
    if (r && HG.MODE !== 'manual') { const d = tl(host, 'your call', HG.RIGHTS[r] + ' · ' + HG.short(p)); const v = await ask(d, [{ l: 'Approve', v: 1, pri: 1, done: '✓ approved by you' }, { l: 'Reject', v: 0, done: '✗ rejected by you' }]); if (!v) { HG.log('humano', 'rejected ' + HG.short(p)); return false; } }
  }
  return codevEngine.doTool(t, host, role);
}
function harnessRunMission(S: Parameters<typeof codevEngine.runMission>[0], text: string): ReturnType<typeof codevEngine.runMission> | undefined {
  if (HG.codeGuard(text)) return;
  return codevEngine.runMission(S, text);
}
window.setMode = function (m) { if (HG.MORD.indexOf(m) > HG.MORD.indexOf(HG.HARN.ceiling)) { bridge.toast(`This project's harness caps autonomy at ${MODES[HG.HARN.ceiling].l}`); return; } bridge.monolith.mode = m; bridge.save(); bridge.toast('Modo ' + MODES[m].l); const t = bridge.tabOf(bridge.monolith.currentTabId); if (t && t.kind === 'settings') bridge.show(bridge.monolith.currentTabId!); };
function cycleMode() { const k = Object.keys(MODES); window.setMode(k[(k.indexOf(bridge.monolith.mode) + 1) % k.length]); }
function pickModel() { bridge.palette('', { ph: 'Modelo para a conversa…', items: Object.entries(bridge.providers()).map(([k, p]: [string, any]) => ({ l: `${p.name} — ${p.model}`, d: p.on ? bridge.provState(k) : 'desligado', run: () => { if (!p.on) { bridge.toast(p.name + ' está desligado — liga-o nas Definições'); return; } bridge.monolith.activeProvider = k; bridge.save(); } })) }); }
function toggleProv(k: string) { const p = bridge.providers(); p[k].on = !p[k].on; bridge.save(); agentStore.providerChanged(k); const panes = bridge.panes(); if (panes[bridge.monolith.pane]) panes[bridge.monolith.pane](); const t = bridge.tabOf(bridge.monolith.currentTabId); if (t && t.kind === 'settings') bridge.show(bridge.monolith.currentTabId!); }
function newChat() {
  if (bridge.run().active) { bridge.toast('Pára a missão primeiro'); return; }
  bridge.chat().length = 0;
  codevEngine.agentReset();
  resetComposer();
  $('#ag-msgs')!.innerHTML = `<div class="intro" id="ag-intro"><div class="i-t">Co-Dev</div><div class="i-s">Entendo requisitos, proponho arquitectura, escrevo, testo, avalio o meu próprio trabalho e corrijo-o — contigo a orientar.</div>
  <button class="chip" data-action="demo" data-on="b"><b>Histórico de conversas persistente</b><small>Requisitos → BD → Repository → UI → testes. Inclui uma auto-correcção.</small></button>
  <button class="chip" data-action="demo" data-on="a"><b>Corrigir o E0382 em lib.rs</b><small>Três provedores propõem; o juiz escolhe a melhor.</small></button>
  <button class="chip" data-action="handle-prompt" data-on="Explica o ficheiro activo e aponta riscos de arquitectura."><b>Explica o ficheiro activo</b><small>Pergunta livre — respondida pelo Claude ao vivo.</small></button>
  <div class="i-n" id="live-note"></div></div>`; window.updateAgentUI();
}

/* publica no window os helpers de transcript/UI (donos agora do chat-view) + a cola local
   de modos/providers, p/ o resíduo app.ts, os onclick inline e as outras features (board) */
Object.assign(window, { ctxPill, cycleMode, pickModel, toggleProv, scrollMsgs, newChat, user, card, phase, md, beat, runState, runLabel, agCtl, waiting, ask, tl });

/* ───── cenários de demonstração (domain/scenarios/, dados puros) ─────
   O domínio não toca no `window`: o que os cenários precisam da workspace a
   correr (ficheiros, testes, caminhos, seed) chega por este `ScenarioEnv`,
   construído aqui a partir do bridge. Lazy: SEED/ROOT/P_* são donos de app.ts
   e só existem depois deste módulo avaliar. */
let _SCN: Scenario[] | null = null;
function SCN_(): Scenario[] {
  if (_SCN) return _SCN;
  const env: ScenarioEnv = {
    paths: { root: bridge.root(), lx: bridge.pathLexer(), repo: bridge.pathRepo(), mig: bridge.pathMigration(), test: bridge.pathTest(), hist: bridge.pathHistory(), adr: bridge.pathAdr(), store: bridge.pathStore() },
    seed: bridge.seed(),
    files: () => bridge.files(),
    has: (p, re) => bridge.has(p, re),
    fileDiffStat: (a, b) => bridge.fileDiffStat(a, b),
    runTests: (pkg) => bridge.runTests(pkg),
    dsLint: () => bridge.dsLint(),
    lexBug: () => bridge.lexBug(),
  };
  _SCN = buildScenarios(env);
  return _SCN;
}
const harnessRunMissionPublished = (S: Parameters<typeof codevEngine.runMission>[0], text: string): unknown => { const d = desktopPorts.codev; return d && d.runMission ? d.runMission(S, text, harnessRunMission) : harnessRunMission(S, text); };
function demo(id: string) { const S = SCN_().find((s) => s.id === id)!; focusAgent(true); window.runMission(S, S.prompt); }

/* publica o motor Co-Dev (já ligado em ./codev/index.ts) no window; os onclick inline,
   o resíduo app.ts e features/board.ts resolvem-nos por global */
Object.assign(window, {
  doTool: harnessDoTool,
  runMission: harnessRunMissionPublished,
  dec: codevEngine.dec,
  decideQ: codevEngine.decideQ,
  council: codevEngine.council,
  execSteps: codevEngine.execSteps,
  evaluate: codevEngine.evaluate,
  reflect: codevEngine.reflect,
  demo,
});

/* ───── conversa livre: ponto de entrada (o motor liveChat vive em application/) ───── */
function handlePrompt(q: string) {
  if (bridge.run().active) { bridge.toast('Há uma execução em curso — pára-a ou espera'); return; } focusAgent(true);
  if (/^\/plano(\s|$)/.test(q)) {
    const pedido = q.replace(/^\/plano\s*/, '');
    if (!pedido) { user(q); card('co-dev', 'Escreve o pedido a seguir: <code>/plano acrescenta paginação à API</code>. O agente investiga só com leitura e propõe o plano para aprovares.'); return; }
    if (!codevEngine.agentPlan(pedido)) { user(q); card('co-dev', 'O modo plano precisa do app desktop, com uma pasta aberta e um provedor com agente seleccionado (Claude, Codex, Gemini ou Ollama).'); }
    return;
  }
  if (q === '/comandos') {
    user(q);
    if (!codevEngine.agentCommands()) card('co-dev', 'Os comandos do projecto precisam do app desktop, com uma pasta aberta e um provedor com agente seleccionado (Claude, Codex, Gemini ou Ollama).');
    return;
  }
  if (q === '/reverter') {
    user(q);
    if (!codevEngine.agentRewind()) card('co-dev', 'Voltar atrás precisa do app desktop, com uma pasta aberta e um provedor com agente seleccionado (Claude, Codex, Gemini ou Ollama).');
    return;
  }
  if (q === '/retomar' || q === '/sessoes' || q === '/sessões') {
    user(q);
    if (!codevEngine.agentResume()) card('co-dev', 'Retomar conversas precisa do app desktop, com uma pasta aberta e um provedor com agente seleccionado (Claude, Codex, Gemini ou Ollama).');
    return;
  }
  if (q === '/test' || q === '/lint') {
    user(q);
    const k = q === '/test' ? 'test' : 'lint', real = bridge.realExec();
    if (real) {
      // pasta real: o comando detectado do projecto, a correr a sério
      const v = bridge.projectCommand(k);
      if (!v) { card('co-dev', `Não detectei um comando de ${k === 'test' ? 'testes' : 'lint'} neste projecto. Define-o em <code>.dxtutor/commands.json</code>.`); return; }
      bridge.setPanelTab('terminal', true);
      void real(v.cmd).then(r => card('co-dev', `<code>${esc(v.cmd)}</code> → ${r.ok ? '✓' : '✖'} ${esc(r.sum)}`));
      return;
    }
    const cmd = k === 'test' ? 'cargo test' : 'dx lint', r = bridge.runTask(cmd);
    card('co-dev', `<code>${cmd}</code> → ${r && r.ok ? '✓' : '✖'} ${esc(r ? r.sum : '')}`);
    return;
  }
  // texto livre só cai num cenário demo na simulação do browser; no desktop vai ao modelo real
  const S = scenarioForPrompt(q, SCN_(), !bridge.isDesktop()); if (S) window.runMission(S, q); else void codevEngine.chat(q);
}
/* Enter/enviar: o compositor junta anexos, modo Plano e fila, e chama handlePrompt */
function agSend() { submit(); }

/* ───── posicionamento do painel ───── */
window.renderAgentView = (_t, host) => { host.innerHTML = `<div class="agent-center"><div class="ac-head"><div class="ag-mark">${svg('sparkle')}</div><div class="ag-name">Co-Dev</div><button class="ac-dock" data-action="assistant-dock">${svg('dock-right')} Fixar à direita</button></div><div class="ac-body"><div id="agent-slot"></div></div></div>`; $('#agent-slot')!.appendChild($('#ag-body')!); bridge.setVar('--agent-w', '0px'); $('#tgl-agent')!.classList.remove('on'); scrollMsgs(); };
function assistantCenter() { bridge.openTab({ id: 'agent', title: 'Co-Dev', kind: 'agent' }); }
function assistantDock() { bridge.closeTab('agent'); }
function toggleAgent() { if (bridge.tabOf('agent')) { bridge.closeTab('agent'); return; } const show = bridge.getVar('--agent-w') === '0px'; bridge.setVar('--agent-w', show ? '380px' : '0px'); $('#tgl-agent')!.classList.toggle('on', show); }
function toggleAgentOn() { focusAgent(); }
function focusAgent(nofocus?: boolean) { if (bridge.tabOf('agent')) { if (bridge.monolith.currentTabId !== 'agent') bridge.show('agent'); } else if (bridge.getVar('--agent-w') === '0px') toggleAgent(); if (!nofocus) ($('#ag-input') as HTMLElement)!.focus(); }
/* publica o ponto de entrada de conversa livre + posicionamento; VIEW.agent fica como shim em app.ts (VIEW nasce depois) */
Object.assign(window, { handlePrompt, agSend, liveChat: codevEngine.liveChat, assistantCenter, assistantDock, toggleAgent, toggleAgentOn, focusAgent });
/* Board (opção 2 do ADR-0003): o Board pede ao Co-Dev pelo seu legacy-bridge, sem importar a feature */
Object.assign(window, { codevAgentStory: codevEngine.agentStory, codevAgentAvailable: codevEngine.agentAvailable });

/* ───── páginas: boas-vindas, definições, gestor, análise ───── */
window.renderWelcomePage = (_t, host) => {
  const w = (ic: string, a: string, b: string, action: string, on = '') => `<button class="wbtn" data-action="${action}"${on ? ` data-on="${esc(on)}"` : ''}><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML = `<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">Um IDE com um Co-Dev multi-modelo. Tudo aqui é navegável: os ficheiros editam-se, a pesquisa procura, o git faz commit, os testes reagem ao código — e o Co-Dev trabalha sobre esses mesmos ficheiros.</div>
  <h2>Ver o Co-Dev a trabalhar</h2><div class="wgrid">${w('sparkle', 'Histórico de conversas', 'Missão completa, com auto-correcção', 'demo', 'b')}${w('debug', 'Corrigir o E0382', 'Conselho de 3 modelos + juiz', 'demo', 'a')}${w('graph', 'Gestor de missões', 'Decisões, checkpoints e uso', 'open-manager')}${w('settings', 'Modelos e autonomia', 'Provedores, routing, modos', 'open-settings')}</div>
  <h2>Navegar</h2><div class="wgrid">${w('search', 'Ir para ficheiro', 'Ctrl+P', 'palette', '')}${w('run', 'Todos os comandos', 'Ctrl+Shift+P', 'palette', '>')}${w('book', 'O que mudou e porquê', 'Análise face a VS Code, Antigravity e Claude Desktop', 'open-analysis')}${w('explorer', 'Conhecimento do projecto', 'Regras, ADRs, Design System, BD', 'go-pane', 'codev')}</div></div>`;
};
function openSettings() { bridge.openTab({ id: 'settings', title: 'Definições', kind: 'settings' }); }
function openManager() { bridge.openTab({ id: 'manager', title: 'Gestor de missões', kind: 'manager' }); }
function openAnalysis() { bridge.openTab({ id: 'analysis', title: 'Análise', kind: 'analysis' }); }
function testProvBase(k: string, btn: HTMLElement): void { btn.textContent = 'a testar…'; setTimeout(() => { btn.textContent = 'Testar ligação'; const o = btn.parentElement!.querySelector('.pd')!; const PROV = bridge.providers(); o.innerHTML = k === 'claude' ? (bridge.sample() ? '<span style="color:var(--green)">✓ ao vivo</span> — respostas reais através do Claude deste artefacto.' : 'Ao vivo indisponível nesta vista; activa-se com o artefacto aberto em claude.ai.') : `<span style="color:var(--yellow)">simulado</span> — a página não pode chamar ${esc(PROV[k].ep)}; a chamada real é feita pelo backend da aplicação.`; }, 500); }
window.testProv = function (k, btn) { const d = desktopPorts.codev; return d && d.testProv ? d.testProv(k, btn, testProvBase) : testProvBase(k, btn); };
const POLICY = [['Responder a perguntas de clarificação', 'tu', 'Co-Dev se confiança ≥ 80%; senão pergunta', 'Co-Dev; abaixo de 80% assume a opção reversível e assinala'], ['Escolher entre propostas dos modelos', 'tu, com recomendação do juiz', 'juiz', 'juiz'], ['Aprovar o plano', 'tu', 'automático', 'automático'], ['Editar ficheiros', 'aprovas cada edição', 'automático, com diff', 'automático, com diff'], ['Terminal: testes, build, lint', 'aprovas', 'automático', 'automático'], ['Terminal: outros comandos', 'aprovas', 'aprovas', 'automático'], ['Corrigir depois de falhar a auto-avaliação', 'aprovas', 'automático (máx. 2)', 'automático (máx. 2)'], ['Commit local', 'aprovas', 'aprovas', 'automático'], ['Push e acções destrutivas', 'aprovas', 'aprovas', 'aprovas — sempre']];
window.renderSettingsPage = (_t, host) => {
  const mi = Object.keys(MODES).indexOf(bridge.monolith.mode); const PROV = bridge.providers();
  host.innerHTML = `<div class="page"><h1>Definições</h1><div class="sub">Guardadas neste browser. Chaves e endpoints reais ficam no keychain da aplicação — aqui servem para mostrar o contrato.</div>
  <h2>Modelos e provedores</h2><div class="pgrid">${Object.entries(PROV).map(([k, p]: [string, any]) => `<div class="pcard"><div class="ph"><span class="pdot${p.on ? '' : ' off'}" style="background:${p.col}"></span>${p.name}<span class="tag ${k === 'claude' && bridge.sample() ? 'live' : ''}">${bridge.provState(k)}</span><button class="sw${p.on ? ' on' : ''}" title="Ligar / desligar" data-action="toggle-prov" data-on="${esc(k)}"></button></div>
    <div><label>Modelo</label><input value="${esc(p.model)}" data-action="set-prov-model" data-on="${esc(k)}"></div><div><label>Endpoint</label><input value="${esc(p.ep)}" data-action="set-prov-ep" data-on="${esc(k)}"></div>
    <div><label>${p.local ? 'Chave (não é necessária)' : 'Chave de API'}</label><input type="password" placeholder="${p.local ? '—' : 'guardada no keychain'}" ${p.local ? 'disabled' : ''}></div><button class="mini" data-action="test-prov" data-on="${esc(k)}">Testar ligação</button><div class="pd"></div></div>`).join('')}</div>
  <h2>Routing por papel</h2><div class="tbl-wrap">${Object.keys(ROUTE).map(r => `<div class="rowline"><span class="pdot" style="background:${PROV[bridge.provFor(r)].col}"></span><b>${ROLE[r]}</b><span style="color:var(--fg-muted)">${ROLE_D[r]}</span><span class="sp"></span><select style="width:150px" data-action="set-route" data-on="${esc(r)}">${Object.entries(PROV).map(([k, p]: [string, any]) => `<option value="${k}"${ROUTE[r] === k ? ' selected' : ''}>${p.name}${p.on ? '' : ' (desligado)'}</option>`).join('')}</select></div>`).join('')}</div><div class="sub" style="margin-top:8px">Se o provedor de um papel estiver desligado, o Co-Dev recorre ao primeiro que estiver ligado.</div>
  <h2>Autonomia</h2><div class="pgrid">${Object.entries(MODES).map(([k, m]) => `<button class="pcard${k === bridge.monolith.mode ? ' sel' : ''}" data-action="set-mode" data-on="${esc(k)}"><div class="ph">${m.l}${k === bridge.monolith.mode ? '<span class="tag acc">activo</span>' : ''}</div><div class="pd">${m.d}</div></button>`).join('')}</div>
  <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><tr><th>Acção</th><th>Manual</th><th>Assistido</th><th>Auto</th></tr>${POLICY.map(r => `<tr><td>${r[0]}</td>${[1, 2, 3].map(i => `<td class="${i - 1 === mi ? 'on' : 'c'}">${r[i]}</td>`).join('')}</tr>`).join('')}</table></div>
  <h2>Auto-avaliação</h2><div class="tbl-wrap"><div class="rowline"><b>Limiar para entregar</b><span style="color:var(--fg-muted)">abaixo disto o Co-Dev corrige em vez de entregar</span><span class="sp"></span><input type="range" min="50" max="100" step="5" value="${bridge.monolith.threshold}" style="width:140px" data-action="set-threshold"><b style="width:28px;text-align:right">${bridge.monolith.threshold}</b></div><div class="rowline"><b>Tentativas de correcção</b><span class="sp"></span><span>2, depois pede orientação</span></div><div class="rowline"><b>Rubrica do juiz</b><span class="sp"></span><span>${CRIT.map(k => k.l + ' ' + k.w).join(' · ')}</span></div></div>
  <h2>Aparência</h2><div class="pgrid">${Object.keys(bridge.themes()).map(n => `<button class="pcard${n === bridge.monolith.theme ? ' sel' : ''}" data-action="set-theme" data-on="${esc(n)}"><div class="ph">${n}${n === bridge.monolith.theme ? '<span class="tag acc">activo</span>' : ''}</div></button>`).join('')}</div>
  <h2>Atalhos de teclado</h2><div class="tbl-wrap">${bridge.commands().filter(c => c[1]).map(c => `<div class="rowline"><span>${c[0]}</span><span class="sp"></span><kbd>${c[1]}</kbd></div>`).join('')}</div></div>`;
};
window.renderManagerPage = (_t, host) => {
  const st: Record<string, string> = { 'concluída': 'live', 'em curso': 'acc', 'bloqueada': 'bad', 'parada': 'warn', 'erro': 'bad' };
  const PROV = bridge.providers(); const usage = bridge.usage();
  host.innerHTML = `<div class="page"><h1>Gestor de missões</h1><div class="sub">Tudo o que o Co-Dev fez, decidiu e pode desfazer.</div>
  <h2>Missões</h2><div class="tbl-wrap">${MISSIONS.map((m: any) => `<div class="rowline"><span class="tag ${st[m.state] || ''}">${m.state}</span><b>${esc(m.title)}</b><span style="color:var(--fg-muted)">modo ${MODES[m.mode].l} · ${m.decs.length} decisões${m.retries ? ' · ' + m.retries + ' correcção(ões)' : ''}${m.dur != null ? ' · ' + m.dur + 's' : ''}</span><span class="sp"></span>${m.score != null ? `<b style="color:${m.score >= bridge.monolith.threshold ? 'var(--green)' : 'var(--red)'}">${m.score}/100</b>` : ''}</div>`).join('') || '<div class="rowline" style="color:var(--fg-muted)">Ainda sem missões.<span class="sp"></span><button class="mini" data-action="demo" data-on="b">Correr a demonstração</button></div>'}</div>
  <h2>Registo de decisões</h2><div class="tbl-wrap"><table class="tbl"><tr><th>#</th><th>Fase</th><th>Decisão</th><th>Escolha</th><th>Quem</th><th>Confiança</th><th>Estado</th></tr>${DECS.map((d: any) => `<tr><td class="c">${d.id}</td><td class="c">${d.phase}</td><td>${esc(d.q)}<div style="color:var(--fg-muted);font-size:11px">${esc(d.basis || '')}</div></td><td>${esc(d.choice)}</td><td>${d.by}</td><td class="c">${d.conf ? Math.round(d.conf * 100) + '%' : '—'}</td><td><span class="tag ${d.status === 'ok' ? 'live' : d.status === 'corrigida' ? 'bad' : 'warn'}">${d.status === 'ok' ? 'válida' : d.status === 'corrigida' ? 'corrigida depois' : 'pressuposto'}</span></td></tr>`).join('') || '<tr><td colspan="7" class="c">Sem decisões registadas.</td></tr>'}</table></div>
  <h2>Checkpoints</h2><div class="tbl-wrap">${CKPT.map((c: any) => `<div class="rowline"><span style="color:var(--fg-muted);font-family:var(--font-mono);font-size:11px">${c.t}</span><span>${esc(c.label)}</span><span class="sp"></span><button class="mini" data-action="restore-ckpt" data-on="${c.id}">Restaurar ficheiros</button></div>`).join('') || '<div class="rowline" style="color:var(--fg-muted)">Criados antes de cada missão e de cada correcção.</div>'}</div>
  <h2>Uso por provedor <span style="text-transform:none;letter-spacing:0;font-weight:400">(estimativa)</span></h2><div class="tbl-wrap">${Object.entries(PROV).map(([k, p]: [string, any]) => `<div class="rowline"><span class="pdot${p.on ? '' : ' off'}" style="background:${p.col}"></span><b>${p.name}</b><span style="color:var(--fg-muted)">${Object.keys(ROUTE).filter(r => ROUTE[r] === k).map(r => ROLE[r]).join(', ') || 'sem papel'}</span><span class="sp"></span><span>${usage[k].calls} chamadas · ${(usage[k].tok / 1000).toFixed(1)}k tokens</span></div>`).join('')}</div></div>`;
};
window.GAPS = [['Paleta de comandos, quick open, atalhos', 'VS Code', 'Menus só mostravam um aviso', 'Feito: Ctrl+P, Ctrl+Shift+P, todos os menus ligados a acções'], ['Editor de código', 'VS Code', 'Texto fixo, só de leitura', 'Feito: editável, realce, diagnósticos na margem, Ln/Col, outline'], ['Pesquisa e substituição', 'VS Code', 'Resultados desenhados à mão', 'Feito: procura real em todos os ficheiros, substituir tudo'], ['Git', 'VS Code', 'Lista estática de 3 ficheiros', 'Feito: estado real, diff, stage, descartar, commit, ramos'], ['Testes e problemas', 'VS Code', 'Contagens fixas', 'Feito: derivados do conteúdo dos ficheiros; clicar leva à linha'], ['Gestor de missões', 'Antigravity (Agent Manager)', 'Não existia', 'Feito: missões, estado, pontuação, duração'], ['Artefactos de confiança', 'Antigravity', 'Só um plano decorativo', 'Feito: requisitos, plano, diffs por edição, avaliação, entrega'], ['Política de autonomia', 'Antigravity + Claude', 'Não existia', 'Feito: Manual / Assistido / Auto com matriz por tipo de acção'], ['Ferramentas visíveis e aprováveis', 'Claude Desktop', 'Resposta «sem backend»', 'Feito: cada leitura, edição e comando aparece e pode ser aprovado'], ['Checkpoints e reversão', 'Claude Code', 'Não existia', 'Feito: automáticos, restauráveis'], ['Conhecimento do projecto', 'CLAUDE.md / Knowledge', 'Não existia', 'Feito: .dxtutor/ com regras, requisitos, ADRs, Design System, padrões, BD'], ['Vários provedores com routing por papel', '—', 'Um modelo fixo', 'Feito: Claude ao vivo; Gemini, Codex e Ollama com o mesmo contrato, simulados'], ['Conselho de modelos com juiz', '—', 'Não existia', 'Feito: propostas concorrentes, rubrica ponderada, decisão registada'], ['Auto-avaliação e auto-correcção', '—', 'Não existia', 'Feito: pontuação por critérios, limiar, reflexão, 2 tentativas, depois escala']];
/* as linhas da secção v3 (ADR-0004, U4j4a — era um GAPS.push no app.ts, que avaliava depois; mesma ordem final) */
window.GAPS.push(['Grafo de commits e ramos','GitLens','Lista plana de commits','Feito: DAG com faixas por ramo, merges, tags, autor por commit, detalhe de ficheiros'],['Gitflow guiado','GitLens / git-flow','Não existia','Feito: cada tarefa abre um ramo e fecha com merge em develop; releases ficam com o humano'],['Vários assistentes com harness','Claude Code (subagentes)','Um só assistente','Feito: 8 papéis; caminhos, comandos e limite de ficheiros aplicados em cada ferramenta'],['Router de modelos','—','Routing fixo','Feito: o assistente descreve a tarefa e recebe o modelo mais adequado'],['Studio de arquitectura','projecto original','Só no histórico de commits','Feito: canvas editável que gera backlog e sprints'],['Backlog, sprints e kanban','Jira / Linear','Não existia','Feito: teste automático ao entrar em Teste; só o que passa chega à validação funcional'],['Tutor','projecto original','Não existia','Feito: percursos, exercícios verificados no editor, pistas graduais, lições a partir dos erros']);
/* `GAPS` fica (é partilhado — app.ts faz `GAPS.push(...)`). A antiga página estática
   `renderAnalysisPage` («O que mudou e porquê» = comparação auto-elogiosa com VS Code/
   Antigravity) foi SUBSTITUÍDA pelo harvest da ui-next: VIEW.analysis delega agora em
   `features/changelog.ts` (timeline git real). `openAnalysis` (o ponto de entrada do
   menu Help + paleta) mantém-se e passa a abrir o changelog. */
/* publica openManager/openSettings/openAnalysis (testProv é window.* acima); os VIEW.* ficam shims em app.ts */
Object.assign(window, { openManager, openSettings, openAnalysis });

/** Renderiza o pane «Co-Dev»: base (missões, conhecimento, checkpoints, routing) e,
 *  por cima, a camada v4 (equipa, backlog, studio). */
function renderCodevPane(): void {
  const fs = bridge.files(), PROV = bridge.providers(), agents = bridge.agents(), backlog = bridge.backlog(), stages = bridge.stages(), studio = bridge.studioDesign();
  // ── base v3 ──
  const kn = Object.keys(fs).filter(p => p.includes("/.dxtutor/")).sort();
  const el = $("#pane-codev");
  if (!el) return;
  el.innerHTML = hd("Co-Dev", `<button title="Gestor de missões" data-action="open-manager">${svg("graph")}</button><button title="Definições" data-action="open-settings">${svg("settings")}</button>`) + `<div class="sections">
   <div class="scm-grp">Missões<span class="cnt">${MISSIONS.length}</span></div>${MISSIONS.slice(0, 5).map((m: any) => `<div class="scm-row" data-action="open-manager"><span class="ic" style="color:var(--accent-hover)">${svg("sparkle")}</span><span class="nm">${esc(m.title)}</span><span class="pth">${m.state}${m.score != null ? " · " + m.score : ""}</span></div>`).join("") || '<div class="sec-empty">Ainda sem missões. Experimenta uma das demonstrações no painel do Co-Dev.</div>'}
   <div class="scm-grp">Conhecimento do projecto<span class="cnt">${kn.length}</span></div>${kn.map(p => `<div class="scm-row" data-action="open-path" data-on="${esc(p)}">${bridge.fIcon(p)}<span class="nm" style="max-width:none">${esc((p.split("/").pop() as string).replace(".md", ""))}</span></div>`).join("")}
   <div class="scm-grp">Checkpoints<span class="cnt">${CKPT.length}</span></div>${CKPT.slice(0, 6).map((c: any) => `<div class="scm-row" style="cursor:default"><span class="ic">${svg("history")}</span><span class="nm">${esc(c.label)}</span><span class="ra" style="display:flex"><button title="Restaurar" data-action="restore-ckpt" data-on="${c.id}">↶</button></span></div>`).join("") || '<div class="sec-empty">Criados automaticamente antes de cada missão e de cada correcção.</div>'}
   <div class="scm-grp">Routing</div>${Object.keys(ROUTE).map(r => `<div class="kv"><span class="pdot" style="background:${PROV[bridge.provFor(r)].col}"></span>${ROLE[r]}<span class="v">${PROV[bridge.provFor(r)].name}</span></div>`).join("")}</div>`;
  // ── decoração v4 (Equipa / Backlog / Studio) ──
  const sec = $("#pane-codev .sections");
  if (sec) sec.insertAdjacentHTML("afterbegin", `<div class="scm-grp">Equipa<span class="cnt">${Object.keys(agents).length}</span></div>${Object.entries(agents).map(([, a]: [string, any]) => `<div class="scm-row" data-action="open-team" title="${esc(a.d)}"><span class="pdot" style="background:${a.col}"></span><span class="nm">${a.n}</span><span class="pth">${esc(a.paths.join(", ") || "só leitura")}</span></div>`).join("")}<div class="scm-grp">Backlog<span class="cnt">${backlog.issues.length}</span></div><div class="scm-row" data-action="open-board"><span class="ic">${svg("split")}</span><span class="nm">Quadro</span><span class="pth">${stages.map(s => backlog.issues.filter((i: any) => i.stage === s[0]).length).join(" · ")}</span></div><div class="scm-row" data-action="open-studio"><span class="ic">${svg("cube")}</span><span class="nm">Studio</span><span class="pth">${studio.nodes.filter((n: any) => n.st === "plan").length} planeados</span></div>`);
}

/* ── publicação transitória no window (shim para o residual) ──
   RP.codev (app.ts) delega em renderCodevPane. */
window.renderCodevPane = renderCodevPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.codev = renderCodevPane;
VIEW.agent = window.renderAgentView;
VIEW.manager = window.renderManagerPage;

/* ───── tabela de acções (ADR-0002, Fase 4) ─────
   O único sítio que liga o nome de acção (emitido como `data-action` pelos
   componentes) ao efeito. É aqui porque só este ficheiro tem à mão tanto as
   funções locais do Co-Dev (demo/toggleProv/…) como o bridge para os nomes que
   vivem noutras features (restoreCkpt/openPath/goPane/openTeam/openBoard/
   openStudio/palette/setTheme). `on` é o `data-on` já descodificado pelo
   browser; `el`/`value` servem os handlers que liam `this`/`this.value`.
   Cada entrada declara o evento DOM a que responde — `change` para os selects/
   inputs de texto (como era `onchange`) e `input` para o cursor do limiar (como
   era `oninput`), para o listener único não disparar um no evento do outro. */
const ACTIONS: ActionTable = {
  /* click */
  "set-mode": { on: "click", run: (e) => window.setMode(e.on) },
  demo: { on: "click", run: (e) => demo(e.on) },
  "handle-prompt": { on: "click", run: (e) => handlePrompt(e.on) },
  "toggle-prov": { on: "click", run: (e) => toggleProv(e.on) },
  "test-prov": { on: "click", run: (e) => window.testProv(e.on, e.el) },
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
  /* input — espelha o antigo oninput do limiar */
  "set-threshold": {
    on: "input",
    run: (e) => {
      const v = +e.value;
      bridge.monolith.threshold = v;
      (e.el.nextElementSibling as HTMLElement).textContent = String(v);
      bridge.save();
    },
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
  newChat: () => newChat(),
  exportConversation,
  toast: (m) => bridge.toast(m),
  speech: () => bridge.speechRecognition() as (new () => SpeechLike) | null,
  pickPersona: () => bridge.pickPersona(),
  refreshPersona: () => bridge.refreshPersona(),
  openModelSettings: () => openSettings(),
  switchProvider: () => pickModel(),
  dictation: () => dictationGateway,
  dictationLang: () => parseDictationLang(bridge.dictationLang()),
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
const CW = window as unknown as { ROUTE: Record<string, string>; ROLE: Record<string, string>; connected: () => string[]; LOCALES: string[][]; LOCALE: string; SAMPLE: unknown };
const PROV: Record<string, { name: string; vendor: string; model: string; ep: string; on: boolean; local?: boolean; col: string }>={
  claude:{name:'Claude',vendor:'Anthropic',model:'claude-opus-5-5',ep:'https://api.anthropic.com',on:true,col:'var(--accent-hover)'},
  gemini:{name:'Gemini',vendor:'Google',model:'gemini-pro',ep:'https://generativelanguage.googleapis.com',on:true,col:'var(--blue)'},
  codex:{name:'Codex',vendor:'OpenAI',model:'gpt-codex',ep:'https://api.openai.com',on:true,col:'var(--green)'},
  ollama:{name:'Ollama',vendor:'local',model:'qwen2.5-coder:14b',ep:'http://localhost:11434',on:true,local:true,col:'var(--purple)'},
};
const CHAT: unknown[]=[];
const RUN={active:false,paused:false,stop:false,pend:null,abort:null,label:'',t0:0};
const STOP='__STOP__',SAFE=/^(cargo (test|build|clippy)|dx lint|npm run lint)/,DANGER=/git push|rm -rf|drop table|--force/i;
Object.assign(window, { PROV, CHAT, RUN, STOP, SAFE, DANGER });
CW.SAMPLE = null;
const provFor=(r: string): string=>PROV[CW.ROUTE[r]].on?CW.ROUTE[r]:(CW.connected()[0]||CW.ROUTE[r]);
const who=(r: string): string=>`${CW.ROLE[r].split(' ')[0].toLowerCase()} · ${PROV[provFor(r)].name.toLowerCase()}`;
const provStateBase=(k: string): string=>k==='claude'?(CW.SAMPLE?'ao vivo':'ao vivo indisponível aqui'):PROV[k].local?'local · simulado':'simulado';
window.provState=(k: string): string=>{const d=desktopPorts.codev;return d&&d.provState?d.provState(k,provStateBase):provStateBase(k);};
const settingsWithLanguage=(t: unknown,host: HTMLElement)=>{window.renderSettingsPage(t,host);host.querySelector('.sub')!.insertAdjacentHTML('afterend',`<h2>Language</h2><div class="pgrid">${CW.LOCALES.map(l=>`<button class="pcard${CW.LOCALE===l[0]?' sel':''}" onclick="setLocale(${jsa(l[0])})"><div class="ph notr">${l[1]}${CW.LOCALE===l[0]?'<span class="tag acc">✓</span>':''}</div><div class="pd">${l[2]}</div></button>`).join('')}</div>`);};
VIEW.settings=(t,host)=>{const d=desktopPorts.codev;if(d&&d.settings)d.settings(t,host,settingsWithLanguage);else settingsWithLanguage(t,host);};
Object.assign(window, { provFor, who });
