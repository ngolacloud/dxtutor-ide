/* ═════════ dxtutor IDE — PairCode (XP pair programming) ═════════
   One developer hosts and gets a token; the other joins with it. The guest sees the host's
   workspace live and follows the driver (open file, scroll, cursor). One of the two drives —
   types in the editor and the shared terminal — and control changes hands only on request and
   acceptance. A small video call (camera + audio) runs alongside over WebRTC; its signalling
   travels inside the same encrypted PairCode channel. Desktop app only. */
(()=>{
/* In the browser build there is no network: pair-sim.js supplies a scripted peer with the same messages. */
const SIM=!window.__TAURI__;
if(SIM?!window.__PAIRSIM__:!window.DXR)return;
const T=SIM?window.__PAIRSIM__.T:window.__TAURI__,inv=SIM?window.__PAIRSIM__.inv:(c,a)=>T.core.invoke(c,a||{}),R=SIM?window.__PAIRSIM__.R:window.DXR;
const escH=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say=m=>{try{log('paircode',m);}catch(e){}};
const P={role:null,state:'idle',token:null,peer:null,peerName:'',driver:'host',follow:true,sent:{},backup:null,
  rtc:null,local:null,callReady:null,cands:[],mic:true,cam:true,mediaErr:null,lastView:'',pendingReq:false,min:false,log:[]};
window.PAIR=P;
const myName=()=>R.user||'me';
const other=r=>r==='host'?'guest':'host';
const amDriver=()=>!!P.role&&P.driver===P.role;
const live=()=>P.state==='connected';
const driverName=()=>P.driver===P.role?'you':(P.peerName||P.driver);
function send(o){if(!live())return Promise.resolve();return inv('pair_send',{msg:JSON.stringify(o)}).catch(e=>say(String(e)));}

/* ───── session ───── */
async function start(){if(P.role){openPanel();return;}
  try{P.token=await inv('pair_host',{name:myName()+(R.name?' · '+R.name:'')});P.role='host';P.driver='host';P.state='waiting';openPanel();say('session started — share the token');}
  catch(e){toast('PairCode could not start: '+e);}}
async function join(token,via){token=(token||'').trim();if(!token){toast('Paste the token first');return;}
  P.role='guest';P.state='joining';P.driver='host';drawPanel();
  try{P.peerName=await inv('pair_join',{token,via:via||null});say('connected to '+P.peerName);}
  catch(e){P.role=null;P.state='idle';drawPanel();toast(String(e).slice(0,200));say(String(e));}}
async function end(){await send({t:'bye'});await inv('pair_stop');cleanup();}
function cleanup(){stopCall();if(P.role==='guest')leaveRemote();P.role=null;P.state='idle';P.token=null;P.peer=null;P.peerName='';P.driver='host';P.pendingReq=false;
  try{show(cur);}catch(e){}drawDock();drawPanel();drawStatus();}

T.event.listen('pair-status',e=>{const s=e.payload||{};
  if(s.state==='waiting'){if(P.role==='host'&&P.state==='connected'){toast((P.peerName||'Your pair')+' left the session');stopCall();P.driver='host';try{show(cur);}catch(e){}}P.state=P.role==='host'?'waiting':P.state;P.peerName=P.role==='host'?'':P.peerName;}
  else if(s.state==='connected'){P.state='connected';P.peer=s.peer;closePanel();
    send({t:'hello',name:myName(),rtc:!!window.RTCPeerConnection});if(P.role==='host')sendSnapshot();}
  else if(s.state==='ended'||s.state==='disconnected'&&P.role==='guest'){if(P.role==='guest'){toast('PairCode session ended');cleanup();}}
  else if(s.state==='error'){toast(s.error||'PairCode error');if(P.role==='guest')cleanup();}
  else if(s.state==='idle'){}
  drawPanel();drawDock();drawStatus();});
T.event.listen('pair-msg',e=>{let m;try{m=JSON.parse(e.payload);}catch(x){return;}handle(m).catch(err=>say('message '+m.t+': '+err));});

async function handle(m){switch(m.t){
  case 'hello':P.peerName=m.name||P.peerName;P.peerRtc=!!m.rtc;toast(`${P.peerName} joined — PairCode`);say(P.peerName+' joined');drawAll();startCall();break;
  case 'vf':onFrame(m.d);break;
  case 'af':onAudio(m.d);break;
  case 'snap':enterRemote(m);break;
  case 'files':applyFiles(m);break;
  case 'view':P.peerView=m;if(!amDriver())applyView(m);break;
  case 'ctl-req':askControl(m);break;
  case 'ctl':P.driver=m.driver;P.pendingReq=false;try{show(cur);}catch(e){}toast(amDriver()?'You have control — you are driving':`${P.peerName} is driving — you are navigating`);drawAll();break;
  case 'ctl-deny':P.pendingReq=false;toast(`${P.peerName} kept control for now`);drawAll();break;
  case 'term':if(P.role==='guest')mirrorLine(m);break;
  case 'termclear':if(P.role==='guest'){const t=$('#term');if(t){t.innerHTML='';newInput(true);}}break;
  case 'rtc-ready':if(P.role==='host')offer();break;
  case 'rtc':await onRtc(m);break;
  case 'av':P.peerAv=m;drawDock();break;
  case 'bye':if(P.role==='guest'){await inv('pair_stop');toast('The host ended the session');cleanup();}break;}}

/* ───── workspace: host is the source of truth ───── */
function realFiles(){const o={};Object.keys(FS).forEach(k=>{if(k.startsWith(ROOT)&&!k.startsWith(ROOT+'learn/'))o[k]=FS[k].content;});return o;}
function sendSnapshot(){P.sent=realFiles();const orig={};Object.keys(P.sent).forEach(k=>{if(FS[k].orig!==FS[k].content)orig[k]=FS[k].orig;});
  send({t:'snap',name:R.name||'workspace',branch:BRANCH,files:P.sent,orig,driver:P.driver,view:viewNow()});}
function enterRemote(m){if(!P.backup){try{R.flush&&R.flush();}catch(e){}P.backup={fs:Object.assign({},FS),root:R.root,name:R.name,git:R.git,branch:BRANCH,cwd:CWD.slice()};}
  R.root=null;R.git=false;R.remote=true;R.name=m.name;
  try{TABS.filter(t=>t.kind==='file'||t.path).map(t=>t.id).forEach(id=>closeTab(id));}catch(e){}
  Object.keys(FS).forEach(k=>{if(!k.startsWith(ROOT+'learn/'))delete FS[k];});
  Object.entries(m.files).forEach(([k,c])=>{FS[k]={content:c,orig:k in m.orig?m.orig[k]:c};});P.sent=Object.assign({},m.files);
  BRANCH=m.branch||'remote';try{$('#st-branch-l').textContent=BRANCH;}catch(e){}CWD=[m.name];OPEN.clear();OPEN.add('dxtutor');P.driver=m.driver||'host';
  document.title=`${m.name} (PairCode with ${P.peerName}) — dxtutor IDE`;
  const t=$('#term');if(t){t.innerHTML='';echo(`<span class="ac">shared terminal</span> <span class="dim">· runs on ${escH(P.peerName)}'s machine · the driver types</span>`);newInput(true);}
  refresh(false,true);if(m.view)applyView(m.view,true);drawAll();say(`showing ${m.name} from ${P.peerName}: ${Object.keys(m.files).length} files`);}
function leaveRemote(){const b=P.backup;if(!b)return;P.backup=null;R.remote=false;
  try{TABS.filter(t=>t.kind==='file'||t.path).map(t=>t.id).forEach(id=>closeTab(id));}catch(e){}
  Object.keys(FS).forEach(k=>delete FS[k]);Object.assign(FS,b.fs);R.root=b.root;R.name=b.name;R.git=b.git;BRANCH=b.branch;CWD=b.cwd;
  try{$('#st-branch-l').textContent=BRANCH;}catch(e){}document.title=(R.name?R.name+' — ':'')+'dxtutor IDE';
  refresh(false,true);if(R.root){R.reloadDisk&&R.reloadDisk();}const t=$('#term');if(t){t.innerHTML='';newInput(true);}}
let syncT=null,applying=false;
const _refresh=refresh;
refresh=function(){const r=_refresh.apply(this,arguments);if(live()&&!applying){clearTimeout(syncT);syncT=setTimeout(syncOut,120);}return r;};
function syncOut(){if(!live())return;const now=realFiles(),set={},del=[];
  Object.keys(now).forEach(k=>{if(P.sent[k]!==now[k])set[k]=now[k];});Object.keys(P.sent).forEach(k=>{if(!(k in now))del.push(k);});
  if(!Object.keys(set).length&&!del.length)return;Object.assign(P.sent,set);del.forEach(k=>delete P.sent[k]);send({t:'files',set,del});}
function applyFiles(m){applying=true;try{const t=tabOf(cur),open=t&&t.path;let touched=false;
    Object.entries(m.set||{}).forEach(([k,c])=>{if(FS[k])FS[k].content=c;else{FS[k]={content:c,orig:null};let d=k.split('/');d.pop();while(d.length){OPEN.add(d.join('/'));d.pop();}}P.sent[k]=c;if(k===open)touched=true;});
    (m.del||[]).forEach(k=>{delete FS[k];delete P.sent[k];});
    if(touched&&!amDriver()){const eb=$('#ebody'),top=eb?eb.scrollTop:0;refresh(false,true);show(cur);const e2=$('#ebody');if(e2)e2.scrollTop=top;}else refresh(true,true);
    if(P.peerView)drawCaret(P.peerView);}finally{applying=false;}}

/* ───── follow the driver: open file, scroll and cursor ───── */
function viewNow(){const t=tabOf(cur),ta=$('#ed-ta'),eb=$('#ebody');return{path:t&&t.path||null,top:eb?Math.round(eb.scrollTop):0,line:ta?ta.value.slice(0,ta.selectionStart).split('\n').length:0,col:ta?ta.selectionStart-ta.value.lastIndexOf('\n',ta.selectionStart-1)-1:0,tab:t?t.id:null,kind:t?t.kind:null};}
setInterval(()=>{if(!live())return;const v=viewNow(),k=JSON.stringify(v);if(k===P.lastView)return;P.lastView=k;send(Object.assign({t:'view',who:P.role},v));},200);
function applyView(v,force){if(!P.follow&&!force)return;
  if(v.path&&FS[v.path]){const t=tabOf(cur);if(!t||t.path!==v.path)openPath(v.path);}
  const eb=$('#ebody');if(eb&&v.path)eb.scrollTop=v.top;drawCaret(v);}
function drawCaret(v){document.querySelectorAll('.pair-caret').forEach(x=>x.remove());const t=tabOf(cur);if(!live()||!t||t.path!==v.path||!v.line)return;
  const ta=$('#ed-ta'),wrap=ta&&ta.parentElement;if(!wrap)return;const cs=getComputedStyle(ta),lh=parseFloat(cs.lineHeight)||22,pt=parseFloat(cs.paddingTop)||0;
  const d=document.createElement('div');d.className='pair-caret';d.style.top=(pt+(v.line-1)*lh)+'px';d.style.height=lh+'px';
  d.innerHTML=`<span>${escH(v.who===P.role?'you':P.peerName||v.who)}${P.driver===v.who?' · driving':''}</span>`;wrap.appendChild(d);}
const _file=VIEW.file;
VIEW.file=(t,host)=>{_file(t,host);if(live()&&!amDriver()){const ta=$('#ed-ta');if(ta){ta.readOnly=true;ta.classList.add('pair-ro');ta.title=`${P.peerName||'Your pair'} is driving — request control to type`;}}
  if(live()&&P.peerView&&!amDriver())setTimeout(()=>drawCaret(P.peerView),0);};
/* keystrokes from the navigator never reach the editor */
document.addEventListener('keydown',e=>{if(!live()||amDriver())return;const a=document.activeElement;if(a&&a.id==='ed-ta'&&!e.ctrlKey&&!e.metaKey&&e.key.length===1){e.preventDefault();nudge();}},true);
let nudgeT=0;function nudge(){if(Date.now()-nudgeT<4000)return;nudgeT=Date.now();toast(`${P.peerName||'Your pair'} is driving — Request control to type`);}

/* ───── control: request, accept, hand over ───── */
function requestControl(){if(!live()||amDriver())return;P.pendingReq=true;send({t:'ctl-req',from:P.role,name:myName()});toast(`Asked ${P.peerName} for control…`);drawAll();}
function giveControl(){if(!live()||!amDriver())return;P.driver=other(P.role);send({t:'ctl',driver:P.driver});try{show(cur);}catch(e){}toast(`${P.peerName} is driving now`);drawAll();}
function takeBack(){if(P.role!=='host'||!live())return;P.driver='host';send({t:'ctl',driver:'host'});try{show(cur);}catch(e){}toast('You took control back');drawAll();}
function askControl(m){if(!amDriver()){send({t:'ctl-deny'});return;}P.ask=m;drawDock();
  if(R.info&&/^host/.test(R.info.pairtest||''))setTimeout(()=>answer(true),/slow/.test(R.info.pairtest)?3500:300);}
function answer(ok){if(!P.ask)return;P.ask=null;if(ok)giveControl();else send({t:'ctl-deny'});drawDock();}

/* ───── shared terminal: runs on the host, the driver types ───── */
const term=$('#term');
if(term)new MutationObserver(ms=>{if(P.role!=='host'||!live())return;ms.forEach(m=>m.addedNodes.forEach(n=>{if(n.nodeType===1&&n.id!=='inputwrap'&&n.classList.contains('line'))send({t:'term',text:n.textContent,err:!!n.querySelector('.er')});}));}).observe(term,{childList:true});
function mirrorLine(m){const t=$('#term');if(!t)return;const d=document.createElement('div');d.className='line';d.innerHTML=m.err?'<span class="er">'+escH(m.text)+'</span>':escH(m.text);const w=$('#inputwrap');w?t.insertBefore(d,w):t.appendChild(d);scrollTerm();}
const _promptHTML=promptHTML;
promptHTML=function(){if(!R.remote)return _promptHTML();return `<span class="pr"><span>${escH(P.peerName||'host')}</span><span class="at">:</span><span class="pth">${escH(CWD.join('/'))}</span><span class="br"> (${escH(BRANCH)})</span><span class="at">$</span></span> `;};
const _run=window.run;
window.run=function(raw){if(P.role==='guest'&&live()){const v=(raw||'').trim();if(!v){newInput();return;}
    if(!amDriver()){nudge();newInput();return;}send({t:'cmd',line:v});const i=$('#cmd');if(i)i.value='';return;}
  if(P.role==='host'&&live()&&P.driver==='guest'&&!applyingCmd){nudge();newInput();return;}
  return _run(raw);};
let applyingCmd=false;
const _handle=handle;
/* commands from the guest run through the host's own terminal */
handle=async function(m){if(m.t==='cmd'&&P.role==='host'&&P.driver==='guest'){setPanelTab('terminal',true);applyingCmd=true;try{await window.run(m.line);}finally{applyingCmd=false;}return;}return _handle(m);};
/* git stays on the host's machine */
['commit','checkout','gitMerge','gfStart','gfFinish'].forEach(n=>{const f=window[n];if(typeof f!=='function')return;window[n]=function(){if(P.role==='guest'&&live()){toast(`git runs on ${P.peerName}'s machine — use the shared terminal while you drive`);return null;}return f.apply(this,arguments);};});
try{commit=window.commit;checkout=window.checkout;gitMerge=window.gitMerge;gfStart=window.gfStart;gfFinish=window.gfFinish;}catch(e){}

/* ───── video call (WebRTC; signalling inside PairCode) ───── */
async function startCall(){P.calls=(P.calls||0)+1;stopCall();P.frames=0;P.audioIn=0;P.sentAudio=0;let ready;P.callReady=new Promise(r=>ready=r);P.cands=[];P.mediaErr=null;
  const gum=c=>Promise.race([P.fakeMedia?Promise.resolve(P.fakeMedia):SIM?Promise.resolve(window.__PAIRSIM__.media()):navigator.mediaDevices.getUserMedia(c),new Promise((_,no)=>setTimeout(()=>no(new Error('camera/microphone did not answer')),12000))]);
  try{P.local=await gum({video:{width:{ideal:320},height:{ideal:240},frameRate:{ideal:15}},audio:{echoCancellation:true,noiseSuppression:true}});}
  catch(e){P.mediaErr=String(e&&(e.name+': '+e.message+(e.constraint?' ('+e.constraint+')':''))||e);try{P.local=await gum({audio:true});}catch(e2){P.local=null;}}
  P.mode=window.RTCPeerConnection&&P.peerRtc&&!P.forceRelay?'rtc':'relay';
  if(P.mode==='relay'){P.mic=true;P.cam=!!(P.local&&P.local.getVideoTracks().length);startRelay();drawDock();ready();sendAv();say('call: relayed through PairCode (no WebRTC on one side)');return;}
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});P.rtc=pc;
  if(P.local)P.local.getTracks().forEach(t=>pc.addTrack(t,P.local));
  if(!P.local||!P.local.getVideoTracks().length)pc.addTransceiver('video',{direction:'recvonly'});
  if(!P.local)pc.addTransceiver('audio',{direction:'recvonly'});
  pc.ontrack=e=>{const v=$('#pair-remote');if(v){v.srcObject=e.streams[0]||new MediaStream([e.track]);v.play().catch(()=>{});}};
  pc.onicecandidate=e=>{if(e.candidate)send({t:'rtc',cand:e.candidate.toJSON()});};
  pc.onconnectionstatechange=()=>drawDock();
  P.mic=true;P.cam=!!(P.local&&P.local.getVideoTracks().length);drawDock();ready();
  if(P.role==='guest')send({t:'rtc-ready'});sendAv();}
