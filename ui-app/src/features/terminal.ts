/* ═════════ dxtutor IDE — feature: terminal (prompt + input loop glue + registo XC) ═════════
   Feature-folha que passou a DONA do terminal: prompt, ciclo de input e o registo BASE
   de comandos `XC` (help/cat/git/dx). Padrão strangler-fig (como scm.ts/ext.ts):
   a feature avalia ANTES de app.ts e publica `window.XC` COMPLETO, para que os decoradores
   que ficam em app.ts (`XC.git=…`, `const _dx=XC.dx;XC.dx=…`, `XC.docker=…`, `XC.make=…`,
   `const _dx4=…`) e em v5.ts (`const _dx5=XC.dx;…`) resolvam `XC` como `window.XC` e
   sobreponham/encadeiem o base SEM qualquer edição aos decoradores.

   Primitivos do ciclo de input (echo/echoCmd/onKey/scrollTerm/termClear) vivem em boot.ts
   e publicam-se no window — ficam lá. Estado/fachadas do monólito (CWD/USER/HOST/BRANCH/
   esc/changes/STAGED/stOf/short/commitGit/COMMITS/BRANCHES/diffStat/FS/
   extOf/hlLine/MODES/MODE/PROV/ACTIVE/CKPT/setMode/$) resolvem por window
   em tempo de chamada (pós-startup). @ts-nocheck como as outras features-motor densas. */

import { esc } from "../core";
import { desktopPorts } from "../app/desktop"; // marca o ficheiro como MÓDULO (não script) — mantém newInput/termRefreshPrompt com
           // escopo de módulo, sem colidir com os `declare global { var … }` de bridge.ts/pair.ts.

/* ADR-0004, U4h3: o prompt e o termExec PUBLICADOS consultam a porta desktop (`desktopPorts.terminal`,
   injectada por platform/desktop/terminal.ts na app Tauri: pasta aberta → shell e prompt reais);
   antes o desktop reatribuía-os no `window`. O pair.ts continua a decorar `promptHTML`/`run` por
   cima, como antes decorava as versões do desktop. */
function promptBase(): string {return `<span class="pr"><span>${USER}</span><span class="at">@</span><span>${HOST}</span><span class="at">:</span><span class="pth">${CWD.join('/')}</span><span class="br"> (${esc(BRANCH)})</span><span class="at">$</span></span> `;}
window.promptHTML = function(){const d=desktopPorts.terminal;return d?d.promptHTML(promptBase):promptBase();};
function newInput(nofocus?:boolean){const t=$('#term'),old=$('#inputwrap');if(old)old.remove();const w=document.createElement('div');w.id='inputwrap';w.className='line inputline';w.innerHTML=promptHTML()+'<input id="cmd" autocomplete="off" spellcheck="false"/>';if(!t)return;t.appendChild(w);const c=$('#cmd');if(c){c.onkeydown=onKey;if(!nofocus)c.focus({preventScroll:true});}scrollTerm();}
function termRefreshPrompt(){const c=$('#cmd') as HTMLInputElement|null,v=c?c.value:'';newInput(true);const n=$('#cmd') as HTMLInputElement|null;if(n)n.value=v;}
function termExecBase(v: string): unknown {echoCmd(v);const[cmd,...a]=v.trim().split(/\s+/);let r=null;if((XC as any)[cmd])r=(XC as any)[cmd](a,v);else echo('<span class="er">'+esc(cmd)+': comando não encontrado</span> <span class="dim">— este terminal emulado só navega nos ficheiros e no git; o terminal real está na app desktop</span>');newInput(true);return r;}
window.termExec = function(v){const d=desktopPorts.terminal;return d?d.termExec(v,termExecBase):termExecBase(v);};
const XC={
  help(){echo(`<span class="ac">ficheiros</span>  <span class="ok">ls</span> <span class="ok">cd</span> <span class="ok">pwd</span> <span class="ok">cat</span> <span class="ok">tree</span>\n<span class="ac">git</span>        <span class="ok">git</span> status | add . | commit -m "msg" | log | branch | checkout &lt;ramo&gt; | diff\n<span class="ac">co-dev</span>     <span class="ok">dx</span> status | modo manual|assist|auto\n<span class="ac">outros</span>     <span class="ok">echo</span> <span class="ok">whoami</span> <span class="ok">date</span> <span class="ok">history</span> <span class="ok">clear</span>`);},
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
    else echo('<span class="dim">git: status | add . | commit -m | log | branch | checkout | diff</span>');},
  dx(a:string[]){const s=a[0];
    if(s==='status'){echo(`modo <span class="ac">${MODES[MODE].l}</span> · modelo <span class="ac">${PROV[ACTIVE].name}</span> · checkpoints ${CKPT.length}`);return;}
    if(s==='modo'&&MODES[a[1]]){setMode(a[1]);echo('modo: '+MODES[a[1]].l);return;}
    echo('<span class="dim">dx: status | modo manual|assist|auto</span>');},
};

