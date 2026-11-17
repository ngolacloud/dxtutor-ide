/* ═════════ dxtutor IDE — feature: Changelog «O que mudou e porquê» ═════════
   Harvest #1 da ui-next (porta `ui-next/src/changelog.ts`): substitui a página
   ESTÁTICA auto-elogiosa (comparação com VS Code/Antigravity, antiga
   `renderAnalysisPage`) pela timeline git REAL do repositório.

   Contrato de honestidade (igual ao da ui-next): o «porquê» é a mensagem de commit
   verdadeira — NADA é resumido nem gerado por LLM. Clicar num commit abre o diff
   tal-e-qual (`git show <hash>`). Assunto/autor/data/diff são texto alheio → só por
   `textContent`, nunca HTML, para não injectar.

   Fonte de dados window-resolved (padrão das folhas): a feature publica um default
   SIMULADO (deriva do estado git do protótipo — `GIT.c`/`GIT.order`, dono = scm.ts)
   e a `bridge.ts` (só em desktop, que carrega DEPOIS) troca-o pelo real
   (`git_log`/`git_show`). Assim o browser continua a funcionar sem backend e o
   desktop mostra o repositório verdadeiro — a vista não distingue um do outro.

   O estado git só se lê LAZY, dentro das funções: as features avaliam ANTES do
   monólito (`app.ts`), logo tocar `window.GIT` no eval do módulo seria ReferenceError. */

import { $, type ClCommit } from "../core";

/* estado da vista (módulo-local; persiste entre reaberturas do separador) */
const CL: {
  commits: ClCommit[];
  selected: string;
  diff: string;
  error: string | null;
  loaded: boolean;
  host: HTMLElement | null;
} = { commits: [], selected: "", diff: "", error: null, loaded: false, host: null };

/* ── fonte SIMULADA (browser): deriva do estado git do protótipo ──────────────── */

/** Refs (ramos/tags) que apontam para um commit — para o crachá na linha. */
function simRefs(GIT: any, h: string): string[] {
  const out: string[] = [];
  for (const b in GIT.refs || {}) if (GIT.refs[b] === h) out.push(b);
  if (GIT.tags && GIT.tags[h]) out.push(GIT.tags[h]);
  return out;
}

/** Timeline simulada: mapeia `GIT.order`/`GIT.c` (dono = scm.ts) para `ClCommit`. */
function simLog(): ClCommit[] {
  const GIT: any = window.GIT;
  if (GIT && Array.isArray(GIT.order) && GIT.order.length) {
    return GIT.order.slice(0, 30).map((h: string): ClCommit => {
      const c = GIT.c[h] || {};
      return {
        hash: h,
        short: String(h).slice(0, 7),
        parents: Array.isArray(c.p) ? c.p : [],
        subject: c.m || "",
        author: c.a === "w" ? "Co-Dev / dxtutor" : c.a || "—",
        date: typeof c.t === "number" ? window.rel(c.t) : "",
        refs: simRefs(GIT, h),
      };
    });
  }
  /* fallback mínimo: o resumo `COMMITS` (só hash + mensagem) */
  return (window.COMMITS || []).map((c): ClCommit => ({
    hash: c.h, short: String(c.h).slice(0, 7), parents: [], subject: c.m, author: "—", date: "", refs: [],
  }));
}

/** Diff simulado: o protótipo não guarda o patch, mas regista os ficheiros tocados. */
function simShow(hash: string): string {
  const GIT: any = window.GIT;
  const c = GIT && GIT.c && GIT.c[hash];
  if (!c) return "";
  const files: string[] = Array.isArray(c.files) ? c.files : [];
  const head = `commit ${c.h}\nAutor:  ${c.a === "w" ? "Co-Dev / dxtutor" : c.a}\nRamo:   ${c.b || "—"}\n\n    ${c.m}\n`;
  return files.length
    ? head + "\nFicheiros neste commit:\n" + files.map((f) => "  " + f).join("\n")
    : head + "\n(O protótipo no browser não guarda o patch — abre a pasta na aplicação para ver o diff real.)";
}

/* defaults window-resolved; a bridge (desktop) sobrepõe com git_log/git_show */
window.clLog = async (): Promise<ClCommit[]> => simLog();
window.clShow = async (hash: string): Promise<string> => simShow(hash);

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
    host.innerHTML = `<div class="page"><h1>O que mudou e porquê</h1>
      <div class="sub">A linha temporal real do repositório (git). Não consegui lê-la:</div>
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
    : `<div class="sec-empty">Sem commits para mostrar. Abre uma pasta com um repositório git.</div>`;
  host.innerHTML = `<div class="page"><h1>O que mudou e porquê</h1>
    <div class="sub">A linha temporal real deste repositório: cada linha é um commit, e o «porquê» é a mensagem que quem mudou escreveu — nada é resumido nem reescrito. Clica para ver o diff.</div>
    <div class="scm-grp">Commits<span class="cnt">${CL.commits.length}</span>
      <button class="mini" id="cl-refresh" style="margin-left:8px">Actualizar</button></div>
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
