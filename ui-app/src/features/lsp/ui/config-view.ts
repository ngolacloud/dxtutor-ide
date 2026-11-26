/* ═════════ feature `lsp` — os ecrãs dos overrides do registo de linguagens (LSP P2) ═════════
   Dono do DOM de três coisas (implementam a `OverridesView`):
     • `#lsp-config` — o editor do `lsp.json` do utilizador (vive na pasta de configuração da app, fora da
       pasta aberta, por isso não abre num separador): o texto, «Save» (o backend grava e aplica) e os
       erros, se o ficheiro ficar ignorado;
     • `#lsp-effective` — a configuração efectiva de um servidor (de onde veio, as linguagens, a aprovação
       e a entrada em JSON), com a escolha do servidor;
     • `#lsp-config-errors` — o aviso dos ficheiros de overrides ignorados por terem erros, com «Open».
   Sem handlers inline (o CSP proíbe-os): os listeners ficam nos próprios elementos e morrem com eles.
   Sem `window`. */

import { esc } from "../../../core";
import { translator } from "../../../app/i18n";
import { LSP_OVERRIDE_MESSAGES } from "../application/override-messages";
import { effectiveEntry, serversForInspection, type FileReport, type LspConfigView } from "../domain/overrides";
import type { OverridesView } from "../application/ports";

const t = translator(LSP_OVERRIDE_MESSAGES);

/** Um diálogo por cima de tudo (fecha com Esc, com «Close» ou ao clicar fora). */
function modal(id: string, inner: string): { box: HTMLElement; close: () => void } {
  document.getElementById(id)?.remove();
  const box = document.createElement("div");
  box.id = id;
  box.className = "lsp-modal";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML = `<div class="dlg-box lsp-modal-box">${inner}</div>`;
  document.body.appendChild(box);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    box.remove();
  };
  document.addEventListener("keydown", onKey, true);
  box.addEventListener("mousedown", (e) => {
    if (e.target === box) close();
  });
  box.querySelector('[data-k="close"]')?.addEventListener("click", close);
  return { box, close };
}

