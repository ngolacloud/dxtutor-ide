/* ═════════ feature `welcome` — raiz de composição (r23 F6) ═════════
   A página de boas-vindas ao estilo do VS Code (Start · Recent · Walkthroughs) e as páginas dos walkthroughs
   (separador `walk:<id>`). Liga o serviço (application/welcome-service.ts) à app desktop e à paleta
   (infrastructure/legacy-bridge.ts), ao git e à auditoria (infrastructure/tauri.ts), ao diálogo de aprovação
   partilhado e aos pontos de entrada das outras features — a tabela `STEP` mapeia cada acção de um passo para
   a função que abre (sem código em texto). Sem `window` aqui.
   O Project avalia DEPOIS desta feature (importado pelo boot-steps): lê-se pelo registo `services`, no acto. */

import { svg, toast } from "../../core";
import { VIEW } from "../../app/store/registry";
import { LS } from "../../app/store/storage";
import { services } from "../../app/services";
import { registerActions } from "../../app/actions";
import { requestApproval } from "../../app/approval";
import { translator } from "../../app/i18n";
import { THEME_LABEL, COMMANDS_MESSAGES } from "../../app/commands-messages";
import { openTab } from "../tabs";
import { goPane } from "../shell";
import { newFile } from "../explorer";
import { THEMES, setTheme } from "../theme";
import { ltResume } from "../learn";
import { openStudio } from "../studio";
import { openSettings, openManager } from "../codev";
import { openCodevRun } from "../codev/index";
import { openTeam } from "../team";
import { dxDeploy } from "../infra";
import { dxRun } from "../stack";
import { openOps } from "../ops/index";
import { WELCOME_MESSAGES } from "../welcome.messages";
import { makeWelcome } from "./application/welcome-service";
import { STORAGE_KEY } from "./domain/progress";
import { walkthrough, stepAction, type StepAction } from "./domain/walkthroughs";
import { tauriAudit, tauriGit } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { WELCOME_UI_MESSAGES, type WelcomeKey } from "./ui/messages";
import { renderWalk, renderWelcome } from "./ui/welcome-view";

const t = translator(WELCOME_UI_MESSAGES);
const tagline = translator(WELCOME_MESSAGES);
const tcm = translator(COMMANDS_MESSAGES);
const RECENT_SHOWN = 5;

export const welcome = makeWelcome({
  workspace: { desktop: () => B.desktop(), home: () => B.home(), recent: () => LS.get<string[]>("dx-recent", []), open: (p) => B.openFolder(p) },
  git: tauriGit(),
  human: { approve: (r) => requestApproval(r), text: (ph, initial) => B.textPrompt(ph, initial), toast: (m) => toast(m) },
  audit: tauriAudit(),
  store: { load: () => LS.get<unknown>(STORAGE_KEY, null), save: (v) => LS.set(STORAGE_KEY, v) },
  say: (k, p) => t(k as WelcomeKey, p),
});

/* ── o que cada passo abre ── */
const STEP: Record<StepAction, () => void> = {
  themes: () => B.pick(t("themePh"), Object.keys(THEMES).map((n) => ({ l: THEME_LABEL[n] ? tcm(THEME_LABEL[n]) : n, run: () => setTheme(n) }))),
  settings: () => openSettings(),
  openFolder: () => { void welcome.openFolder(); },
  explorer: () => goPane("explorer"),
  palette: () => B.palette(">"),
  studio: () => openStudio(),
  team: () => openTeam(),
  board: () => B.openBoard(),
  run: () => { void dxRun(); },
  deploy: () => { void dxDeploy(); },
  infra: () => goPane("infra"),
  codev: () => goPane("codev"),
  manager: () => openManager(),
  codevRun: () => openCodevRun(),
  project: () => services.project?.openProject(),
  projectBacklog: () => services.project?.openProject("backlog"),
  pairHost: () => B.pair("start"),
  pairJoin: () => B.pair("join"),
  tests: () => goPane("test"),
  debug: () => goPane("debug"),
  hood: () => B.hood(),
  scm: () => goPane("scm"),
  learn: () => ltResume(),
  tutor: () => goPane("tutor"),
};

