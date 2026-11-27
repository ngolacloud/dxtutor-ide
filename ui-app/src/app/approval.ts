/* ═════════ o diálogo de aprovação partilhado (r23 F1, docs/v2/AUDIT-r23.md) ═════════
   Regra do r23: tudo o que muda algo fora do editor (push, reset, apply, deploy, sync, exec, delete) pede
   aprovação e mostra o comando EXACTO. Este é o único diálogo para isso: título, o comando tal como vai
   correr, onde (contexto/namespace/pasta/ramo), e — quando o chamador o pede — um motivo obrigatório e uma
   palavra a escrever para confirmar. Devolve a decisão; NÃO corre nada (quem chama corre e audita).

   As features não importam este módulo no domínio nem na aplicação: declaram na sua porta `HumanPort` um
   `approve(pedido)` com a mesma forma (tipagem estrutural) e a raiz de composição liga-o a
   `requestApproval`. Sem `window`, sem handlers inline (o CSP proíbe-os): os listeners ficam no próprio
   diálogo e morrem com ele. Um pedido novo com outro aberto recusa o anterior (nunca há dois). */

import { esc } from "../core";
import { translator } from "./i18n";
import { APPROVAL_MESSAGES } from "./approval-messages";

const t = translator(APPROVAL_MESSAGES);

export interface ApprovalRequest {
  /** o que vai acontecer, em linguagem de gente («Roll web back to revision 3») */
  title: string;
  /** o comando exacto que corre se for aprovado */
  command: string;
  /** onde corre: «context kind-dev · namespace shop», «folder infra», «branch main» */
  scope?: string;
  /** apaga ou substitui algo: o botão fica vermelho */
  destructive?: boolean;
  /** o motivo é obrigatório (vai para o registo de auditoria) */
  reasonRequired?: boolean;
  /** palavra que o humano tem de escrever para o botão acender (p.ex. o nome do pod) */
  confirmText?: string;
  /** o que a acção traz consigo, item a item (p.ex. os pacotes que se descarregam, com a versão),
   *  com uma nota opcional por baixo — mostrado antes do comando */
  list?: { heading: string; items: string[]; note?: string };
}

export interface ApprovalDecision {
  approved: boolean;
  /** o motivo escrito (vazio quando não houve) */
  reason: string;
  /** quando o humano decidiu (ms desde a época) */
  decidedAt: number;
}

/** Pode aprovar-se com o que está escrito? (puro: o diálogo e os testes usam o mesmo) */
export function canApprove(req: ApprovalRequest, typed: string, reason: string): boolean {
  if (req.confirmText && typed.trim() !== req.confirmText) return false;
  if (req.reasonRequired && !reason.trim()) return false;
  return true;
}

let pending: ((d: ApprovalDecision) => void) | null = null;

/** Mostra o diálogo e resolve com a decisão do humano (Cancelar, Esc ou clicar fora = recusa). */
export function requestApproval(req: ApprovalRequest, now: () => number = Date.now): Promise<ApprovalDecision> {
  if (pending) pending({ approved: false, reason: "", decidedAt: now() });
  document.getElementById("approval")?.remove();

  const box = document.createElement("div");
  box.id = "approval";
  box.className = "show";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.innerHTML =
    `<div class="dlg-box appr-box"><h2>${esc(req.title)}</h2><p class="appr-lede">${esc(t("lede"))}</p>` +
    (req.scope ? `<div class="appr-scope"><span>${esc(t("scope"))}</span> ${esc(req.scope)}</div>` : "") +
    (req.list ? `<h3>${esc(req.list.heading)}</h3><ul class="appr-list">${req.list.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` + (req.list.note ? `<p class="appr-note">${esc(req.list.note)}</p>` : "") : "") +
    `<h3>${esc(t("command"))}</h3><pre class="appr-cmd">${esc(req.command)}</pre>` +
    (req.reasonRequired ? `<h3>${esc(t("reason"))}</h3><textarea id="appr-reason" rows="2" placeholder="${esc(t("reasonPh"))}"></textarea>` : "") +
    (req.confirmText ? `<h3>${t("typeToConfirm", { word: `<code>${esc(req.confirmText)}</code>` })}</h3><input id="appr-typed" class="inp" autocomplete="off" spellcheck="false">` : "") +
    `<div class="dlg-f"><button class="mini" id="appr-no">${esc(t("cancel"))}</button><button class="mini pri${req.destructive ? " danger" : ""}" id="appr-ok">${esc(t("approve"))}</button></div></div>`;
  document.body.appendChild(box);

  const okBtn = box.querySelector("#appr-ok") as HTMLButtonElement;
  const reasonEl = box.querySelector("#appr-reason") as HTMLTextAreaElement | null;
  const typedEl = box.querySelector("#appr-typed") as HTMLInputElement | null;
  const read = (): { typed: string; reason: string } => ({ typed: typedEl?.value ?? "", reason: reasonEl?.value ?? "" });
  const sync = (): void => { const v = read(); okBtn.disabled = !canApprove(req, v.typed, v.reason); };
  sync();

  return new Promise<ApprovalDecision>((resolve) => {
    const finish = (approved: boolean): void => {
      if (pending !== settle) return;
      pending = null;
      document.removeEventListener("keydown", onKey, true);
      box.remove();
      resolve({ approved, reason: read().reason.trim(), decidedAt: now() });
    };
    const settle = (d: ApprovalDecision): void => { pending = null; document.removeEventListener("keydown", onKey, true); box.remove(); resolve(d); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } };
    pending = settle;
    document.addEventListener("keydown", onKey, true);
    box.addEventListener("click", (e) => { if (e.target === box) finish(false); });
    box.querySelector("#appr-no")!.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => { const v = read(); if (canApprove(req, v.typed, v.reason)) finish(true); });
    reasonEl?.addEventListener("input", sync);
    typedEl?.addEventListener("input", sync);
    setTimeout(() => (typedEl ?? reasonEl ?? (box.querySelector("#appr-no") as HTMLElement)).focus(), 0);
  });
}
