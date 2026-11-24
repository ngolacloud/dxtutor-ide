/* ═════════ dxtutor IDE — feature: Infra (resíduo strangler + composição) ═════════
   ADR-0002 (Clean Architecture). Feature DONA do seu estado (ENVS/ENVX/K8S/DEVC/OBS,
   window-backed) e do DOM (renderInfraPane base v5 + decoração v6 dobradas,
   renderEnvsView, renderObserveView, drawRemote/infraDraw); COMPÕE os dois motores
   (runtime/contentores/dev-container/K8s + environments/drift/observabilidade) com os
   adaptadores do bridge.

   Estado da extracção:
   - Fase 1 — window.* confinado a features/infra/infrastructure/legacy-bridge.ts.
   - Fase 2 — domínio PURO e tipado em features/infra/domain/ (geradores K8s/devcontainer,
     secrets, drift, observabilidade).
   - Fase 3 — a orquestração (rtConnect/k8sConnect/dcAttach/dxDeploy/k8sScale/k8sDown/
     promote/redeployEnv/initSecrets/envState/driftReport/… + os wrappers dos geradores)
     saiu para features/infra/application/infra-engine.ts, com deps injectadas por porta
     (application/ports.ts). Este ficheiro COMPÕE o motor com os adaptadores do bridge, é
     DONO do DOM e do estado, e RE-PUBLICA a superfície no window.

   Mecânica strangler: avalia ANTES de app.ts/v5.ts/v6.ts (ordem do index.html). O estado
   é window-backed e hidratado PREGUIÇOSAMENTE pelo motor (LS/ROOT só se tocam dentro das
   funções, nunca no eval). Os nomes livres do monólito (SD/TECH/KIND/FS/GIT/goPane/dlg/…)
   resolvem no window ao correr, através do bridge. As decorações de v6 (dxDeploy/drawStudio)
   importam initSecrets/driftReport/DSTY por porta tipada (ADR-0002 passo 6); rtConnect/
   k8sConnect/dxDeploy publicados consultam a porta desktop (`desktopPorts.infra`, U4h4). Este
   resíduo está FORA da subárvore features/infra/ (não governado por A7/A8). ADR-0004, U4i1:
   tipado (era @ts-nocheck) — só anotações, casts e declarações: o JavaScript emitido é o mesmo. */
import { $, $$, hd, svg, esc } from "../core";
import { RP, VIEW } from "../app/store/registry";
import { desktopPorts } from "../app/desktop";
import { RTN, KCTX, ENVL, DSTY, defaultEnvs, defaultEnvx } from "./infra/domain/constants";
import { seeded, spark, buildObs, obsLine as domObsLine } from "./infra/domain/observability";
import { urlHosts } from "./infra/domain/secrets";
import { makeInfraEngine } from "./infra/application/infra-engine";
import { bindActions, type ActionTable } from "./infra/ui/actions";
import type { DesignNode, EnvDep, ObsData, SecretSets } from "./infra/domain/types";
import type { ObserveTab } from "./infra/application/ports";
import {
  envs, envx, k8s, setK8s, stack, setStack, devc, setDevc, pDc, setPDc,
  design, files, root, tech, kind, isApp, nodeSlug, composeServices,
  gitRefs, gitCommits, lsGet, lsSet,
  goPane, openPath, openTab, dlg, echo, echoCmd, newInput, setPanelTab, getVar,
  pane, panes, drawStack, note, rel, toast, log, rerender, writeFile, publish,
} from "./infra/infrastructure/legacy-bridge";

/* globais que este resíduo publica/lê e que o resto do contrato (core.ts) ainda não declara */
declare global {
  interface Window {
    saveEnv: () => void;
    saveEnvx: () => void;
    SHOWSEC: boolean;
    DRIFT: string | null;
    OBS: Record<string, ObsData>;
    ctlLogs: (n: string) => void;
    XC: Record<string, (a: string[], v?: string) => unknown>;
    redeployEnv: (e: string) => void;
    promote: (e: string) => void;
    openEnvs: () => void;
    k8sScale: (n: string, d: number) => void;
    k8sDown: () => void;
  }
  var SHOWSEC: boolean;
}

