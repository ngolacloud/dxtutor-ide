// @ts-nocheck
/* ═════════ dxtutor IDE — feature: Run and Debug (motor + pane lateral) ═════════
   Feature da reestruturação POR FUNCIONALIDADE. Ao contrário das features-folha
   (que só detêm o render de um pane), esta feature é DONA de TODA a sua lógica: o
   motor de depuração simulado (sessão `DBG`, lançadores `debugConfigs`, breakpoints
   `BPS`, os traços `lexTrace`/`crashTrace` e os controlos `dbg*`) MAIS o render do
   pane «Run and Debug» (`renderDebugPane`). Migrado da camada transitória `v6.ts`.

   Inversão de direcção (face à fase anterior): o motor era dono de `v6.ts` e a feature
   só renderizava; agora a feature é dona e o resíduo do monólito (`v6.ts`: paintEd,
   explainCmd, keydown, badges) lê o estado por fachadas window SEM os substrings
   `DBG`/`BPS`/`debugConfigs` — `window.dbgState()` (sessão), `window.dbgBreaks` (Set) e
   `window.dbgLaunch()` (lançadores). As fachadas sincronizam com o módulo por
   window-backing (`DBG=window.DBG={…}`), pois os `onclick="…DBG.…"` inline resolvem
   `DBG` no escopo global (window) ao clicar.

   Do core importa-se o que já lá é tipado (`$`, `hd`, `svg`, `esc`). O restante núcleo
   dono do monólito/camadas é resolvido por nome livre via window em runtime — as
   funções só correm DEPOIS do arranque (cliques, keydown, boot6): FS, P_LX, cur, PANE,
   tabOf, goPane, getVar/setVar, togglePanel, setPanelTab, RP, openPath, paintEd, log,
   hhmm, toast, dlg, isHuman, checkpoint, writeFile, lexVariant, LXL, lexBug, envState,
   localSecrets, ENVX, ENVL, urlHosts, LS.

   Ordem/eval: carrega ANTES de app.ts/v5/v6 — por isso NADA de leituras globais
   ansiosas no eval do módulo (ex.: `LS` só existe depois de app.ts). O estado `BPS`
   nasce como Set vazio e hidrata-se de `LS` preguiçosamente (`hydrateBps`, guard-once)
   na primeira entrada (boot6 chama `drawDbg()` antes de `show(cur)`→paintEd).

   @ts-nocheck: o interior denso do motor (sessões/traços com objectos polimórficos)
   fica por tipar numa passagem futura dedicada; aqui o foco é a EXTRACÇÃO para a
   feature-dona. */
import { $, hd, svg, esc } from "../core";

/* ───── estado (window-backed; o resíduo lê por fachadas sem substring proibido) ───── */
let DBG = (window.DBG = window.DBG ?? null);
const BPS = (window.BPS = window.BPS instanceof Set ? window.BPS : new Set());
let _bpsHydrated = false;
/** Restaura os breakpoints persistidos de `LS` uma única vez. Preguiçoso porque este
 *  módulo avalia antes de app.ts definir `LS`; chamado nas entradas (drawDbg/startDebug
 *  /toggleBp/renderDebugPane), garantindo o Set populado antes do primeiro paintEd. */
function hydrateBps(){if(_bpsHydrated)return;_bpsHydrated=true;try{(LS.get('bps6',[])||[]).forEach(b=>BPS.add(b));}catch(e){}}
const saveBps=()=>LS.set('bps6',[...BPS]);