const errorList = (errors: string[]): string => `<ul class="lsp-cfg-errs">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;

function editUserFile(file: { path: string; exists: boolean; text: string }, save: (text: string) => Promise<FileReport>): void {
  const { box, close } = modal(
    "lsp-config",
    `<h2>${esc(t("userTitle"))}</h2><p class="lsp-cfg-path"><code>${esc(file.path)}</code></p><p class="appr-lede">${esc(t("userLede"))}</p>` +
      `<textarea id="lsp-config-text" class="lsp-cfg-text" rows="18" spellcheck="false"></textarea>` +
      `<div class="lsp-cfg-out" role="status"></div>` +
      `<div class="dlg-f"><button class="mini" type="button" data-k="close">${esc(t("close"))}</button><button class="mini pri" type="button" data-k="save">${esc(t("save"))}</button></div>`,
  );
  const ta = box.querySelector("#lsp-config-text") as HTMLTextAreaElement;
  const out = box.querySelector(".lsp-cfg-out") as HTMLElement;
  const btn = box.querySelector('[data-k="save"]') as HTMLButtonElement;
  ta.value = file.text;
  ta.focus();
  ta.addEventListener("keydown", (e) => {
    // Tab escreve espaços (é um ficheiro JSON), Ctrl+S grava
    if (e.key === "Tab" && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText("  ", a, b, "end");
    } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      btn.click();
    }
  });
  btn.addEventListener("click", () => {
    btn.disabled = true;
    out.className = "lsp-cfg-out";
    save(ta.value).then(
      (rep) => {
        btn.disabled = false;
        if (rep.applied || rep.errors.length === 0) {
          out.textContent = t("saved");
          out.classList.add("ok");
          setTimeout(close, 700);
        } else {
          out.innerHTML = `<b>${esc(t("savedInvalid"))}</b>${errorList(rep.errors)}`;
          out.classList.add("bad");
        }
      },
      (e: unknown) => {
        btn.disabled = false;
        out.textContent = t("saveFailed", { error: e instanceof Error ? e.message : String(e) });
        out.classList.add("bad");
      },
    );
  });
}

function fileLine(label: string, f: FileReport | null): string {
  if (!f) return "";
  const state = !f.exists ? t("effMissing") : f.applied ? t("effApplied") : t("effIgnored");
  return `<li><b>${esc(label)}</b> <code>${esc(f.path)}</code> — <span class="${f.exists && !f.applied ? "bad" : ""}">${esc(state)}</span>${f.exists && !f.applied ? errorList(f.errors) : ""}</li>`;
}

function showEffective(view: LspConfigView, selected: string | null, review: (serverId: string) => void): void {
  const servers = serversForInspection(view);
  const first = selected && servers.some((s) => s.id === selected) ? selected : servers[0]?.id ?? null;
  const options = servers.map((s) => `<option value="${esc(s.id)}"${s.id === first ? " selected" : ""}>${esc(`${s.label} (${s.id})`)}${s.sources.some((x) => x !== "bundled") ? " *" : ""}</option>`).join("");
  const { box } = modal(
    "lsp-effective",
    `<h2>${esc(t("effTitle"))}</h2>` +
      `<h3>${esc(t("effFiles"))}</h3><ul class="lsp-cfg-files">${fileLine("user", view.userFile)}${fileLine("project", view.projectFile)}</ul>` +
      `<h3>${esc(t("effServer"))}</h3><select id="lsp-eff-server" class="inp">${options}</select><div class="lsp-eff-body"></div>` +
      `<div class="dlg-f"><button class="mini" type="button" data-k="close">${esc(t("close"))}</button></div>`,
  );
  const body = box.querySelector(".lsp-eff-body") as HTMLElement;
  const sel = box.querySelector("#lsp-eff-server") as HTMLSelectElement;
  const draw = (id: string | null): void => {
    const e = id ? effectiveEntry(view, id) : null;
    if (!e) {
      body.innerHTML = "";
      return;
    }
    body.innerHTML =
      `<p class="lsp-eff-meta">${esc(t("effSources", { sources: e.sources.join(" → ") }))} · ${esc(t("effLanguages", { list: e.languages.join(", ") || t("effNone") }))}</p>` +
      (e.approval ? `<p class="lsp-eff-pending">${esc(t("effPending", { command: e.approval.command }))} <button class="mini pri" type="button" data-k="review">${esc(t("review"))}</button></p>${e.approval.config ? `<pre class="lsp-eff-config">${esc(e.approval.config)}</pre>` : ""}` : "") +
      (e.approved ? `<p class="lsp-eff-ok">${esc(t("effApproved"))}</p>` : "") +
      `<pre class="lsp-eff-json">${esc(e.json)}</pre>`;
    body.querySelector('[data-k="review"]')?.addEventListener("click", () => {
      box.remove();
      review(e.id);
    });
  };
  sel.addEventListener("change", () => draw(sel.value));
  draw(first);
}

function showInvalid(files: FileReport[], open: (f: FileReport) => void): void {
  document.getElementById("lsp-config-errors")?.remove();
  if (!files.length) return;
  const el = document.createElement("div");
  el.id = "lsp-config-errors";
  el.className = "lsp-cfg-notice";
  el.setAttribute("role", "alert");
  el.innerHTML =
    `<b>⚠ ${esc(t("invalidTitle"))}</b><p>${esc(t("invalidLede"))}</p>` +
    files.map((f, i) => `<div class="lsp-cfg-file"><code>${esc(f.path)}</code> <button class="mini" type="button" data-open="${i}">${esc(t("open"))}</button>${errorList(f.errors.slice(0, 5))}</div>`).join("") +
    `<div class="dlg-f"><button class="mini" type="button" data-k="dismiss">${esc(t("dismiss"))}</button></div>`;
  el.querySelector('[data-k="dismiss"]')!.addEventListener("click", () => el.remove());
  el.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) =>
    b.addEventListener("click", () => {
      const f = files[Number(b.dataset.open)];
      if (f) open(f);
    }),
  );
  document.body.appendChild(el);
}

export const overridesView: OverridesView = { editUserFile, showEffective, showInvalid };
