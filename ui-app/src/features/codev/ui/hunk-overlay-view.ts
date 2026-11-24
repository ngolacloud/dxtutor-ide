/* ═══════════ Co-Dev — UI: live hunks drawn over the editor (docs/v2/RF-CODEV-STREAM.md §8) ═══════════
   The DOM side of the overlay. The editor paints the lines (with the `hk-old`/`hk-new`/
   `hk-writing` classes, from the view); this module adds, on top of the editor:
   - a bar per hunk: Pause/Faster/Stop while Co-Dev types, Accept/Reject while it waits
     for the human, the outcome once chosen;
   - «Back to Co-Dev» when the human scrolled away from the hunk being written;
   - Space pauses/resumes and Esc stops (only when the focus is not in a text field).
   Buttons carry `data-action` (+ `data-on`); the effects live in the action table. */

import { esc } from "../../../core";
import type { HunkReview } from "../application/hunk-review";
import { activeHunk, type HunkState, type VView } from "../domain/hunk-overlay";

const LINE_PX = 22;

function bar(h: HunkState, typing: boolean, paused: boolean): string {
  const btn = (action: string, label: string, pri = false) =>
    `<button class="hk-btn${pri ? " pri" : ""}" data-action="${action}" data-on="${esc(h.id)}"><span>${label}</span></button>`;
  if (typing) {
    return (
      `<span class="hk-tag">Co-Dev</span><span class="hk-state">${paused ? "em pausa" : "a escrever…"}</span>` +
      btn("hunk-pause", paused ? "Continuar" : "Pausar") +
      btn("hunk-faster", "Mais rápido") +
      btn("hunk-stop", "Parar")
    );
  }
  if (h.status === "review") {
    if (h.choice) {
      return `<span class="hk-tag">Co-Dev</span><span class="hk-state">${h.choice === "accept" ? "aceite" : "rejeitada"} — à espera das outras</span>`;
    }
    return `<span class="hk-tag">Co-Dev</span>` + btn("hunk-accept", "Aceitar", true) + btn("hunk-reject", "Rejeitar");
  }
  return `<span class="hk-tag">Co-Dev</span><span class="hk-state">a aguardar decisão…</span>`;
}

/** The overlay's `decorate`, the scroll and key handling, bound to one HunkReview. */
export function makeHunkOverlayView(review: HunkReview) {
  let programmatic = 0;
  let boundBody: HTMLElement | null = null;

  const onScroll = (): void => {
    if (programmatic > 0) {
      programmatic--;
      return;
    }
    review.stopFollowing();
  };

  function decorate(_path: string, host: { wrap: HTMLElement; hl: HTMLElement; gut: HTMLElement }, view: VView): void {
    host.wrap.querySelectorAll(".hk-bar").forEach((n) => n.remove());
    const s = review.state();
    const active = activeHunk(s);
    for (const b of view.blocks) {
      const h = s.hunks.find((x) => x.id === b.hunk);
      if (!h) continue;
      const widest = Math.max(0, ...view.lines.slice(b.from, b.to).map((l) => l.text.length));
      const el = document.createElement("div");
      el.className = "hk-bar";
      el.style.top = `${b.from * LINE_PX}px`;
      el.style.left = `${widest + 4}ch`;
      el.innerHTML = bar(h, !!active && active.id === h.id, s.paused);
      host.wrap.appendChild(el);
    }
    const body = host.wrap.closest<HTMLElement>("#ebody");
    if (body && body !== boundBody) {
      boundBody?.removeEventListener("scroll", onScroll);
      body.addEventListener("scroll", onScroll, { passive: true });
      boundBody = body;
    }
    backButton();
  }

  /** «Back to Co-Dev», shown while Co-Dev writes and the human looks elsewhere. */
  function backButton(): void {
    const want = !review.following() && !!activeHunk(review.state());
    let el = document.getElementById("hk-back");
    if (want && !el) {
      el = document.createElement("button");
      el.id = "hk-back";
      el.className = "hk-back";
      el.dataset.action = "hunk-back";
      el.innerHTML = "<span>Voltar ao Co-Dev</span>";
      document.body.appendChild(el);
    } else if (!want && el) el.remove();
  }

  /** Scrolls the editor so view line `line` is in sight (Co-Dev's writing line). */
  function reveal(line: number): void {
    const body = document.getElementById("ebody");
    if (!body) return;
    const y = line * LINE_PX;
    if (y < body.scrollTop + 2 * LINE_PX || y > body.scrollTop + body.clientHeight - 3 * LINE_PX) {
      const top = Math.max(0, y - Math.floor(body.clientHeight / 2));
      if (Math.abs(body.scrollTop - top) > 1) {
        programmatic++;
        body.scrollTop = top;
      }
    }
  }

  /** Space pauses/resumes, Esc stops — while Co-Dev types, outside text fields. */
  function onKey(e: KeyboardEvent): void {
    if (!activeHunk(review.state())) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
    if (e.key === "Escape" && !typing) {
      e.preventDefault();
      review.stop();
    } else if (e.key === " " && !typing) {
      e.preventDefault();
      review.togglePause();
    }
  }

  const KEY = "__codevHunkKeys__";
  const doc = document as Document & { [KEY]?: (e: KeyboardEvent) => void };
  if (doc[KEY]) document.removeEventListener("keydown", doc[KEY]!);
  doc[KEY] = onKey;
  document.addEventListener("keydown", onKey);
  review.onChange(backButton);

  return { decorate, reveal };
}
