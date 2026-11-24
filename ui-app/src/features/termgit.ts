/* ═════════ dxtutor IDE — feature: terminal (comando `git`) ═════════
   Feature-folha que fica DONA do handler `git` do terminal (sub-comandos status/add/
   commit/log/branch/checkout/merge/flow/diff/push), extraído do monólito `app.ts`
   (era `XC.git`). `XC` nasce em `features/terminal.ts` (window.XC, registo base
   help/cat/git/cargo/npm/dx); o decorador que ficava em `app.ts` fica SHIM:
   `XC.git=(a,raw)=>window.gitCmd(a,raw)` — lazy, por isso não importa que `window.XC`
   ainda não exista quando este módulo avalia.

   Fronteira: o MOTOR git (`GIT`/`BRANCH`/`changes`/`stOf`/`short`/`STAGED`/`commitGit`/
   `graphLayout`/`checkout`/`gitMerge`/`gfStart`/`gfFinish`/`diffStat`/`FS`/`refresh`/
   `rerender`/`echo`) continua dono de `features/scm.ts` (+ resíduo do monólito) e é lido
   por nome livre (ambiente, declarado em bridge.ts/pair.ts) — tal como `features/graph.ts`
   lê `graphLayout`/`GIT`/`BRANCH`. Nada é lido ansiosamente: só dentro de `gitCmd`,
   chamada a partir do loop do terminal depois do arranque. Do core importa-se só o que é
   dono de lá (`esc`). */

import { esc } from "../core";
/* Há um repositório git aberto? O acessor do scm (no desktop, DXR.git; no browser nunca —
   ADR-0006, R1d), importado em vez de publicado no window. */
import { repo as repoOpen } from "./scm/infrastructure/legacy-bridge";

function gitCmd(a: string[], raw: string): { ok: boolean } | undefined {
  if (!repoOpen()) {
    echo('<span class="er">fatal: not a git repository</span>\n<span class="dim">o terminal emulado só conhece o git de uma pasta aberta na app desktop</span>');
    return { ok: false };
  }
  const s = a[0],
    ch = changes();
  if (s === "status") {
    echo(
      `No ramo <span class="ac">${esc(BRANCH)}</span>\n` +
        (ch.length
          ? ch
              .map((p) =>
                stOf(p) === "U"
                  ? `  <span class="er">untracked:  ${short(p)}</span>`
                  : `  <span class="warn">modified:</span>   ${short(p)}`,
              )
              .join("\n")
          : "nada para commitar, área de trabalho limpa"),
    );
    return { ok: true };
  }
  if (s === "add") {
    ch.forEach((p) => STAGED.add(p));
    refresh();
    echo(`<span class="dim">${ch.length} ficheiro(s) em stage</span>`);
    return;
  }
  if (s === "commit") {
    const m = raw.match(/-m\s+(["'])(.*?)\1/) || raw.match(/-m\s+(.+)$/) || [];
    const msg = (m[2] || m[1] || "").trim();
    if (!msg) {
      echo('<span class="er">uso: git commit -m "mensagem"</span>');
      return;
    }
    const c = commitGit(msg);
    echo(c ? `[${esc(BRANCH)} <span class="ac">${c.h}</span>] ${esc(msg)}` : '<span class="dim">nada para commitar</span>');
    return { ok: !!c };
  }
  if (s === "log") {
    const L = graphLayout();
    echo(
      L.rows
        .slice(0, 14)
        .map((r) => {
          const c = GIT.c[r.h],
            rf = Object.keys(GIT.refs).filter((b) => GIT.refs[b] === r.h);
          return `<span class="dim">${"│ ".repeat(r.col)}${c.p.length > 1 ? "◆" : "●"}</span> <span class="ac">${r.h}</span>${rf.length ? ` <span class="ok">(${rf.join(", ")})</span>` : ""} ${esc(c.m)}`;
        })
        .join("\n"),
    );
    return;
  }
  if (s === "branch") {
    echo(Object.keys(GIT.refs).map((b) => (b === BRANCH ? `<span class="ok">* ${b}</span>` : "  " + b)).join("\n"));
    return;
  }
  if (s === "checkout") {
    const nb = a[1] === "-b",
      b = nb ? a[2] : a[1];
    if (!b) {
      echo('<span class="er">uso: git checkout [-b] &lt;ramo&gt;</span>');
      return;
    }
    echo(checkout(b, nb) ? `Mudou para o ramo '${esc(b)}'` : `<span class="er">não foi possível mudar para '${esc(b)}'</span>`);
    rerender("graph");
    return;
  }
  if (s === "merge") {
    const m = a[1] && gitMerge(a[1]);
    echo(m ? `Merge feito: <span class="ac">${m.h}</span> ${esc(m.m)}` : '<span class="er">uso: git merge &lt;ramo&gt;</span>');
    rerender("graph");
    return { ok: !!m };
  }
  if (s === "flow") {
    if (a[2] === "start" && a[3]) {
      gfStart(a[1], a[3]);
      echo(`Ramo <span class="ac">${esc(BRANCH)}</span> criado`);
    } else if (a[2] === "finish") {
      const m = gfFinish();
      echo(m ? "Finalizado: " + esc(m.m) : '<span class="er">não estás num ramo de gitflow</span>');
    } else {
      echo('<span class="dim">git flow feature|fix|release|hotfix start &lt;nome&gt; · git flow x finish</span>');
    }
    return;
  }
  if (s === "diff") {
    echo(
      ch
        .map((p) => {
          const d = diffStat(FS[p].orig, FS[p].content);
          return ` ${short(p)} | <span class="ok">+${d.add}</span> <span class="er">-${d.del}</span>`;
        })
        .join("\n") || '<span class="dim">sem diferenças</span>',
    );
    return;
  }
  if (s === "push") {
    echo('<span class="dim">o terminal emulado não fala com remotos — faz o push no terminal real da app desktop</span>');
    return { ok: false };
  }
  echo('<span class="dim">git: status | add . | commit -m | log | branch | checkout [-b] | merge | flow | diff | push</span>');
}

window.gitCmd = gitCmd;
/* o comando `git` do terminal emulado é este (ADR-0004, U4j4a — era um shim no app.ts) */
(window as unknown as { XC: Record<string, (a: string[], raw: string) => unknown> }).XC.git = gitCmd;