/* ───── traços simulados (lexer code-step e ops crash-attach) ───── */
function lexTrace(v){const Lt=LXL(/let mut tokens/),Lc=LXL(/let mut chars/),Ll=LXL(/for c in|while let Some\(c\)/),Li=LXL(/is_ascii_digit/),Lp=LXL(/Token::Num\(c\)/),Lk=LXL(/chars\.peek\(\)/),Le=LXL(/Token::Eof\)/),Lr=LXL(/^\s*tokens\s*$/);
  const H=(eof,dig,test)=>({eof,dig,test}),S=[],toks=[],ok=v!=='clone',stack=l=>[`lexer::tokenize · lib.rs:${l}`,'lexer::tests::tokenize_emits_eof · lib.rs (test)','test::run_test · std'],vec=()=>`[${toks.join(', ')}] · len ${toks.length}, cap ${toks.length?4:0}`;
  let orig="next '1'",copy=null;const V=x=>Object.assign({'src: &str':'"12"','tokens: Vec<Token>':vec(),'chars: Peekable<Chars>':`{ ${orig}, peeked: None }`},copy?{'(loop copy) Chars':`{ ${copy} }`}:{},x||{});
  S.push({l:Lt,focus:'what decides whether Eof is pushed',v:V(),h:H(40,35,25),n:`Entered <code>tokenize("12")</code> from the test <code>tokenize_emits_eof</code>, which expects the last token to be <code>Eof</code>. Three ways this fails: Eof never gets pushed, the digits are tokenized wrong, or the test expects the wrong thing. The only thing that decides Eof is whether <code>chars</code> is exhausted at line ${Lk} — so <code>chars</code> is what I am watching.`});
  S.push({l:Lc,focus:'the iterator',v:V(),h:H(40,35,25),n:`<code>tokens</code> is empty and has not allocated yet. <code>chars</code> becomes a <code>Peekable</code> over <code>"12"</code>; its cursor sits before <code>'1'</code>.`});
  S.push({l:Ll,focus:'how the loop consumes chars',v:(copy=v==='clone'?"next '1'":null,V()),h:v==='clone'?H(58,27,15):H(36,40,24),n:v==='clone'?`The loop iterates over <code>chars.clone()</code>: a <b>copy</b> of the iterator. Everything the loop consumes comes out of the copy — the original <code>chars</code> will not move. That is the first thing I would flag; I will confirm it at line ${Lk}.`:v==='byref'?`<code>chars.by_ref()</code> lends the iterator to the loop: the loop advances the original <code>chars</code>, and still gives it back afterwards. When the loop ends, <code>chars</code> should be exhausted.`:`<code>while let Some(c) = chars.next()</code> pulls from the original iterator one character at a time — same effect as <code>by_ref()</code>, more verbose.`});
  ['1','2'].forEach((ch,i)=>{if(v==='clone')copy=i?"next None":"next '2'";else orig=i?'next None':"next '2'";
    S.push({l:Li,focus:'tokenizing digits',v:V({'c: char':`'${ch}'`}),h:i?H(v==='clone'?66:30,8,v==='clone'?26:62):H(v==='clone'?62:34,22,v==='clone'?16:44),n:i?`Second character <code>'2'</code>. ${v==='clone'?`Note the variables: the <b>copy</b> is advancing, the original <code>chars</code> still says <code>next '1'</code>.`:'The original iterator advanced with the loop, as expected.'}`:`<code>c = '1'</code> is an ASCII digit, so it will be pushed.`});
    toks.push(`Num('${ch}')`);S.push({l:Lp,focus:'tokenizing digits',v:V({'c: char':`'${ch}'`}),h:i?H(v==='clone'?70:24,4,v==='clone'?26:72):H(v==='clone'?64:32,16,v==='clone'?20:52),n:i?`Both digits are in <code>tokens</code> — the digit handling is fine, so I am dropping that hypothesis.`:`<code>tokens</code> allocated on the first push: capacity 4 (Rust's minimum for small elements). <code>Token</code> is 4 bytes thanks to the niche in <code>char</code>.`});});
  if(v==='clone')copy=null;
  S.push({l:Lk,focus:'the Eof condition',v:V({'chars.peek()':ok?'None':"Some('1')"}),h:ok?H(3,2,6):H(94,2,4),n:ok?`<code>chars.peek()</code> is <code>None</code>: the original iterator is exhausted, so the condition is true and <code>Eof</code> will be pushed. Nothing suspicious on this path.`:`Here it is. <code>chars.peek()</code> returns <code>Some('1')</code>: the original iterator was <b>never advanced</b>, because the loop consumed the copy. The condition is false, so <code>Eof</code> is skipped. This explains the test failure completely; the other two hypotheses are ruled out by what we saw.`,ev:true});
  if(ok){toks.push('Eof');S.push({l:Le,focus:'the Eof condition',v:V({'chars.peek()':'None'}),h:H(2,2,4),n:'<code>Eof</code> pushed.'});}
  S.push({l:Lr,focus:'the result',v:V(),h:ok?H(2,2,3):H(97,1,2),n:ok?`Returns <code>[Num('1'), Num('2'), Eof]</code>. The test's assertion holds.`:`Returns <code>[Num('1'), Num('2')]</code> — no <code>Eof</code>. The test will fail with <code>left: Some(Num('2')), right: Some(Eof)</code>.`});
  return{steps:S,end:ok?{ok:true,t:'No defect on this path',b:`The test passes. ${v==='byref'?'<code>by_ref()</code>':'<code>while let</code>'} keeps the loop on the original iterator, which is what the Eof check relies on.`}:{ok:false,t:'Root cause found',b:`The compiler's suggestion fixed the <b>compile</b> error but changed the <b>behaviour</b>: cloning a <code>Peekable</code> gives the loop its own cursor, so the original never reaches the end and <code>peek()</code> keeps seeing <code>'1'</code>.<br><br><b>Fix:</b> lend the iterator instead of copying it — <code>for c in chars.by_ref()</code>. It compiles for the same reason the clone did (the loop no longer takes ownership), and it keeps a single cursor.<br><br><b>Lesson:</b> when <code>rustc</code> says “consider cloning”, ask whether you need a second value or just a second <i>use</i> of the same one. For iterators it is almost always the second.`,fix:o=>o.replace('for c in chars.clone() {','for c in chars.by_ref() {')}};}
