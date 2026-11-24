/* ═════════ feature `arch` — vista do Studio de arquitectura ═════════
   Dono do DOM/markup: a barra, o catálogo de tipos, o canvas SVG e o inspector. O canvas
   segue o guia visual: painéis com moldura e barra de título na cor do painel, grupos
   tracejados com etiqueta-pílula sobre a linha de topo, cartões com ícone em cima, nome em
   baixo e mini-bloco de código escuro, setas tracejadas (controlo na cor do painel, dados a
   verde, opcional a cinzento). O canvas é 1:1 e faz scroll; seleccionar não redesenha a
   barra (o scroll mantém-se). As acções vão em `data-action` + `data-on` (listener
   delegado em `actions.ts`); arrastar e redimensionar ligam-se aqui, ao SVG. Sem window. */

import {
  EDGE_STYLES, EDGE_STYLE_LEGEND, EVENT_KINDS, GROUP_KINDS, GROUP_LABEL, KIND_COLOR, KIND_LABEL, PROTOCOLS, PROTOCOL_LABEL, SYSTEM_KINDS,
  descendants, depth, findGroup, findNode, hasEventKinds, isEventKind, isPanelBody, relationTakesEvent, viewOfGroup, viewOfNode,
} from "../domain/design";
import { CARD, PANEL_BAR, codeLines, groupPills, layout, nameLines, pillRect } from "../domain/geometry";
import { LABEL_PX, placeLabels, routeAll, straightRoutes, type Point, type Route } from "../domain/routing";
import type { ArchConnection, ArchKind, Design, DesignGroup, DesignNode, Rect } from "../domain/types";
import type { ArchStudio } from "../application/studio";
import type { RulesEditor } from "../application/rules";
import { RULES_FILE, joinList } from "../domain/rules";
import type { Repaint } from "../application/ports";
import { ICONS } from "./icons";

/** O ícone Tabler de cada Kind. */
export const KIND_ICON: Record<ArchKind, string> = {
  service: "server", store: "database", broker: "arrows-exchange", consumer: "inbox", relay: "arrows-right-left",
  gateway: "door-enter", cli: "terminal-2", process: "cpu", daemon: "server-cog", runtime: "stack-2",
  socket: "plug-connected", state: "files", kernel: "cpu-2", external: "world", client: "device-desktop",
  worker: "box", port: "network", adapter: "transform",
};

const DEPENDS = "var(--fg-dim)";
const DATA = "var(--green)", MUTED = "var(--fg-muted)", NEUTRAL = "var(--accent)", ACCENT = "var(--accent)";
const CODE_BG = "#0d1117", CODE_FG = "#c9d1d9";

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Um ícone 24×24 desenhado com `size` px em (x, y). */
export function icon(name: string, x: number, y: number, size: number, color: string, width = 1.75): string {
  const k = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${k})" fill="none" stroke="${color}" stroke-width="${width / k}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</g>`;
}

/** A cor de um componente: a do seu painel; fora de painéis, a do Kind de eventos ou a de acento. */
export const nodeColor = (d: Design, n: DesignNode): string =>
  viewOfNode(d, n)?.color ?? (isEventKind(n.kind) ? KIND_COLOR[n.kind] : NEUTRAL);

/** Cor, tracejado e rótulo de uma seta. */
export function edgeLook(d: Design, c: ArchConnection): { color: string; dash: string; label: string } {
  if (c.relation) return { color: MUTED, dash: "", label: c.event ? `${c.relation} · ${c.event}` : c.relation };
  // só o rótulo escrito: o protocolo é do modelo (inspector, Mermaid), não se desenha
  // sozinho — o guia pede rótulo só quando o significado não é óbvio
  const label = c.label ?? "";
  if (c.style === "data") return { color: DATA, dash: "6 4", label };
  if (c.style === "optional") return { color: MUTED, dash: "2 4", label };
  // uma dependência não é um fluxo: linha cheia e neutra (a legenda explica-a)
  if (c.style === "depends") return { color: DEPENDS, dash: "", label };
  const from = findNode(d, c.from);
  return { color: (from && viewOfNode(d, from)?.color) ?? MUTED, dash: "6 4", label };
}


/* ───── peças do canvas (puras: estado → markup) ───── */

function panelSvg(title: string, color: string, r: Rect): string {
  return `<g pointer-events="none"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="14" fill="${color}" fill-opacity=".05" stroke="${color}" stroke-width="1.6"/>` +
    `<path d="M${r.x} ${r.y + PANEL_BAR}V${r.y + 14}a14 14 0 0 1 14 -14H${r.x + r.w - 14}a14 14 0 0 1 14 14V${r.y + PANEL_BAR}Z" fill="${color}"/>` +
    `<text x="${r.x + r.w / 2}" y="${r.y + 20}" text-anchor="middle" fill="#fff" font-size="14" font-weight="700" font-family="var(--font-ui)">${esc(title)}</text></g>`;
}

function groupSvg(g: DesignGroup, r: Rect, color: string, selected: boolean, body: boolean): string {
  if (body) {
    return `<g data-g="${esc(g.id)}" style="cursor:move"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="#000" fill-opacity="0.001"${selected ? ` stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="2 3"` : ""}/>` +
      (selected ? `<rect data-gr="${esc(g.id)}" x="${r.x + r.w - 11}" y="${r.y + r.h - 11}" width="11" height="11" rx="2" fill="${ACCENT}" style="cursor:nwse-resize"/>` : "") + `</g>`;
  }
  const stroke = selected ? ACCENT : color;
  const pill = pillRect(g.label, r), pw = pill.w, cx = r.x + r.w / 2;
  return `<g data-g="${esc(g.id)}" style="cursor:move">` +
    `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10" fill="#000" fill-opacity="0.001" stroke="${stroke}" stroke-width="${selected ? 2 : 1.3}"${g.style === "dashed" ? ' stroke-dasharray="6 4"' : ""}/>` +
    `<rect x="${cx - pw / 2}" y="${r.y - 10}" width="${pw}" height="20" rx="10" fill="var(--bg-elevated)" stroke="${stroke}" stroke-width="1.2"/>` +
    `<text x="${cx}" y="${r.y + 4}" text-anchor="middle" fill="var(--fg)" font-size="10.5" font-weight="700" font-family="var(--font-ui)">${esc(g.label)}</text>` +
    (selected ? `<rect data-gr="${esc(g.id)}" x="${r.x + r.w - 11}" y="${r.y + r.h - 11}" width="11" height="11" rx="2" fill="${ACCENT}" style="cursor:nwse-resize"/>` : "") +
    `</g>`;
}