/* ═══════════ estado window-backed (o resíduo é dono) ═══════════
   RTN/KCTX/ENVL são constantes do domínio, publicadas (onclick inline + v5/v6
   resolvem-nas por global). DSTY já não é publicada: v6 importa-a por porta tipada
   (ADR-0002 passo 6). ENVS/ENVX hidratam-se preguiçosamente no motor. DEVC/K8S
   continuam window-backed porque bridge.ts/stack.ts os reatribuem; STACK é de stack.ts. */
window.RTN = RTN; window.KCTX = KCTX; window.ENVL = ENVL;
const ENVS = (window.ENVS = defaultEnvs());
const ENVX = (window.ENVX = defaultEnvx());
window.DEVC = null; window.K8S = null; window.SHOWSEC = false; window.DRIFT = null;
const OBS: Record<string, ObsData> = (window.OBS = {}); let OBST = null as ReturnType<typeof setInterval> | null;

/* ═══════════ raiz de composição: adaptadores do bridge (infra) ↔ portas do motor
   (application). O motor fica puro (sem window/DOM); window/DOM ficam deste lado. ENVS/
   ENVX são a MESMA referência que envs()/envx() do bridge devolvem (window.ENVS/ENVX). */
const engine = makeInfraEngine({
  state: { envs, envx, k8s, setK8s, stack, setStack, devc, setDevc, pDc, setPDc },
  catalog: { design, tech, kind, isApp, slug: nodeSlug },
  workspace: { files, writeFile, composeServices, root },
  scm: { refs: gitRefs, commits: gitCommits },
  persist: { get: lsGet, set: lsSet },
  terminal: { echo, echoCmd, newInput, setPanelTab, getVar },
  nav: { goPane, openPath, openTab, dlg },
  notifier: { toast, note, log },
  view: { redraw: () => infraDraw(), rerender, rerenderDebug: () => { if (pane() === "debug") panes().debug?.(); }, drawStack },
  clock: { now: () => Date.now() },
});
const {
  hydrateEnvs, hydrateEnvx, saveEnv, saveEnvx, cli, needRt, rtConnect, k8sConnect,
  projectContext, devcontainerJson, dcAttach, dcDetach, appEnv, k8sInfra, k8sDocs,
  dxDeploy, k8sScale, k8sDown, runTaskQuiet, ctlLogs, designApps, localSecrets,
  initSecrets, envDeps, envState, envHealth, secretCheck, commitsBetween, promote,
  redeployEnv, openEnvs, driftReport, openObserve,
} = engine;
/* ADR-0002 passo 6: nomes reais consumidos via import ES (porta tipada), substituindo as
   antigas fachadas-alias resolvidas por global — hoje pelo drift do Studio (features/studio.ts,
   ADR-0004 U4g6; era a decoração do v6.ts). */
export { initSecrets, driftReport, DSTY, ENVL };

/* ═══════════ DOM (resíduo dono): remote + redesenho do pane ═══════════ */
function drawRemote() { const b = $('.si.remote'); if (!b) return; let s = b.querySelector('span.rl'); if (!s) { b.insertAdjacentHTML('beforeend', '<span class="rl notr"></span>'); s = b.querySelector('span.rl'); } s!.textContent = DEVC ? ' Dev Container: dxtutor' : ''; b.onclick = () => goPane('infra'); b.title = 'Infra: runtime, dev container, Kubernetes'; }
function infraDraw() { if (PANE === 'infra') RP.infra(); drawRemote(); }

/** Renderiza o pane «Infra»: base (runtime/dev-container/containers/K8s/remote) e, por
 *  cima, a camada v6 (environments, workloads do ambiente seleccionado). */