async function offer(){await P.callReady;const pc=P.rtc;if(!pc)return;const o=await pc.createOffer();await pc.setLocalDescription(o);send({t:'rtc',sdp:pc.localDescription});}
async function onRtc(m){await P.callReady;const pc=P.rtc;if(!pc)return;
  if(m.sdp){await pc.setRemoteDescription(m.sdp);if(m.sdp.type==='offer'){const a=await pc.createAnswer();await pc.setLocalDescription(a);send({t:'rtc',sdp:pc.localDescription});}
    for(const c of P.cands.splice(0))await pc.addIceCandidate(c).catch(()=>{});}
  else if(m.cand){if(pc.remoteDescription)await pc.addIceCandidate(m.cand).catch(()=>{});else P.cands.push(m.cand);}}
/* relay mode: when either webview lacks WebRTC (WebKitGTK on most Linux distros), the call goes
   through the encrypted PairCode channel — JPEG frames at 8 fps and 16 kHz PCM audio. Meant for LAN/VPN. */
function b64(buf){const u=new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s);}
function unb64(d){const s=atob(d),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u.buffer;}
function startRelay(){if(!P.local)return;const vt=P.local.getVideoTracks()[0],at=P.local.getAudioTracks()[0];
  if(vt){const v=document.createElement('video');v.muted=true;v.playsInline=true;v.srcObject=new MediaStream([vt]);v.play().catch(()=>{});const c=document.createElement('canvas');c.width=320;c.height=240;const g=c.getContext('2d');
    P.relayV=v;P.vTimer=setInterval(()=>{if(!P.cam||!live())return;const dv=$('#pair-self'),src=v.readyState>=2?v:dv&&dv.readyState>=2?dv:null;if(!src){v.play().catch(()=>{});return;}g.drawImage(src,0,0,320,240);send({t:'vf',d:c.toDataURL('image/jpeg',0.55)});},125);}
  if(at){try{const AC=window.AudioContext||window.webkitAudioContext,ac=new AC();P.capAc=ac;const src=ac.createMediaStreamSource(new MediaStream([at])),proc=ac.createScriptProcessor(4096,1,1),ratio=ac.sampleRate/16000;
    proc.onaudioprocess=e=>{if(!P.mic||!live())return;const inp=e.inputBuffer.getChannelData(0),n=Math.floor(inp.length/ratio),out=new Int16Array(n);for(let i=0;i<n;i++){const x=inp[Math.floor(i*ratio)];out[i]=Math.max(-1,Math.min(1,x))*32767;}send({t:'af',d:b64(out.buffer)});P.sentAudio=(P.sentAudio||0)+1;};
    src.connect(proc);proc.connect(ac.destination);P.capNodes=[src,proc];if(ac.state==='suspended')ac.resume().catch(()=>{});}catch(e){say('audio capture: '+e);}}}
