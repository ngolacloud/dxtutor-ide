/* ═════════ feature `lsp` — o ecrã dos servidores de linguagem a correr (LSP P6) ═════════
   Dono do DOM de `#lsp-servers` (implementa a `ServersScreen`): a tabela com cada servidor (nome, pasta,
   pid, estado, ficheiros abertos ou tempo inactivo, memória) e «Restart»/«Stop», o total, «Show log» (o canal
   «Language servers» do Output) e «Close». Redesenha-se no lugar enquanto está aberta (o caso de uso relê a
   lista); um listener delegado na própria caixa, que morre com ela. Sem handlers inline, sem `window`. */

import { esc } from "../../../core";
import { translator } from "../../../app/i18n";
import { LSP_SERVERS_MESSAGES } from "../application/servers-messages";
import { duration, memory, serverRows, totalMemory, type ServersView } from "../domain/servers";
import type { ServersActions, ServersScreen } from "../application/ports";
import { modal } from "./config-view";

const t = translator(LSP_SERVERS_MESSAGES);
const ID = "lsp-servers";

/** A tabela; `keys` recebe a chave de cada linha (a chave de sessão leva `\0`, que o HTML não guarda num
 *  atributo: a linha leva só o índice). */
function table(view: ServersView, folder: string | null, keys: string[]): string {
  const rows = serverRows(view, folder, t);
  keys.splice(0, keys.length, ...rows.map((r) => r.key));
  if (!rows.length) return `<p class="lsp-srv-none">${esc(t("none"))}</p>`;
  const head = [t("colServer"), t("colRoot"), t("colPid"), t("colState"), t("colIdle"), t("colMemory"), ""].map((h) => `<th>${esc(h)}</th>`).join("");
  const body = rows
    .map(
      (r, i) =>
        `<tr data-i="${i}"><td><b>${esc(r.label)}</b></td><td class="lsp-srv-root">${esc(r.root)}</td><td class="num">${esc(r.pid)}</td>` +
        `<td><span class="lsp-srv-st ${r.state}">${esc(t(r.state))}</span></td><td title="${esc(r.files.join("\n"))}">${esc(r.idle)}</td><td class="num">${esc(r.memory)}</td>` +
        `<td class="lsp-srv-acts"><button class="mini" type="button" data-k="restart" title="${esc(t("restartTitle"))}">${esc(t("restart"))}</button><button class="mini" type="button" data-k="stop" title="${esc(t("stopTitle"))}">${esc(t("stop"))}</button></td></tr>`,
    )
    .join("");
  const total = totalMemory(view);
  return `<table class="lsp-srv-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + `<p class="lsp-srv-foot">${esc(t("total", { n: rows.length, memory: memory(total) }))}</p>`;
}

function lede(view: ServersView): string {
  const text = view.idleMinutes > 0 ? t("lede", { idle: duration(view.idleMinutes * 60), max: view.maxServers }) : t("ledeNever", { max: view.maxServers });
  return `<p class="appr-lede">${esc(text)} ${esc(t("limitsHint"))}</p>`;
}

/** O ecrã, com a pasta aberta (para mostrar os caminhos relativos a ela). */
export function serversScreen(folder: () => string | null): ServersScreen {
  let acts: ServersActions | null = null;
  const keys: string[] = [];
  return {
    isOpen: () => !!document.getElementById(ID),
    show(view, a) {
      acts = a;
      const open = document.getElementById(ID);
      if (open) {
        const body = open.querySelector(".lsp-srv-body");
        if (body) body.innerHTML = lede(view) + table(view, folder(), keys);
        return;
      }
      const { box, close } = modal(
        ID,
        `<h2>${esc(t("title"))}</h2><div class="lsp-srv-body">${lede(view)}${table(view, folder(), keys)}</div>` +
          `<div class="dlg-f"><button class="mini" type="button" data-k="log">${esc(t("showLog"))}</button><button class="mini" type="button" data-k="close">${esc(t("close"))}</button></div>`,
      );
      box.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-k]");
        if (!b || !acts) return;
        const i = b.closest<HTMLElement>("tr[data-i]")?.dataset.i;
        const key = i == null ? "" : keys[Number(i)] ?? "";
        if (b.dataset.k === "stop" && key) {
          b.disabled = true;
          acts.stop(key);
        } else if (b.dataset.k === "restart" && key) {
          b.disabled = true;
          acts.restart(key);
        } else if (b.dataset.k === "log") {
          close();
          acts.showLog();
        }
      });
    },
  };
}
