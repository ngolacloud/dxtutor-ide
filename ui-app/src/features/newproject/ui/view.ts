/* ═════════ feature `newproject` — vista: o modal New Project ═════════
   Como o do Learning Track: um cartão por template (ícone, nome, resumo), agrupados em Linguagens, Frameworks,
   Servidores web e Aplicações; depois o formulário (nome, pasta, versão) e o resultado. Os botões vão pelo
   despachante partilhado (`newproject:*`); o nome valida-se enquanto se escreve, sem redesenhar o campo. */

import { esc } from "../../../core";
import { registerActions } from "../../../app/actions";
import { byGroup, joinPath, slug, type Created, type Template } from "../domain/catalog";
import type { NewProject, NewProjectState } from "../application/new-project";
import type { NewProjectKey } from "./messages";

type T = (key: NewProjectKey, params?: Record<string, string | number>) => string;

function card(t: T, x: Template): string {
  return `<button class="np-card" data-action="newproject:pick" data-on="${esc(x.id)}"><span class="g">${esc(x.icon)}</span><b>${esc(x.name)}</b><small>${esc(x.summary)}</small><span class="np-meta">${esc(x.version ? `${x.version} · ` : "")}${esc(t("files", { n: x.files }))}</span></button>`;
}

function nameError(t: T, s: NewProjectState, problem: "empty" | "shape" | null): string {
  if (!problem) return "";
  return problem === "empty" ? t("nameEmpty") : t("nameShape", { slug: slug(s.name) });
}

function resultLines(t: T, r: Created): string[] {
  const out: string[] = [];
  out.push(r.git.kind === "committed" ? t("gitCommitted") : r.git.kind === "inside_repository" ? t("gitInside") : r.git.kind === "needs_author" ? t("gitAuthor") : t("gitFailed", { detail: r.git.detail }));
  if (r.lock.kind === "generated") out.push(t("lockGenerated", { file: r.lock.file }));
  if (r.lock.kind === "missing") out.push(t("lockMissing", { file: r.lock.file, command: r.lock.command }));
  if (r.lock.kind === "failed") out.push(t("lockFailed", { file: r.lock.file, command: r.lock.command, detail: r.lock.detail }));
  if (r.tlsPort) out.push(t("tlsNote", { port: r.tlsPort }));
  return out;
}

export function renderNewProject(t: T, s: NewProjectState, problem: "empty" | "shape" | null): string {
  const head = `<div class="np-head"><h2>${esc(t("title"))}</h2><button class="lnk" data-action="newproject:close">${esc(t("close"))}</button></div>`;
  const err = s.error ? `<p class="np-err">${esc(s.error)}</p>` : "";
  if (s.step === "pick") {
    const groups = s.templates
      ? byGroup(s.templates).map((g) => `<h3 class="np-sec">${esc(t(g.group))}</h3><div class="np-cards">${g.items.map((x) => card(t, x)).join("")}</div>`).join("")
      : s.loading ? `<p class="np-dim">${esc(t("loading"))}</p>` : "";
    return `<div class="np-box">${head}<p class="np-dim">${esc(t("intro"))}</p>${err}${groups}</div>`;
  }
  const x = s.selected!;
  if (s.step === "done" && s.result) {
    const r = s.result;
    return `<div class="np-box">${head}<p class="np-ok">${esc(t("done", { name: s.name, files: r.files }))}</p><ul class="np-notes">${resultLines(t, r).map((l) => `<li>${esc(l)}</li>`).join("")}</ul><div class="np-foot"><button class="mini pri" data-action="newproject:close">${esc(t("close"))}</button></div></div>`;
  }
  const busy = s.step === "busy";
  const versions = x.version
    ? `<label class="np-f"><span>${esc(t("version"))}</span><select data-action="newproject:version"${busy ? " disabled" : ""}>${(x.versions.length ? x.versions : [x.version]).map((v) => `<option value="${esc(v)}"${v === s.version ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`
    : "";
  const ports = [t("port", { port: x.port }), x.tlsPort ? t("tls", { port: x.tlsPort }) : ""].filter(Boolean).join(" · ");
  return `<div class="np-box">${head}<div class="np-chosen"><span class="g">${esc(x.icon)}</span><div><b>${esc(x.name)}</b><small>${esc(x.summary)}</small><small class="np-dim">${esc(ports)}</small></div></div>
<label class="np-f"><span>${esc(t("name"))}</span><input id="np-name" data-action="newproject:name" value="${esc(s.name)}" spellcheck="false" autocomplete="off"${busy ? " disabled" : ""}><small id="np-name-err" class="np-err">${esc(nameError(t, s, problem))}</small><small class="np-dim">${esc(t("nameHint"))}</small></label>
<label class="np-f"><span>${esc(t("parent"))}</span><div class="np-row"><input id="np-parent" data-action="newproject:parentText" value="${esc(s.parent)}" spellcheck="false"${busy ? " disabled" : ""}><button class="mini" data-action="newproject:parent"${busy ? " disabled" : ""}>${esc(t("choose"))}</button></div><small id="np-where" class="np-dim">${esc(s.parent && s.name ? t("where", { dir: joinPath(s.parent, s.name) }) : "")}</small></label>
${versions}${err}<div class="np-foot"><button class="lnk" data-action="newproject:back"${busy ? " disabled" : ""}>${esc(t("back"))}</button><button class="mini pri" data-action="newproject:create"${busy || problem || !s.parent ? " disabled" : ""}>${esc(busy ? t("creating") : t("create"))}</button></div></div>`;
}

/** Monta o modal (`#np`, no body) e liga os botões. */
export function mountNewProject(np: NewProject, t: T): void {
  let problem: "empty" | "shape" | null = null;
  const host = (): HTMLElement => {
    let o = document.getElementById("np");
    if (!o) {
      o = document.createElement("div");
      o.id = "np";
      document.body.appendChild(o);
      o.addEventListener("click", (e) => { if (e.target === o) np.close(); });
    }
    return o;
  };
  const paint = (): void => {
    const s = np.state();
    const o = host();
    o.classList.toggle("show", s.open);
    if (s.open) o.innerHTML = renderNewProject(t, s, problem);
  };
  np.onChange(() => {
    problem = np.state().step === "form" ? np.setName(np.state().name) : null;
    paint();
  });
  const live = (): void => {
    const s = np.state();
    const err = document.getElementById("np-name-err");
    if (err) err.textContent = nameError(t, s, problem);
    const where = document.getElementById("np-where");
    if (where) where.textContent = s.parent && s.name ? t("where", { dir: joinPath(s.parent, s.name) }) : "";
    const go = document.querySelector<HTMLButtonElement>('[data-action="newproject:create"]');
    if (go) go.disabled = !!problem || !s.parent;
  };
  registerActions({
    "newproject:close": { click: () => np.close() },
    "newproject:pick": { click: (c) => np.pick(c.on) },
    "newproject:back": { click: () => np.back() },
    "newproject:name": { input: (c) => { problem = np.setName(c.value); live(); } },
    "newproject:parentText": { input: (c) => { np.setParent(c.value); live(); } },
    "newproject:parent": { click: () => { void np.chooseParent(); } },
    "newproject:version": { change: (c) => np.setVersion(c.value) },
    "newproject:create": { click: () => { void np.create(); } },
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && np.state().open) np.close(); });
}