/* ── as vistas ── */
let welcomeHost: HTMLElement | null = null;
const walkHosts = new Map<string, HTMLElement>();

function paintWelcome(): void {
  if (!welcomeHost || !welcomeHost.isConnected) return;
  const all = welcome.recent();
  welcomeHost.innerHTML = renderWelcome(t, svg, {
    desktop: welcome.desktop(), cloning: welcome.cloning(), tagline: tagline("youDecideTheAssistants"),
    recent: all.slice(0, RECENT_SHOWN), moreRecent: all.length > RECENT_SHOWN, walks: welcome.walkthroughs(), show: welcome.state().show,
  });
}
function paintWalk(id: string): void {
  const h = walkHosts.get(id), w = walkthrough(id);
  if (!h || !w) return;
  if (!h.isConnected) { walkHosts.delete(id); return; }
  const p = welcome.walkthroughs().find((x) => x.w.id === id)!.progress;
  h.innerHTML = renderWalk(t, svg, w, welcome.state(), welcome.selected(id), p, welcome.desktop());
}
welcome.subscribe(() => { paintWelcome(); [...walkHosts.keys()].forEach(paintWalk); });

VIEW.welcome = (_t, host) => { welcomeHost = host; paintWelcome(); };
VIEW.walk = (tab, host) => { const id = String(tab.id).replace(/^walk:/, ""); walkHosts.set(id, host); paintWalk(id); };

/** Abre (ou volta a) a página de boas-vindas. */
export function openWelcome(): void { openTab({ id: "welcome", title: t("tab"), kind: "welcome" }); }

/** Abre um walkthrough no primeiro passo por fazer. */
export function openWalk(id: string): void {
  const w = walkthrough(id);
  if (!w) return;
  welcome.openWalk(id);
  openTab({ id: `walk:${id}`, title: t(`${id}.title` as WelcomeKey), kind: "walk" });
}

/** A paleta com os walkthroughs («Help: Walkthroughs»). */
export function pickWalkthrough(): void {
  B.pick(t("walkthroughs"), welcome.walkthroughs().map(({ w, progress }) => ({ l: t(`${w.id}.title` as WelcomeKey), d: t("progress", { done: progress.done, total: progress.total }), run: () => openWalk(w.id) })));
}

const pair2 = (on: string): [string, string] => { const i = on.indexOf("|"); return [on.slice(0, i), on.slice(i + 1)]; };

registerActions({
  "welcome:newFile": { click: () => newFile() },
  "welcome:openFile": { click: () => B.palette("") },
  "welcome:openFolder": { click: () => { void welcome.openFolder(); } },
  "welcome:clone": { click: () => { void welcome.clone(); } },
  "welcome:connect": { click: () => B.pick(t("connectPh"), [
    { l: t("connDevc"), run: () => goPane("infra") },
    { l: t("connPod"), run: () => openOps() },
    { l: t("connPair"), run: () => B.pair("join") },
    { l: t("connSsh"), run: () => toast(t("sshNA")) },
  ]) },
  "welcome:pairJoin": { click: () => B.pair("join") },
  "welcome:openRecent": { click: (c) => { void welcome.openRecent(c.on); } },
  "welcome:moreRecent": { click: () => B.pick(t("recentPh"), welcome.recent().map((r) => ({ l: r.name, d: r.parent, run: () => { void welcome.openRecent(r.path); } }))) },
  "welcome:openWalk": { click: (c) => openWalk(c.on) },
  "welcome:toggleShow": { change: (c) => welcome.setShow((c.el as HTMLInputElement).checked) },
  "welcome:back": { click: () => openWelcome() },
  "welcome:step": { click: (c) => { const [id, i] = pair2(c.on); welcome.select(id, Number(i)); } },
  "welcome:done": { click: (c) => { const [id, step] = pair2(c.on); welcome.done(id, step); } },
  "welcome:run": { click: (c) => {
    const [id, step] = pair2(c.on), s = walkthrough(id)?.steps.find((x) => x.id === step);
    const a = s && stepAction(s, welcome.desktop());
    if (a) STEP[a]();
  } },
});
