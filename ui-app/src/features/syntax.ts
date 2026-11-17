/* ═════════ dxtutor IDE — feature: realce de sintaxe ═════════
   Feature-folha da reestruturação por funcionalidade. Consome o `core` tipado
   por import real e detém o realce de uma linha (`hlLine`) que vivia no monólito
   `app.ts`. É quase-pura: só depende de `esc` (dono do core), por isso tipa-se a
   sério — SEM `@ts-nocheck`. O regex de palavras-chave (`KW`) é módulo-local;
   ninguém fora daqui o usa.

   Shim transitório: publica `hlLine` no `window` porque o residual invoca-o por
   nome livre — o editor (`paintEd`), a vista de diff, o `cat` do terminal e o
   outline em `app.ts`, mais `v5.ts`/`v6.ts`, resolvem-no como global. GOTCHA C:
   mover a def REMOVE a def de topo do monólito, por isso a entrada `hlLine` saiu
   também do `Object.assign(window,…)` do `app.ts` (senão ReferenceError travava
   o chunk). */

import { esc } from "../core";

/** Palavras-chave (Rust/TS/SQL) realçadas como `kw`; usado só por `hlLine`. */
const KW =
  /^(?:pub|fn|let|mut|for|in|if|else|while|loop|match|return|use|mod|impl|trait|struct|enum|type|const|static|self|Self|crate|async|await|export|import|from|function|class|interface|extends|new|var|void|null|true|false|as|CREATE|TABLE|INDEX|ON|NOT|NULL|PRIMARY|KEY|REFERENCES|DELETE|CASCADE|SELECT|FROM|WHERE|ORDER|BY|DESC|ASC|LIMIT|INSERT|INTO|VALUES|TEXT|INTEGER|UNIQUE|DEFAULT|AND|OR)$/;

/** Realça uma linha `s` da linguagem `ext`, devolvendo HTML com spans de classe. */
function hlLine(s: string, ext: string): string {
  if (ext === "md") {
    if (/^#/.test(s)) return `<span class="kw">${esc(s)}</span>`;
    return esc(s)
      .replace(/`[^`]+`/g, (m) => `<span class="str">${m}</span>`)
      .replace(/\*\*[^*]+\*\*/g, (m) => `<span class="ty">${m}</span>`);
  }
  const re =
    /(\/\/.*$|--\s.*$|\/\*.*?\*\/|#\s.*$|<!--.*?-->)|("(?:\\.|[^"\\])*"|`[^`]*`)|(\b\d[\d_.]*\b|#[0-9a-fA-F]{3,8}\b)|([A-Za-z_]\w*!)|([A-Za-z_]\w*)(?=\()|([A-Za-z_][\w-]*)/g;
  let out = "",
    i = 0,
    m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    out += esc(s.slice(i, m.index));
    const x = esc(m[0]);
    if (m[1]) out += `<span class="cm">${x}</span>`;
    else if (m[2]) out += `<span class="str">${x}</span>`;
    else if (m[3]) out += `<span class="num">${x}</span>`;
    else if (m[4]) out += `<span class="mac">${x}</span>`;
    else if (m[5]) out += `<span class="${KW.test(m[5]) ? "kw" : "fn"}">${x}</span>`;
    else
      out += KW.test(m[6])
        ? `<span class="kw">${x}</span>`
        : /^[A-Z][a-z]/.test(m[6])
          ? `<span class="ty">${x}</span>`
          : x;
    i = m.index + m[0].length;
  }
  return out + esc(s.slice(i));
}

/* ── publicação transitória no window (shim para o residual) ──
   paintEd/diff/cat/outline (app.ts) e v5.ts/v6.ts resolvem hlLine por nome livre. */
window.hlLine = hlLine;
