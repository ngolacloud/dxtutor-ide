/* ═══════════ feature `codebase` — ui: the Dependencies and Onboarding tabs (A10) ═══════════
   Texts from the catalog, the rest escaped. Actions: data-action="cb-…" + data-on. No window. */

import { esc } from "../../../core";
import { isVuln, sortVulns, updateCompatible, upgradeLatest } from "../domain/rules";
import type { CodebaseState } from "../application/codebase-service";
import type { CodebaseKey } from "./messages";

export type T = (k: CodebaseKey, p?: Record<string, string | number>) => string;
const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string => `<button class="${cls}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;
const mini = (act: string, label: string, on: string): string => `<button class="cb-mini" data-action="${act}" data-on="${esc(on)}">${label}</button>`;

export function renderDeps(t: T, st: CodebaseState, canAsk: boolean, desktop: boolean): string {
  if (!desktop) return `<div class="cb"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  const head = `<div class="cb-top"><b>${t("depsTitle")}</b><span class="cb-dim">${t("depsSub")}</span></div><div class="cb-bar"><label class="cb-online"><input type="checkbox" data-action="cb-online"${st.online ? " checked" : ""}> <span>${t("online")}</span></label>${btn("cb-check", st.depsBusy ? t("checking") : t("check"), "", "btn ghost", st.depsBusy)}${btn("cb-tests", t("runTests"))}</div>${st.online ? "" : `<div class="cb-dim">${t("offlineNote")}</div>`}${st.ran ? `<div class="cb-ran notr">${esc(t("ran", { c: st.ran }))}</div>` : ""}${st.error ? `<pre class="cb-err notr">${esc(st.error)}</pre>` : ""}`;
  const r = st.deps;
  if (!r) return `<div class="cb">${head}${st.depsBusy ? `<div class="sec-empty">${t("checking")}</div>` : ""}</div>`;
  if (!r.ecosystems.length) return `<div class="cb">${head}<div class="sec-empty">${t("noEco")}</div></div>`;
  const ecos = r.ecosystems.map((e, i) => {
    const vulns = sortVulns(e.vulns);
    const vrows = vulns.length ? vulns.map((v) => `<div class="cb-row${isVuln(v) ? " bad" : ""}"><span class="cb-sev s-${esc(v.severity.toLowerCase())}">${esc(v.severity)}</span><span class="notr cb-nm">${esc(v.package)} ${esc(v.version)}</span><span class="notr">${esc(v.title)}</span><span class="cb-dim notr">${v.fixed.length ? esc(t("fixed", { v: v.fixed.join(", ") })) : t("noFix")}</span><span class="cb-sp"></span>${v.url ? `<a class="cb-mini notr" href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.id)}</a>` : `<span class="cb-dim notr">${esc(v.id)}</span>`}${canAsk ? mini("cb-why", t("why"), `${i}|${v.id}`) : ""}</div>`).join("") : `<div class="sec-empty">${t("none")}</div>`;
    const orows = e.outdated.length ? e.outdated.map((d) => {
      const up = updateCompatible(e, d), lat = upgradeLatest(e, d);
      return `<div class="cb-row"><span class="notr cb-nm">${esc(d.name)}</span>${d.direct ? `<span class="cb-tag">${t("direct")}</span>` : ""}<span class="cb-dim notr">${esc(d.current)}${d.compatible ? ` → ${esc(d.compatible)}` : ""}${d.latest ? ` · latest ${esc(d.latest)}` : ""}</span><span class="cb-jump j-${d.jump}">${d.jump}</span><span class="cb-sp"></span>${up ? mini("cb-update", t("update"), `${i}|${d.name}`) : ""}${lat ? mini("cb-upgrade", t("upgrade", { v: d.latest ?? "" }), `${i}|${d.name}`) : ""}${canAsk && (d.jump === "major" || d.latest) ? mini("cb-plan", t("plan"), `${i}|${d.name}`) : ""}</div>`;
    }).join("") : `<div class="sec-empty">${t("none")}</div>`;
    return `<section class="cb-sec"><h3><span class="notr">${esc(e.kind)}</span> · <span class="notr">${esc(e.dir)}</span></h3>${e.notes.map((n) => `<div class="cb-dim notr">${esc(n)}</div>`).join("")}<div class="cb-ct">${t("vulns")} <span class="cb-dim">${vulns.length}</span></div>${vrows}<div class="cb-ct">${t("outdated")} <span class="cb-dim">${e.outdated.length}</span></div>${orows}<div class="cb-dim notr">${esc(e.commands.join(" · "))}</div></section>`;
  }).join("");
  return `<div class="cb">${head}${ecos}</div>`;
}

