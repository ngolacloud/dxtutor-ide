/* ═════════ dxtutor IDE — feature: Run (pane lateral) ═════════
   O pane «Run» lista os projectos da pasta aberta e os comandos de cada um, e corre-os num
   terminal de tarefa na pasta do projecto.

   ADR-0006, R2d: sai a lista fixa do workspace de demonstração (`cargo test -p lexer`,
   `cargo test -p store`, `dx lint`, …). No desktop com pasta, os projectos vêm do backend
   (`detect_projects`: a raiz e as sub-pastas de primeiro nível, pelo ficheiro-marca) e os
   comandos da regra pura `run-commands.ts` (os do Node, dos `scripts` reais do package.json).
   Sem pasta (browser), o pane diz como abrir uma. Abre-se pelo menu Run («Run Project…») e
   pela paleta. Os comandos correm por um só listener no pane (sem `onclick` inline).

   Regista o seu pane (`RP.run`, ADR-0004 U4j2) e publica `renderRunPane` no `window` (i18n). */

import { $, hd, svg, esc } from "../core";
import { RP } from "../app/store/registry";
import { projectsClient, type ProjectInfo } from "../platform/tauri/projects";
import { commandsFor, type ProjectFiles } from "./run-commands";

interface Term { runTask?: (cmd: string, o?: { cwd?: string; label?: string }) => unknown }
interface Globals {
  DXR?: { root?: string | null; term?: Term };
  FS: Record<string, { content: string }>;
  ROOT: string;
  PANE: string;
  runTask: (cmd: string) => unknown;
  setPanelTab: (t: string) => void;
}
const G = window as unknown as Globals;
const root = (): string | null => G.DXR?.root ?? null;

/** A pasta do projecto relativa à raiz aberta ("" = a própria raiz). */
const relOf = (r: string, abs: string): string => (abs === r ? "" : abs.startsWith(r.replace(/\/$/, "") + "/") ? abs.slice(r.replace(/\/$/, "").length + 1) : abs);

/** Os ficheiros de um projecto, pelo FS carregado (chaves `ROOT + caminho relativo`). */
function filesOf(rel: string): ProjectFiles {
  const base = G.ROOT + (rel ? rel + "/" : "");
  return { has: (f) => !!G.FS[base + f], read: (f) => G.FS[base + f]?.content ?? null };
}

let state: { root: string | null; loading: boolean; projects: ProjectInfo[] | null; error: string | null } = { root: null, loading: false, projects: null, error: null };

function load(r: string): void {
  state = { root: r, loading: true, projects: null, error: null };
  projectsClient().detect(r).then(
    (ps) => { if (state.root === r) state = { root: r, loading: false, projects: ps, error: null }; },
    (e) => { if (state.root === r) state = { root: r, loading: false, projects: null, error: e instanceof Error ? e.message : String(e) }; },
  ).finally(() => { if (state.root === r && G.PANE === "run") renderRunPane(); });
}

/** Corre `cmd` na pasta `cwd`: num terminal de tarefa (PTY) quando há, senão com `cd`. */
function runIn(cmd: string, cwd: string): void {
  const t = G.DXR?.term;
  if (t && t.runTask) { G.setPanelTab("terminal"); void t.runTask(cmd, { cwd, label: cmd }); return; }
  G.runTask(cwd && cwd !== root() ? `cd '${cwd.replace(/'/g, "'\\''")}' && ${cmd}` : cmd);
}

/** Renderiza o pane «Run»: os projectos detectados e os seus comandos. */
function renderRunPane(): void {
  const el = $("#pane-run");
  if (!el) return;
  const r = root();
  if (!r) { el.innerHTML = hd("Run") + '<div class="sections"><div class="sec-empty">Abre uma pasta (File → Open Folder…) para ver os projectos e os comandos para os correr.</div></div>'; return; }
  if (state.root !== r) load(r);
  const acts = `<button title="Voltar a detectar os projectos" data-run-refresh="1">${svg("refresh")}</button>`;
  let body: string;
  if (state.loading) body = '<div class="sec-empty">A detectar os projectos…</div>';
  else if (state.error) body = `<div class="sec-empty" style="color:var(--red)">Não consegui detectar os projectos: ${esc(state.error)}</div>`;
  else if (!state.projects || !state.projects.length) body = '<div class="sec-empty">Não detectei projectos nesta pasta (nem na raiz nem nas sub-pastas de primeiro nível): Cargo.toml, go.mod, package.json, pyproject.toml, pom.xml, composer.json ou Gemfile.</div>';
  else body = '<div class="sec-empty">Cada comando corre num terminal de tarefa, na pasta do projecto.</div>' + state.projects.map((p) => {
    const rel = relOf(r, p.path), cmds = commandsFor(p.kind, filesOf(rel));
    return `<div class="scm-grp notr">${esc(p.name)}<span class="cnt">${esc(p.kind)}</span></div>${rel ? `<div class="sec-empty notr" style="padding-top:0">${esc(rel)}/</div>` : ""}` +
      (cmds.length
        ? cmds.map((c) => `<div class="scm-row" data-run-cmd="${esc(c.cmd)}" data-run-cwd="${esc(p.path)}" title="${esc(c.cmd)}"><span class="ic" style="color:var(--green)">${svg("run")}</span><span class="nm notr">${esc(c.cmd)}</span><span class="pth notr">${esc(c.label)}</span></div>`).join("")
        : '<div class="sec-empty">Sem comandos conhecidos para este tipo de projecto.</div>');
  }).join("");
  el.innerHTML = hd("Run", acts) + `<div class="sections">${body}</div>`;
}

/* um só listener: correr um comando / voltar a detectar (o pane é redesenhado a cada render) */
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t || !t.closest("#pane-run")) return;
  const row = t.closest<HTMLElement>("[data-run-cmd]");
  if (row) { runIn(row.dataset.runCmd as string, row.dataset.runCwd as string); return; }
  if (t.closest("[data-run-refresh]")) { const r = root(); if (r) { load(r); renderRunPane(); } }
});

/* ── publicação transitória no window (shim para o residual: RP.run delega aqui) ── */
window.renderRunPane = renderRunPane;
/* registo da vista pela própria feature (ADR-0004, U4j2 — era um shim no app.ts) */
RP.run = renderRunPane;

