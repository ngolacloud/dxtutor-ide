/* ═════════ comandos e menus do IDE (ADR-0004, U4j5c) ═════════
   A paleta de comandos (`CMD`), a barra de menus (`buildMenus`) e o fallback do Tutor (`LCUR`), que viviam
   no app.ts — movidos sem mudar, na mesma posição do main.ts (logo antes do app/boot-steps.ts). O `CMD`
   lê o `THEMES` e guarda várias acções por valor ao avaliar (como antes). Dissolvem-se quando cada
   feature registar os seus comandos (U7). */
import { getVar } from "../features/shell";
import { short } from "../features/workspace";
import type { AppCmd, AppMenu } from "./ide-globals";
import { codevAsk } from "./codev-ask";
import { openCodevRun } from "../features/codev/index";

/* O global MENUS (declarado em pair.ts) não conhece os separadores/submenus que se constroem aqui:
   neste módulo vê-se com o tipo completo. Declaração só de tipo: continua a resolver o global no acto. */
declare const MENUS: AppMenu[];

export const CMD: AppCmd[]=[
  ['Ir para ficheiro…','Ctrl+P',()=>palette('')],['Mostrar todos os comandos','Ctrl+Shift+P',()=>palette('>')],['Ir para a linha…','Ctrl+G',()=>palette(':')],['Ir para o próximo problema','F8',()=>nextProblem()],
  ['Ficheiro: Novo ficheiro…','',newFile],['Ficheiro: Nova pasta…','',newFolder],
  ['Ver: Explorer','Ctrl+Shift+E',()=>goPane('explorer')],['Ver: Pesquisa','Ctrl+Shift+F',()=>{goPane('search');$('#s-q')!.focus();}],['Ver: Source Control','Ctrl+Shift+G',()=>goPane('scm')],['Ver: Run and Debug','',()=>goPane('run')],['Ver: Testing','',()=>goPane('test')],['Ver: Extensions','',()=>goPane('ext')],
  ['Ver: Alternar barra lateral','Ctrl+B',toggleSide],['Ver: Alternar painel','Ctrl+J',togglePanel],['Ver: Terminal','Ctrl+`',()=>setPanelTab('terminal')],['Ver: Problemas','Ctrl+Shift+M',()=>setPanelTab('problems')],['Ver: Output do Co-Dev','',()=>setPanelTab('output')],
  ['Co-Dev: Focar a conversa','Ctrl+L',()=>focusAgent()],['Co-Dev: Abrir no centro','',()=>assistantCenter()],['Co-Dev: Painel de conhecimento','Ctrl+Shift+A',()=>goPane('codev')],['Co-Dev: Gestor de missões','',()=>openManager()],['Co-Dev: Nova conversa','',()=>newChat()],['Co-Dev: Escolher modelo…','',()=>pickModel()],
  ['Co-Dev: Modo Manual','',()=>setMode('manual')],['Co-Dev: Modo Assistido','',()=>setMode('assist')],['Co-Dev: Modo Auto','',()=>setMode('auto')],
  ['Co-Dev: Parar execução','',()=>agCtl('stop')],['Co-Dev: Restaurar último checkpoint','',()=>CKPT.length?restoreCkpt(CKPT[0].id):toast('Sem checkpoints')],
  ['Git: Commit…','',()=>{goPane('scm');$('#scm-msg')!.focus();}],['Git: Mudar de ramo…','',pickBranch],
  ['Run: Projectos e comandos…','',()=>goPane('run')],['Run: Testes do projecto','',()=>goPane('test')],/* eram cargo test/build e dx lint fixos do workspace de demonstração (ADR-0006, R2d) */
  ['Preferências: Definições','Ctrl+,',()=>openSettings()],...Object.keys(THEMES).map((n): AppCmd=>['Preferências: Tema — '+n,'',()=>setTheme(n)]),
  ['Ajuda: Bem-vindo','',()=>openTab({id:'welcome',title:'Bem-vindo',kind:'welcome'})],['Ajuda: O que mudou e porquê','',()=>openAnalysis()]];