function renderInfraPane(): void {
  hydrateEnvs(); hydrateEnvx();
  const DEVC = window.DEVC, K8S = window.K8S, STACK = window.STACK,
    ENVL = window.ENVL, ENVX = window.ENVX, envHealth = window.envHealth, envState = window.envState,
    openObserve = window.openObserve;
  // ── base v5 ──
  const el = $("#pane-infra"), on = (x: unknown) => `<span class="pdot${x ? "" : " off"}" style="background:var(--green)"></span>`, docs = k8sDocs().length;
  if (!el) return;
  el.innerHTML = hd("Infra", `<button title="RUN the stack" data-action="dx-run">${svg("run")}</button><button title="Deploy to Kubernetes" data-action="dx-deploy">${svg("rocket")}</button>`) + `<div class="sections">
   <div class="scm-grp">Container runtime${on(ENVS.rtOn)}</div><div class="seg" style="margin:4px 10px">${Object.keys(RTN).map(r => `<button class="${ENVS.rt === r ? "on" : ""}" data-action="rt-set" data-on="${esc(r)}">${RTN[r]}</button>`).join("")}</div>
   <input class="inp notr" value="${esc(ENVS.sock[ENVS.rt])}" title="Socket path" data-action="rt-sock"><button class="btn${ENVS.rtOn ? " ghost" : ""}" data-action="rt-connect">${ENVS.rtOn ? "Disconnect" : "Connect socket"}</button>
   <div class="scm-grp">Dev Container${on(!!DEVC)}</div>${DEVC ? `<div class="scm-row" data-action="open-pdc"><span class="ic">${svg("container")}</span><span class="nm notr">${DEVC.name}</span><span class="pth notr">${DEVC.image}</span></div><button class="btn ghost" data-action="dc-detach">Detach</button>` : `<div class="sec-empty">Attach this project to a container built from its own context: languages, ports, the runtime socket and your kubeconfig.</div><button class="btn" data-action="dc-attach">Attach project to a container</button>`}
   <div class="scm-grp">Containers<span class="cnt">${(STACK ? STACK.length : 0) + (DEVC ? 1 : 0)}</span></div>${!ENVS.rtOn ? '<div class="sec-empty">Connect the socket to list containers.</div>' : (STACK || []).map((s: any) => `<div class="scm-row" data-action="ctl-logs" data-on="${esc(s.name)}" title="Show logs"><span class="pdot" style="background:var(--green)"></span><span class="nm notr">${esc(s.name)}</span><span class="pth notr">${esc(s.url === "internal" ? s.src : s.url)}</span></div>`).join("") + (STACK ? `<button class="btn ghost" data-action="dx-stop">■ Stop the stack</button>` : `<button class="btn ghost" data-action="dx-run">▶ RUN the stack</button>`)}
   <div class="scm-grp">Kubernetes${on(ENVS.k8sOn)}</div><input class="inp notr" value="${esc(ENVS.kube)}" title="KUBECONFIG" data-action="kube-conf"><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 10px"><select class="inp notr" style="margin:0;width:100%" title="Context" data-action="kube-ctx">${KCTX.map(c => `<option${c === ENVS.ctx ? " selected" : ""}>${c}</option>`).join("")}</select><input class="inp notr" style="margin:0;width:100%" value="${esc(ENVS.ns)}" title="Namespace" data-action="kube-ns"></div>
   <button class="btn${ENVS.k8sOn ? " ghost" : ""}" data-action="k8s-connect">${ENVS.k8sOn ? "Disconnect" : "Connect cluster"}</button>
   ${ENVS.k8sOn ? (K8S ? K8S.deps.map((d: any) => `<div class="scm-row" style="cursor:default"><span class="pdot" style="background:${d.ready ? "var(--green)" : "var(--fg-muted)"}"></span><span class="nm notr">${esc(d.n)}</span><span class="pth">${d.ready}/${d.rep}</span><span class="ra" style="display:flex"><button title="Scale down" data-action="k8s-scale" data-on="${esc(d.n)}|-1">−</button><button title="Scale up" data-action="k8s-scale" data-on="${esc(d.n)}|1">+</button></span></div>`).join("") + `<button class="btn" data-action="dx-deploy">⎈ Redeploy</button><button class="btn ghost" data-action="k8s-down">Delete from cluster</button>` : `<div class="sec-empty">${docs ? `${docs} resources ready in <code>deploy/k8s</code>.` : "No manifests yet — the platform issue from the Studio creates them."}</div><button class="btn" data-action="dx-deploy">⎈ Deploy to ${esc(ENVS.ctx)}</button>`) : ""}
   <div class="scm-grp">Remote hosts<span class="cnt">${ENVS.ssh.length}</span></div>${ENVS.ssh.map((h: string, i: number) => `<div class="scm-row" data-action="ssh-toast"><span class="ic">${svg("remote")}</span><span class="nm notr">${esc(h)}</span><span class="ra" style="display:flex"><button title="Remove" data-action="ssh-del" data-on="${esc(i)}">×</button></span></div>`).join("")}<input class="inp notr" placeholder="user@host" data-action="ssh-add">
   ${(window as unknown as { DXR?: unknown }).DXR ? "" : '<div class="sec-empty">O socket e o KUBECONFIG ligam o runtime de contentores e o cluster reais na app desktop; no browser não há a que ligar.</div>'}</div>`;
  // ── decoração v6 (environments / observabilidade) ──
  const sec = $("#pane-infra .sections");
  if (!sec) return;
  sec.insertAdjacentHTML("afterbegin", `<div class="scm-grp">Environments</div><div class="env-chips">${Object.entries(ENVL).map(([k, l]) => { const h = envHealth(k); return `<button class="${ENVX.cur === k ? "on" : ""}" data-action="env-chip" data-on="${esc(k)}"><span class="pdot${h === "off" ? " off" : ""}" style="background:${h === "bad" ? "var(--red)" : "var(--green)"}"></span>${l}</button>`; }).join("")}</div><button class="btn ghost" data-action="open-envs">Environments and secrets</button>`);
  $$("#pane-infra .scm-row").forEach(row => {
    const b = row.querySelector('[data-action="k8s-scale"]');
    if (!b) return;
    const n = (b.getAttribute("data-on") || "").split("|")[0];
    row.style.cursor = "pointer"; row.title = "Logs and metrics";
    row.onclick = e => { if ((e.target as Element | null)?.closest("button")) return; openObserve("local", n as string); };
  });
  if (ENVX.cur !== "local") {
    const s = envState(ENVX.cur);
    (sec.querySelector(".env-chips"))?.insertAdjacentHTML("afterend", s ? s.deps.map((d: any) => `<div class="scm-row" data-action="observe" data-on="${ENVX.cur}|${esc(d.n)}" title="Logs and metrics"><span class="pdot" style="background:${d.status === "crash" ? "var(--red)" : "var(--green)"}"></span><span class="nm notr">${esc(d.n)}</span><span class="pth">${d.ready}/${d.rep}${d.status === "crash" ? " · crash loop" : ""}</span></div>`).join("") : `<div class="sec-empty">${ENVL[ENVX.cur]} has nothing deployed. Promote from ${ENVX.cur === "staging" ? "Local" : "Staging"}.</div><button class="btn" data-action="promote" data-on="${esc(ENVX.cur)}">Promote to ${ENVL[ENVX.cur]}…</button>`);
  }
}