function crashTrace(env,n){const st=envState(env),bad=st.deps.find(d=>d.n===n)||{},L=localSecrets(),S=ENVX.sec[env],key=Object.keys(S[n]||{}).find(k=>(S[n][k]||'')!==(L[n]||{})[k]&&/URL|HOST|ENDPOINT/.test(k))||Object.keys(S[n]||{})[0],badV=(S[n]||{})[key]||'',goodV=(L[n]||{})[key]||'',h=urlHosts(badV),gh=urlHosts(goodV),peer=st.deps.find(d=>d.n!==n&&d.status==='ok'&&Object.values(S[d.n]||{}).some(x=>urlHosts(x)===gh)),H=(db,cred,host,code)=>({db,cred,host,code});
  return{hk:{db:'Database is down',cred:'Wrong credentials',host:'Wrong host in configuration',code:'Bug in the worker'},steps:[
   {cmd:`kubectl -n ${ENVX.ns[env]} get pod -l app=${n}`,out:`NAME                 READY   STATUS             RESTARTS   AGE\n${n}-7d9f-x2lq   0/1     CrashLoopBackOff   ${bad.restarts||6}          4m\n\nLast State: Terminated · Reason: Error · Exit Code: 1`,focus:'how the process dies',h:H(30,25,25,20),n:'Exit code <b>1</b>, not 137 — the OOM killer is not involved; the process exits on its own, early, every time. That points at startup configuration or a dependency, not load.'},
   {cmd:`kubectl -n ${ENVX.ns[env]} logs ${n}-7d9f-x2lq --previous`,out:`INFO starting ${n} v0.1.0\nINFO reading configuration from environment\nERROR ${bad.err||''}`,focus:'what it fails on',h:H(22,6,58,14),n:`The failure is a <b>DNS lookup</b>, not an authentication error: the name <code>${esc(h||'')}</code> does not resolve. Wrong credentials would fail later, after connecting — I am dropping that one.`},
   {cmd:`kubectl -n ${ENVX.ns[env]} get pod -l app=${peer?peer.n:'orders-api'}`,out:peer?`NAME                     READY   STATUS    RESTARTS\n${peer.n}-5c8b-k1pz   2/2     Running   0`:'(no other workload uses this service)',focus:'whether the database is actually up',h:peer?H(3,4,86,7):H(15,5,70,10),n:peer?`<code>${esc(peer.n)}</code> talks to the same database through <code>${esc(gh||'')}</code> and is healthy. So the database is up and reachable from this namespace. The difference must be in <code>${esc(n)}</code>'s own configuration.`:'No healthy peer to compare with, so I cannot fully rule out the database yet.'},
   {cmd:`dx secrets diff ${n} --env local,${env} --keys-only=false`,out:`${key}\n  local:   ${goodV.replace(/:[^:@/]+@/,':••••@')}\n  ${env}: ${badV.replace(/:[^:@/]+@/,':••••@')}`,focus:'what differs between environments',h:H(2,3,95,0),n:`Apart from the password, which is meant to differ, only the host changes: <code>${esc(gh||'')}</code> locally, <code>${esc(h||'')}</code> in ${ENVL[env].toLowerCase()}. Promotion checked that the key exists, not that the value is right.`},
   {cmd:`kubectl -n ${ENVX.ns[env]} run dns-check --rm -i --image=busybox -- nslookup ${h}`,out:`** server can't find ${h}: NXDOMAIN\n\n$ nslookup ${gh}\nName: ${gh}.${ENVX.ns[env]}.svc.cluster.local`,focus:'confirming the root cause',h:H(1,1,98,0),n:`Confirmed: <code>${esc(h||'')}</code> does not exist in the cluster; the service is <code>${esc(gh||'')}</code> (or <code>${esc(gh||'')}.${esc(ENVX.ns[env])}.svc.cluster.local</code>).`}],
   end:{ok:false,t:'Root cause found',b:`<code>${esc(n)}</code>'s <code>${esc(key)}</code> in ${ENVL[env].toLowerCase()} points at <code>${esc(h||'')}</code>, a name that does not exist in the cluster. The code is fine.<br><br><b>Fix (yours — secrets are a human change):</b> set the host to <code>${esc(gh||'')}</code> in the ${ENVL[env].toLowerCase()} secrets, then redeploy ${ENVL[env].toLowerCase()}.<br><br><b>To stop this happening again:</b> add a startup check that resolves every service host in the secrets before rollout, or make promotion run a DNS dry-run in the target namespace.`,act:`openEnvs();SHOWSEC=true;rerender('envs')`}};}

