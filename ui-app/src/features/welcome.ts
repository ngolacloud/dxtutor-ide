/* ═════════ dxtutor IDE — feature: página de boas-vindas (ADR-0004, U4g7) ═════════
   Dona do separador «welcome» (o primeiro que o arranque abre): regista `VIEW.welcome` no
   registo de vistas (app/store/registry.ts). Era a camada «less noise» do v5.ts, que
   sobrepunha as três versões anteriores (o shim do app.ts para o `renderWelcomePage` do
   codev.ts e as duas páginas do app.ts) antes de alguém as chamar — essas saíram como
   código morto. No desktop, a vista consulta a porta `desktopPorts.welcome` (U4h5b). Os botões chamam por nome as acções das features
   (`openStudio()`, `openTeam()`, `dxRun()`, …) — handlers inline, como no v5. */

import { svg } from "../core";
import { VIEW } from "../app/store/registry";
import { desktopPorts } from "../app/desktop";
import { registerActions, globalCalls, callGlobal } from "../app/actions";
import { translator } from "../app/i18n";
import { WELCOME_MESSAGES } from "./welcome.messages";
import { ltResume } from "./learn";
import { openStudio } from "./studio";
import { openSettings, openManager } from "./codev";
import { openTeam } from "./team";
import { dxDeploy } from "./infra";
import { dxRun } from "./stack";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(WELCOME_MESSAGES);

const welcomeBase=(_t: unknown,host: HTMLElement): void=>{const w=(ic:string,a:string,b:string,act:string,on?:string)=>`<button class="wbtn" data-action="welcome:${act}"${on===undefined?'':` data-on="${on}"`}><span class="wi">${svg(ic)}</span><span><b>${a}</b><small>${b}</small></span></button>`;
  host.innerHTML=`<div class="page"><div style="display:flex;align-items:center;gap:14px;margin-bottom:8px"><div style="width:40px;height:40px;display:grid;place-items:center;background:var(--accent-grad);border-radius:11px;color:#fff;box-shadow:var(--sh-acc)">${svg('sparkle')}</div><h1 style="font-weight:300;font-size:26px;margin:0">dxtutor <b style="font-weight:600">IDE</b></h1></div>
  <div class="sub">${txt("youDecideTheAssistants")}</div>
  <h2>${txt("build")}</h2><div class="wgrid">${w('cube','1 · Design','Studio with cloud and open-source components','openStudio')}${w('account','2 · Set the harness','Templates, scopes and who decides','openTeam')}${w('split','3 · Deliver','Board, sprints, automatic tests, your review','openBoard')}${w('run','4 · RUN','Start the whole stack on your container runtime','dxRun')}${w('rocket','5 · Deploy','One click to your local Kubernetes','dxDeploy')}${w('container','Infra','Socket, dev container, KUBECONFIG','goPane','infra')}</div>
  <h2>${txt("learn")}</h2><div class="wgrid">${w('book','Learning Track','Rust and Go, from zero to confident','ltResume')}</div>
  <h2>Co-Dev</h2><div class="wgrid">${w('graph','Mission manager','Decisions, checkpoints and usage','openManager')}${w('settings','Settings','Models, autonomy, language','openSettings')}</div></div>`;};
/** A parte desktop da página (ADR-0004, U4h5b), injectada em `desktopPorts.welcome`: os botões
 *  «Open Folder…» e as pastas recentes. Recebe a página de base. */
export interface WelcomeDesktop { welcome(t: unknown, host: HTMLElement, virtual: (t: unknown, host: HTMLElement) => void): void }
/* o VIEW.welcome consulta a porta (antes o desktop embrulhava-o no `window`) */
VIEW.welcome=(t,host)=>{const d=desktopPorts.welcome;if(d)d.welcome(t,host,welcomeBase);else welcomeBase(t,host);};
/* os botões da página chamam a função publicada, no acto (eram `onclick="f(…)"` em string — ADR-0004, U5a) */
registerActions({
  ...globalCalls("welcome", ["openBoard"]),
  "welcome:dxRun": { click: () => void dxRun() },
  "welcome:dxDeploy": { click: () => void dxDeploy() },
  "welcome:openManager": { click: () => openManager() },
  "welcome:openTeam": { click: () => openTeam() },
  "welcome:openStudio": { click: () => openStudio() },
  "welcome:openSettings": { click: () => openSettings() },
  "welcome:ltResume": { click: () => ltResume() },
  "welcome:goPane": { click: (c) => void callGlobal("goPane", c.on) },
});
