/* ═════════ dxtutor IDE — feature: notificações (sino + painel) ═════════
   Feature-folha da reestruturação por funcionalidade (Fase 1). Consome o `core`
   tipado por import real e detém a lógica de notificações que vivia no monólito
   `app.ts`: a fila `NOTES`, o contador `UNREAD`, emitir uma nota (`note`), pintar
   o badge do sino (`drawBell`) e abrir/fechar o painel (`toggleNotes`).

   Shim transitório: publica `note`/`toggleNotes` no `window` porque o residual
   ainda os resolve pelos nomes livres — `app.ts` e `v6.ts` chamam `note(...)` ao
   longo dos fluxos guionados, e o `onclick="toggleNotes()"` do sino na barra de
   estado precisa de `window.toggleNotes`. À medida que esses emissores migrarem
   para features, o espelho cai. `NOTES`/`UNREAD`/`drawBell` ficam privados. */

import { $, esc, hhmm } from "../core";
import { translator } from "../app/i18n";
import { NOTIFICATIONS_MESSAGES } from "./notifications.messages";
/** Os textos deste módulo vêm do catálogo (ADR-0004, U6c). */
const txt = translator(NOTIFICATIONS_MESSAGES);

/** Uma notificação: hora de parede + mensagem. */
interface Note {
  t: string;
  m: string;
}

/** Fila de notificações, mais recente primeiro. */
const NOTES: Note[] = [];
/** Notas por ler desde a última abertura do painel. */
let UNREAD = 0;

/** Pinta o badge de não-lidas no sino da barra de estado. */
function drawBell(): void {
  const el = $("#st-bell-n");
  if (el) el.innerHTML = UNREAD ? `<span class="nb">${UNREAD}</span>` : "";
}

/** Emite uma notificação `m` e actualiza o badge. */
function note(m: string): void {
  NOTES.unshift({ t: hhmm(), m });
  UNREAD++;
  drawBell();
}

/** Abre/fecha o painel de notificações; ao abrir, zera as não-lidas e re-pinta a lista. */
function toggleNotes(): void {
  const n = $("#notes");
  if (!n) return;
  if (n.classList.toggle("show")) {
    UNREAD = 0;
    drawBell();
    n.innerHTML = NOTES.length
      ? NOTES.slice(0, 20)
          .map(
            (x) =>
              `<div class="nt"><span class="tm">${x.t}</span><span>${esc(x.m)}</span></div>`,
          )
          .join("")
      : `<div class="nt">${txt("noNotifications")}</div>`;
  }
}

/* ── publicação transitória no window (shim para o residual e o onclick inline) ── */
/* o sino da barra de estado (app/chrome-actions.ts) importa-o (ADR-0004, U7n) */
export { toggleNotes, note };
/* fecha o painel de notificações num clique fora dele (ADR-0004, U4j5a — era do app.ts); nenhum listener de clique
   no document usa stopImmediatePropagation, por isso a posição deste não muda nada */
document.addEventListener('click',e=>{if(!(e.target as Element).closest('#notes')&&!(e.target as Element).closest('#st-bell'))$('#notes')!.classList.remove('show');});