export function renderMap(t: T, st: CodebaseState, canAsk: boolean, desktop: boolean): string {
  if (!desktop) return `<div class="cb"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  const head = `<div class="cb-top"><b>${t("mapTitle")}</b><span class="cb-dim">${t("mapSub")}</span></div><div class="cb-bar">${btn("cb-map-refresh", t("refresh"), "", "btn ghost", st.mapBusy)}${canAsk && st.map ? btn("cb-tour", t("tour"), "", "btn ghost cb-ai") : ""}</div>${st.error ? `<pre class="cb-err notr">${esc(st.error)}</pre>` : ""}`;
  const m = st.map;
  if (!m) return `<div class="cb">${head}<div class="sec-empty">${t("loading")}</div></div>`;
  const total = Math.max(1, m.languages.reduce((a, l) => a + l.lines, 0));
  const langs = `<div class="cb-langs">${m.languages.filter((l) => l.lines > 0).slice(0, 8).map((l) => `<span class="cb-lang" style="flex:${Math.max(1, Math.round((l.lines / total) * 100))}" title="${esc(l.name)} · ${l.lines}"><b class="notr">${esc(l.name)}</b> <span class="cb-dim">${t("lines", { n: l.lines })} · ${t("files", { n: l.files })}</span></span>`).join("")}</div><div class="cb-dim">${t("files", { n: m.totalFiles })} · ${t("tests", { n: m.tests })}</div>`;
  const card = (title: string, body: string) => `<div class="cb-card"><div class="cb-ct">${title}</div>${body || `<div class="sec-empty">${t("none")}</div>`}</div>`;
  const entries = m.entries.map((e, i) => `<div class="cb-row"><span class="cb-tag">${esc(e.kind)}</span><span class="notr cb-nm">${esc(e.name)}</span><a class="cb-link notr" data-action="cb-open" data-on="${esc(e.file)}">${esc(e.file)}</a><span class="cb-sp"></span>${e.run ? mini("cb-run", t("run"), String(i)) : ""}</div>`).join("");
  const docs = m.docs.map((d) => `<div class="cb-row"><a class="cb-link notr" data-action="cb-open" data-on="${esc(d)}">${esc(d)}</a></div>`).join("");
  const hot = m.hot.map((h) => `<div class="cb-row"><a class="cb-link notr" data-action="cb-open" data-on="${esc(h.file)}">${esc(h.file)}</a><span class="cb-sp"></span><span class="cb-dim">${t("changes", { n: h.changes })}</span></div>`).join("");
  const people = m.people.map((p) => `<div class="cb-row"><span class="notr">${esc(p.name)}</span><span class="cb-sp"></span><span class="cb-dim">${t("commits", { n: p.commits })}</span></div>`).join("");
  const mods = m.modules.map((x) => `<div class="cb-row"><a class="cb-link notr" data-action="cb-open" data-on="${esc(x.file)}">${esc(x.file)}</a><span class="cb-sp"></span><span class="cb-dim">${t("symbols", { n: x.symbols })}</span></div>`).join("");
  return `<div class="cb">${head}${m.notes.map((n) => `<div class="cb-dim notr">${esc(n)}</div>`).join("")}<div class="cb-card">${`<div class="cb-ct">${t("languages")}</div>`}${langs}</div><div class="cb-grid">${card(t("entries"), entries)}${card(t("docs"), docs)}${card(t("hot"), hot)}${card(t("people"), people)}${card(t("modules"), mods)}</div></div>`;
}