function onFrame(d){P.lastFrame=Date.now();P.frames=(P.frames||0)+1;const img=$('#pair-remote-img');if(img&&!P.min)img.src=d;else if(!img)drawDock();P.lastFrameData=d;if(P.frames===1)drawDock();}
function onAudio(d){P.audioIn=(P.audioIn||0)+1;try{const AC=window.AudioContext||window.webkitAudioContext;if(!P.playAc)P.playAc=new AC();const ac=P.playAc;if(ac.state==='suspended')ac.resume().catch(()=>{});
  const pcm=new Int16Array(unb64(d)),buf=ac.createBuffer(1,pcm.length,16000),ch=buf.getChannelData(0);for(let i=0;i<pcm.length;i++)ch[i]=pcm[i]/32768;
  const now=ac.currentTime;if(!P.playT||P.playT<now||P.playT-now>0.6)P.playT=now+0.08;const sN=ac.createBufferSource();sN.buffer=buf;sN.connect(ac.destination);sN.start(P.playT);P.playT+=buf.duration;}catch(e){}}
document.addEventListener('click',()=>{if(P.playAc&&P.playAc.state==='suspended')P.playAc.resume().catch(()=>{});if(P.capAc&&P.capAc.state==='suspended')P.capAc.resume().catch(()=>{});},true);
function stopCall(){clearInterval(P.vTimer);P.vTimer=null;if(P.capNodes){P.capNodes.forEach(n=>{try{n.disconnect();}catch(e){}});P.capNodes=null;}if(P.capAc){P.capAc.close().catch(()=>{});P.capAc=null;}if(P.playAc){P.playAc.close().catch(()=>{});P.playAc=null;}P.playT=0;P.lastFrameData=null;P.relayV=null;
  if(P.rtc){try{P.rtc.close();}catch(e){}P.rtc=null;}if(P.local){P.local.getTracks().forEach(t=>t.stop());P.local=null;}P.peerAv=null;}
