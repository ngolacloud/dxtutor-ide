/* ═════════ dxtutor IDE — feature: Changelog «O que mudou e porquê» ═════════
   Harvest #1 da ui-next (porta `ui-next/src/changelog.ts`): substitui a página
   ESTÁTICA auto-elogiosa (comparação com VS Code/Antigravity, antiga
   `renderAnalysisPage`) pela timeline git REAL do repositório.

   Contrato de honestidade (igual ao da ui-next): o «porquê» é a mensagem de commit
   verdadeira — NADA é resumido nem gerado por LLM. Clicar num commit abre o diff
   tal-e-qual (`git show <hash>`). Assunto/autor/data/diff são texto alheio → só por
   `textContent`, nunca HTML, para não injectar.

   Fonte de dados window-resolved (padrão das folhas): a feature publica um default
   vazio e a `bridge.ts` (só em desktop, que carrega DEPOIS) troca-o pelo real
   (`git_log`/`git_show`). */

import { $, type ClCommit } from "../core";
import { VIEW } from "../app/store/registry";
import { desktopPorts } from "../app/desktop";
import { translator } from "../app/i18n";
import { CHANGELOG_MESSAGES } from "./changelog.messages";
import { CHANGELOG_DESKTOP_MESSAGES } from "./changelog.desktop-messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(CHANGELOG_MESSAGES);
const txd = translator(CHANGELOG_DESKTOP_MESSAGES);

/* estado da vista (módulo-local; persiste entre reaberturas do separador) */
const CL: {
  commits: ClCommit[];
  selected: string;
  diff: string;
  error: string | null;
  loaded: boolean;
  host: HTMLElement | null;
} = { commits: [], selected: "", diff: "", error: null, loaded: false, host: null };

/* ── sem repositório (o browser, ou o desktop sem pasta) não há timeline: a vista mostra o
   aviso. A fonte SIMULADA que derivava do histórico inventado do protótipo (`GIT.order`/
   `COMMITS`) saiu com ele (ADR-0006, R1d). ── */
const noLog = async (): Promise<ClCommit[]> => [];
const noShow = async (_hash: string): Promise<string> => "";

/** A parte desktop do changelog (ADR-0004, U4h5b), injectada em `desktopPorts.changelog`: o
 *  `git log`/`git show` reais do repositório aberto. Recebe a versão sem repositório. */
export interface ChangelogDesktop {
  log(virtual: () => Promise<ClCommit[]>): Promise<ClCommit[]>;
  show(hash: string, virtual: (hash: string) => Promise<string>): Promise<string>;
}
/* fontes window-resolved: consultam a porta desktop (antes o desktop reatribuía-as no `window`) */
window.clLog = async (): Promise<ClCommit[]> => { const d = desktopPorts.changelog; return d ? d.log(noLog) : noLog(); };
window.clShow = async (hash: string): Promise<string> => { const d = desktopPorts.changelog; return d ? d.show(hash, noShow) : noShow(hash); };

/* ── render ───────────────────────────────────────────────────────────────────── */

async function load(): Promise<void> {
  CL.loaded = true;
  try {
    CL.commits = await window.clLog();
    CL.error = null;
  } catch (e) {
    CL.commits = [];
    CL.error = String(e);
  }
  draw();
}

async function openCommit(hash: string): Promise<void> {
  try {
    CL.diff = await window.clShow(hash);
    CL.selected = hash;
    CL.error = null;
  } catch (e) {
    CL.error = String(e);
  }
  draw();
}

function draw(): void {
  const host = CL.host;
  if (!host) return;
  if (CL.error) {
    host.innerHTML = `<div class="page"><h1>${txd("title")}</h1>
      <div class="sub">${txd("readError")}</div>
      <div class="sec-empty cl-error"></div></div>`;
    ($(".cl-error") as HTMLElement).textContent = CL.error;
    return;
  }
  const rows = CL.commits.length
    ? CL.commits
        .map(
          () => `<div class="scm-row cl-row" style="cursor:pointer">
            <span class="ic">${window.svg("history")}</span>
            <span class="nm cl-subject" style="max-width:none"></span>
            <span class="tag cl-refs" style="display:none"></span>
            <span class="pth cl-meta"></span>
          </div>`,
        )
        .join("")
    : `<div class="sec-empty">${txd("none")}</div>`;
  host.innerHTML = `<div class="page"><h1>${txd("title")}</h1>
    <div class="sub">${txd("sub")}</div>
    <div class="scm-grp">Commits<span class="cnt">${CL.commits.length}</span>
      <button class="mini" id="cl-refresh" style="margin-left:8px">${txt("refresh")}</button></div>
    <div class="sections">${rows}</div>
    <div class="scm-grp cl-diff-head" style="display:${CL.selected ? "flex" : "none"}">Diff de <span class="cl-diff-hash" style="font-family:var(--font-mono);margin-left:6px;color:var(--accent-hover)"></span></div>
    <pre class="cl-diff" style="display:${CL.selected ? "block" : "none"};font-family:var(--font-mono);font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;color:var(--fg-dim);padding:10px 2px 40px;margin:0"></pre></div>`;

  const refresh = $("#cl-refresh") as HTMLButtonElement | null;
  if (refresh) refresh.onclick = () => void load();

  host.querySelectorAll<HTMLElement>(".cl-row").forEach((row, i) => {
    const c = CL.commits[i];
    if (!c) return;
    row.classList.toggle("on", c.hash === CL.selected);
    (row.querySelector(".cl-subject") as HTMLElement).textContent = c.subject;
    const refs = row.querySelector(".cl-refs") as HTMLElement;
    if (c.refs.length) {
      refs.textContent = c.refs.join(", ");
      refs.style.display = "";
    }
    const merge = c.parents.length > 1 ? " · merge" : "";
    (row.querySelector(".cl-meta") as HTMLElement).textContent =
      [c.short, c.author, c.date].filter(Boolean).join(" · ") + merge;
    row.onclick = () => void openCommit(c.hash);
  });

  if (CL.selected) {
    (host.querySelector(".cl-diff-hash") as HTMLElement).textContent = CL.selected.slice(0, 7);
    (host.querySelector(".cl-diff") as HTMLElement).textContent = CL.diff;
  }
}

/** Ponto de entrada da vista (VIEW.analysis → esta fachada). Desenha o estado actual
 *  e, na primeira abertura, carrega a timeline (assíncrona: git_log real ou simulado). */
window.renderChangelogPage = (_t: unknown, host: HTMLElement): void => {
  CL.host = host;
  draw();
  if (!CL.loaded) void load();
};
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
VIEW.analysis = window.renderChangelogPage;
