/* ═════════ PairCode — simulated peer for the browser build ═════════
   A page cannot open sockets to another machine, so in the browser PairCode talks to a scripted
   developer ("Ana") through the same messages the desktop app exchanges for real: hello, snapshot,
   files, view, control requests, shared terminal and relayed video frames. pair.js is unchanged. */
(()=>{
if(window.__TAURI__)return;
const L={},emit=(n,p)=>(L[n]||[]).forEach(f=>{try{f({payload:p});}catch(e){console.error(e);}});
const T={event:{listen:(n,f)=>{(L[n]=L[n]||[]).push(f);return Promise.resolve(()=>{});}}};
const R={user:'walter',errors:[],info:{},ready:true,root:null,git:false,name:null,remote:false};
const B={role:null,timers:[],files:{},driver:'host',peer:'Ana',typing:false,turn:0};
const later=(ms,f)=>{const t=setTimeout(f,ms);B.timers.push(t);return t;};
const every=(ms,f)=>{const t=setInterval(f,ms);B.timers.push(t);return t;};
const sleep=ms=>new Promise(r=>later(ms,r));
const out=o=>emit('pair-msg',JSON.stringify(o));
function clear(){B.timers.forEach(t=>{clearTimeout(t);clearInterval(t);});B.timers=[];B.typing=false;}

/* a small drawn webcam: face that blinks and talks while Ana types */
function avatar(c,name,bg,talk){const g=c.getContext('2d'),t=Date.now()/1000;const gr=g.createLinearGradient(0,0,0,240);gr.addColorStop(0,bg[0]);gr.addColorStop(1,bg[1]);g.fillStyle=gr;g.fillRect(0,0,320,240);
  g.fillStyle='rgba(255,255,255,.08)';g.fillRect(0,170,320,70);
  g.fillStyle='#3b2a24';g.beginPath();g.ellipse(160,112,60,68,0,0,7);g.fill();
  g.fillStyle='#c98e6b';g.beginPath();g.ellipse(160,122,46,54,0,0,7);g.fill();
  g.fillStyle='#2a3140';g.beginPath();g.ellipse(160,250,92,70,0,0,7);g.fill();
  const blink=(t%4)<0.12;g.fillStyle='#1c1c1c';[140,180].forEach(x=>{g.beginPath();g.ellipse(x,114,6,blink?1:6,0,0,7);g.fill();});
  const m=talk?3+Math.abs(Math.sin(t*9))*7:2;g.fillStyle='#7a3b33';g.beginPath();g.ellipse(160,146,12,m,0,0,7);g.fill();
  g.fillStyle='rgba(0,0,0,.45)';g.fillRect(8,8,g.measureText(name).width+18,24);g.fillStyle='#fff';g.font='14px sans-serif';g.fillText(name,17,25);}
function camera(){const c=document.createElement('canvas');c.width=320;c.height=240;every(140,()=>{avatar(c,B.peer+' · simulated',['#2d4a6b','#14202e'],B.typing);out({t:'vf',d:c.toDataURL('image/jpeg',0.6)});});}
let selfStream=null;
function media(){if(selfStream)return selfStream.clone();const c=document.createElement('canvas');c.width=320;c.height=240;const draw=()=>avatar(c,'you',['#6b4a2d','#2e2014'],false);draw();setInterval(draw,200);
  try{selfStream=c.captureStream(10);}catch(e){return null;}return selfStream.clone();}

/* the file Ana works in, and her typing — the same "files" and "view" messages a real peer sends */
function target(){const t=tabOf(cur);if(t&&t.path&&FS[t.path])return t.path;const ks=Object.keys(FS).filter(k=>k.startsWith(ROOT)&&!k.includes('/learn/'));return ks.find(k=>/\.(rs|go|ts|js|py)$/.test(k))||ks[0];}
async function typeLines(path,at,text){if(!path)return;B.typing=true;const base=(FS[path]?FS[path].content:'').split('\n');const lines=text.split('\n');let done=[];
  for(let li=0;li<lines.length;li++){for(let i=1;i<=lines[li].length;i+=2){if(!B.typing)return;const cur=done.concat([lines[li].slice(0,i)]);const l=base.slice();l.splice(at,0,...cur);
      out({t:'files',set:{[path]:l.join('\n')},del:[]});out({t:'view',who:B.role,path,top:Math.max(0,(at-6)*20),line:at+cur.length,col:i,tab:null,kind:'file'});await sleep(60);}
    done.push(lines[li]);}
  B.typing=false;}
function viewOf(path,line){out({t:'view',who:B.role,path,top:Math.max(0,(line-6)*20),line,col:0,tab:null,kind:'file'});}

/* we host, Ana joins as guest: she navigates, asks for control, types a little, hands control back */
function asGuest(){later(2200,()=>{emit('pair-status',{state:'connected',role:'host',peer:'192.168.1.31'});out({t:'hello',name:B.peer,rtc:false});camera();out({t:'av',mic:true,cam:true});
  later(6500,()=>out({t:'ctl-req',from:'guest',name:B.peer}));});}
async function guestDrives(){await sleep(900);const p=target();viewOf(p,1);await sleep(700);
  await typeLines(p,0,'// Ana: extract the parsing into its own function?\n// TODO(pair): cover the empty input case with a test');
  await sleep(800);out({t:'cmd',line:'git status --short'});await sleep(3500);out({t:'ctl',driver:'host'});}

/* Ana hosts, we join as guest: we see her workspace, follow her cursor and can ask for control */
function asHost(){later(700,()=>{emit('pair-status',{state:'connected',role:'guest',peer:'192.168.1.20'});out({t:'hello',name:B.peer,rtc:false});
  const files={},orig={};Object.keys(FS).forEach(k=>{if(k.startsWith(ROOT)&&!k.includes('/learn/')){files[k]=FS[k].content;if(FS[k].orig!==FS[k].content)orig[k]=FS[k].orig;}});
  const p=target();out({t:'snap',name:'ana-workspace',branch:'feature/pair-demo',files,orig,driver:'host',view:{path:p,top:0,line:1,col:0,kind:'file'}});
  camera();out({t:'av',mic:true,cam:true});later(2200,hostTypes);});}
async function hostTypes(){if(B.driver!=='host')return;const p=target();viewOf(p,1);await sleep(900);
  await typeLines(p,1,'    // Ana: I will add the validation here — follow along');
  if(B.driver==='host')later(6000,hostTypes2);}
async function hostTypes2(){if(B.driver!=='host')return;const p=target();await typeLines(p,2,'    // then we wire the error type; ask for control if you want to drive');}
function termOut(line){const o=[`$ ${line}`];
  if(/^cargo test/.test(line))o.push('   Compiling dxtutor v0.7.0','    Finished test profile in 2.41s','running 4 tests','test result: ok. 4 passed; 0 failed');
  else if(/^git status/.test(line))o.push(' M src/main.rs');else if(/^ls/.test(line))o.push('Cargo.toml  README.md  src');else o.push(`(ran on ${B.peer}'s machine)`);
  o.forEach((text,i)=>later(150*i,()=>out({t:'term',text,err:false})));}

function onSend(m){
  if(m.t==='ctl'){B.driver=m.driver;if(B.role==='guest'&&m.driver==='guest')guestDrives();if(B.role==='host'&&m.driver==='host')later(2500,hostTypes2);if(m.driver!==B.role)B.typing=false;}
  else if(m.t==='ctl-req'&&B.role==='host'){B.typing=false;later(1800,()=>{B.driver='guest';out({t:'ctl',driver:'guest'});});}
  else if(m.t==='cmd'&&B.role==='host'&&B.driver==='guest')termOut(m.line);
  else if(m.t==='ctl-deny'&&B.role==='guest'){later(9000,()=>out({t:'ctl-req',from:'guest',name:B.peer}));}}

async function inv(c,a){a=a||{};
  if(c==='pair_host'){clear();B.role='guest';B.driver='host';asGuest();return'dxp_'+btoa(JSON.stringify({v:1,host:a.name||'walter',addrs:['192.168.1.20','100.84.12.7','127.0.0.1'],port:47821,key:'browser-demo-'+Math.random().toString(36).slice(2,12)})).replace(/=+$/,'');}
  if(c==='pair_join'){if(!/^dxp_/.test(a.token||''))throw new Error('this is not a PairCode token (it starts with dxp_)');clear();B.role='host';B.driver='host';asHost();return B.peer;}
  if(c==='pair_send'){try{onSend(JSON.parse(a.msg));}catch(e){}return;}
  if(c==='pair_stop'){clear();B.role=null;emit('pair-status',{state:'idle'});return;}
  throw new Error(c+' is only available in the desktop app');}
window.__PAIRSIM__={T,inv,R,media};
})();