/** Corpo de VIEW.envs — exportado; v6.ts importa e delega (porta tipada, ADR passo 6). */
export function renderEnvsView(_t: unknown, host: HTMLElement) { initSecrets(); const L = localSecrets(), mask = (v: string) => v === '' ? '<span class="sec-empty-v">empty</span>' : SHOWSEC ? esc(v) : '••••••' + esc(String(v).slice(-4));
  const card = (e: string) => { const s = envState(e), h = envHealth(e); return `<div class="pcard env-c"><div class="ph"><span class="pdot${h === 'off' ? ' off' : ''}" style="background:${h === 'bad' ? 'var(--red)' : 'var(--green)'}"></span>${ENVL[e]}${ENVX.cur === e ? '<span class="tag acc">selected</span>' : ''}</div>
    <div class="st-kv"><span>cluster</span><code class="notr">${esc(e === 'local' ? ENVS.ctx : ENVX.ctx[e])} / ${esc(e === 'local' ? ENVS.ns : ENVX.ns[e])}</code></div><div class="st-kv"><span>version</span><code class="notr">${s ? s.ver + ' · ' + rel(s.at as number) : 'not deployed'}</code></div>
    ${s ? `<div class="st-kv"><span>workloads</span><code>${s.deps.filter(d => d.status === 'ok').length}/${s.deps.length} ready</code></div>${s.deps.filter(d => d.status === 'crash').map(d => `<div class="env-bad notr">✖ ${esc(d.n)} · CrashLoopBackOff</div>`).join('')}` : ''}
    <div class="env-a">${e === 'local' ? `<button class="mini pri" data-action="deploy-envs">⎈ Deploy</button>` : `<button class="mini pri" data-action="promote" data-on="${esc(e)}">Promote from ${e === 'staging' ? 'Local' : 'Staging'} →</button>${s ? `<button class="mini" data-action="redeploy" data-on="${esc(e)}">Redeploy</button>` : ''}`}<button class="mini" data-action="env-select" data-on="${esc(e)}">Select</button></div></div>`; };
  host.innerHTML = `<div class="page" style="max-width:1000px"><h1>Environments</h1><div class="sub">One design, three environments. Only the secrets and the cluster change. Promotion always moves a version that already ran in the previous environment, and it never happens without your approval.</div>
   <div class="pgrid" style="grid-template-columns:repeat(3,1fr)">${['local', 'staging', 'production'].map(card).join('')}</div>
   <h2>Secrets<button class="mini" style="float:right;text-transform:none;letter-spacing:0" data-action="toggle-sec">${SHOWSEC ? 'Hide values' : 'Show values'}</button></h2>
   <div class="sub">Local values come from the compose wiring. Staging and production values live in the cluster or your vault — the desktop app writes them there and never commits them.</div>
   ${Object.keys(L).length ? `<div class="tbl-wrap"><table class="tbl sec-t"><tr><th>Workload · key</th><th>Local</th><th>Staging</th><th>Production</th></tr>${Object.entries(L).map(([a, kv]) => Object.keys(kv).map(k => `<tr><td class="notr"><b>${esc(a)}</b><br><code>${esc(k)}</code></td><td class="c notr">${mask(kv[k])}</td>${['staging', 'production'].map(e => { const v = (ENVX.sec![e as keyof SecretSets][a] || {})[k]; return `<td class="notr">${SHOWSEC ? `<input value="${esc(v || '')}" data-action="sec-edit" data-on="${e}|${esc(a)}|${esc(k)}">` : mask(v == null ? '' : v)}</td>`; }).join('')}</tr>`).join('')).join('')}</table></div>` : '<div class="sub">The design has no applications yet.</div>'}
   <h2>Promotion history</h2><div class="tbl-wrap">${ENVX.hist.map(h => `<div class="rowline"><span>${ENVL[h.from]} → <b>${ENVL[h.to]}</b></span><code class="notr">${h.ver}</code><span class="sp"></span><span style="color:var(--fg-muted)">approved by you · ${rel(h.at)}</span></div>`).join('') || '<div class="rowline" style="color:var(--fg-muted)">No promotions yet.</div>'}</div></div>`; }

