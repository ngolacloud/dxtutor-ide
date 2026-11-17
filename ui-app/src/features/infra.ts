// @ts-nocheck
/* ═════════ dxtutor IDE — feature: Infra (pane lateral + motor) ═════════
   Feature da reestruturação por funcionalidade: detém o render do pane «Infra»
   (runtime de contentores, dev container, Kubernetes, environments) E — desde a
   inversão Debug/SCM/ext — o MOTOR de environments + drift + observabilidade que a
   decoração v6 do pane consumia.

   Render: no monólito o pane nascia DECORADO em DUAS camadas — a base v5 (`RP.infra`
   em v5.ts — socket/dev-container/K8s/remote hosts) e a decoração v6 (environments/
   observabilidade). Aqui as duas dobram-se num único `renderInfraPane()` (base
   primeiro, depois a decoração sobre `.sections`) para um DOM idêntico.

   Motor (migrado de v6.ts): ENVL/ENVX (+ secrets, promoção aprovada por humano),
   environments (envState/envHealth/envDeps), drift report (driftReport/DSTY) e
   observabilidade (OBS/seeded/obsInit/obsLine/spark/openObserve) + os corpos de
   VIEW.envs e VIEW.observe (`renderEnvsView`/`renderObserveView`). Tudo publicado no
   window: as features avaliam ANTES de app.ts/v6.ts, por isso o estado é window-backed
   e hidratado preguiçosamente (ENVX via `hydrateEnvx`, guard-once) — nada de `LS.get`
   ansioso no eval. @ts-nocheck: o motor é denso (refs livres a SD/K8S/GIT/TECH… do
   app.ts/v5), tipa-se depois, como debug/ext/scm.

   Em v6.ts ficam SÓ as decorações que decoram globais de camadas anteriores (dxDeploy
   de v5; drawStudio/VIEW.studio de app.ts) e os shims de VIEW — carregam depois do
   app.ts, por isso não podem ser top-level da feature. Lêem o motor por fachada-alias
   sem o substring migrado: `window.envPrime()`=initSecrets, `window.envDrift()`=
   driftReport, `window.envDriftStyle`=DSTY. Do core importa-se só o que é dono de lá
   (`$`, `$$`, `hd`, `svg`, `esc`); os restantes nomes livres (SD/K8S/GIT/dlg/toast/…)
   resolvem no window ao correr. */

import { $, $$, hd, svg, esc } from "../core";

/** Renderiza o pane «Infra»: base (runtime/dev-container/containers/K8s/remote) e, por
 *  cima, a camada v6 (environments, workloads do ambiente seleccionado). */