function nodeSvg(d: Design, n: DesignNode, r: Rect, selected: boolean, linking: boolean): string {
  const color = nodeColor(d, n);
  const stroke = selected ? ACCENT : "var(--border-strong)";
  const cursor = linking ? "crosshair" : "grab";
  const head = `<g data-n="${esc(n.id)}" transform="translate(${r.x} ${r.y})" style="cursor:${cursor}">`;
  if (n.kind === "kernel") {
    return head + `<rect width="${r.w}" height="${r.h}" rx="8" fill="var(--bg-hover)" stroke="${stroke}" stroke-width="${selected ? 2 : 1.2}"/>` +
      icon(KIND_ICON.kernel, 12, (r.h - 18) / 2, 18, "var(--fg-dim)") +
      `<text x="${r.w / 2}" y="${r.h / 2 + 4}" text-anchor="middle" fill="var(--fg-dim)" font-size="12" font-weight="600" font-family="var(--font-ui)">${esc(nameLines(n.name).join(" "))}</text></g>`;
  }
  const lines = nameLines(n.name), code = codeLines(n.code);
  let y = CARD.padTop + CARD.icon + CARD.gap;
  let out = head + `<rect width="${r.w}" height="${r.h}" rx="10" fill="var(--bg-elevated)" stroke="${stroke}" stroke-width="${selected ? 2 : 1.2}"/>` +
    icon(KIND_ICON[n.kind], (r.w - CARD.icon) / 2, CARD.padTop, CARD.icon, color);
  if (n.outbox) out += `<text x="${r.w - 8}" y="14" text-anchor="end" fill="${color}" font-size="8" font-weight="700" font-family="var(--font-mono)">OUTBOX</text>`;
  for (const l of lines) { y += CARD.line; out += `<text x="${r.w / 2}" y="${y - 3}" text-anchor="middle" fill="var(--fg)" font-size="12" font-weight="600" font-family="var(--font-ui)">${esc(l)}</text>`; }
  if (code.length) {
    y += CARD.codePad;
    const h = code.length * CARD.codeLine + CARD.codePad + 2;
    out += `<rect x="8" y="${y}" width="${r.w - 16}" height="${h}" rx="5" fill="${CODE_BG}"/>`;
    code.forEach((l, i) => { out += `<text x="14" y="${y + CARD.codePad + 7 + i * CARD.codeLine}" fill="${CODE_FG}" font-size="9.5" font-family="var(--font-mono)">${esc(l)}</text>`; });
  }
  return out + `</g>`;
}

function edgeSvg(d: Design, c: ArchConnection, i: number, route: Route, labelAt: Point | null, selected: boolean, marker: (color: string) => string): string {
  const pts = route.points;
  if (pts.length < 2) return "";
  // a ponta pára 3 px antes da borda (a cabeça da seta não entra no cartão)
  const a = pts[pts.length - 2], b = pts[pts.length - 1], len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const tip = { x: b.x - ((b.x - a.x) / len) * 3, y: b.y - ((b.y - a.y) / len) * 3 };
  const dPath = [...pts.slice(0, -1), tip].map((p, k) => `${k ? "L" : "M"}${p.x} ${p.y}`).join("");
  const { color, dash, label } = edgeLook(d, c);
  const sw = selected ? 2.6 : 1.5;
  let out = `<g data-e="${i}" style="cursor:pointer"><path d="${dPath}" fill="none" stroke="transparent" stroke-width="12"/>` +
    `<path d="${dPath}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""} marker-end="url(#${marker(color)})"/>`;
  if (label && labelAt) {
    out += `<text x="${labelAt.x}" y="${labelAt.y + 3.5}" text-anchor="middle" fill="${color === MUTED ? "var(--fg-dim)" : color}" font-size="${LABEL_PX}" font-family="var(--font-mono)" paint-order="stroke" stroke="var(--bg-base)" stroke-width="3">${esc(label)}</text>`;
  }
  return out + `</g>`;
}

/** A legenda das setas: só aparece quando há setas de dependência (que, sem ela, se
 *  confundiam com fluxos), e lista os estilos em uso com o aspecto real de cada um.
 *  Fica por baixo do desenho; os limites crescem para a conter. */