/* ───── lançadores + motor de sessão ───── */
function debugConfigs(){const c=[{id:'lexer',l:'lexer · test tokenize_emits_eof',d:'cargo test -p lexer, under lldb'}];['staging','production'].forEach(e=>{const s=ENVX.st[e];if(s)s.deps.filter(d=>d.status==='crash').forEach(d=>c.push({id:`crash:${e}:${d.n}`,l:`Attach: ${d.n} (${e})`,d:'CrashLoopBackOff — investigate'}));});return c;}
function startDebug(id){hydrateBps();const ct=tabOf(cur);id=id||(ct&&ct.path===P_LX?'lexer':(debugConfigs().find(c=>c.id.startsWith('crash'))||{id:'lexer'}).id);goPane('debug');if(getVar('--panel-h')==='0px')togglePanel();setVar('--panel-h','300px');
  if(id==='lexer'){const v=lexVariant();if(v==='bug'){DBG=window.DBG={id,kind:'pre',i:-1,steps:[],feed:[],h:{}};dbgFeed('look','Building <code>lexer</code> in debug mode…');
      dbgFeed('evidence',`<pre>error[E0382]: use of moved value: \`chars\`\n --> crates/lexer/src/lib.rs:${LXL(/chars\.peek\(\)/)}:8\n  |\n${LXL(/for c in/)} |     for c in chars {\n  |              ----- \`chars\` moved due to this implicit call to \`.into_iter()\`\n  |\nhelp: you can \`clone\` the value and consume it, but this might not be your desired behavior\n  |\n  |     for c in chars.clone() {\n  |                   ++++++++</pre>`);
      dbgFeed('think',`I cannot start a session: there is no binary until the borrow checker is satisfied. <code>rustc</code> offers <code>.clone()</code> — and even warns it “might not be your desired behavior”. That warning is the interesting part. Rather than guess, let's apply the suggestion and <b>watch what it does at runtime</b>; the test will tell us if it is right.`);
      DBG.offer=true;setPanelTab('dbg');RP.debug();drawDbg();return;}
    if(v==='other'){DBG=window.DBG={id,kind:'pre',i:-1,steps:[],feed:[],h:{}};dbgFeed('think','This edit is not one the prototype can step through. The desktop app runs the real test under <code>lldb</code> / <code>codelldb</code>, with the same assistant reading the frames.');setPanelTab('dbg');RP.debug();drawDbg();return;}
    const tr=lexTrace(v);DBG=window.DBG={id,kind:'code',i:-1,steps:tr.steps,end:tr.end,feed:[],h:{},hk:{eof:'Eof is never pushed',dig:'Digits are tokenized wrong',test:'The test expects the wrong thing'},watch:['chars.peek()','tokens.len()']};
    if(![...BPS].some(b=>b.startsWith(P_LX+':')))BPS.add(P_LX+':'+LXL(/chars\.peek\(\)/));openPath(P_LX);dbgFeed('look',`Debugging <code>tokenize_emits_eof</code> on <code>lib.rs</code> as it is now (<code>${v==='clone'?'for c in chars.clone()':v==='byref'?'for c in chars.by_ref()':'while let'}</code>). Breakpoints: ${[...BPS].filter(b=>b.startsWith(P_LX)).map(b=>'line '+b.split(':').pop()).join(', ')}.`);dbgStep();}
  else{const[,e,n]=id.split(':'),tr=crashTrace(e,n);DBG=window.DBG={id,kind:'ops',i:-1,steps:tr.steps,end:tr.end,hk:tr.hk,feed:[],h:{}};dbgFeed('look',`Attaching to <code>${esc(n)}</code> in ${ENVL[e].toLowerCase()}. A crash-looping pod cannot be stepped like code, so I investigate the way you would: status, logs, a healthy peer, the configuration diff, then confirm. Press <kbd>F10</kbd> to run each probe.`);dbgStep();}
  setPanelTab('dbg');RP.debug();}