const cmd=(l: string)=>()=>CMD.find(c=>c[0]===l)![2]();
export function buildMenus(){MENUS.length=0;MENUS.push(
  {t:'File',get items(){return[{l:'Novo ficheiro…',act:newFile},{l:'Nova pasta…',act:newFolder},{sep:1},{l:'Abrir ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Abrir recente',sub:Object.keys(FS).filter(p=>/\.(rs|ts|sql)$/.test(p)).slice(0,6).map(p=>({l:short(p),act:()=>openPath(p)}))},{sep:1},{l:'Guardar',k:'Ctrl+S',act:()=>toast('Auto Save activo — já está guardado')},{sep:1},{l:'Preferências',sub:[{l:'Definições',k:'Ctrl+,',act:openSettings},{l:'Tema',sub:Object.keys(THEMES).map(n=>({l:n,on:n===THEME,act:()=>setTheme(n)}))}]},{sep:1},{l:'Fechar separador',act:()=>cur&&closeTab(cur)}];}},
  {t:'Edit',items:[{l:'Anular',k:'Ctrl+Z',act:()=>edCmd('undo')},{l:'Refazer',k:'Ctrl+Y',act:()=>edCmd('redo')},{sep:1},{l:'Procurar nos ficheiros',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Substituir nos ficheiros',act:()=>{goPane('search');$('#s-r')!.focus();}}]},
  {t:'Selection',items:[{l:'Seleccionar tudo',k:'Ctrl+A',act:()=>edCmd('selectAll')},{l:'Seleccionar linha',act:()=>edCmd('line')},{sep:1},{l:'Enviar selecção ao Co-Dev',k:'Ctrl+I',act:()=>{if(!selText()){toast('Selecciona texto no editor primeiro');return;}codevAsk.fromEditor();}}]},
  {t:'View',get items(){return[{l:'Paleta de comandos…',k:'Ctrl+Shift+P',act:()=>palette('>')},{sep:1},{l:'Explorer',k:'Ctrl+Shift+E',act:()=>goPane('explorer')},{l:'Pesquisa',k:'Ctrl+Shift+F',act:cmd('Ver: Pesquisa')},{l:'Source Control',k:'Ctrl+Shift+G',act:()=>goPane('scm')},{l:'Testing',act:()=>goPane('test')},{l:'Co-Dev',k:'Ctrl+Shift+A',act:()=>goPane('codev')},{sep:1},{l:'Barra lateral',k:'Ctrl+B',on:sideOpen(),act:toggleSide},{l:'Painel inferior',k:'Ctrl+J',on:getVar('--panel-h')!=='0px',act:togglePanel},{l:'Painel do Co-Dev',on:getVar('--agent-w')!=='0px'||!!tabOf('agent'),act:toggleAgent},{sep:1},{l:'Terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Problemas',k:'Ctrl+Shift+M',act:()=>setPanelTab('problems')},{l:'Output do Co-Dev',act:()=>setPanelTab('output')}];}},
  {t:'Go',items:[{l:'Ir para ficheiro…',k:'Ctrl+P',act:()=>palette('')},{l:'Ir para a linha…',k:'Ctrl+G',act:()=>palette(':')},{l:'Próximo problema',k:'F8',act:()=>nextProblem()},{sep:1},{l:'Separador seguinte',act:()=>stepTab(1)},{l:'Separador anterior',act:()=>stepTab(-1)}]},
  {t:'Run',items:[{l:'Run Project…',act:()=>goPane('run')},{l:'Run Tests',act:()=>goPane('test')}]},
  {t:'Co-Dev',get items(){return[{l:'Focar a conversa',k:'Ctrl+L',act:()=>focusAgent()},{l:'Nova conversa',act:newChat},{l:'Execução, checkpoints e permissões',act:openCodevRun},{l:'Escolher modelo…',act:pickModel},{sep:1},...Object.entries(MODES).map(([k,m])=>({l:'Modo '+m.l,on:k===MODE,act:()=>setMode(k)})),{sep:1},{l:'Gestor de missões',act:openManager},{l:'Conhecimento do projecto',act:()=>goPane('codev')},{l:'Definições do Co-Dev',act:openSettings}];}},
  {t:'Terminal',items:[{l:'Mostrar terminal',k:'Ctrl+`',act:()=>setPanelTab('terminal')},{l:'Limpar',act:()=>termClear()}]},
  {t:'Help',items:[{l:'Bem-vindo',act:cmd('Ajuda: Bem-vindo')},{l:'O que mudou e porquê',act:openAnalysis},{l:'Atalhos de teclado',act:openSettings},{sep:1},{l:'Sobre',act:()=>toast('dxtutor IDE · protótipo v2')}]});}

/* ───── Tutor ───── */
export let LCUR: [string, string]=['rust','own'];/* fallback constante dos call-sites vivos (welcome/CMD/MENUS): nextLesson()||LCUR */

/* comandos da camada v3 (Projecto, Git, Gitflow, Tutor) */
CMD.push(['Projecto: Studio de arquitectura','',openStudio],['Projecto: Quadro (kanban)','',openBoard],['Projecto: Gerar backlog a partir do Studio','',genBacklog],['Projecto: Executar Sprint 1','',()=>runSprint(0)],['Projecto: Executar Sprint 2','',()=>runSprint(1)],['Projecto: Nova issue…','',newIssue],['Equipa: Assistentes e harness','',()=>openTeam()],['Equipa: Escolher assistente da conversa…','',pickAgent],
  ['Git: Grafo de commits','',()=>openGraph()],['Gitflow: Iniciar feature…','',()=>gfPrompt('feature')],['Gitflow: Iniciar fix…','',()=>gfPrompt('fix')],['Gitflow: Iniciar release…','',()=>gfPrompt('release')],['Gitflow: Finalizar ramo actual','',()=>gfFinish()?toast('Ramo finalizado'):toast('Não estás num ramo de gitflow')],['Tutor: Continuar a aprender','',()=>{goPane('tutor');openLesson(...(nextLesson()||LCUR));}]);

Object.assign(window, { CMD, buildMenus });