function legend(d: Design, b: Rect, marker: (color: string) => string): { svg: string; bounds: Rect } {
  const styled = d.connections.filter((c) => !c.relation);
  if (!styled.some((c) => c.style === "depends")) return { svg: "", bounds: b };
  const entries = EDGE_STYLES.flatMap((st) => {
    const c = styled.find((x) => (x.style ?? "control") === st);
    if (!c) return [];
    // o controlo tem a cor do painel de onde sai: a amostra fica neutra e di-lo
    if (st === "control") return [{ text: `${EDGE_STYLE_LEGEND.control} (cor do painel)`, look: { ...edgeLook(d, c), color: MUTED } }];
    return [{ text: EDGE_STYLE_LEGEND[st], look: edgeLook(d, c) }];
  });
  const y = b.y + b.h, x0 = b.x + 24;
  let x = x0, out = "";
  for (const e of entries) {
    out += `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y}" stroke="${e.look.color}" stroke-width="1.5"${e.look.dash ? ` stroke-dasharray="${e.look.dash}"` : ""} marker-end="url(#${marker(e.look.color)})"/>` +
      `<text x="${x + 42}" y="${y + 4}" fill="var(--fg-dim)" font-size="11" font-family="var(--font-ui)">${esc(e.text)}</text>`;
    x += 42 + e.text.length * 6.2 + 28;
  }
  return { svg: `<g data-legend="">${out}</g>`, bounds: { ...b, w: Math.max(b.w, x - b.x), h: b.h + 34 } };
}

/** O SVG completo do desenho (também o que a exportação SVG da F5 vai usar). */
export function canvasSvg(d: Design, sel: { node?: string; group?: string; edge?: number }, linking: string | null, fast = false): { svg: string; bounds: Rect } {
  const l = layout(d);
  const colors: string[] = [];
  const marker = (color: string): string => {
    let k = colors.indexOf(color);
    if (k < 0) { colors.push(color); k = colors.length - 1; }
    return `arch-ar-${k}`;
  };
  let body = "";
  for (const v of d.views) { const r = l.panels.get(v.id); if (r) body += panelSvg(v.title, v.color, r); }
  const groups = [...d.groups].sort((a, b) => depth(d, a.id) - depth(d, b.id));
  for (const g of groups) body += groupSvg(g, l.groups.get(g.id)!, viewOfGroup(d, g.id)?.color ?? MUTED, sel.group === g.id, isPanelBody(d, g));
  const pills = groupPills(d, l);
  // a meio de um arrasto: rectas de borda a borda (o encaminhamento faz-se ao largar)
  const routes = fast ? straightRoutes(l.nodes, d.connections) : routeAll(l.nodes, d.connections, pills);
  const labels = placeLabels([...l.nodes.values(), ...pills], routes, d.connections.map((c) => edgeLook(d, c).label || null),
    [...l.panels.values(), ...l.groups.values()]);
  d.connections.forEach((c, i) => { body += edgeSvg(d, c, i, routes[i], labels[i], sel.edge === i, marker); });
  for (const n of d.components) body += nodeSvg(d, n, l.nodes.get(n.id)!, sel.node === n.id || linking === n.id, linking !== null);
  // a legenda antes das definições: os marcadores das amostras entram em `colors`
  const leg = legend(d, l.bounds, marker);
  const b = leg.bounds;
  const defs = `<defs>${colors.map((c, k) => `<marker id="arch-ar-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`).join("")}` +
    `<pattern id="arch-grid" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="var(--guide)"/></pattern></defs>`;
  return { svg: defs + `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="url(#arch-grid)"/>` + body + leg.svg, bounds: b };
}

export interface ArchViewDeps {
  studio: ArchStudio;
  /** O painel «Rules» (F5.2/F5.5); sem ele, o botão não aparece. */
  rules?: RulesEditor;
  root(): string | null;
  /** As exportações vão para a pasta do projecto (desktop com pasta) ou são downloads. */
  savesToProject(): boolean;
}