function sendAv(){send({t:'av',mic:P.mic,cam:P.cam});}
function toggleMic(){if(!P.local)return;P.mic=!P.mic;P.local.getAudioTracks().forEach(t=>t.enabled=P.mic);sendAv();drawDock();}
function toggleCam(){if(!P.local||!P.local.getVideoTracks().length)return;P.cam=!P.cam;P.local.getVideoTracks().forEach(t=>t.enabled=P.cam);sendAv();drawDock();}

/* ───── UI: panel (start / join), floating call dock, status item ───── */
document.head.insertAdjacentHTML('beforeend',`<style>
#pair-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;place-items:center;z-index:900}
#pair-modal.on{display:grid}
#pair-modal .pm{width:min(560px,92vw);background:var(--bg-2,#1e1f24);border:1px solid var(--line,#2b2d33);border-radius:12px;padding:18px 20px;box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--fg,#ddd)}
#pair-modal h3{margin:0 0 4px;font-size:16px}#pair-modal .dim{color:var(--fg-muted,#8a8f9c);font-size:12px}
#pair-modal textarea,#pair-modal input{width:100%;box-sizing:border-box;background:var(--bg,#16171b);color:inherit;border:1px solid var(--line,#2b2d33);border-radius:8px;padding:8px;font:12px var(--mono,monospace)}
#pair-modal textarea{height:74px;resize:none;word-break:break-all}
#pair-modal .row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
#pair-modal .tabs{display:flex;gap:6px;margin:12px 0}
#pair-dock{position:fixed;right:16px;bottom:34px;width:272px;transition:left .15s,top .15s;background:var(--bg-2,#1e1f24);border:1px solid var(--line,#2b2d33);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.45);z-index:800;overflow:hidden;font-size:12px;color:var(--fg,#ddd)}
#pair-dock .ph{display:flex;align-items:center;gap:6px;padding:6px 8px;cursor:move;user-select:none;border-bottom:1px solid var(--line,#2b2d33)}
#pair-dock .ph b{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pair-dock .vid{position:relative;height:190px;background:#0c0d10}
#pair-dock video{width:100%;height:100%;object-fit:cover;display:block}
#pair-dock #pair-self{position:absolute;right:6px;bottom:6px;width:76px;height:57px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:#000;object-fit:cover}
#pair-dock .vl{position:absolute;left:6px;bottom:6px;background:rgba(0,0,0,.55);padding:2px 6px;border-radius:5px}
#pair-dock .nov{position:absolute;inset:0;display:grid;place-items:center;color:#8a8f9c;text-align:center;padding:10px}
#pair-dock .ctl{display:flex;gap:4px;padding:6px;flex-wrap:wrap}#pair-dock .ctl .mini{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#pair-dock .ask{padding:8px;background:rgba(224,138,91,.14);border-top:1px solid var(--line,#2b2d33)}
#pair-dock.min .vid,#pair-dock.min .ctl{display:none}
.pair-badge{padding:1px 6px;border-radius:9px;font-size:10.5px;background:rgba(92,201,167,.18);color:#5cc9a7}
.pair-badge.nav{background:rgba(110,168,255,.16);color:#6ea8ff}
.pair-caret{position:absolute;left:0;right:0;border-left:2px solid #e08a5b;background:rgba(224,138,91,.08);pointer-events:none;z-index:3}
.pair-caret span{position:absolute;right:6px;top:-1px;font-size:10px;background:#e08a5b;color:#fff;padding:0 5px;border-radius:0 0 4px 4px}
.ed-ta.pair-ro{cursor:default}
#st-pair{display:none}
</style>`);
document.body.insertAdjacentHTML('beforeend',`<div id="pair-modal" onclick="if(event.target===this)PAIR.ui.close()"><div class="pm" id="pair-pm"></div></div><div id="pair-dock" style="display:none"></div>`);
let tab='start';
function openPanel(t){if(t)tab=t;$('#pair-modal').classList.add('on');drawPanel();}
function closePanel(){$('#pair-modal').classList.remove('on');}
function drawPanel(){drawPanel0();if(SIM){const el=$('#pair-pm');if(el)el.insertAdjacentHTML('afterbegin','<div class="dim" style="margin:0 0 8px;color:#e0b64a">Browser demo — the other developer is simulated. The desktop app connects for real.</div>');}}
function drawPanel0(){const el=$('#pair-pm');if(!el)return;
  if(P.role==='host'){el.innerHTML=`<h3>PairCode — you are hosting</h3><div class="dim">Send this token to the other developer. It works once per session and holds the key that encrypts everything you share.</div>
    <div class="row"><textarea id="pair-tok" readonly>${escH(P.token||'')}</textarea></div>
    <div class="row"><button class="mini pri" onclick="PAIR.ui.copy()">Copy token</button><span class="dim">${live()?`<b>${escH(P.peerName)}</b> is connected`:'waiting for your pair to join…'}</span><span style="flex:1"></span><button class="mini" onclick="PAIR.ui.end()">End session</button></div>
    <div class="dim" style="margin-top:10px">Both machines must reach each other: same network, or a VPN such as Tailscale/WireGuard. Across the internet without a VPN, forward TCP port ${escH((P.token&&decodeTok(P.token).port)||47821)} on the host's router and the guest uses "via".</div>`;return;}
  if(P.role==='guest'){el.innerHTML=`<h3>PairCode — ${live()?'connected to '+escH(P.peerName):'joining…'}</h3><div class="dim">You see ${escH(P.peerName||'the host')}'s workspace. ${amDriver()?'You are driving.':'You are navigating — request control to type.'}</div><div class="row"><span style="flex:1"></span><button class="mini" onclick="PAIR.ui.end()">Leave session</button></div>`;return;}
  el.innerHTML=`<h3>PairCode</h3><div class="dim">Pair programming: one drives, the other navigates. The guest sees the host's project live, both see and hear each other, and control changes hands on request.</div>
   <div class="tabs"><button class="mini ${tab==='start'?'pri':''}" onclick="PAIR.ui.tab('start')">Host a session</button><button class="mini ${tab==='join'?'pri':''}" onclick="PAIR.ui.tab('join')">Join with a token</button></div>
   ${tab==='start'?`<div class="dim">Shares <b>${escH(R.root||'the sample workspace')}</b>. Your pair can read every file in it while the session lasts.</div><div class="row"><button class="mini pri" onclick="PAIR.ui.start()">Start and get a token</button></div>`
   :`<div class="row"><textarea id="pair-in" placeholder="dxp_…"></textarea></div><div class="row"><input id="pair-via" placeholder="via (optional): host:port — for a tunnel or VPN address"></div><div class="row"><button class="mini pri" onclick="PAIR.ui.join()">Join</button><span class="dim">your open folder is set aside and comes back when you leave</span></div>`}`;}
