/* O que o motor de tradução NÃO traduz (código, nomes de ficheiros, ids, saída de comandos, o editor…).
   Módulo puro à parte (ADR-0004, U6b) para o harness dos goldens o partilhar sem avaliar o motor. */
export const TR_SKIP = '.notr,#pc-output,.s-hit,#dk-containers,#dk-images,.kc-id,.gl-h,.tmux,#term .cmd,#term .pr,.ag-model,.ed,.diff,script,style,pre,code,#st-svg,.gl-msg,.gl-ref,.kc-t,.kc-b,.lt-file,.crumb';