export function makeArchView({ studio, rules, root, savesToProject }: ArchViewDeps) {
  let host: HTMLElement | null = null;
  const q = <T extends Element>(sel: string): T | null => (host ? host.querySelector<T>(sel) : null);

  const catBtn = (k: ArchKind): string =>
    `<button class="st-tech" data-action="arch-add" data-on="${k}" title="Add a ${KIND_LABEL[k]} (inside the selected group, if any)">` +
    `<svg width="16" height="16" viewBox="0 0 16 16" style="flex:none">${icon(KIND_ICON[k], 0, 0, 16, isEventKind(k) ? KIND_COLOR[k] : "var(--fg-dim)", 1.6)}</svg>${KIND_LABEL[k]}<i>＋</i></button>`;

  function renderShell(): void {
    if (!host) return;
    host.innerHTML = `<div class="studio arch-studio">
  <div class="st-bar" data-arch-bar></div>
  <div class="st-main">
    <div class="st-cat"><div class="st-ct">System</div>${SYSTEM_KINDS.map(catBtn).join("")}
      <div class="st-ct" style="margin-top:10px">Events</div>${EVENT_KINDS.map(catBtn).join("")}</div>
    <div class="st-canvas"><svg data-arch-svg></svg></div>
    <div class="st-insp" data-arch-insp></div>
  </div>
</div>`;
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (svg) svg.addEventListener("mousedown", onCanvasDown);
  }

  function paintBar(): void {
    const bar = q<HTMLElement>("[data-arch-bar]");
    if (!bar) return;
    const s = studio.state(), d = s.design;
    const canvas = q<HTMLElement>(".st-canvas");
    if (canvas) canvas.style.outline = s.proposal ? "2px dashed var(--accent)" : "";
    if (s.proposal) {
      bar.innerHTML = `<b style="font-size:14px">Architecture</b>
    <span style="color:var(--accent)">Co-Dev proposes: <b>${esc(s.proposal.title)}</b>${s.showCurrent ? " · showing your current design" : ""}</span>
    <span class="sp"></span>
    <button class="mini" data-action="arch-peek">${s.showCurrent ? "Show the proposal" : "Show current design"}</button>
    <button class="mini" data-action="arch-discard">Discard</button>
    <button class="mini pri" data-action="arch-accept">Accept</button>`;
      return;
    }
    const scaffold = !d.components.length || hasEventKinds(d);
    bar.innerHTML = `<b style="font-size:14px">Architecture</b>
    <button class="mini${s.linking !== null ? " pri" : ""}" data-action="arch-link">⤳ Connect</button>
    <button class="mini" data-action="arch-add-group" title="A dashed boundary (inside the selected group, if any)">＋ Group</button>
    <button class="mini" data-action="arch-add-view" title="Side-by-side comparison (at most two panels)">＋ Panel</button>
    <button class="mini" data-action="arch-arrange" title="Lay everything out in layers, top to bottom">⇅ Arrange</button>
    <button class="mini${s.io ? " pri" : ""}" data-action="arch-io" title="Export SVG, PNG or Mermaid; import Mermaid">⇄ Import / Export</button>
    ${rules ? `<button class="mini${rules.state().open ? " pri" : ""}" data-action="arch-rules" title="The architect's rules (.dxtutor/architecture.toml) and the ADRs">§ Rules</button>` : ""}
    <span class="sp"></span>
    ${scaffold ? `<button class="mini" data-action="arch-preview">Preview scaffold</button>
    <button class="mini pri" data-action="arch-scaffold">Generate scaffold</button>` : ""}`;
  }

  function paintCanvas(fast = false): void {
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (!svg) return;
    const s = studio.state();
    const sel = s.sel?.t === "node" ? { node: s.sel.id } : s.sel?.t === "group" ? { group: s.sel.id } : s.sel?.t === "edge" ? { edge: s.sel.i } : {};
    const shown = s.proposal && !s.showCurrent ? s.proposal.design : s.design;
    const { svg: inner, bounds: b } = canvasSvg(shown, s.proposal ? {} : sel, s.proposal ? null : s.linking, fast);
    svg.setAttribute("viewBox", `${b.x} ${b.y} ${b.w} ${b.h}`);
    svg.setAttribute("width", String(b.w));
    svg.setAttribute("height", String(b.h));
    svg.innerHTML = inner;
  }

  /* ───── inspector ───── */

  const opt = (v: string, label: string, on: boolean): string => `<option value="${esc(v)}"${on ? " selected" : ""}>${esc(label)}</option>`;
  const groupPath = (d: Design, id: string): string => {
    const parts: string[] = [];
    let g = findGroup(d, id);
    const seen = new Set<string>();
    while (g && !seen.has(g.id)) { seen.add(g.id); parts.unshift(g.label); g = g.parent ? findGroup(d, g.parent) : undefined; }
    return parts.join(" › ");
  };

  function validationBlock(): string {
    const s = studio.state();
    if (s.validating) return `<div class="st-f"><span>…</span><div>Validating…</div></div>`;
    if (s.valError) return `<div class="st-f w"><span>⚠</span><div>${esc(s.valError)}</div></div>`;
    if (!s.design.components.length && !s.design.groups.length) return `<div class="st-f"><span>·</span><div>The design is empty. Add a component from the list on the left.</div></div>`;
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

  const field = (label: string, html: string): string => `<label>${label}</label>${html}`;
  const input = (action: string, on: string, value: string, ph = ""): string =>
    `<input class="inp" style="margin:0 0 4px;width:100%" data-action="${action}" data-on="${esc(on)}" value="${esc(value)}"${ph ? ` placeholder="${esc(ph)}"` : ""}>`;
  const area = (action: string, on: string, value: string, rows: number, mono = false, ph = ""): string =>
    `<textarea class="inp" rows="${rows}" style="margin:0 0 4px;width:100%;resize:vertical${mono ? ";font-family:var(--font-mono);font-size:11px" : ""}" data-action="${action}" data-on="${esc(on)}"${ph ? ` placeholder="${esc(ph)}"` : ""}>${esc(value)}</textarea>`;
  const check = (action: string, on: string, checked: boolean, label: string): string =>
    `<label style="text-transform:none;letter-spacing:0;font-size:12px;color:var(--fg)"><input type="checkbox" data-action="${action}" data-on="${esc(on)}"${checked ? " checked" : ""}> ${label}</label>`;

  function nodeInspector(d: Design, n: DesignNode): string {
    const name = (id: string): string => findNode(d, id)?.name.split("\n")[0] ?? id;
    const kinds = `<optgroup label="System">${SYSTEM_KINDS.map((k) => opt(k, KIND_LABEL[k], n.kind === k)).join("")}</optgroup>` +
      `<optgroup label="Events">${EVENT_KINDS.map((k) => opt(k, KIND_LABEL[k], n.kind === k)).join("")}</optgroup>`;
    const groups = opt("", "— none —", !n.group) + d.groups.map((g) => opt(g.id, groupPath(d, g.id), n.group === g.id)).join("");
    const conns = d.connections.map((c, i) => (c.from === n.id || c.to === n.id)
      ? `<div class="st-e"><a data-action="arch-sel-edge" data-on="${i}" style="cursor:pointer">${esc(name(c.from))} → ${esc(name(c.to))}${c.relation ? ` (${esc(c.relation)})` : c.label ? ` (${esc(c.label)})` : ""}</a><button data-action="arch-del-conn" data-on="${i}" title="Remove">×</button></div>`
      : "").join("") || "<p>No connections.</p>";
    return `<h3>Component</h3>` +
      field("Name", area("arch-name", n.id, n.name, 2)) +
      field("Kind", `<select data-action="arch-kind" data-on="${esc(n.id)}">${kinds}</select>`) +
      (n.kind === "store" ? check("arch-outbox", n.id, n.outbox, "Outbox table") : "") +
      field("Group", `<select data-action="arch-node-group" data-on="${esc(n.id)}">${groups}</select>`) +
      field("Code", area("arch-code", n.id, n.code ?? "", 2, true, "e.g. delonix run nginx")) +
      field("Source", input("arch-source", n.id, n.source ?? "", "file or crate where it is confirmed")) +
      field("Connections", conns) +
      `<button class="mini" style="margin-top:10px" data-action="arch-del" data-on="${esc(n.id)}">Delete component</button>`;
  }

  function groupInspector(d: Design, g: DesignGroup): string {
    const inside = descendants(d, g.id);
    const parents = opt("", "— none (top level) —", !g.parent) +
      d.groups.filter((x) => x.id !== g.id && !inside.has(x.id)).map((x) => opt(x.id, groupPath(d, x.id), g.parent === x.id)).join("");
    const panel = d.views.find((v) => v.roots.includes(g.id));
    const panels = opt("", "— none —", !panel) + d.views.map((v) => opt(v.id, v.title, panel?.id === v.id)).join("");
    const members = d.components.filter((c) => c.group === g.id).length;
    return `<h3>Group</h3>` +
      field("Label", input("arch-group-label", g.id, g.label)) +
      field("Kind", `<select data-action="arch-group-kind" data-on="${esc(g.id)}">${GROUP_KINDS.map((k) => opt(k, GROUP_LABEL[k], g.kind === k)).join("")}</select>`) +
      field("Border", `<select data-action="arch-group-style" data-on="${esc(g.id)}">${opt("dashed", "Dashed", g.style === "dashed")}${opt("solid", "Solid", g.style === "solid")}</select>`) +
      field("Inside", `<select data-action="arch-group-parent" data-on="${esc(g.id)}">${parents}</select>`) +
      (!g.parent && d.views.length ? field("Panel", `<select data-action="arch-group-view" data-on="${esc(g.id)}">${panels}</select>`) : "") +
      field("Source", input("arch-group-source", g.id, g.source ?? "", "module or crate where it is confirmed")) +
      `<div class="st-kv"><span>components</span><code>${members}</code></div>` +
      (isPanelBody(d, g) ? `<p style="margin-top:8px">This group has the panel's name, so it is the panel's body: its border is not drawn and dragging it moves the panel. Rename it to show it as a boundary.</p>` : "") +
      `<p style="margin-top:8px">With the group selected, the components you add go inside it. Drag cards in and out of it; drag the corner to resize.</p>` +
      `<button class="mini" style="margin-top:6px" data-action="arch-group-del" data-on="${esc(g.id)}">Delete group</button>`;
  }

  function edgeInspector(d: Design, c: ArchConnection, i: number): string {
    const name = (id: string): string => findNode(d, id)?.name.split("\n")[0] ?? id;
    const styles = opt("", c.relation ? "— event link —" : "Control (default)", !c.style) +
      opt("control", "Control", c.style === "control") + opt("data", "Data / requests", c.style === "data") + opt("optional", "Optional", c.style === "optional") + opt("depends", "Depends on (static)", c.style === "depends");
    const protos = opt("", "—", !c.protocol) + PROTOCOLS.map((p) => opt(p, PROTOCOL_LABEL[p], c.protocol === p)).join("");
    return `<h3>Connection</h3><p><b>${esc(name(c.from))}</b> → <b>${esc(name(c.to))}</b></p>` +
      (c.relation ? `<div class="st-kv"><span>relation</span><code>${esc(c.relation)}</code></div>` : "") +
      (c.relation && relationTakesEvent(c.relation) ? field("Event", input("arch-edge-event", String(i), c.event, "routing key")) : "") +
      field("Style", `<select data-action="arch-edge-style" data-on="${i}">${styles}</select>`) +
      field("Protocol", `<select data-action="arch-edge-protocol" data-on="${i}">${protos}</select>`) +
      field("Label", input("arch-edge-label", String(i), c.label ?? "", "only when the meaning is not obvious")) +
      field("Source", input("arch-edge-source", String(i), c.source ?? "", "file where the call is confirmed")) +
      `<button class="mini" style="margin-top:10px" data-action="arch-del-conn" data-on="${i}">Delete connection</button>`;
  }

  function proposalInspector(): string {
    const p = studio.state().proposal!, d = p.design;
    const errors = p.findings.filter((f) => f.severity === "error").length;
    const findings = p.findings.length
      ? p.findings.map((f) => `<div class="st-f ${f.severity === "error" ? "e" : "w"}"><span>${f.severity === "error" ? "✖" : "⚠"}</span><div>${esc(f.message)} <code>${esc(f.rule)}</code></div></div>`).join("")
      : `<div class="st-f ok"><span>✓</span><div>The proposal is consistent.</div></div>`;
    return `<h3>Proposal from Co-Dev</h3><p><b>${esc(p.title)}</b></p>` +
      `<p>Your design does not change until you press <b>Accept</b>. Nothing is written to disk. If the agent proposes again, the new proposal replaces this one.</p>` +
      `<div class="st-kv"><span>components</span><code>${d.components.length}</code></div>` +
      `<div class="st-kv"><span>arrows</span><code>${d.connections.length}</code></div>` +
      `<div class="st-kv"><span>groups</span><code>${d.groups.length}</code></div>` +
      `<div class="st-kv"><span>panels</span><code>${d.views.length}</code></div>` +
      `<h3 style="margin-top:14px">Validation${errors ? ` · ${errors} error(s)` : ""}</h3>${findings}`;
  }

  function ioInspector(): string {
    const s = studio.state();
    const where = savesToProject()
      ? `Saved in the project folder (<code>docs/architecture/</code> by default), after you confirm.`
      : `Downloaded by the browser (open a folder in the desktop app to save into the project).`;
    const btn = (f: string, label: string): string => `<button class="mini" data-action="arch-export" data-on="${f}">${label}</button>`;
    const result = (s.ioError ? `<div class="st-f e"><span>✖</span><div>${esc(s.ioError)}</div></div>` : "") +
      (s.ioMessage ? `<div class="st-f ok"><span>✓</span><div>${esc(s.ioMessage)}</div></div>` : "") +
      s.importWarnings.map((w) => `<div class="st-f w"><span>⚠</span><div>${esc(w)}</div></div>`).join("") +
      (s.mdBlocks ?? []).map((b, i) => `<button class="st-tech" data-action="arch-import-block" data-on="${i}"><span style="font-family:var(--font-mono);font-size:11px">${esc(b.label)}</span><i>⇣</i></button>`).join("");
    const sample = 'graph TB\n  subgraph HOST["Host Linux"]\n    CLI["delonix"] -- "fork" --> SHIM["log shim"]\n  end';
    return `<h3>Export</h3><p>${where}</p>` +
      `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${btn("svg", "SVG")}${btn("png", "PNG")}${btn("mermaid", "Mermaid")}${btn("json", "Design file")}</div>` +
      result +
      `<h3 style="margin-top:14px">Import Mermaid</h3><p>A <code>graph</code> or <code>flowchart</code>, with <code>subgraph</code>. Parsed by the Rust backend; the result is laid out top to bottom.</p>` +
      `<textarea class="inp" data-arch-mermaid rows="7" style="width:100%;resize:vertical;font-family:var(--font-mono);font-size:11px" placeholder="${esc(sample)}"></textarea>` +
      `<button class="mini" style="margin-top:6px" data-action="arch-import-mermaid">Import</button>` +
      `<h3 style="margin-top:14px">Open from the project</h3><p>A <code>.arch.json</code> design file, a <code>.mmd</code>, or a Markdown file with Mermaid diagrams (e.g. <code>ARCHITECTURE.md</code>).</p>` +
      `<input class="inp" data-arch-open style="width:100%;margin:0 0 6px" value="docs/architecture/"><button class="mini" data-action="arch-open">Open</button>`;
  }

  /* ───── as regras do arquitecto e os ADR (F5.2/F5.5) ───── */
  function rulesInspector(ed: RulesEditor): string {
    const r = ed.state();
    const head = `<h3>Architect's rules</h3><p><code>${RULES_FILE}</code>${r.doc && !r.doc.exists ? " — not created yet" : ""}. Checked on every change of Co-Dev and in the Problems panel; a deviation passes only with an accepted ADR.</p>`;
    if (!ed.available()) return head + `<div class="st-f"><span>·</span><div>The rules live in the project folder: open a folder in the desktop app to edit them.</div></div>`;
    if (r.loading && !r.doc) return head + `<div class="st-f"><span>…</span><div>Loading…</div></div>`;
    const can = !!r.doc?.canEdit;
    const dis = can ? "" : " disabled";
    const txt = (action: string, on: string, value: string, ph: string): string =>
      `<input class="inp" style="margin:0 0 4px;width:100%" data-action="${action}" data-on="${esc(on)}" value="${esc(value)}" placeholder="${esc(ph)}"${dis}>`;
    const note = r.doc?.note ? `<div class="st-f${can ? "" : " w"}"><span>${can ? "·" : "⚠"}</span><div>${esc(r.doc.note)}</div></div>` : "";
    const status = (r.error ? r.error.split("\n").map((e) => `<div class="st-f e"><span>✖</span><div>${esc(e)}</div></div>`).join("") : "") +
      (r.message ? `<div class="st-f ok"><span>✓</span><div>${esc(r.message)}</div></div>` : "");
    const layers = r.draft.layers.map((l, i) =>
      `<div class="arch-rl" style="border-left:3px solid var(--accent);padding-left:8px;margin:8px 0">` +
      field("Layer", txt("arch-rl-name", String(i), l.name, "domain")) +
      field("Paths", txt("arch-rl-paths", String(i), joinList(l.paths), "src/domain/**")) +
      check("arch-rl-free", String(i), l.mayUse === null, "May depend on any layer").replace("<input", `<input${dis}`) +
      (l.mayUse === null ? "" : field("May use", txt("arch-rl-uses", String(i), joinList(l.mayUse), "nothing else"))) +
      (can ? `<button class="mini" data-action="arch-rl-del" data-on="${i}">Remove layer</button>` : "") + `</div>`).join("") ||
      `<p>No layers yet. Draw a group of kind «Layer» for each one and its arrows, then use <b>Layers from the drawing</b>.</p>`;
    const naming = r.draft.naming.map((n, i) =>
      `<div style="margin:6px 0">${txt("arch-rl-naming-paths", String(i), joinList(n.paths), "src/**/*.rs")}${txt("arch-rl-naming-pattern", String(i), n.pattern, "^[a-z0-9_]+\\.rs$")}` +
      (can ? `<button class="mini" data-action="arch-rl-naming-del" data-on="${i}">Remove</button>` : "") + `</div>`).join("");
    const exceptions = r.draft.exceptions.map((x, i) =>
      `<div style="margin:6px 0">${txt("arch-rl-exc-adr", String(i), x.adr, "ADR-0007")}${txt("arch-rl-exc-rule", String(i), x.rule, "library:moment")}` +
      (can ? `<button class="mini" data-action="arch-rl-exc-del" data-on="${i}">Remove</button>` : "") + `</div>`).join("");
    const adrs = r.adrs.map((a) =>
      `<div class="st-f${a.accepted ? " ok" : ""}"><span>${a.accepted ? "✓" : "·"}</span><div><b>${esc(a.id)}</b> ${esc(a.title)} <code>${esc(a.status || "no status")}</code>` +
      (!a.accepted && can ? ` <button class="mini" data-action="arch-adr-accept" data-on="${esc(a.path)}">Accept</button>` : "") + `</div></div>`).join("") ||
      `<p>No ADRs in <code>docs/adr/</code>, <code>docs/decisions/</code> or <code>docs/architecture/ADR-*</code>.</p>`;
    const commit = r.changed.length
      ? `<h3 style="margin-top:14px">Commit</h3><p>Changed here: ${r.changed.map((p) => `<code>${esc(p)}</code>`).join(", ")}. The commit takes only these files.</p><button class="mini pri" data-action="arch-rl-commit"${dis}>Commit…</button>`
      : "";
    return head + note + status +
      `<h3 style="margin-top:14px">Layers</h3>${layers}` +
      (can ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="mini" data-action="arch-rl-add">＋ Layer</button><button class="mini" data-action="arch-rl-from" title="A layer for each group of kind «Layer»; the arrows between them say who may use whom">Layers from the drawing</button></div>` : "") +
      `<h3 style="margin-top:14px">Libraries</h3>` +
      field("Forbidden", txt("arch-rl-lib", "forbidden", joinList(r.draft.libraries.forbidden), "lodash, moment")) +
      field("Approved (only these, when set)", txt("arch-rl-lib", "approved", joinList(r.draft.libraries.approved), "any")) +
      `<h3 style="margin-top:14px">File names</h3>${naming}` + (can ? `<button class="mini" data-action="arch-rl-naming-add">＋ Naming rule</button>` : "") +
      `<h3 style="margin-top:14px">Exceptions (need an accepted ADR)</h3>${exceptions}` + (can ? `<button class="mini" data-action="arch-rl-exc-add">＋ Exception</button>` : "") +
      `<div style="margin-top:12px"><button class="mini pri" data-action="arch-rl-save"${can ? "" : " disabled"}>Save rules${r.dirty ? " •" : ""}</button></div>` +
      `<h3 style="margin-top:14px">ADRs</h3>${adrs}` + commit;
  }

  function panelsBlock(d: Design): string {
    if (!d.views.length) return `<p>Use <b>＋ Panel</b> for a side-by-side comparison: the known system on the left, ours on the right.</p>`;
    return d.views.map((v) =>
      `<div style="border-left:3px solid ${esc(v.color)};padding-left:8px;margin:8px 0">` +
      input("arch-view-title", v.id, v.title) +
      `<label>Colour</label><input type="color" data-action="arch-view-color" data-on="${esc(v.id)}" value="${esc(v.color)}" style="width:44px;height:22px;border:0;background:none">` +
      check("arch-view-daemonless", v.id, v.daemonless, "Claims to be daemonless") +
      check("arch-view-strict", v.id, v.strict, "Strict: every box and arrow has a source") +
      `<button class="mini" data-action="arch-view-del" data-on="${esc(v.id)}">Remove panel</button></div>`).join("");
  }

  function paintInspector(): void {
    const ins = q<HTMLElement>("[data-arch-insp]");
    if (!ins) return;
    const s = studio.state(), d = s.design;
    const notice = s.notice ? `<div class="st-f w"><span>⚠</span><div>${esc(s.notice)}</div></div>` : "";
    if (s.proposal) { ins.innerHTML = proposalInspector(); return; }
    if (rules?.state().open && s.linking === null) { ins.innerHTML = rulesInspector(rules); return; }
    if (s.io && s.linking === null) { ins.innerHTML = notice + ioInspector(); return; }
    if (s.linking !== null) {
      ins.innerHTML = `<h3>Connect</h3><p>${s.linking === "" ? "Click the component the arrow starts from." : "Now click the component it goes to."}</p>`;
      return;
    }
    if (s.sel?.t === "node") { const n = findNode(d, s.sel.id); if (n) { ins.innerHTML = notice + nodeInspector(d, n); return; } }
    if (s.sel?.t === "group") { const g = findGroup(d, s.sel.id); if (g) { ins.innerHTML = notice + groupInspector(d, g); return; } }
    if (s.sel?.t === "edge") { const c = d.connections[s.sel.i]; if (c) { ins.innerHTML = notice + edgeInspector(d, c, s.sel.i); return; } }
    const r = root();
    ins.innerHTML = notice + `<h3>Design</h3><p>Add components, drag them, and use <b>Connect</b> to draw the arrows. Groups are dashed boundaries; panels put two systems side by side.</p>` +
      `<p>Validation and the scaffold always come from the Rust backend.</p>` +
      `<h3 style="margin-top:14px">Validation</h3>${validationBlock()}` +
      `<div class="st-kv" style="margin-top:12px"><span>components</span><code>${d.components.length}</code></div>` +
      `<div class="st-kv"><span>connections</span><code>${d.connections.length}</code></div>` +
      `<div class="st-kv"><span>groups</span><code>${d.groups.length}</code></div>` +
      `<div class="st-kv"><span>target</span><code>${esc(r ?? "no folder open")}</code></div>` +
      `<h3 style="margin-top:14px">Panels</h3>${panelsBlock(d)}` +
      resultBlock();
  }

  /* ── interacção do canvas: seleccionar, ligar, arrastar, redimensionar ── */
  function onCanvasDown(e: MouseEvent): void {
    const svg = q<SVGSVGElement>("[data-arch-svg]");
    if (!svg || e.button !== 0) return;
    const s = studio.state();
    const t = e.target as Element;
    const r = svg.getBoundingClientRect();
    const vbw = Number(svg.getAttribute("width")) || r.width;
    const k = r.width ? vbw / r.width : 1;
    const x0 = e.clientX, y0 = e.clientY;
    const drag = (onMove: (dx: number, dy: number) => void, onEnd: (moved: boolean) => void): void => {
      let moved = false;
      const mv = (ev: MouseEvent): void => {
        const dx = (ev.clientX - x0) * k, dy = (ev.clientY - y0) * k;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        moved = true;
        onMove(dx, dy);
      };
      const up = (): void => {
        document.removeEventListener("mousemove", mv);
        document.removeEventListener("mouseup", up);
        onEnd(moved);
      };
      document.addEventListener("mousemove", mv);
      document.addEventListener("mouseup", up);
      e.preventDefault();
    };

    if (s.proposal) return; // uma proposta é só para ver: decide-se na barra
    const nodeEl = t.closest<SVGGElement>("[data-n]");
    if (s.linking !== null) { studio.linkClick(nodeEl?.dataset.n ?? null); return; }

    const handle = t.closest<SVGElement>("[data-gr]");
    if (handle) {
      const id = handle.dataset.gr!;
      const g = findGroup(s.design, id), shown = layout(s.design).groups.get(id);
      if (!g || !shown) return;
      const w0 = shown.w - (g.x - shown.x), h0 = shown.h - (g.y - shown.y);
      drag((dx, dy) => studio.resizeGroup(id, w0 + dx, h0 + dy), (moved) => { if (moved) studio.endResize(); });
      return;
    }
    if (nodeEl) {
      const id = nodeEl.dataset.n!;
      const n = findNode(s.design, id);
      if (!n) return;
      const nx = n.x, ny = n.y;
      studio.select({ t: "node", id });
      drag((dx, dy) => studio.move(id, Math.max(0, nx + dx), Math.max(0, ny + dy)), (moved) => { if (moved) studio.endMove(id); });
      return;
    }
    const edgeEl = t.closest<SVGGElement>("[data-e]");
    if (edgeEl) { studio.select({ t: "edge", i: Number(edgeEl.dataset.e) }); return; }
    const groupEl = t.closest<SVGGElement>("[data-g]");
    if (groupEl) {
      const id = groupEl.dataset.g!;
      const g = findGroup(s.design, id);
      if (!g) return;
      let lx = 0, ly = 0;
      studio.select({ t: "group", id });
      drag((dx, dy) => {
        const gx = Math.max(0, g.x + dx - lx) - g.x, gy = Math.max(0, g.y + dy - ly) - g.y;
        lx += gx; ly += gy;
        studio.moveGroup(id, gx, gy);
      }, (moved) => { if (moved) studio.endGroupMove(id); });
      return;
    }
    studio.select(null);
  }

  function repaint(scope: Repaint): void {
    if (!host || !host.isConnected) return;
    if (scope === "all") { paintBar(); paintCanvas(); paintInspector(); }
    else if (scope === "canvas") paintCanvas();
    else if (scope === "drag") paintCanvas(true);
    else paintInspector();
  }

  return {
    /** Monta a vista num separador (chamado pelo `VIEW.arch`). */
    mount(el: HTMLElement): void {
      host = el;
      studio.ensureLoaded();
      renderShell();
      repaint("all");
      if (studio.state().design.components.length) void studio.validate();
    },
    repaint,
  };
}