/* ── observabilidade: cache OBS + polling (DOM/relógio ficam no resíduo; o núcleo
   seedado — seeded/spark/buildObs/obsLine — é puro, importado do domínio). ── */
const isoTime = () => new Date().toISOString().slice(11, 23);
function obsInit(env: string, n: string): ObsData {
  const k = env + ':' + n;
  if (OBS[k]) return OBS[k];
  const dep: Partial<EnvDep> = (envState(env) || { deps: [] }).deps.find(d => d.n === n) || { status: 'ok' };
  const node = design().nodes.find(x => nodeSlug(x) === n), kindName = node ? tech()[node.tech].kind : 'app';
  return (OBS[k] = buildObs(env, n, { crash: dep.status === 'crash', err: dep.err as string | null, kind: kindName, appLike: isApp((node || { tech: 'rust-axum' }) as DesignNode) }, k, isoTime));
}
function obsLine(o: ObsData) { domObsLine(o, isoTime); }

/** Corpo de VIEW.observe — exportado; v6.ts importa e delega (porta tipada, ADR passo 6). */
export function renderObserveView(t: ObserveTab, host: HTMLElement) { const o = obsInit(t.env as string, t.name), last = (a: number[]) => a[a.length - 1];
  host.innerHTML = `<div class="obs"><div class="gl-bar"><b class="notr">${esc(t.name)}</b><span class="tag">${ENVL[t.env as string]}</span>${o.crash ? '<span class="tag bad">CrashLoopBackOff</span>' : '<span class="tag live">running</span>'}<span class="tag warn">simulated</span><span class="sp"></span><button class="mini" data-action="obs-clear" data-on="${esc(t.env)}:${esc(t.name)}">Clear</button></div>
   <div class="obs-m">${[['CPU', '%', o.cpu, 'var(--accent)', 100], ['Memory', 'MiB', o.mem, 'var(--blue)'], ['Requests', '/s', o.rps, 'var(--green)'], ['p95 latency', 'ms', o.p95, 'var(--purple)']].map(([l, u, a, c, mx]) => `<div class="obs-c"><div class="obs-h"><span>${l}</span><b>${last(a as number[]).toFixed(u === '%' || u === '/s' ? 0 : 0)} ${u}</b></div>${spark(a as number[], c as string, mx as number | undefined)}</div>`).join('')}</div>
   <div class="obs-l" id="obs-l">${o.logs.map(x => `<div class="ll ${x.lv}"><span class="ts">${x.ts}</span><span class="lv">${x.lv}</span><span class="notr">${esc(x.m)}</span></div>`).join('')}</div></div>`; const lg = $('#obs-l')!; lg.scrollTop = lg.scrollHeight;
  clearInterval(OBST!); OBST = setInterval(() => { const tt = tabOf(cur) as unknown as (ObserveTab & { kind?: string }) | null; if (!tt || tt.kind !== 'observe') { clearInterval(OBST!); return; } const oo = OBS[tt.env + ':' + tt.name]; obsLine(oo); (['cpu', 'mem', 'rps', 'p95'] as const).forEach(k => { const a = oo[k]; a.push(Math.max(0, a[a.length - 1] + (oo.r() - .5) * (a[0] * .3 + 1))); a.shift(); }); const top = $('#obs-l')!.scrollTop, atEnd = $('#obs-l')!.scrollHeight - top - $('#obs-l')!.clientHeight < 30; show(cur!); if (!atEnd) $('#obs-l')!.scrollTop = top; }, 1500); }