Object.assign(window, { XC, newInput, termRefreshPrompt });

/* ═════════ U4e (ADR-0004): o terminal emulado de base (era do boot.ts) ═════════
   Os primitivos do ciclo de input (`echo`/`echoCmd`/`scrollTerm`/`termClear`/`termNew`/
   `onKey`/`complete`), a navegação na árvore (`dirAt`/`curDir`) e o interpretador de base
   `run` (com os comandos `ls`/`cd`/`pwd`/`cat`/`tree`/… e o registo `XC`
   acima por cima). O histórico (`HIST`/`hidx`) passou a estado deste módulo.
   O `run` e o `promptHTML` publicados consultam a porta desktop (U4h3) e são decorados depois
   pelo pair.ts (PairCode): por isso o Enter chama `G.run` e o prompt `G.promptHTML` em
   runtime — a versão decorada, como antes. O resto chama-se directamente. */

interface TreeEntry {
  dir?: number;
  t?: string;
  children?: Record<string, TreeEntry>;
}
interface TerminalGlobals {
  CWD: string[];
  USER: string;
  HOST: string;
  TREE: { projects: TreeEntry };
  XC: Record<string, (a: string[], v: string) => unknown>;
  run: (raw: string) => void;
  promptHTML: () => string;
  setPanelTab: (pt: string, nofocus?: boolean) => void;
  termExec: (v: string) => unknown;
}
const TG = window as unknown as TerminalGlobals;

/* identidade neutra do terminal emulado do browser; no desktop o bridge põe o utilizador e a
   máquina reais (ADR-0005, R1c1 — era «walter@delonix») */
TG.USER = "user";
TG.HOST = "browser";

/** O histórico de comandos do terminal emulado (↑/↓). */
const HIST: string[] = [];
let hidx = 0;

function termNew(): void {
  termClear();
}

function termClear(): void {
  const t = $("#term") as HTMLElement;
  t.innerHTML = "";
  echo(`<span class="ac">terminal emulado</span> <span class="dim">· só os ficheiros e o git deste workspace · o terminal real está na app desktop · </span><span class="ok">help</span>`);
  newInput();
}

function echo(h: string): void {
  const t = $("#term") as HTMLElement;
  const d = document.createElement("div");
  d.className = "line";
  d.innerHTML = h;
  t.appendChild(d);
  scrollTerm();
}

function scrollTerm(): void {
  const p = $("#pc-terminal") as HTMLElement;
  p.scrollTop = p.scrollHeight;
}

function onKey(e: KeyboardEvent): void {
  const c = e.target as HTMLInputElement;
  if (e.key === "Enter") {
    const v = c.value;
    TG.run(v);
    if (v.trim()) HIST.push(v);
    hidx = HIST.length;
  } else if (e.key === "ArrowUp") {
    if (hidx > 0) {
      hidx--;
      c.value = HIST[hidx] || "";
    }
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    if (hidx < HIST.length - 1) {
      hidx++;
      c.value = HIST[hidx] || "";
    } else {
      hidx = HIST.length;
      c.value = "";
    }
    e.preventDefault();
  } else if (e.key === "Tab") {
    e.preventDefault();
    complete(c);
  } else if (e.ctrlKey && e.key === "l") {
    e.preventDefault();
    termClear();
  }
}

function dirAt(parts: string[]): TreeEntry | null {
  let n: TreeEntry = TG.TREE.projects;
  for (const p of parts) {
    if (!n.children || !n.children[p]) return null;
    n = n.children[p];
  }
  return n;
}

function curDir(): TreeEntry | null {
  return dirAt(TG.CWD.slice(4));
}

function complete(c: HTMLInputElement): void {
  const parts = c.value.split(" "),
    frag = parts[parts.length - 1],
    d = curDir();
  if (!d || !d.children) return;
  const m = Object.keys(d.children).filter((x) => x.startsWith(frag));
  if (m.length === 1) {
    parts[parts.length - 1] = m[0];
    c.value = parts.join(" ");
  } else if (m.length > 1) {
    echoCmd(c.value);
    echo('<span class="dim">' + m.join("   ") + "</span>");
    newInput();
    ($("#cmd") as HTMLInputElement).value = c.value;
  }
}

function echoCmd(v: string): void {
  const w = $("#inputwrap");
  if (w) w.remove();
  echo(TG.promptHTML() + '<span class="cmd">' + (v || "").replace(/</g, "&lt;") + "</span>");
}