function decodeTok(t){try{return JSON.parse(atob(t.slice(4).replace(/-/g,'+').replace(/_/g,'/')));}catch(e){return{};}}
function drawDock(){const d=$('#pair-dock');if(!d)return;if(!live()){d.style.display='none';return;}d.style.display='';d.classList.toggle('min',P.min);
  const relay=P.mode==='relay',remoteOn=relay?!!P.frames||!!P.audioIn:P.rtc&&P.rtc.connectionState==='connected',peerCam=(!P.peerAv||P.peerAv.cam)&&(!relay||!!P.frames);
  const st=relay?'relayed':P.rtc?P.rtc.connectionState:'';
  const keepSelf=$('#pair-self'),keepRemote=$('#pair-remote');
  d.innerHTML=`<div class="ph" id="pair-drag"><span class="pdot" style="background:${remoteOn?'var(--green,#5cc9a7)':'#e0b64a'}"></span><b>${escH(P.peerName||'pair')}</b><span class="pair-badge ${amDriver()?'':'nav'}">${amDriver()?'driving':'navigating'}</span><button class="mini" title="Minimise" onclick="PAIR.ui.min()">${P.min?'▢':'–'}</button></div>
   <div class="vid">${relay?`<img id="pair-remote-img" style="width:100%;height:100%;object-fit:cover;display:block" ${P.lastFrameData?`src="${P.lastFrameData}"`:''}>`:'<video id="pair-remote" autoplay playsinline></video>'}${!remoteOn||!peerCam?`<div class="nov">${!remoteOn?'connecting call… '+escH(st):P.peerAv&&!P.peerAv.cam?escH(P.peerName)+' turned the camera off':'no video from '+escH(P.peerName)+(relay?' (audio only)':'')}</div>`:''}${relay?'<span class="vl" style="left:auto;right:88px;top:6px;bottom:auto" title="No WebRTC on one side: video and audio go through the encrypted PairCode channel">relay</span>':''}
   <video id="pair-self" autoplay playsinline muted ${P.local&&P.cam?'':'style="display:none"'}></video><span class="vl">${escH(P.peerName)}${P.peerAv&&!P.peerAv.mic?' 🔇':''}</span></div>
   <div class="ctl"><button class="mini" title="${P.mic?'Mute':'Unmute'}" onclick="PAIR.ui.mic()" ${P.local?'':'disabled'}>${P.mic?'🎙':'🔇'}</button><button class="mini" title="${P.cam?'Turn camera off':'Turn camera on'}" onclick="PAIR.ui.cam()" ${P.local&&P.local.getVideoTracks().length?'':'disabled'}>${P.cam?'📷':'🚫'}</button>
   <button class="mini" title="Follow the driver's file and cursor" onclick="PAIR.ui.follow()">${P.follow?'◉ Follow':'○ Follow'}</button><button class="mini" onclick="PAIR.ui.end()">${P.role==='host'?'End':'Leave'}</button></div>
   <div class="ctl" style="padding-top:0">${amDriver()?`<button class="mini pri" onclick="PAIR.ui.give()">Give control to ${escH(P.peerName)}</button>`:`<button class="mini pri" onclick="PAIR.ui.request()" ${P.pendingReq?'disabled':''}>${P.pendingReq?'Waiting for an answer…':'Request control'}</button>`}${P.role==='host'&&!amDriver()?`<button class="mini" onclick="PAIR.ui.take()">Take back</button>`:''}</div>
   ${P.ask?`<div class="ask"><b>${escH(P.peerName)}</b> asks for control of mouse and keyboard.<div class="ctl" style="padding:6px 0 0"><button class="mini pri" onclick="PAIR.ui.answer(true)">Give control</button><button class="mini" onclick="PAIR.ui.answer(false)">Not now</button></div></div>`:''}`;
  /* keep the live video elements so the picture does not flash on every redraw */
  if(keepSelf&&keepSelf.srcObject){$('#pair-self').replaceWith(keepSelf);keepSelf.style.display=P.local&&P.cam?'':'none';}
  if(keepRemote&&keepRemote.srcObject&&$('#pair-remote'))$('#pair-remote').replaceWith(keepRemote);
  const rv=$('#pair-remote');if(rv&&P.rtc&&!rv.srcObject){const rs=P.rtc.getReceivers().map(r=>r.track).filter(Boolean);if(rs.length){rv.srcObject=new MediaStream(rs);rv.play().catch(()=>{});}}
  const sv=$('#pair-self');if(sv&&P.local&&sv.srcObject!==P.local){sv.srcObject=P.local;sv.play().catch(()=>{});}
  drag(d,$('#pair-drag'));placeDock();}