function dbgFeed(k,h){DBG.feed.push({k,h,t:hhmm()});}
function dbgApplyClone(){if(isHuman('code')){toast('Code is yours in this project — make the change yourself');dbgFeed('think',`Make the change yourself on line ${LXL(/for c in/)}: <code>for c in chars.clone() {</code>, then press <kbd>F5</kbd>.`);openPath(P_LX,LXL(/for c in/));drawDbg();return;}
  checkpoint('Before trying rustc\'s .clone() suggestion');writeFile(P_LX,FS[P_LX].content.replace('for c in chars {','for c in chars.clone() {'));log('debug',"applied rustc's .clone() suggestion to observe it");startDebug('lexer');}
function dbgStep(){if(!DBG||DBG.kind==='pre')return;if(DBG.i>=DBG.steps.length-1){dbgFinish();return;}DBG.i++;const s=DBG.steps[DBG.i];if(s.h)DBG.h=s.h;
  if(DBG.kind==='ops'){dbgFeed('cmd',`<pre class="notr">$ ${esc(s.cmd)}\n${esc(s.out)}</pre>`);dbgFeed(s.i===DBG.steps.length-1?'evidence':'think',s.n);}else dbgFeed(s.ev?'evidence':'think',`<span class="dbg-ln">line ${s.l}</span> ${s.n}`);
  DBG.focus=s.focus;if(DBG.i>=DBG.steps.length-1)dbgFinish();refreshDbg();}