/* ═══════════ tabela de acções (ADR-0002, Fase 4) ═══════════
   Liga o nome de acção (emitido como data-action por renderInfraPane/renderEnvsView/
   renderObserveView) ao efeito, servido pelo listener delegado de ui/actions.ts. Fica
   aqui — no resíduo, fora da subárvore governada por A7/A8 — porque só este ficheiro tem
   à mão o motor e o bridge. O payload viaja SÓ em data-on (o golden strippa data-action/
   data-on; um data-* à medida vazava); os valores interpolados escapam-se com `esc` à
   saída. Como os onclick antigos resolviam window.X ao clicar, os comandos chamam a versão
   window (late-binding): rtConnect/k8sConnect/dxRun/dxStop/dxDeploy/ctlLogs são
   reatribuídos/decorados por bridge.ts (real) e v5/v6. As mutações de estado usam ENVS/
   ENVX (a MESMA referência que window.ENVS/ENVX). */
const ACTIONS: ActionTable = {
  "dx-run": { on: "click", run: () => window.dxRun() },
  "dx-stop": { on: "click", run: () => window.dxStop() },
  "dx-deploy": { on: "click", run: () => window.dxDeploy() },
  "rt-set": { on: "click", run: e => { ENVS.rt = e.on; ENVS.rtOn = false; window.saveEnv(); window.infraDraw(); } },
  "rt-sock": { on: "change", run: e => { ENVS.sock[ENVS.rt] = e.value; ENVS.rtOn = false; window.saveEnv(); window.infraDraw(); } },
  "rt-connect": { on: "click", run: () => window.rtConnect() },
  "open-pdc": { on: "click", run: () => window.openPath(window.P_DC) },
  "dc-detach": { on: "click", run: () => window.dcDetach() },
  "dc-attach": { on: "click", run: () => window.dcAttach() },
  "ctl-logs": { on: "click", run: e => window.ctlLogs(e.on) },
  "kube-conf": { on: "change", run: e => { ENVS.kube = e.value; ENVS.k8sOn = false; window.saveEnv(); window.infraDraw(); } },
  "kube-ctx": { on: "change", run: e => { ENVS.ctx = e.value; window.K8S = null; window.saveEnv(); window.infraDraw(); } },
  "kube-ns": { on: "change", run: e => { ENVS.ns = e.value; window.saveEnv(); } },
  "k8s-connect": { on: "click", run: () => window.k8sConnect() },
  "k8s-scale": { on: "click", run: e => { const [n, d] = e.on.split("|"); window.k8sScale(n, +d); } },
  "k8s-down": { on: "click", run: () => window.k8sDown() },
  "ssh-toast": { on: "click", run: () => window.toast("SSH sessions need the desktop app") },
  "ssh-del": { on: "click", run: e => { ENVS.ssh.splice(+e.on, 1); window.saveEnv(); window.infraDraw(); } },
  "ssh-add": { on: "change", run: e => { if (e.value.trim()) { ENVS.ssh.push(e.value.trim()); window.saveEnv(); window.infraDraw(); } } },
  "env-chip": { on: "click", run: e => { ENVX.cur = e.on; window.saveEnvx(); window.infraDraw(); } },
  "open-envs": { on: "click", run: () => window.openEnvs() },
  "observe": { on: "click", run: e => { const [env, n] = e.on.split("|"); window.openObserve(env, n); } },
  "promote": { on: "click", run: e => window.promote(e.on) },
  "deploy-envs": { on: "click", run: () => { window.dxDeploy(); window.rerender("envs"); } },
  "redeploy": { on: "click", run: e => window.redeployEnv(e.on) },
  "env-select": { on: "click", run: e => { ENVX.cur = e.on; window.saveEnvx(); window.rerender("envs"); window.infraDraw(); } },
  "toggle-sec": { on: "click", run: () => { window.SHOWSEC = !window.SHOWSEC; window.rerender("envs"); } },
  "sec-edit": { on: "change", run: e => { const [env, a, k] = e.on.split("|"); const S = ENVX.sec![env as keyof SecretSets]; S[a] = S[a] || {}; S[a][k] = e.value; window.saveEnvx(); } },
  "obs-clear": { on: "click", run: e => { window.OBS[e.on].logs = []; window.show(window.cur); } },
};
bindActions(ACTIONS);