/* The call never covers the Co-Dev chat: it sits in the bottom-right corner of the editor area, and a
   drag that would end over the chat (or outside the editor and side bar) snaps back to that corner. */
let dockPos=null;
function zone(){const eb=$('#ebody'),ag=$('#agent');const e=eb?eb.getBoundingClientRect():{left:0,top:0,right:innerWidth,bottom:innerHeight};
  const a=ag&&ag.offsetParent!==null?ag.getBoundingClientRect():null;return{e,a};}
function overlapsChat(r,a){return a&&r.right>a.left&&r.left<a.right&&r.bottom>a.top&&r.top<a.bottom;}
function placeDock(){const d=$('#pair-dock');if(!d||d.style.display==='none')return;const{e,a}=zone(),w=d.offsetWidth,h=d.offsetHeight;
  if(e.right-e.left<w+24&&!P.min){P.min=true;P.autoMin=true;drawDock();return;}
  if(P.autoMin&&e.right-e.left>=w+24){P.autoMin=false;P.min=false;drawDock();return;}
  let x,y;if(dockPos){x=dockPos.x;y=dockPos.y;const r={left:x,top:y,right:x+w,bottom:y+h};if(overlapsChat(r,a)||x<0||y<0||x+w>innerWidth||y+h>innerHeight){dockPos=null;}}
  if(!dockPos){x=Math.max(e.left+8,e.right-w-14);y=Math.max(e.top+8,e.bottom-h-12);}
  d.style.left=x+'px';d.style.top=y+'px';d.style.right='auto';d.style.bottom='auto';}