function dbgContinue(){if(!DBG){startDebug();return;}if(DBG.kind!=='code'){dbgStep();return;}const from=DBG.i;do{DBG.i++;if(DBG.i>=DBG.steps.length){DBG.i=DBG.steps.length-1;dbgFinish();refreshDbg();return;}const s=DBG.steps[DBG.i];if(s.h)DBG.h=s.h;if(s.focus==='how the loop consumes chars'&&!BPS.has(P_LX+':'+s.l))dbgFeed('think',`<span class="dbg-ln">line ${s.l} · passed</span> ${s.n}`);if(BPS.has(P_LX+':'+s.l)||DBG.i===DBG.steps.length-1){const skipped=DBG.i-from-1;if(skipped>0)dbgFeed('look',`Ran ${skipped} step(s) to the next breakpoint.`);dbgFeed(s.ev?'evidence':'think',`<span class="dbg-ln">line ${s.l}</span> ${s.n}`);DBG.focus=s.focus;if(DBG.i>=DBG.steps.length-1)dbgFinish();break;}}while(true);refreshDbg();}
function dbgFinish(){if(DBG.done)return;DBG.done=true;dbgFeed(DBG.end.ok?'ok':'root',`<b>${DBG.end.t}.</b> ${DBG.end.b}`);log('debug',DBG.end.t);}
function dbgStop(){DBG=window.DBG=null;setVar('--panel-h','230px');refreshDbg();}
function dbgFix(){if(!DBG||!DBG.end||!DBG.end.fix)return;if(isHuman('code')){toast('Code is yours in this project — apply the fix yourself');openPath(P_LX,LXL(/for c in/));return;}
  const old=FS[P_LX].content,nw=DBG.end.fix(old);dlg({title:'Apply the fix?',body:`<p>The Debug assistant proposes one line on <code>crates/lexer/src/lib.rs</code>:</p><pre class="notr">- ${esc(old.split('\n').find(l=>/for c in/.test(l)).trim())}\n+ ${esc(nw.split('\n').find(l=>/for c in/.test(l)).trim())}</pre><p>Then it re-runs the test under the debugger to confirm.</p>`,ok:'Apply and re-run',onOk:()=>{checkpoint('Before the Debug assistant fix');writeFile(P_LX,nw);startDebug('lexer');}});}
