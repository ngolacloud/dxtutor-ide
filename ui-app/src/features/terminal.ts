/* ═════════ dxtutor IDE — feature: terminal (prompt + input loop glue + registo XC) ═════════
   Feature-folha que passou a DONA do terminal: prompt, ciclo de input e o registo BASE
   de comandos `XC` (help/cat/git/cargo/npm/dx). Padrão strangler-fig (como scm.ts/ext.ts):
   a feature avalia ANTES de app.ts e publica `window.XC` COMPLETO, para que os decoradores
   que ficam em app.ts (`XC.git=…`, `const _dx=XC.dx;XC.dx=…`, `XC.docker=…`, `XC.make=…`,
   `const _dx4=…`) e em v5.ts (`const _dx5=XC.dx;…`) resolvam `XC` como `window.XC` e
   sobreponham/encadeiem o base SEM qualquer edição aos decoradores.

   Primitivos do ciclo de input (echo/echoCmd/onKey/scrollTerm/termClear) vivem em boot.ts
   e publicam-se no window — ficam lá. Estado/fachadas do monólito (CWD/USER/HOST/BRANCH/
   esc/changes/STAGED/stOf/short/commitGit/COMMITS/BRANCHES/runTests/dsLint/diffStat/FS/
   extOf/hlLine/MODES/MODE/PROV/ACTIVE/MISSIONS/CKPT/setMode/demo/$) resolvem por window
   em tempo de chamada (pós-startup). @ts-nocheck como as outras features-motor densas. */

import { esc } from "../core"; // marca o ficheiro como MÓDULO (não script) — mantém newInput/termRefreshPrompt com
           // escopo de módulo, sem colidir com os `declare global { var … }` de bridge.ts/pair.ts.