addEventListener('resize',placeDock);
try{const ro=new ResizeObserver(()=>placeDock());['#ebody','#agent','#panel'].forEach(q=>{const el=$(q);if(el)ro.observe(el);});}catch(e){}
function drag(el,h){if(!h)return;h.onmousedown=e=>{if(e.target.closest('button'))return;const r=el.getBoundingClientRect(),dx=e.clientX-r.left,dy=e.clientY-r.top;
  const mv=ev=>{el.style.left=Math.max(0,Math.min(innerWidth-r.width,ev.clientX-dx))+'px';el.style.top=Math.max(0,Math.min(innerHeight-40,ev.clientY-dy))+'px';el.style.right='auto';el.style.bottom='auto';};
  const up=()=>{removeEventListener('mousemove',mv);removeEventListener('mouseup',up);const b=el.getBoundingClientRect();dockPos=overlapsChat(b,zone().a)?null:{x:b.left,y:b.top};if(!dockPos)toast('The call stays clear of the Co-Dev chat');placeDock();};addEventListener('mousemove',mv);addEventListener('mouseup',up);};}
function drawStatus(){let s=$('#st-pair');const anchor=$('#st-prob');if(!s&&anchor){anchor.insertAdjacentHTML('afterend','<button class="si" id="st-pair" title="PairCode" onclick="PAIR.ui.open()"></button>');s=$('#st-pair');}
  if(!s)return;s.style.display=P.role?'':'none';s.textContent=P.role?(live()?`👥 ${P.peerName||'pair'} · ${amDriver()?'driving':'navigating'}`:'👥 waiting for pair…'):'';}
function drawAll(){drawPanel();drawDock();drawStatus();}

P.ui={open:()=>openPanel(),close:closePanel,tab:t=>{tab=t;drawPanel();},start:()=>start(),join:()=>join(($('#pair-in')||{}).value,($('#pair-via')||{}).value).then(()=>{if(live()||P.state==='connected')closePanel();}),
  end:()=>{end();closePanel();},copy:()=>{const t=$('#pair-tok');(navigator.clipboard&&navigator.clipboard.writeText(P.token)||Promise.reject()).then(()=>toast('Token copied')).catch(()=>{t.select();document.execCommand('copy');toast('Token copied');});},
  mic:toggleMic,cam:toggleCam,follow:()=>{P.follow=!P.follow;if(P.follow&&P.peerView)applyView(P.peerView);drawDock();},request:requestControl,give:giveControl,take:takeBack,answer,min:()=>{P.min=!P.min;drawDock();}};

/* menus, palette, shortcut */
const coMenu=MENUS.find(m=>m.t==='Co-Dev');
const items=()=>[{l:'PairCode: host a session…',k:'Ctrl+Alt+P',act:()=>openPanel('start')},{l:'PairCode: join with a token…',act:()=>openPanel('join')},{l:'PairCode: request control',act:requestControl},{l:'PairCode: give control',act:giveControl},{l:'PairCode: end session',act:()=>end()}];
MENUS.splice(MENUS.findIndex(m=>m.t==='Help'),0,{t:'Pair',get items(){return items();}});try{$('#menubar').innerHTML='';buildMenubar();}catch(e){}
CMD.unshift(['PairCode: Host a session','Ctrl+Alt+P',()=>openPanel('start')],['PairCode: Join with a token','',()=>openPanel('join')],['PairCode: Request control','',requestControl],['PairCode: Give control','',giveControl],['PairCode: End session','',()=>end()]);
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.altKey&&(e.key==='p'||e.key==='P')){e.preventDefault();openPanel();}},true);
drawStatus();