const DBGK={look:['Looking at','var(--blue)'],think:['Analysing','var(--accent-hover)'],evidence:['Evidence','var(--yellow)'],cmd:['Probe','var(--fg-muted)'],root:['Root cause','var(--red)'],ok:['Verdict','var(--green)']};
function drawDbg(){hydrateBps();const el=$('#pc-dbg');if(!el)return;if(!DBG){el.innerHTML=`<div class="dbg-empty">${svg('bug')}<div><b>Debug assistant</b><p>Start a session (<kbd>F5</kbd>) and the assistant explains what it is looking at and why, keeps ranked hypotheses with the evidence for and against each, and suggests the next probe — like a senior engineer next to you, not a cursor jumping between lines.</p><button class="mini pri" onclick="startDebug()">Start debugging</button></div></div>`;return;}
  const hs=Object.entries(DBG.h||{}).sort((a,b)=>b[1]-a[1]),probes=[];if(DBG.kind==='code'&&!DBG.done){probes.push(['Step over (F10)','dbgStep()'],['Continue to breakpoint (F5)','dbgContinue()']);if(!DBG.watch.includes('chars.peek()'))probes.push(['Watch chars.peek()',"DBG.watch.push('chars.peek()');refreshDbg()"]);}
  if(DBG.kind==='ops'&&!DBG.done)probes.push(['Run next probe (F10)','dbgStep()']);if(DBG.offer)probes.push(["Apply rustc's suggestion and debug it",'dbgApplyClone()']);if(DBG.done&&DBG.end.fix)probes.push(['Apply the fix and re-run','dbgFix()']);if(DBG.done&&DBG.end.act)probes.push(['Open the staging secrets',DBG.end.act]);if(DBG.done)probes.push(['Explain this to me in depth',"explainCmd(true)"]);
  el.innerHTML=`<div class="dbg"><div class="dbg-feed" id="dbg-feed">${DBG.focus?`<div class="dbg-focus">Now analysing: <b>${esc(DBG.focus)}</b></div>`:''}${DBG.feed.map(f=>`<div class="df ${f.k}"><span class="dk" style="color:${DBGK[f.k][1]}">${DBGK[f.k][0]}</span><div>${f.h}</div></div>`).join('')}</div>
   <div class="dbg-side"><div class="dbg-t">Hypotheses</div>${hs.length?hs.map(([k,v])=>`<div class="hy${v<8?' out':''}"><div class="hy-h"><span>${DBG.hk[k]}</span><b>${v}%</b></div><i><b style="width:${v}%;background:${v>=80?'var(--red)':v<8?'var(--fg-muted)':'var(--accent)'}"></b></i></div>`).join(''):'<div class="sec-empty" style="padding:4px 0">Forming hypotheses once the session starts.</div>'}
   <div class="dbg-t">Next</div>${probes.map(p=>`<button class="dbg-p" onclick="${p[1]}">${p[0]}</button>`).join('')}</div></div>`;const f=$('#dbg-feed');f.scrollTop=f.scrollHeight;}
function refreshDbg(){drawDbg();if(PANE==='debug')RP.debug();const t=tabOf(cur);if(t&&t.path===P_LX&&t.kind==='file'){paintEd(P_LX);const s=DBG&&DBG.kind==='code'&&DBG.steps[DBG.i];if(s)$('#ebody').scrollTop=Math.max(0,(s.l-1)*22-140);}}
function toggleBp(p,l){hydrateBps();const k=p+':'+l;BPS.has(k)?BPS.delete(k):BPS.add(k);saveBps();refreshDbg();if(tabOf(cur)&&tabOf(cur).path===p)paintEd(p);}
document.addEventListener('click',e=>{const g=e.target.closest('#ed-gut div');if(!g)return;const t=tabOf(cur);if(!t||!t.path||t.kind!=='file')return;toggleBp(t.path,[...g.parentElement.children].indexOf(g)+1);});

/** Renderiza o pane «Run and Debug»: controlo da sessão, lançadores, variáveis,
 *  watch, call stack, probes e breakpoints. Render puro sobre `DBG`/`BPS`. */