/* registo das vistas (ADR-0004, U4g1 — antes eram shims no v6.ts; o bridge.ts decora
   depois o VIEW.observe, e continua a decorar esta versão) */
RP.infra = renderInfraPane;
VIEW.envs = renderEnvsView;
/* ADR-0004, U4h4: o VIEW.observe, o rtConnect/k8sConnect e o dxDeploy PUBLICADOS consultam a porta
   desktop (`desktopPorts.infra`, injectada por platform/desktop/infra.ts: socket/cluster/deploy e
   logs reais); antes o desktop reatribuía-os no `window`. */
VIEW.observe = (t, host) => { const d = desktopPorts.infra; if (d) d.observe(t as unknown as ObserveTab, host, renderObserveView); else renderObserveView(t as unknown as ObserveTab, host); };

/* ── o que vivia nas camadas v5/v6 (ADR-0004, U4g2) ──
   Corria ao carregar o v5.ts/v6.ts; agora corre aqui, que avalia antes — e nada entre os
   dois lia estes nomes por valor no eval (só chamadas tardias), por isso o que se vê em
   runtime é o mesmo (o bridge.ts continua a decorar por cima). Publica-se já composto:
   • dxDeploy: depois de um deploy, fixa a versão no cluster e prepara os secrets (v6).
   As chamadas internas do motor continuam a usar a versão base, como antes. (O override
   do ctlLogs — abrir o tab de observabilidade — foi dobrado no próprio motor.) */
