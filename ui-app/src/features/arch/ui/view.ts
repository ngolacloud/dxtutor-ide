/* ═════════ feature `arch` — vista do Studio de arquitectura ═════════
   Dono do DOM/markup: a barra, o catálogo de tipos, o canvas SVG e o inspector. Lê o
   estado do caso de uso e repinta por âmbito (tudo / canvas / inspector). As acções vão
   em `data-action` + `data-on` (o listener delegado está em `actions.ts`); o arrastar e
   o clicar no canvas ligam-se aqui, ao elemento SVG. Sem window. */

import { KINDS, KIND_COLOR, KIND_LABEL, findNode } from "../domain/design";
import type { ArchConnection, DesignNode } from "../domain/types";
import type { ArchStudio } from "../application/studio";
import type { Repaint } from "../application/ports";

export const NW = 150, NH = 54, VBW = 760, VBH = 440;

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const cut = (x: string, m: number): string => (x.length > m ? x.slice(0, m - 1) + "…" : x);

export interface ArchViewDeps {
  studio: ArchStudio;
  root(): string | null;
}

export function makeArchView({ studio, root }: ArchViewDeps) {
  let host: HTMLElement | null = null;
  const q = <T extends Element>(sel: string): T | null => (host ? host.querySelector<T>(sel) : null);

  function renderShell(): void {
    if (!host) return;
    const s = studio.state();
    host.innerHTML = `<div class="studio arch-studio">
  <div class="st-bar"><b style="font-size:14px">Architecture</b>
    <button class="mini${s.linking !== null ? " pri" : ""}" data-action="arch-link">⤳ Connect</button>
    <span class="sp"></span>
    <button class="mini" data-action="arch-preview">Preview scaffold</button>
    <button class="mini pri" data-action="arch-scaffold">Generate scaffold</button>
  </div>
  <div class="st-main">
    <div class="st-cat"><div class="st-ct">Components</div>${KINDS.map((k) =>
      `<button class="st-tech" data-action="arch-add" data-on="${k}"><span class="pdot" style="background:${KIND_COLOR[k]}"></span>${KIND_LABEL[k]}<i>＋</i></button>`).join("")}</div>
    <div class="st-canvas"><svg data-arch-svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMinYMin meet" style="min-width:640px"></svg></div>
    <div class="st-insp" data-arch-insp></div>
  </div>
</div>`;
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (svg) svg.addEventListener("mousedown", onCanvasDown);
  }

  function paintCanvas(): void {
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (!svg) return;
    const s = studio.state(), d = s.design;
    const edge = (c: ArchConnection): string => {
      const A = findNode(d, c.from), B = findNode(d, c.to);
      if (!A || !B) return "";
      const ax = A.x + NW / 2, ay = A.y + NH / 2, bx = B.x + NW / 2, by = B.y + NH / 2;
      // a linha pára na borda do cartão de destino (não por baixo dele)
      const dx = bx - ax, dy = by - ay;
      const k = Math.min(dx ? (NW / 2 + 4) / Math.abs(dx) : 9, dy ? (NH / 2 + 4) / Math.abs(dy) : 9);
      const label = c.event ? `${c.relation} · ${c.event}` : c.relation;
      return `<line x1="${ax + dx * k}" y1="${ay + dy * k}" x2="${bx - dx * k}" y2="${by - dy * k}" stroke="var(--fg-muted)" stroke-width="1.4" marker-end="url(#arch-ar)"/>` +
        `<text x="${(ax + bx) / 2}" y="${(ay + by) / 2 - 5}" text-anchor="middle" fill="var(--fg-muted)" font-size="9" font-family="var(--font-mono)">${esc(label)}</text>`;
    };
    const node = (n: DesignNode): string => {
      const on = s.sel === n.id || s.linking === n.id;
      return `<g data-n="${esc(n.id)}" transform="translate(${n.x} ${n.y})" style="cursor:${s.linking !== null ? "crosshair" : "grab"}">` +
        `<rect width="${NW}" height="${NH}" rx="10" fill="var(--bg-elevated)" stroke="${on ? "var(--accent)" : "var(--border-strong)"}" stroke-width="${on ? 2 : 1.3}"/>` +
        `<rect width="5" height="${NH - 16}" y="8" rx="2.5" fill="${KIND_COLOR[n.kind]}"/>` +
        `<text x="14" y="18" fill="${KIND_COLOR[n.kind]}" font-size="8.5" font-weight="700" font-family="var(--font-mono)" letter-spacing=".6">${KIND_LABEL[n.kind].toUpperCase()}${n.outbox ? " · OUTBOX" : ""}</text>` +
        `<text x="14" y="38" fill="var(--fg)" font-size="12.5" font-weight="600" font-family="var(--font-ui)">${esc(cut(n.name, 19))}</text></g>`;
    };
    svg.innerHTML = `<defs><marker id="arch-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--fg-muted)"/></marker>` +
      `<pattern id="arch-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--guide)"/></pattern></defs>` +
      `<rect width="${VBW}" height="${VBH}" fill="url(#arch-grid)"/>` +
      d.connections.map(edge).join("") + d.components.map(node).join("");
  }

  function validationBlock(): string {
    const s = studio.state();
    if (s.validating) return `<div class="st-f"><span>…</span><div>Validating…</div></div>`;
    if (s.valError) return `<div class="st-f w"><span>⚠</span><div>${esc(s.valError)}</div></div>`;
    if (!s.design.components.length) return `<div class="st-f"><span>·</span><div>The design is empty. Add a component from the list on the left.</div></div>`;
    if (!s.findings.length) return `<div class="st-f ok"><span>✓</span><div>The architecture is consistent.</div></div>`;
    return s.findings.map((f) =>
      `<div class="st-f ${f.severity === "error" ? "e" : "w"}"><span>${f.severity === "error" ? "✖" : "⚠"}</span>` +
      `<div>${esc(f.message)} <code>${esc(f.rule)}</code></div></div>`).join("");
  }

  function resultBlock(): string {
    const s = studio.state();
    if (s.opError) return `<div class="st-f e"><span>✖</span><div>${esc(s.opError)}</div></div>`;
    if (s.written) {
      const list = s.written.length
        ? s.written.map((p) => `<div class="st-f ok"><span>✓</span><div><code>${esc(p)}</code></div></div>`).join("")
        : `<div class="st-f"><span>·</span><div>Nothing written: every file already existed.</div></div>`;
      return `<h3 style="margin-top:14px">Scaffold · ${s.written.length} written</h3>${list}`;
    }
    if (s.preview) {
      const list = s.preview.length
        ? s.preview.map(([p]) => `<div class="st-f"><span>·</span><div><code>${esc(p)}</code></div></div>`).join("")
        : `<div class="st-f w"><span>⚠</span><div>Nothing to generate: the design has errors or no live components.</div></div>`;
      return `<h3 style="margin-top:14px">Preview · ${s.preview.length} files</h3><p>Nothing has been written yet.</p>${list}`;
    }
    return "";
  }

  function paintInspector(): void {
    const ins = q<HTMLElement>("[data-arch-insp]");
    if (!ins) return;
    const s = studio.state(), d = s.design;
    if (s.linking !== null) {
      ins.innerHTML = `<h3>Connect</h3><p>${s.linking === "" ? "Click the component the arrow starts from." : "Now click the component it goes to."}</p>`;
      return;
    }
    const n = s.sel ? findNode(d, s.sel) : undefined;
    if (n) {
      const name = (id: string): string => findNode(d, id)?.name ?? id;
      const conns = d.connections.map((c, i) => (c.from === n.id || c.to === n.id)
        ? `<div class="st-e">${esc(name(c.from))} →(${esc(c.relation)}${c.event ? " · " + esc(c.event) : ""}) ${esc(name(c.to))}<button data-action="arch-del-conn" data-on="${i}" title="Remove">×</button></div>`
        : "").join("") || "<p>No connections.</p>";
      ins.innerHTML = `<h3>Component</h3>` +
        `<label>Name</label><input class="inp" style="margin:0 0 8px;width:100%" value="${esc(n.name)}" data-action="arch-name" data-on="${esc(n.id)}">` +
        `<label>Kind</label><select data-action="arch-kind" data-on="${esc(n.id)}">${KINDS.map((k) => `<option value="${k}"${n.kind === k ? " selected" : ""}>${KIND_LABEL[k]}</option>`).join("")}</select>` +
        (n.kind === "store" ? `<label><input type="checkbox" data-action="arch-outbox" data-on="${esc(n.id)}"${n.outbox ? " checked" : ""}> Outbox table</label>` : "") +
        `<label>Connections</label>${conns}` +
        `<button class="mini" style="margin-top:10px" data-action="arch-del" data-on="${esc(n.id)}">Delete component</button>`;
      return;
    }
    const r = root();
    ins.innerHTML = `<h3>Design</h3><p>Add components, drag them, and use <b>Connect</b> to draw the arrows. The relation is inferred from the kinds at each end.</p>` +
      `<p>Validation and the scaffold always come from the Rust backend.</p>` +
      `<h3 style="margin-top:14px">Validation</h3>${validationBlock()}` +
      `<div class="st-kv" style="margin-top:12px"><span>components</span><code>${d.components.length}</code></div>` +
      `<div class="st-kv"><span>connections</span><code>${d.connections.length}</code></div>` +
      `<div class="st-kv"><span>target</span><code>${esc(r ?? "no folder open")}</code></div>` +
      resultBlock();
  }

  /* ── interacção do canvas: seleccionar, ligar, arrastar ── */
  function onCanvasDown(e: MouseEvent): void {
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (!svg) return;
    const s = studio.state();
    const g = (e.target as Element).closest<SVGGElement>("[data-n]");
    const id = g?.dataset.n ?? null;
    if (s.linking !== null) { studio.linkClick(id); return; }
    if (!id) { studio.select(null); return; }
    const n = findNode(s.design, id);
    if (!n) return;
    const r = svg.getBoundingClientRect();
    const k = r.width ? VBW / r.width : 1;
    const ox = (e.clientX - r.left) * k - n.x, oy = (e.clientY - r.top) * k - n.y;
    let moved = false;
    const mv = (ev: MouseEvent): void => {
      moved = true;
      studio.move(id,
        Math.max(4, Math.min(VBW - NW - 4, (ev.clientX - r.left) * k - ox)),
        Math.max(4, Math.min(VBH - NH - 4, (ev.clientY - r.top) * k - oy)));
    };
    const up = (): void => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
      if (moved) studio.endMove();
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
    studio.select(id);
    e.preventDefault();
  }

  function repaint(scope: Repaint): void {
    if (!host || !host.isConnected) return;
    if (scope === "all") { renderShell(); paintCanvas(); paintInspector(); }
    else if (scope === "canvas") paintCanvas();
    else paintInspector();
  }

  return {
    /** Monta a vista num separador (chamado pelo `VIEW.arch`). */
    mount(el: HTMLElement): void {
      host = el;
      studio.ensureLoaded();
      repaint("all");
      if (studio.state().design.components.length) void studio.validate();
    },
    repaint,
  };
}