function renderDebugPane(): void {
  hydrateBps();
  const el = $("#pane-debug"), cf = debugConfigs(), s = DBG && DBG.kind === "code" ? DBG.steps[DBG.i] : null;
  if (!el) return;
  el.innerHTML = hd("Run and Debug", `<button title="Start debugging (F5)" onclick="startDebug()">${svg("run")}</button>`) + `<div class="sections">${DBG ? `<div class="dbg-ctl"><button title="Continue (F5)" onclick="dbgContinue()">▶</button><button title="Step over (F10)" onclick="dbgStep()">↷</button><button title="Restart" onclick="startDebug(DBG.id)">↻</button><button title="Stop (Shift+F5)" onclick="dbgStop()">■</button><span class="notr">${esc((cf.find(c => c.id === DBG.id) || { l: DBG.id }).l)}</span></div>` : ""}
   ${!DBG ? `<div class="scm-grp">Launch</div>${cf.map(c => `<div class="scm-row" onclick="startDebug('${c.id}')"><span class="ic" style="color:${c.id.startsWith("crash") ? "var(--red)" : "var(--green)"}">${svg(c.id.startsWith("crash") ? "bug" : "run")}</span><span class="nm notr" style="max-width:none">${esc(c.l)}</span></div><div class="sec-empty" style="padding-top:0;padding-left:34px">${esc(c.d)}</div>`).join("")}<button class="btn" onclick="startDebug()">Start debugging (F5)</button>` : ""}
   ${DBG && DBG.kind === "code" ? `<div class="scm-grp">Variables</div>${s ? Object.entries(s.v).map(([k, v]) => `<div class="dv"><span class="k notr">${esc(k)}</span><span class="v notr">${esc(v)}</span></div>`).join("") : ""}
   <div class="scm-grp">Watch</div>${DBG.watch.map((w: string, i: number) => { const val = s ? (w === "chars.peek()" ? (s.v["chars.peek()"] || (/next '1'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('1')" : /next '2'/.test(s.v["chars: Peekable<Chars>"]) ? "Some('2')" : "None")) : w === "tokens.len()" ? (s.v["tokens: Vec<Token>"].match(/len (\d+)/) || [])[1] : "not available in the prototype") : ""; return `<div class="dv"><span class="k notr">${esc(w)}</span><span class="v notr">${esc(val)}</span><button onclick="DBG.watch.splice(${i},1);refreshDbg()">×</button></div>`; }).join("")}<input class="inp notr" placeholder="Add expression" onchange="if(this.value.trim()){DBG.watch.push(this.value.trim());refreshDbg()}">
   <div class="scm-grp">Call stack</div>${s ? [`lexer::tokenize · lib.rs:${s.l}`, "lexer::tests::tokenize_emits_eof", "test::run_test · std"].map((f, i) => `<div class="dv${i ? "" : " top"}"><span class="k notr">${esc(f)}</span></div>`).join("") : ""}` : ""}
   ${DBG && DBG.kind === "ops" ? `<div class="scm-grp">Probes</div>${DBG.steps.map((p: any, i: number) => `<div class="dv${i === DBG.i ? " top" : ""}"><span class="k" style="color:${i <= DBG.i ? "var(--green)" : "var(--fg-muted)"}">${i <= DBG.i ? "✓" : "○"}</span><span class="v notr" style="text-align:left">${esc(p.cmd)}</span></div>`).join("")}` : ""}
   <div class="scm-grp">Breakpoints<span class="cnt">${BPS.size}</span></div>${[...BPS].map(b => { const l = b.split(":").pop() as string, p = b.slice(0, b.length - l.length - 1); return `<div class="scm-row" onclick="openPath('${p}',${l})"><span class="bpd"></span><span class="nm notr">${esc(p.split("/").pop())}</span><span class="pth">line ${l}</span><span class="ra" style="display:flex"><button onclick="event.stopPropagation();BPS.delete('${b}');saveBps();refreshDbg()">×</button></span></div>`; }).join("") || '<div class="sec-empty">Click the gutter or press <kbd>F9</kbd> to add one.</div>'}
   <div class="sec-empty">Sessions are simulated in the browser. The desktop app drives lldb / delve / debugpy through the Debug Adapter Protocol; the assistant reads the same frames.</div></div>`;
}

/* ── publicação no window ──
   • `renderDebugPane` — RP.debug (v6) delega (lazy, no switch de pane).
   • motor (`startDebug`/`dbg*`/`saveBps`/`debugConfigs`/`lexTrace`/`crashTrace`) — os
     `onclick`/keydown/menus do monólito resolvem-nos por nome livre ao disparar.
   • fachadas SEM substring proibido para o resíduo de v6.ts ler o estado:
     `dbgState()` (sessão), `dbgBreaks` (Set), `dbgLaunch()` (lançadores). */
window.renderDebugPane = renderDebugPane;
window.dbgState = () => DBG;
window.dbgBreaks = BPS;
window.dbgLaunch = debugConfigs;
Object.assign(window, {
  startDebug, dbgFeed, dbgApplyClone, dbgStep, dbgContinue, dbgFinish, dbgStop, dbgFix,
  drawDbg, refreshDbg, toggleBp, saveBps, debugConfigs, lexTrace, crashTrace,
});