/** O interpretador de base do terminal emulado: o registo `XC` primeiro, depois estes. */
function run(raw: string): void {
  echoCmd(raw);
  const v = raw.trim();
  if (!v) {
    newInput();
    return;
  }
  const [cmd, ...a] = v.split(/\s+/);
  const C: Record<string, () => unknown> = {
    help() {
      echo(`<span class="ac">comandos:</span>\n<span class="ok">ls</span> [dir]   <span class="ok">cd</span> &lt;dir&gt;   <span class="ok">pwd</span>   <span class="ok">cat</span> &lt;f&gt;   <span class="ok">tree</span>\n<span class="ok">echo</span> <span class="ok">whoami</span> <span class="ok">date</span> <span class="ok">history</span> <span class="ok">clear</span>`);
    },
    ls() {
      const d = a[0] ? dirAt(TG.CWD.slice(4).concat(a[0].split("/").filter(Boolean))) : curDir();
      if (!d || !d.children) {
        echo('<span class="er">ls: ' + (a[0] || ".") + ": não encontrado</span>");
        return;
      }
      const kids = d.children;
      echo(
        Object.keys(kids)
          .map((n) => (kids[n].dir ? `<span class="dir">${n}/</span>` : `<span class="${kids[n].t === "rust" ? "ac" : ""}">${n}</span>`))
          .join("   ") || '<span class="dim">(vazio)</span>',
      );
    },
    pwd() {
      echo("/home/" + TG.USER + "/" + TG.CWD.slice(1).join("/"));
    },
    cd() {
      const x = a[0] || "~";
      if (x === "~" || x === "/") {
        TG.CWD = ["~", "dxtutor", "workspace", "projects"];
        return;
      }
      if (x === "..") {
        if (TG.CWD.length > 4) TG.CWD.pop();
        return;
      }
      const t = TG.CWD.slice();
      for (const p of x.split("/").filter(Boolean)) {
        if (p === "..") {
          if (t.length > 4) t.pop();
          continue;
        }
        const nd = dirAt(t.slice(4).concat(p));
        if (!nd || !nd.dir) {
          echo('<span class="er">cd: ' + x + ": não é um directório</span>");
          return;
        }
        t.push(p);
      }
      TG.CWD = t;
    },
    tree() {
      echo('<span class="dir">' + TG.CWD[TG.CWD.length - 1] + "/</span>");
      const d = curDir();
      if (d && d.children) {
        const kids = d.children;
        const ks = Object.keys(kids);
        ks.forEach((k, i) => echo('<span class="dim">' + (i === ks.length - 1 ? "└─ " : "├─ ") + "</span>" + (kids[k].dir ? '<span class="dir">' + k + "/</span>" : k)));
      }
    },
    echo() {
      echo(a.join(" ").replace(/</g, "&lt;"));
    },
    whoami() {
      echo(TG.USER);
    },
    date() {
      echo(new Date().toString());
    },
    history() {
      HIST.forEach((h, i) => echo('<span class="dim">' + String(i + 1).padStart(4) + "</span>  " + h.replace(/</g, "&lt;")));
    },
    clear() {
      termClear();
      return "skip";
    },
  };
  let r: unknown;
  if (TG.XC[cmd]) r = TG.XC[cmd](a, v);
  else if (C[cmd]) r = C[cmd]();
  else echo('<span class="er">' + cmd + ': comando não encontrado</span> <span class="dim">(help)</span>');
  if (r !== "skip" && r !== "async") newInput();
}

/** A parte desktop do terminal (ADR-0004, U4h3), injectada pela app Tauri em
 *  `desktopPorts.terminal`: com uma pasta aberta, o input, os comandos das features e o prompt
 *  passam a um shell real. Cada operação recebe a versão emulada (`virtual`), em que o
 *  adaptador delega sem pasta. */
export interface TerminalDesktop {
  run(raw: string | undefined, virtual: (raw?: string) => unknown): unknown;
  termExec(v: string, virtual: (v: string) => unknown): unknown;
  promptHTML(virtual: () => string): string;
}
/* o `run` publicado consulta a porta (o desktop passava `raw` tal-e-qual, undefined incluído) */
const runVirtual = run as (raw?: string) => unknown;
const runPublished = (raw?: string): unknown => { const d = desktopPorts.terminal; return d ? d.run(raw, runVirtual) : runVirtual(raw); };

/** Corre um comando no terminal (mostra-o): era o `runTask` do app.ts (ADR-0004, U4j3). Chama o
 *  `termExec` PUBLICADO, que consulta a porta desktop (tarefa num PTY na app). */
function runTask(c: string): unknown { TG.setPanelTab('terminal'); return TG.termExec(c); }

Object.assign(window, { termNew, termClear, echo, scrollTerm, onKey, dirAt, curDir, complete, echoCmd, run: runPublished, runTask });