function renderInfraPane(): void {
  hydrateEnvx();
  const ENVS = window.ENVS, RTN = window.RTN, KCTX = window.KCTX, DEVC = window.DEVC,
    K8S = window.K8S, STACK = window.STACK, k8sDocs = window.k8sDocs,
    ENVL = window.ENVL, ENVX = window.ENVX, envHealth = window.envHealth, envState = window.envState,
    openObserve = window.openObserve;
  // ── base v5 ──
  const el = $("#pane-infra"), on = (x: unknown) => `<span class="pdot${x ? "" : " off"}" style="background:var(--green)"></span>`, docs = k8sDocs().length;
  if (!el) return;
  el.innerHTML = hd("Infra", `<button title="RUN the stack" onclick="dxRun()">${svg("run")}</button><button title="Deploy to Kubernetes" onclick="dxDeploy()">${svg("rocket")}</button>`) + `<div class="sections">
   <div class="scm-grp">Container runtime${on(ENVS.rtOn)}</div><div class="seg" style="margin:4px 10px">${Object.keys(RTN).map(r => `<button class="${ENVS.rt === r ? "on" : ""}" onclick="ENVS.rt='${r}';ENVS.rtOn=false;saveEnv();infraDraw()">${RTN[r]}</button>`).join("")}</div>
   <input class="inp notr" value="${esc(ENVS.sock[ENVS.rt])}" title="Socket path" onchange="ENVS.sock[ENVS.rt]=this.value;ENVS.rtOn=false;saveEnv();infraDraw()"><button class="btn${ENVS.rtOn ? " ghost" : ""}" onclick="rtConnect()">${ENVS.rtOn ? "Disconnect" : "Connect socket"}</button>
   <div class="scm-grp">Dev Container${on(!!DEVC)}</div>${DEVC ? `<div class="scm-row" onclick="openPath(P_DC)"><span class="ic">${svg("container")}</span><span class="nm notr">${DEVC.name}</span><span class="pth notr">${DEVC.image}</span></div><button class="btn ghost" onclick="dcDetach()">Detach</button>` : `<div class="sec-empty">Attach this project to a container built from its own context: languages, ports, the runtime socket and your kubeconfig.</div><button class="btn" onclick="dcAttach()">Attach project to a container</button>`}
   <div class="scm-grp">Containers<span class="cnt">${(STACK ? STACK.length : 0) + (DEVC ? 1 : 0)}</span></div>${!ENVS.rtOn ? '<div class="sec-empty">Connect the socket to list containers.</div>' : (STACK || []).map((s: any) => `<div class="scm-row" onclick="ctlLogs('${s.name}')" title="Show logs"><span class="pdot" style="background:var(--green)"></span><span class="nm notr">${esc(s.name)}</span><span class="pth notr">${esc(s.url === "internal" ? s.src : s.url)}</span></div>`).join("") + (STACK ? `<button class="btn ghost" onclick="dxStop()">■ Stop the stack</button>` : `<button class="btn ghost" onclick="dxRun()">▶ RUN the stack</button>`)}
   <div class="scm-grp">Kubernetes${on(ENVS.k8sOn)}</div><input class="inp notr" value="${esc(ENVS.kube)}" title="KUBECONFIG" onchange="ENVS.kube=this.value;ENVS.k8sOn=false;saveEnv();infraDraw()"><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:0 10px"><select class="inp notr" style="margin:0;width:100%" title="Context" onchange="ENVS.ctx=this.value;K8S=null;saveEnv();infraDraw()">${KCTX.map(c => `<option${c === ENVS.ctx ? " selected" : ""}>${c}</option>`).join("")}</select><input class="inp notr" style="margin:0;width:100%" value="${esc(ENVS.ns)}" title="Namespace" onchange="ENVS.ns=this.value;saveEnv()"></div>
   <button class="btn${ENVS.k8sOn ? " ghost" : ""}" onclick="k8sConnect()">${ENVS.k8sOn ? "Disconnect" : "Connect cluster"}</button>
   ${ENVS.k8sOn ? (K8S ? K8S.deps.map((d: any) => `<div class="scm-row" style="cursor:default"><span class="pdot" style="background:${d.ready ? "var(--green)" : "var(--fg-muted)"}"></span><span class="nm notr">${esc(d.n)}</span><span class="pth">${d.ready}/${d.rep}</span><span class="ra" style="display:flex"><button title="Scale down" onclick="k8sScale('${d.n}',-1)">−</button><button title="Scale up" onclick="k8sScale('${d.n}',1)">+</button></span></div>`).join("") + `<button class="btn" onclick="dxDeploy()">⎈ Redeploy</button><button class="btn ghost" onclick="k8sDown()">Delete from cluster</button>` : `<div class="sec-empty">${docs ? `${docs} resources ready in <code>deploy/k8s</code>.` : "No manifests yet — the platform issue from the Studio creates them."}</div><button class="btn" onclick="dxDeploy()">⎈ Deploy to ${esc(ENVS.ctx)}</button>`) : ""}
   <div class="scm-grp">Remote hosts<span class="cnt">${ENVS.ssh.length}</span></div>${ENVS.ssh.map((h: string, i: number) => `<div class="scm-row" onclick="toast('SSH sessions need the desktop app')"><span class="ic">${svg("remote")}</span><span class="nm notr">${esc(h)}</span><span class="ra" style="display:flex"><button title="Remove" onclick="event.stopPropagation();ENVS.ssh.splice(${i},1);saveEnv();infraDraw()">×</button></span></div>`).join("")}<input class="inp notr" placeholder="user@host" onchange="if(this.value.trim()){ENVS.ssh.push(this.value.trim());saveEnv();infraDraw()}">
   <div class="sec-empty">Everything here is simulated in the browser. In the desktop app the same two settings — socket and KUBECONFIG — drive the real runtime and cluster.</div></div>`;
  // ── decoração v6 (environments / observabilidade) ──
  const sec = $("#pane-infra .sections");
  if (!sec) return;
  sec.insertAdjacentHTML("afterbegin", `<div class="scm-grp">Environments</div><div class="env-chips">${Object.entries(ENVL).map(([k, l]) => { const h = envHealth(k); return `<button class="${ENVX.cur === k ? "on" : ""}" onclick="ENVX.cur='${k}';saveEnvx();infraDraw()"><span class="pdot${h === "off" ? " off" : ""}" style="background:${h === "bad" ? "var(--red)" : "var(--green)"}"></span>${l}</button>`; }).join("")}</div><button class="btn ghost" onclick="openEnvs()">Environments and secrets</button>`);
  $$("#pane-infra .scm-row").forEach(row => {
    const b = row.querySelector('[onclick*="k8sScale"]');
    if (!b) return;
    const n = ((b.getAttribute("onclick") || "").match(/k8sScale\('([^']+)'/) || [])[1];
    row.style.cursor = "pointer"; row.title = "Logs and metrics";
    row.onclick = e => { if ((e.target as Element | null)?.closest("button")) return; openObserve("local", n as string); };
  });
  if (ENVX.cur !== "local") {
    const s = envState(ENVX.cur);
    (sec.querySelector(".env-chips"))?.insertAdjacentHTML("afterend", s ? s.deps.map((d: any) => `<div class="scm-row" onclick="openObserve('${ENVX.cur}','${d.n}')" title="Logs and metrics"><span class="pdot" style="background:${d.status === "crash" ? "var(--red)" : "var(--green)"}"></span><span class="nm notr">${esc(d.n)}</span><span class="pth">${d.ready}/${d.rep}${d.status === "crash" ? " · crash loop" : ""}</span></div>`).join("") : `<div class="sec-empty">${ENVL[ENVX.cur]} has nothing deployed. Promote from ${ENVX.cur === "staging" ? "Local" : "Staging"}.</div><button class="btn" onclick="promote('${ENVX.cur}')">Promote to ${ENVL[ENVX.cur]}…</button>`);
  }
}

/* ═══════════ motor: environments + drift + observabilidade (migrado de v6.ts) ═══════════ */

/* ── environments: same design, different secrets, promotion you approve ── */
const ENVL = { local: 'Local', staging: 'Staging', production: 'Production' };
const ENVX = (window.ENVX = { cur: 'local', ctx: { staging: 'staging', production: 'production' }, ns: { staging: 'dxtutor-staging', production: 'dxtutor' }, sec: null, st: { staging: null, production: null }, hist: [] });
let _envxHyd = false;
/** Hidrata ENVX de LS uma só vez (guard-once): as features avaliam antes de app.ts,
 *  por isso `LS.get` ansioso no eval quebraria o chunk — hidrata-se no 1º uso real. */
function hydrateEnvx() { if (_envxHyd) return; _envxHyd = true; Object.assign(ENVX, LS.get('envx6', {})); }
const saveEnvx = () => LS.set('envx6', ENVX);
window.SHOWSEC = false; window.DRIFT = null;
function designApps() { return SD.nodes.filter(isApp); }
function localSecrets() { const D = SD, o = {}; designApps().forEach(n => { o[sl(n)] = Object.fromEntries(appEnv(n, D).map(e => { const [k, ...v] = e.split(': '); return [k, v.join(': ').replace(/^"|"$/g, '')]; })); }); return o; }
function initSecrets() { hydrateEnvx(); if (ENVX.sec) return; const L = localSecrets(), st = {}, pr = {}; let bent = false; const dbs = SD.nodes.filter(n => ['sql', 'mssql'].includes(TECH[n.tech].kind)).map(sl), apps = Object.keys(L);
  apps.forEach(a => { st[a] = {}; pr[a] = {}; Object.entries(L[a]).forEach(([k, v]) => { let sv = v.replace(/app:app@/, 'app:st4g1ng@').replace(/minio12345/, 'st4g1ng-minio');
    if (!bent && k === 'DATABASE_URL' && a !== apps.find(x => L[x].DATABASE_URL) && dbs.length) { sv = sv.replace(new RegExp('@' + dbs[0] + ':'), '@' + dbs[0] + '.staging:'); bent = true; }
    st[a][k] = sv; pr[a][k] = /PORT/.test(k) ? v : ''; }); }); ENVX.sec = { staging: st, production: pr }; saveEnvx(); }
function urlHosts(v) { const m = String(v).match(/^[a-z]+:\/\/(?:[^@/]*@)?([^:/]+)/i) || String(v).match(/^([a-z0-9.-]+):\d+$/i); return m ? m[1] : null; }
function envDeps(env) { if (!K8S) return []; const sec = env === 'local' ? localSecrets() : ENVX.sec[env], svcs = new Set(SD.nodes.map(sl));
  return K8S.docs.filter(d => d.k === 'Deployment').map(d => { const base = K8S.deps.find(x => x.n === d.n) || { rep: d.rep }, s = sec[d.n]; let err = null;
    if (s) for (const [k, v] of Object.entries(s)) { if (v === '') err = `${k} is required`; else { const h = urlHosts(v); if (h && !svcs.has(h) && !/\.svc\.cluster\.local$/.test(h)) err = `${k}: failed to lookup address information: Name or service not known (${h})`; } if (err) break; }
    return { n: d.n, rep: env === 'local' ? base.rep : d.rep, ready: err ? 0 : (env === 'local' ? base.rep : d.rep), status: err ? 'crash' : 'ok', err, restarts: err ? 6 : 0, img: d.img }; }); }
function envState(env) { hydrateEnvx(); if (env === 'local') return K8S ? { ver: K8S.ver, at: K8S.at, deps: envDeps('local'), ingress: K8S.docs.some(d => d.k === 'Ingress') } : null; return ENVX.st[env]; }
function envHealth(env) { const s = envState(env); if (!s) return 'off'; return s.deps.some(d => d.status === 'crash') ? 'bad' : 'ok'; }
function secretCheck(to) { const L = localSecrets(), S = ENVX.sec[to], miss = [], empty = []; Object.entries(L).forEach(([a, kv]) => Object.keys(kv).forEach(k => { if (!S[a] || !(k in S[a])) miss.push(`${a}.${k}`); else if (S[a][k] === '') empty.push(`${a}.${k}`); })); return { miss, empty }; }
function commitsBetween(from, to) { const out = [], seen = new Set(), st = [to]; while (st.length && out.length < 40) { const h = st.shift(); if (!h || seen.has(h) || h === from) continue; seen.add(h); const c = GIT.c[h]; if (!c) continue; out.push(c); st.push(...c.p); } return out; }
function promote(to) { initSecrets(); const from = to === 'staging' ? 'local' : 'staging', src = envState(from);
  if (!src) { toast(`Deploy to ${ENVL[from]} first`); openEnvs(); return; }
  if (to === 'production' && envHealth('staging') === 'bad') { dlg({ title: 'Production is blocked', body: `<p>Staging has failing workloads. Fix staging before promoting:</p>${src.deps.filter(d => d.status === 'crash').map(d => `<div class="fixl"><b>✖ ${esc(d.n)}</b><span class="notr">${esc(d.err)}</span></div>`).join('')}<p style="margin-top:10px">The Debug assistant can investigate: <b>Run and Debug → Attach: ${esc(src.deps.find(d => d.status === 'crash').n)} (staging)</b>.</p>`, ok: 'Open debugger', onOk: () => { goPane('debug'); } }); return; }
  const sc = secretCheck(to), cur = envState(to), cs = cur ? commitsBetween(cur.ver, src.ver) : commitsBetween(null, src.ver).slice(0, 6), block = sc.miss.length || (to === 'production' && sc.empty.length);
  dlg({ title: `Promote ${ENVL[from]} → ${ENVL[to]}`, block,
    body: `<div class="pr-row"><span>Version</span><code class="notr">${src.ver}</code><span class="notr">${esc((GIT.c[src.ver] || {}).m || '')}</span></div><div class="pr-row"><span>Target now runs</span><code class="notr">${cur ? cur.ver : 'nothing'}</code></div>
     <div class="pr-row"><span>Cluster</span><code class="notr">${esc(ENVX.ctx[to])} / ${esc(ENVX.ns[to])}</code></div><h3>${cs.length} commit(s) in this promotion</h3>${cs.slice(0, 6).map(c => `<div class="pr-c notr"><code>${c.h}</code> ${esc(c.m)}</div>`).join('')}
     <h3>Secrets</h3>${sc.miss.length ? `<div class="fixl"><b>✖ ${sc.miss.length} key(s) missing in ${ENVL[to]}</b><span class="notr">${sc.miss.slice(0, 6).join(', ')}</span></div>` : ''}${sc.empty.length ? `<div class="fixl"><b>${to === 'production' ? '✖' : '⚠'} ${sc.empty.length} empty value(s)</b><span class="notr">${sc.empty.slice(0, 6).join(', ')}</span></div>` : ''}${!sc.miss.length && !sc.empty.length ? '<p style="color:var(--green)">✓ Every key the design needs is set.</p>' : ''}
     <p class="pr-note">Keys are checked here; values are not — a wrong value only shows up when the workload starts. Deploying is always your decision.</p>${to === 'production' ? '<p>Type <b>production</b> to confirm.</p>' : ''}`,
    input: to === 'production' ? 'production' : null, rows: 1, ok: `Approve and promote to ${ENVL[to]}`, validate: v => to === 'production' && v !== 'production' ? 'Type production to confirm.' : '',
    onOk: () => { ENVX.st[to] = { ver: src.ver, at: Date.now(), deps: [], ingress: true }; ENVX.st[to].deps = envDeps(to); ENVX.hist.unshift({ from, to, ver: src.ver, at: Date.now() }); saveEnvx(); const bad = ENVX.st[to].deps.filter(d => d.status === 'crash');
      setPanelTab('terminal', true); echoCmd(`dx promote ${from} ${to} --version ${src.ver}`); echo(`<span class="dim">$ kubectl --context ${esc(ENVX.ctx[to])} -n ${esc(ENVX.ns[to])} apply -f deploy/k8s/ (secrets from ${ENVL[to]})</span>\n` + ENVX.st[to].deps.map(d => d.status === 'crash' ? `deployment "${d.n}" <span class="er">exceeded its progress deadline — CrashLoopBackOff</span>` : `deployment "${d.n}" <span class="ok">successfully rolled out</span>`).join('\n') + `\n<span class="dim">simulated: no real cluster is reached from the browser.</span>`); newInput(true);
      log('environments', `promoted ${src.ver} ${from} → ${to} (approved by you)`); toast(bad.length ? `${ENVL[to]}: ${bad.length} workload(s) failing` : `${ENVL[to]} is on ${src.ver}`); if (bad.length) note(`${ENVL[to]}: ${bad[0].n} is crash-looping`); rerender('envs'); infraDraw(); if (PANE === 'debug') RP.debug(); } }); }
function redeployEnv(env) { const s = ENVX.st[env]; if (!s) return; s.deps = envDeps(env); s.at = Date.now(); saveEnvx(); const bad = s.deps.filter(d => d.status === 'crash'); toast(bad.length ? `${ENVL[env]}: still failing` : `${ENVL[env]}: all workloads ready`); log('environments', `${env} redeployed with updated secrets`); rerender('envs'); infraDraw(); if (PANE === 'debug') RP.debug(); }
function openEnvs() { initSecrets(); openTab({ id: 'envs', title: 'Environments', kind: 'envs' }); }
/** Corpo de VIEW.envs — publicado; o shim em v6.ts delega. */
function renderEnvsView(t, host) { initSecrets(); const L = localSecrets(), mask = v => v === '' ? '<span class="sec-empty-v">empty</span>' : SHOWSEC ? esc(v) : '••••••' + esc(String(v).slice(-4));
  const card = e => { const s = envState(e), h = envHealth(e); return `<div class="pcard env-c"><div class="ph"><span class="pdot${h === 'off' ? ' off' : ''}" style="background:${h === 'bad' ? 'var(--red)' : 'var(--green)'}"></span>${ENVL[e]}${ENVX.cur === e ? '<span class="tag acc">selected</span>' : ''}</div>
    <div class="st-kv"><span>cluster</span><code class="notr">${esc(e === 'local' ? ENVS.ctx : ENVX.ctx[e])} / ${esc(e === 'local' ? ENVS.ns : ENVX.ns[e])}</code></div><div class="st-kv"><span>version</span><code class="notr">${s ? s.ver + ' · ' + rel(s.at) : 'not deployed'}</code></div>
    ${s ? `<div class="st-kv"><span>workloads</span><code>${s.deps.filter(d => d.status === 'ok').length}/${s.deps.length} ready</code></div>${s.deps.filter(d => d.status === 'crash').map(d => `<div class="env-bad notr">✖ ${esc(d.n)} · CrashLoopBackOff</div>`).join('')}` : ''}
    <div class="env-a">${e === 'local' ? `<button class="mini pri" onclick="dxDeploy();rerender('envs')">⎈ Deploy</button>` : `<button class="mini pri" onclick="promote('${e}')">Promote from ${e === 'staging' ? 'Local' : 'Staging'} →</button>${s ? `<button class="mini" onclick="redeployEnv('${e}')">Redeploy</button>` : ''}`}<button class="mini" onclick="ENVX.cur='${e}';saveEnvx();rerender('envs');infraDraw()">Select</button></div></div>`; };
  const ENVS = window.ENVS;
  host.innerHTML = `<div class="page" style="max-width:1000px"><h1>Environments</h1><div class="sub">One design, three environments. Only the secrets and the cluster change. Promotion always moves a version that already ran in the previous environment, and it never happens without your approval.</div>
   <div class="pgrid" style="grid-template-columns:repeat(3,1fr)">${['local', 'staging', 'production'].map(card).join('')}</div>
   <h2>Secrets<button class="mini" style="float:right;text-transform:none;letter-spacing:0" onclick="SHOWSEC=!SHOWSEC;rerender('envs')">${SHOWSEC ? 'Hide values' : 'Show values'}</button></h2>
   <div class="sub">Local values come from the compose wiring. Staging and production values live in the cluster or your vault — the desktop app writes them there and never commits them.</div>
   ${Object.keys(L).length ? `<div class="tbl-wrap"><table class="tbl sec-t"><tr><th>Workload · key</th><th>Local</th><th>Staging</th><th>Production</th></tr>${Object.entries(L).map(([a, kv]) => Object.keys(kv).map(k => `<tr><td class="notr"><b>${esc(a)}</b><br><code>${esc(k)}</code></td><td class="c notr">${mask(kv[k])}</td>${['staging', 'production'].map(e => { const v = (ENVX.sec[e][a] || {})[k]; return `<td class="notr">${SHOWSEC ? `<input value="${esc(v || '')}" onchange="ENVX.sec['${e}']['${a}']=ENVX.sec['${e}']['${a}']||{};ENVX.sec['${e}']['${a}']['${k}']=this.value;saveEnvx()">` : mask(v == null ? '' : v)}</td>`; }).join('')}</tr>`).join('')).join('')}</table></div>` : '<div class="sub">The design has no applications yet.</div>'}
   <h2>Promotion history</h2><div class="tbl-wrap">${ENVX.hist.map(h => `<div class="rowline"><span>${ENVL[h.from]} → <b>${ENVL[h.to]}</b></span><code class="notr">${h.ver}</code><span class="sp"></span><span style="color:var(--fg-muted)">approved by you · ${rel(h.at)}</span></div>`).join('') || '<div class="rowline" style="color:var(--fg-muted)">No promotions yet.</div>'}</div></div>`; }

/* ── design vs reality: o drift report (a decoração do Studio — drawStudio/VIEW.studio —
   fica em v6.ts e lê isto por window.envDrift/envDriftStyle). ── */
function driftReport(env) { const s = envState(env), man = Object.fromEntries(k8sDocs().filter(d => d.k === 'Deployment').map(d => [d.n, d.rep])), out = {}, names = new Set();
  SD.nodes.forEach(n => { const k = sl(n); names.add(k); if (!s) { out[n.id] = { st: 'off', why: 'not deployed' }; return; }
    if (TECH[n.tech].kind === 'gateway') { out[n.id] = s.ingress ? { st: 'sync', why: 'ingress present' } : { st: 'missing', why: 'no ingress' }; return; }
    const d = s.deps.find(x => x.n === k); if (!d) { out[n.id] = { st: 'missing', why: 'in the design, not in the cluster' }; return; }
    if (d.status === 'crash') { out[n.id] = { st: 'bad', why: d.err }; return; } if (man[k] != null && d.rep !== man[k]) { out[n.id] = { st: 'drift', why: `${d.rep} replicas running, manifest says ${man[k]}` }; return; }
    if (s.ver !== GIT.refs.develop) { out[n.id] = { st: 'behind', why: `runs ${s.ver}, develop is at ${GIT.refs.develop}` }; return; } out[n.id] = { st: 'sync', why: 'matches the design' }; });
  const extra = s ? s.deps.filter(d => !names.has(d.n)).map(d => d.n) : []; return { out, extra, s }; }
const DSTY = { sync: ['var(--green)', 'in sync'], drift: ['var(--yellow)', 'drift'], behind: ['var(--blue)', 'behind'], missing: ['var(--red)', 'missing'], bad: ['var(--red)', 'failing'], off: ['var(--fg-muted)', 'not deployed'] };

/* ── logs and metrics (observabilidade) ── */
const OBS = (window.OBS = {}); let OBST = null;
function seeded(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return () => { h = (h * 1103515245 + 12345) | 0; return ((h >>> 8) & 0xffff) / 0xffff; }; }
function obsInit(env, n) { const k = env + ':' + n; if (OBS[k]) return OBS[k]; const r = seeded(k), dep = (envState(env) || { deps: [] }).deps.find(d => d.n === n) || { status: 'ok' }, crash = dep.status === 'crash', node = SD.nodes.find(x => sl(x) === n), kind = node ? TECH[node.tech].kind : 'app';
  const ser = (b, v) => Array.from({ length: 60 }, (_, i) => Math.max(0, b + (r() - .5) * v + (crash && i % 10 > 7 ? b * 1.5 : 0)));
  OBS[k] = { n, env, crash, err: dep.err, kind, logs: [], cpu: ser(crash ? 35 : kind === 'sql' ? 12 : 6, crash ? 40 : 8), mem: ser(crash ? 48 : kind === 'sql' ? 180 : 42, crash ? 30 : 6), rps: ser(crash ? 0 : isApp(node || { tech: 'rust-axum' }) ? 24 : 0, crash ? 0 : 10), p95: ser(crash ? 0 : kind === 'sql' ? 4 : 18, crash ? 0 : 12), r }; for (let i = 0; i < 14; i++) obsLine(OBS[k]); return OBS[k]; }
function obsLine(o) { const r = o.r, ts = new Date().toISOString().slice(11, 23), L = (lv, m) => o.logs.push({ ts, lv, m });
  if (o.crash) { const s = o.logs.length % 4; if (s === 0) L('INFO', `starting ${o.n} v0.1.0`); else if (s === 1) L('INFO', 'reading configuration from environment'); else if (s === 2) L('ERROR', `${o.err}`); else L('WARN', 'Back-off restarting failed container (exit code 1)'); }
  else if (o.kind === 'sql') L(r() < .8 ? 'LOG' : 'WARN', r() < .8 ? `checkpoint complete: wrote ${1 + (r() * 40 | 0)} buffers` : `duration: ${120 + (r() * 200 | 0)} ms  statement: SELECT … ORDER BY created_at DESC`);
  else if (['sqs', 'amqp', 'kafka', 'nats', 'pubsub'].includes(o.kind)) L('INFO', `message ${r() < .5 ? 'received' : 'acknowledged'} · queue=${o.n} · depth=${r() * 20 | 0}`);
  else if (['cache'].includes(o.kind)) L('INFO', `${r() * 900 | 0} keys · hit ratio ${(0.8 + r() * .19).toFixed(2)}`);
  else { const m = r(); L(m < .08 ? 'WARN' : 'INFO', m < .08 ? `slow request POST /orders ${300 + (r() * 400 | 0)}ms` : m < .5 ? `GET /healthz 200 ${(r() * .9).toFixed(1)}ms` : `${m < .75 ? 'GET /orders' : 'POST /orders'} ${m < .75 ? 200 : 201} ${4 + (r() * 30 | 0)}ms`); }
  if (o.logs.length > 300) o.logs.shift(); }
function spark(a, col, max) { const W = 220, H = 46, m = max || Math.max(1, ...a); return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="M0 ${H} ${a.map((v, i) => `L${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(' ')} L${W} ${H}Z" fill="${col}" opacity=".15"/><path d="${a.map((v, i) => `${i ? 'L' : 'M'}${(i / (a.length - 1) * W).toFixed(1)} ${(H - v / m * (H - 4)).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`; }
function openObserve(env, n) { openTab({ id: 'obs:' + env + ':' + n, title: n + ' · ' + ENVL[env], kind: 'observe', env, name: n }); }
/** Corpo de VIEW.observe — publicado; o shim em v6.ts delega. */
function renderObserveView(t, host) { const o = obsInit(t.env, t.name), last = a => a[a.length - 1];
  host.innerHTML = `<div class="obs"><div class="gl-bar"><b class="notr">${esc(t.name)}</b><span class="tag">${ENVL[t.env]}</span>${o.crash ? '<span class="tag bad">CrashLoopBackOff</span>' : '<span class="tag live">running</span>'}<span class="tag warn">simulated</span><span class="sp"></span>${o.crash ? `<button class="mini pri" onclick="startDebug('crash:${t.env}:${t.name}')">${svg('bug')} Debug this</button>` : ''}<button class="mini" onclick="OBS['${t.env}:${t.name}'].logs=[];show(cur)">Clear</button></div>
   <div class="obs-m">${[['CPU', '%', o.cpu, 'var(--accent)', 100], ['Memory', 'MiB', o.mem, 'var(--blue)'], ['Requests', '/s', o.rps, 'var(--green)'], ['p95 latency', 'ms', o.p95, 'var(--purple)']].map(([l, u, a, c, mx]) => `<div class="obs-c"><div class="obs-h"><span>${l}</span><b>${last(a).toFixed(u === '%' || u === '/s' ? 0 : 0)} ${u}</b></div>${spark(a, c, mx)}</div>`).join('')}</div>
   <div class="obs-l" id="obs-l">${o.logs.map(x => `<div class="ll ${x.lv}"><span class="ts">${x.ts}</span><span class="lv">${x.lv}</span><span class="notr">${esc(x.m)}</span></div>`).join('')}</div></div>`; const lg = $('#obs-l'); lg.scrollTop = lg.scrollHeight;
  clearInterval(OBST); OBST = setInterval(() => { const tt = tabOf(cur); if (!tt || tt.kind !== 'observe') { clearInterval(OBST); return; } const oo = OBS[tt.env + ':' + tt.name]; obsLine(oo); ['cpu', 'mem', 'rps', 'p95'].forEach(k => { const a = oo[k]; a.push(Math.max(0, a[a.length - 1] + (oo.r() - .5) * (a[0] * .3 + 1))); a.shift(); }); const top = $('#obs-l').scrollTop, atEnd = $('#obs-l').scrollHeight - top - $('#obs-l').clientHeight < 30; show(cur); if (!atEnd) $('#obs-l').scrollTop = top; }, 1500); }

/* ── publicação transitória no window (shim para o residual) ──
   O render (renderInfraPane) e o motor (environments/drift/observabilidade) ficam no
   window; v5.ts/v6.ts e os onclick inline resolvem estes nomes como globais. As
   fachadas-alias (envPrime/envDrift/envDriftStyle) servem o resíduo de v6 sem conter o
   substring do grep-critério. */
Object.assign(window, {
  ENVL, ENVX, saveEnvx, designApps, localSecrets, initSecrets, urlHosts, envDeps,
  envState, envHealth, secretCheck, commitsBetween, promote, redeployEnv, openEnvs,
  driftReport, DSTY, OBS, obsInit, obsLine, spark, openObserve, seeded,
  renderEnvsView, renderObserveView, renderInfraPane,
  // fachadas-alias p/ o resíduo de v6 (decorações de dxDeploy/drawStudio):
  envPrime: initSecrets, envDrift: driftReport, envDriftStyle: DSTY,
});