/* ───── two-instance smoke test (DXTUTOR_PAIRTEST=host|guest) ───── */
(async()=>{while(!R.ready)await new Promise(r=>setTimeout(r,100));if(!R.info.pairtest)return;const role=R.info.pairtest.replace('-slow',''),slow=/slow/.test(R.info.pairtest),pause=ms=>new Promise(r=>setTimeout(r,slow?ms:0));
  /* fake camera and microphone, built once, so the call pipeline runs on machines without devices */
  let fake=null;try{const c=document.createElement('canvas');c.width=320;c.height=240;const g=c.getContext('2d');let f=0;const paint=()=>{g.fillStyle=role==='host'?'#e08a5b':'#6ea8ff';g.fillRect(0,0,320,240);g.fillStyle='#fff';g.font='28px sans-serif';g.fillText(role+' '+(f++),20,130);};paint();setInterval(paint,100);
    const vs=c.captureStream(15),ac=new AudioContext(),o=ac.createOscillator(),dst=ac.createMediaStreamDestination();o.connect(dst);o.start();fake=new MediaStream([...vs.getVideoTracks(),...dst.stream.getAudioTracks()]);}catch(e){R.errors.push('fake media: '+e);}
  P.fakeMedia=fake;
  const dir=R.info.selftest.replace(/[\\/][^\\/]*$/,''),wait=async(f,ms=15000)=>{const t0=Date.now();while(!f()){if(Date.now()-t0>ms)throw new Error('timeout');await new Promise(r=>setTimeout(r,100));}};
  const rep={role,steps:{},errors:R.errors};const step=async(n,f)=>{try{rep.steps[n]=await f();}catch(e){rep.steps[n]='FAIL: '+(e&&e.message||e);}await pause(2500);};
  if(role==='host'){
    await step('host',async()=>{await start();await inv('write_file',{root:dir,rel:'token.txt',content:P.token});if(slow)openPanel();return P.token.slice(0,12)+'…';});
    await step('guestJoined',async()=>{await wait(()=>live(),30000);return P.peerName;});
    if(slow){await pause(1500);closePanel();}
    await step('controlGiven',async()=>{await wait(()=>P.driver==='guest');return true;});
    await step('guestEditOnDisk',async()=>{await wait(()=>FS[ROOT+'main.rs']&&FS[ROOT+'main.rs'].content.includes('from guest'));R.flush();await R.idle();return(await inv('exec',{program:'cat',args:['main.rs'],cwd:R.root})).stdout.trim();});
    await step('guestCommandRan',async()=>{await wait(()=>Object.keys(R.disk).includes('shared.txt')||false,10000).catch(()=>{});return(await inv('exec',{program:'cat',args:['shared.txt'],cwd:R.root})).stdout.trim();});
    await step('hostEditReachesGuest',async()=>{takeBack();await new Promise(r=>setTimeout(r,300));writeFile(ROOT+'host-note.md','# from host\n');await new Promise(r=>setTimeout(r,4000));return true;});
    await step('video',()=>({rtc:!!window.RTCPeerConnection,media:!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia),state:P.rtc&&P.rtc.connectionState,mode:P.mode,framesIn:P.frames||0,audioIn:P.audioIn||0,audioOut:P.sentAudio||0,dbg:{local:P.local&&P.local.getTracks().map(t=>t.kind+':'+t.readyState+':'+t.enabled),cap:P.capAc&&P.capAc.state,vReady:P.relayV&&P.relayV.readyState,cam:P.cam,mic:P.mic,calls:P.calls},err:P.mediaErr}));
  }else{
    await step('join',async()=>{let tok='';const t0=Date.now();while(!tok&&Date.now()-t0<30000){const r=await inv('exec',{program:'cat',args:['token.txt'],cwd:dir});tok=r.code===0?r.stdout.trim():'';if(!tok)await new Promise(r=>setTimeout(r,300));}
      await join(tok);await wait(()=>live()&&FS[ROOT+'main.rs']);return{peer:P.peerName,files:Object.keys(FS).filter(k=>!k.includes('/learn/')).map(k=>k.slice(ROOT.length)),driver:P.driver};});
    await step('readOnlyWhileNavigating',async()=>{openPath(ROOT+'main.rs');await new Promise(r=>setTimeout(r,200));return $('#ed-ta').readOnly;});
    await step('followsHost',()=>tabOf(cur)&&tabOf(cur).path);
    await step('control',async()=>{requestControl();await wait(()=>amDriver());await new Promise(r=>setTimeout(r,200));return{driver:P.driver,editable:!$('#ed-ta').readOnly};});
    await step('edit',async()=>{if(slow){const base=FS[ROOT+'main.rs'].content,txt='// from guest: pairing with PairCode\n';for(let i=1;i<=txt.length;i+=2){FS[ROOT+'main.rs'].content=txt.slice(0,i)+base;refresh(false,true);await new Promise(r=>setTimeout(r,70));}}FS[ROOT+'main.rs'].content='// from guest\nfn main() {}\n'+(slow?'\n// navigator: add a test for main next\n':'');refresh(true);await new Promise(r=>setTimeout(r,600));return true;});
    await step('sharedTerminal',async()=>{window.run('echo shared-term > shared.txt && echo done-on-host');await wait(()=>[...document.querySelectorAll('#term .line')].some(d=>d.textContent.trim()==='done-on-host'));return true;});
    await step('hostEditArrives',async()=>{await wait(()=>FS[ROOT+'host-note.md']);return{content:FS[ROOT+'host-note.md'].content.trim(),driver:P.driver};});
    await step('video',()=>({rtc:!!window.RTCPeerConnection,media:!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia),state:P.rtc&&P.rtc.connectionState,mode:P.mode,framesIn:P.frames||0,audioIn:P.audioIn||0,audioOut:P.sentAudio||0,dbg:{local:P.local&&P.local.getTracks().map(t=>t.kind+':'+t.readyState+':'+t.enabled),cap:P.capAc&&P.capAc.state,vReady:P.relayV&&P.relayV.readyState,cam:P.cam,mic:P.mic,calls:P.calls},err:P.mediaErr,img:!!($('#pair-remote-img')&&$('#pair-remote-img').src)}));
    await step('leave',async()=>{await end();await new Promise(r=>setTimeout(r,300));return{restored:!R.remote,files:Object.keys(FS).length};});
  }
  await pause(3000);rep.errors=R.errors;await inv('selftest_report',{report:rep});})();
})();