window.promptHTML = function(){return `<span class="pr"><span>${USER}</span><span class="at">@</span><span>${HOST}</span><span class="at">:</span><span class="pth">${CWD.join('/')}</span><span class="br"> (${esc(BRANCH)})</span><span class="at">$</span></span> `;}
function newInput(nofocus?:boolean){const t=$('#term'),old=$('#inputwrap');if(old)old.remove();const w=document.createElement('div');w.id='inputwrap';w.className='line inputline';w.innerHTML=promptHTML()+'<input id="cmd" autocomplete="off" spellcheck="false"/>';if(!t)return;t.appendChild(w);const c=$('#cmd');if(c){c.onkeydown=onKey;if(!nofocus)c.focus({preventScroll:true});}scrollTerm();}
function termRefreshPrompt(){const c=$('#cmd') as HTMLInputElement|null,v=c?c.value:'';newInput(true);const n=$('#cmd') as HTMLInputElement|null;if(n)n.value=v;}
window.termExec = function(v){echoCmd(v);const[cmd,...a]=v.trim().split(/\s+/);let r=null;if((XC as any)[cmd])r=(XC as any)[cmd](a,v);else echo('<span class="er">'+esc(cmd)+': comando não encontrado</span>');newInput(true);return r;}
const XC={
  help(){echo(`<span class="ac">ficheiros</span>  <span class="ok">ls</span> <span class="ok">cd</span> <span class="ok">pwd</span> <span class="ok">cat</span> <span class="ok">tree</span>\n<span class="ac">git</span>        <span class="ok">git</span> status | add . | commit -m "msg" | log | branch | checkout &lt;ramo&gt; | diff | push\n<span class="ac">build</span>      <span class="ok">cargo</span> build | test [-p lexer|store] | run     <span class="ok">npm</span> run dev\n<span class="ac">co-dev</span>     <span class="ok">dx</span> lint | status | modo manual|assist|auto | missao a|b\n<span class="ac">outros</span>     <span class="ok">echo</span> <span class="ok">whoami</span> <span class="ok">date</span> <span class="ok">neofetch</span> <span class="ok">history</span> <span class="ok">clear</span>`);},
  cat(a:string[]){if(!a[0]){echo('<span class="er">cat: falta o ficheiro</span>');return;}const rel=CWD.slice(4).concat(a[0].split('/')).join('/');const p=FS[rel]?rel:Object.keys(FS).find(k=>k.endsWith('/'+a[0].split('/').pop()));if(!p){echo('<span class="er">cat: '+esc(a[0])+': não encontrado</span>');return;}echo(FS[p].content.split('\n').map(l=>hlLine(l,extOf(p))).join('\n'));},
  git(a:string[],raw:string){const s=a[0],ch=changes();
    if(s==='status'){if(!ch.length){echo(`No ramo <span class="ac">${esc(BRANCH)}</span>\nnada para commitar, área de trabalho limpa`);return{ok:true};}
      echo(`No ramo <span class="ac">${esc(BRANCH)}</span>`+(STAGED.size?`\n<span class="dim">Staged:</span>\n`+[...STAGED].map(p=>`  <span class="ok">${stOf(p)==='U'?'new file:':'modified:'}   ${short(p)}</span>`).join('\n'):'')+`\n<span class="dim">Alterações:</span>\n`+ch.filter(p=>!STAGED.has(p)).map(p=>stOf(p)==='U'?`  <span class="er">untracked:  ${short(p)}</span>`:`  <span class="warn">modified:</span>   ${short(p)}`).join('\n'));}
    else if(s==='add'){ch.forEach(p=>STAGED.add(p));refresh();echo(`<span class="dim">${ch.length} ficheiro(s) em stage</span>`);}
    else if(s==='commit'){const m=(raw.match(/-m\s+(["'])(.*?)\1/)||raw.match(/-m\s+(.+)$/)||[]);const msg=(m[2]||m[1]||'').trim();if(!msg){echo('<span class="er">uso: git commit -m "mensagem"</span>');return;}const c=commitGit(msg);echo(c?`[${esc(BRANCH)} <span class="ac">${c.h}</span>] ${esc(msg)}\n <span class="dim">${c.n} ficheiro(s) alterado(s)</span>`:'<span class="dim">nada para commitar</span>');return{ok:!!c};}
    else if(s==='log')echo(COMMITS.map(c=>`<span class="ac">${c.h}</span> ${esc(c.m)}`).join('\n'));
    else if(s==='branch')echo(BRANCHES.map(b=>b===BRANCH?`<span class="ok">* ${b}</span>`:'  '+b).join('\n'));
    else if(s==='checkout'){if(BRANCHES.includes(a[1])){BRANCH=a[1];const bl=$('#st-branch-l');if(bl)bl.textContent=BRANCH;refresh();echo(`Mudou para o ramo '${esc(BRANCH)}'`);}else echo('<span class="er">ramo desconhecido: '+esc(a[1]||'')+'</span>');}
    else if(s==='diff')echo(ch.map(p=>{const d=diffStat(FS[p].orig,FS[p].content);return ` ${short(p)} | <span class="ok">+${d.add}</span> <span class="er">-${d.del}</span>`;}).join('\n')||'<span class="dim">sem diferenças</span>');
    else if(s==='push'){echo(`<span class="dim">A enviar para origin/${esc(BRANCH)}…</span>\n<span class="ok">push simulado ✓</span> <span class="dim">(o protótipo não tem remoto)</span>`);return{ok:true};}
    else echo('<span class="dim">git: status | add . | commit -m | log | branch | checkout | diff | push</span>');},
  cargo(a:string[]){const s=a[0],pk=a[1]==='-p'?a[2]:undefined,r=runTests(pk);
    if(s==='build'||s==='run'||s==='clippy'){if(!runTests().build){echo(`<span class="dim">   Compiling lexer v0.1.0</span>\n<span class="er">${esc(runTests().err)}</span>\n<span class="er">error: could not compile \`lexer\`</span>`);return{ok:false,sum:'build falhou (E0382)'};}
      echo(`<span class="dim">   Compiling dxtutor v0.2.0</span>\n<span class="ok">    Finished</span> dev [unoptimized] in 0.81s`+(s==='run'?'\n<span class="dim">     Running</span> target/debug/dxtutor\ndxtutor a escutar em 127.0.0.1:1420':''));return{ok:true,sum:'build ok'};}
    if(s==='test'){if(!r.build){echo(`<span class="dim">   Compiling lexer v0.1.0</span>\n<span class="er">${esc(r.err)}</span>\n<span class="er">error: could not compile \`lexer\`</span>`);return{ok:false,sum:'build falhou (E0382)'};}
      const f=r.tests.filter(t=>!t.ok).length;echo(`<span class="dim">   Compiling … Finished test in 1.2s\nrunning ${r.tests.length} tests</span>\n`+r.tests.map(t=>`test ${t.n} ... ${t.ok?'<span class="ok">ok</span>':'<span class="er">FAILED</span>'}`).join('\n')+`\n\ntest result: ${f?'<span class="er">FAILED</span>':'<span class="ok">ok</span>'}. ${r.tests.length-f} passed; ${f} failed`);
      return{ok:!f,sum:`${r.tests.length-f} passados · ${f} falhados`};}
    echo('<span class="dim">cargo: build | test [-p pkg] | run</span>');},
  npm(a:string[]){if(a[0]==='run'&&a[1]==='dev'){echo(`<span class="ok">VITE</span> pronto em 312 ms\n  ➜  Local: <span class="ac">http://localhost:1420/</span>`);return{ok:true,sum:'vite a correr'};}if(a[0]==='run'&&a[1]==='lint')return XC.dx(['lint']);echo('<span class="dim">npm: run dev | run lint</span>');},
  dx(a:string[]){const s=a[0];
    if(s==='lint'){const v=dsLint();echo(v.length?v.map(x=>`<span class="warn">aviso</span> ${short(x.p)}:${x.line}  cor fixa <span class="er">${x.hex}</span> — usar token`).join('\n')+`\n<span class="er">✖ ${v.length} violação(ões) do Design System</span>`:'<span class="ok">✓ Design System: 0 violações</span>');return{ok:!v.length,sum:v.length?v.length+' violação(ões)':'0 violações'};}
    if(s==='status'){echo(`modo <span class="ac">${MODES[MODE].l}</span> · modelo <span class="ac">${PROV[ACTIVE].name}</span> · missões ${MISSIONS.length} · checkpoints ${CKPT.length}`);return;}
    if(s==='modo'&&MODES[a[1]]){setMode(a[1]);echo('modo: '+MODES[a[1]].l);return;}
    if(s==='missao'&&(a[1]==='a'||a[1]==='b')){demo(a[1]);echo('<span class="dim">missão entregue ao Co-Dev →</span>');return;}
    echo('<span class="dim">dx: lint | status | modo manual|assist|auto | missao a|b</span>');},
};

Object.assign(window, { XC, newInput, termRefreshPrompt });
