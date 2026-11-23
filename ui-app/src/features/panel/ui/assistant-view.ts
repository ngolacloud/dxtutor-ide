/* ═════════ feature `panel` — Debug assistant (dados reais) ═════════
   Com uma pasta aberta, o assistente mostra o que REALMENTE falhou no workspace: os
   comandos do terminal que terminaram com código ≠ 0 (com a cauda da saída, lida do
   buffer pela integração de shell) e os erros dos checkers. Cada um segue para o Co-Dev
   com o contexto todo, pré-preenchido no compositor para o humano rever antes de enviar. */

import type { CommandRecord, Problem } from "../domain/types";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const ago = (now: number, t: number): string => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : new Date(t).toLocaleTimeString();
};

export const ASSISTANT_MARK = "dbgx";

export function renderAssistant(el: HTMLElement, o: {
  failures: CommandRecord[];
  errors: Problem[];
  integration: boolean;
  now: number;
  icon: string;
}): void {
  const cmds = o.failures.slice(0, 12).map((f, i) => {
    const tail = f.output.split("\n").slice(-14).join("\n");
    return `<div class="dx-card"><div class="dx-h"><code>$ ${esc(f.command || "(command)")}</code><span class="dx-code">exit ${f.exitCode}</span><span class="c">${esc(f.terminalTitle)} · ${esc(ago(o.now, f.at))}</span></div>${tail.trim() ? `<pre class="dx-out">${esc(tail)}</pre>` : ""}<div class="dx-a"><button class="mini pri" data-action="dx-ask-cmd" data-on="${i}">Ask Co-Dev</button> <button class="mini" data-action="dx-rerun" data-on="${i}">Re-run</button> <button class="mini" data-action="dx-show" data-on="${esc(f.terminalId)}">Show terminal</button></div></div>`;
  });
  const errs = o.errors.slice(0, 8).map((p, i) => `<div class="dx-card"><div class="dx-h"><span class="pb-ic error">✖</span><span class="dx-msg">${esc(p.message.split("\n")[0])}</span><a class="c" data-action="pb-open" data-on="${esc(p.file)}|${p.line}">${esc(p.file)}:${p.line}</a></div><div class="dx-a"><button class="mini pri" data-action="dx-ask-err" data-on="${i}">Ask Co-Dev</button></div></div>`);
  const empty = !cmds.length && !errs.length;
  el.innerHTML = `<div class="${ASSISTANT_MARK}">${empty
    ? `<div class="dbg-empty">${o.icon}<div><b>Debug assistant</b><p>Nothing has failed in this workspace yet. Commands that end with an error in the terminal${o.integration ? "" : " (needs bash or zsh for shell integration)"} and the errors found by the project's checkers show up here with their real output, ready to hand to Co-Dev.</p></div></div>`
    : `${cmds.length ? `<div class="dx-sec">Failed commands</div>${cmds.join("")}` : ""}${errs.length ? `<div class="dx-sec">Errors in the workspace</div>${errs.join("")}` : ""}`}</div>`;
}

/** O pedido ao Co-Dev para um comando falhado: comando, código, pasta, saída e os erros
 *  dos checkers nos ficheiros que a saída menciona. */
export function promptForCommand(f: CommandRecord, related: Problem[]): string {
  const rel = related.slice(0, 6).map((p) => `- ${p.file}:${p.line} ${p.message.split("\n")[0]}`).join("\n");
  return `This command failed in my terminal. Find the root cause and propose the fix.\n\n$ ${f.command}\n(exit ${f.exitCode}${f.cwd ? `, in ${f.cwd}` : ""})\n\n\`\`\`\n${f.output.split("\n").slice(-60).join("\n")}\n\`\`\`${rel ? `\n\nRelated problems reported by the checkers:\n${rel}` : ""}`;
}

export function promptForProblem(p: Problem): string {
  return `The ${p.source} checker reports this error. Explain the cause and propose the fix.\n\n${p.file}:${p.line}:${p.col} ${p.code ? `[${p.code}] ` : ""}${p.message}`;
}
