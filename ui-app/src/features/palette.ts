/* ═════════ dxtutor IDE — feature: Paleta de comandos / Quick Open ═════════
   Feature-folha da reestruturação POR FUNCIONALIDADE. Detém o overlay da paleta
   (Ctrl+P ficheiros · `>` comandos · `:` linha) e o prompt de texto reutilizável
   (novo ficheiro/pasta via `PAL_TEXT`). Migrada de app.ts.

   Estado com dono aqui (ADR-0004, U7j/U7o — era window-backed): a configuração aberta (`PAL`), os itens
   (`PITEMS`, lidos pelo arranque por import), o item seleccionado (`palState.idx`, que o keydown do arranque move
   com as setas) e o último «text» de uma paleta de pergunta (`PAL_TEXT`).

   Do core importa-se o que já é tipado (`$`, `esc`). O restante núcleo dono do
   monólito resolve-se por nome livre via window em runtime — as funções da paleta
   só correm DEPOIS do arranque (cliques/teclas): CMD, FS, short, fIcon, gotoLine,
   openPath, closeMenus — globais dinâmicos do monólito, resolvidos por window em runtime
   (declarados no contrato ambiente de pair.ts; ficheiro já tipado, sem supressão de tipos). */
import { $, esc } from "../core";
import { translator } from "../app/i18n";
import { PALETTE_MESSAGES } from "./palette.messages";
import { services } from "../app/services";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(PALETTE_MESSAGES);

/* ───── estado (window-backed; o resíduo boot/keydown de app.ts lê por window.*) ───── */
/* o estado da paleta, com dono aqui (ADR-0004, U7o — era PAL/PIDX/PAL_TEXT): a configuração aberta, o item
   seleccionado (o arranque move-o com as setas — `palState.idx`) e o último «text» de uma paleta de pergunta */
let PAL: PalCfg | null = null;
export const palState = { idx: 0 };
/* os itens da paleta: com dono aqui; o arranque lê-os por import (ligação viva — U7j, era PITEMS) */
export let PITEMS: any[] = [];
let PAL_TEXT: (q: string) => void = () => {};

interface PalCfg { ph?: string; verb?: string; items?: { l: string }[]; text?: (q: string) => void }
function palette(pre: string, cfg?: PalCfg){services.menus!.closeMenus();PAL=cfg||null;const inp=$('#pal-in') as HTMLInputElement|null;$('#pal')!.classList.add('show');if(inp){inp.value=pre||'';inp.placeholder=cfg?(cfg.ph||''):'Nome do ficheiro  ·  > comandos  ·  : linha';}palState.idx=0;palDraw();setTimeout(()=>inp&&inp.focus(),0);}
export function closePal(){$('#pal')!.classList.remove('show');PAL=null;}
function fuzzy(q: string,s: string){q=q.toLowerCase();s=s.toLowerCase();let i=0;for(const c of s){if(c===q[i])i++;if(i===q.length)return true;}return!q.length;}
export function palDraw(){const q=($('#pal-in') as HTMLInputElement|null)?.value||'';
  if(PAL){PITEMS=PAL.items?PAL.items.filter((i: {l: string})=>fuzzy(q,i.l)):[{l:`${PAL.verb||'Confirmar'}: ${q||'…'}`,run:()=>PAL_TEXT(q)}];}
  else if(q.startsWith('>')){const f=q.slice(1).trim();PITEMS=CMD.filter(c=>fuzzy(f,c[0])).map(c=>({l:c[0],k:c[1],run:c[2]}));}
  else if(q.startsWith(':')){const n=parseInt(q.slice(1))||1;PITEMS=[{l:'Ir para a linha '+n,run:()=>gotoLine(n)}];}
  else PITEMS=Object.keys(FS).filter(p=>fuzzy(q,short(p))).sort((a,b)=>(a.split('/').pop()||'').localeCompare(b.split('/').pop()||'')).map(p=>({l:p.split('/').pop(),d:short(p),ic:fIcon(p),run:()=>openPath(p)}));
  palState.idx=Math.min(palState.idx,Math.max(0,PITEMS.length-1));
  $('#pal-list')!.innerHTML=PITEMS.length?PITEMS.map((it,i)=>`<div class="pi${i===palState.idx?' on':''}" data-i="${i}">${it.ic||''}<span>${esc(it.l)}</span>${it.d?`<span class="d">${esc(it.d)}</span>`:''}${it.k?`<span class="key">${it.k}</span>`:''}</div>`).join(''):`<div class="pal-empty">${txt("noResults")}</div>`;
  const on=$('#pal-list .on');if(on&&on.scrollIntoView)on.scrollIntoView({block:'nearest'});}
export function palRun(i: number){const it=PITEMS[i];if(!it)return;if(PAL&&PAL.text)PAL_TEXT=PAL.text;closePal();it.run();}

/* ── publicação no window ──
   palette/closePal/palDraw/palRun são chamados por nome livre de muitos pontos
   (CMD, menus, newFile/newFolder, onclicks inline) e pelo resíduo boot/keydown
   de app.ts (via window.*); fuzzy é um matcher puro partilhado. */
Object.assign(window, { palette,});
