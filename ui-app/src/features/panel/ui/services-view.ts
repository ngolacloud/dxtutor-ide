/* ═════════ feature `panel` — vista do Services ═════════
   Duas secções reais: as PORTAS TCP em escuta (as do workspace primeiro, como o Ports do
   VS Code, com Abrir no browser / Copiar URL) e o COMPOSE do workspace (`docker compose
   ps` lido a sério; Up/Down correm num terminal de tarefa). */

import type { PortInfo } from "../domain/types";
import { portUrl, shortCwd } from "../domain/naming";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

export interface ServicesModel {
  ports: PortInfo[] | null;
  portsError: string | null;
  showAll: boolean;
  root: string | null;
  rootName: string | null;
  home: string | null;
  compose: string | null;
  stack: { name: string; src: string; url: string; state: string }[] | null;
  stackLoading: boolean;
}

export function renderServices(el: HTMLElement, m: ServicesModel): void {
  const ws = (m.ports ?? []).filter((p) => p.inWorkspace);
  const shown = m.showAll ? m.ports ?? [] : ws;
  const others = (m.ports?.length ?? 0) - ws.length;
  const portsBody = m.portsError
    ? `<div class="sec-empty">✖ ${esc(m.portsError)}</div>`
    : m.ports === null
      ? `<div class="sec-empty">Reading listening ports…</div>`
      : !shown.length
        ? `<div class="sec-empty">${m.root ? "No process started from this workspace is listening on a TCP port." : "No listening ports."} ${others > 0 && !m.showAll ? `<a data-action="sv-all">Show the ${others} other port${others === 1 ? "" : "s"} of your user</a>` : ""}</div>`
        : `<table class="tbl sv-tbl"><tr><th>Port</th><th>Address</th><th>Process</th><th>Command</th><th>Running in</th><th></th></tr>${shown
            .map((p) => {
              const url = portUrl(p);
              return `<tr><td class="sv-port">${p.inWorkspace ? '<span class="pdot" style="background:var(--green)"></span>' : '<span class="pdot"></span>'}${p.port}</td><td class="c">${esc(p.address)}</td><td>${esc(p.process ?? "?")}${p.pid ? ` <span class="c">${p.pid}</span>` : ""}</td><td class="c sv-cmd" title="${esc(p.command ?? "")}">${esc(p.command ?? "")}</td><td class="c">${esc(shortCwd(p.cwd, m.root, m.rootName, m.home))}</td><td class="sv-act"><button class="mini" data-action="sv-open" data-on="${esc(url)}">Open</button> <button class="mini" data-action="sv-copy" data-on="${esc(url)}">Copy URL</button></td></tr>`;
            })
            .join("")}</table>`;
  const head = `<div class="svc-h"><b>Ports</b><span class="c">${m.showAll ? "all listening ports of your user" : "listening ports of processes started in this workspace"}</span><span class="sp"></span><label class="sv-tg"><input type="checkbox" data-action="sv-toggle-all"${m.showAll ? " checked" : ""}> Show all</label></div>`;

  let compose: string;
  if (!m.root) compose = "";
  else if (!m.compose) compose = `<div class="svc-h"><b>Compose</b><span class="c">no docker-compose.yml / compose.yaml in this workspace</span></div>`;
  else {
    const rows = m.stack ?? [];
    compose = `<div class="svc-h"><b>Compose</b><span class="c">${esc(m.compose)}</span>${m.stackLoading ? '<span class="pb-spin"></span>' : rows.length ? `<span class="tag live">${rows.length} running</span>` : '<span class="c">· not running</span>'}<span class="sp"></span><button class="mini pri" data-action="sv-up">▶ Up</button> <button class="mini" data-action="sv-down"${rows.length ? "" : " disabled"}>■ Down</button></div>${rows.length ? `<table class="tbl sv-tbl">${rows.map((s) => `<tr><td><span class="pdot" style="background:var(--green)"></span> ${esc(s.name)}</td><td class="c">${esc(s.src)}</td><td>${s.url === "internal" ? '<span class="c">internal</span>' : `<a data-action="sv-open" data-on="${esc(s.url)}">${esc(s.url)}</a>`}</td><td class="c">${esc(s.state)}</td></tr>`).join("")}</table>` : ""}`;
  }
  el.innerHTML = head + portsBody + compose;
}