const rtConnectPublished = () => { const d = desktopPorts.infra; return d ? d.rtConnect(rtConnect) : rtConnect(); };
const k8sConnectPublished = () => { const d = desktopPorts.infra; return d ? d.k8sConnect(k8sConnect) : k8sConnect(); };
const dxDeployPublished = () => { const d = desktopPorts.infra; return d ? d.dxDeploy(dxDeployPrimed) : dxDeployPrimed(); };
function dxDeployPrimed() { const r = dxDeploy(); const K8S = window.K8S; if (r && r.ok && K8S) { K8S.ver = window.GIT.refs.develop; K8S.at = Date.now(); initSecrets(); } return r; }

/* ── publicação transitória no window (shim para o residual) ──
   O render e os dois motores ficam no window; v5.ts/v6.ts e os onclick inline resolvem
   estes nomes como globais. (As decorações de v6 — dxDeploy/drawStudio — já não lêem
   initSecrets/driftReport/DSTY por global: importam-nos por porta tipada; ADR-0002 passo 6.) */
publish({
  rtConnect: rtConnectPublished, k8sConnect: k8sConnectPublished, dxDeploy: dxDeployPublished, needRt, projectContext, devcontainerJson, dcAttach, dcDetach,
  drawRemote, infraDraw, appEnv, k8sInfra, k8sDocs, k8sScale, k8sDown, runTaskQuiet, ctlLogs,
  saveEnv, cli, hydrateEnvs,
  ENVL, ENVX, saveEnvx, designApps, localSecrets, urlHosts, envDeps, envState,
  envHealth, secretCheck, commitsBetween, promote, redeployEnv, openEnvs,
  OBS, obsInit, obsLine, spark, openObserve, seeded, renderInfraPane,
});

/* ── comandos do terminal (ADR-0004, U4g2 — viviam no v5) ──
   Registados no XC de features/terminal.ts, que por isso avalia antes deste módulo:
   `kubectl get deploy|pods`, `devcontainer up` e `dx deploy`. Os subcomandos do `dx` que o
   app.ts acrescenta depois (test/sprint, run/stop) são disjuntos de `deploy`, por isso
   decorar antes deles não muda o resultado de nenhum. */
const XC = window.XC;
/* o terminal emulado não fala com o cluster nem com o runtime (respondia com o estado K8S/DEVC
   simulado — ADR-0006, R5a): o kubectl/devcontainer reais correm no terminal da app desktop */
XC.kubectl = () => { echo('<span class="dim">o terminal emulado não fala com o cluster — o kubectl real corre no terminal da app desktop</span>'); };
XC.devcontainer = () => { echo('<span class="dim">o terminal emulado não arranca contentores — usa «Attach» em Infra na app desktop</span>'); };
const _dx5 = XC.dx;
XC.dx = (a: string[]) => { if (a[0] === 'deploy') return window.dxDeploy(); return _dx5(a); };
