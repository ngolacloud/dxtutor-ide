/* ═════════ feature `welcome` — ui: the Welcome page and a walkthrough page (r23 F6) ═════════
   Markup only: what the service says, as HTML with `data-action`/`data-on` (the shared dispatcher; no inline
   handlers). Two columns like VS Code: Start + Recent on the left, Walkthroughs on the right; the startup
   checkbox at the bottom. A walkthrough opens as its own tab: the steps on the left, the selected step's
   text and its action on the right. */

import { stepAction, type Walkthrough } from "../domain/walkthroughs";
import { isDone, type Progress, type WelcomeState } from "../domain/progress";
import type { RecentEntry } from "../domain/recent";
import type { WelcomeKey } from "./messages";

export type T = (k: WelcomeKey, p?: Record<string, string | number>) => string;
export type Icon = (name: string) => string;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
const k = (s: string): WelcomeKey => s as WelcomeKey;

export interface WelcomeModel {
  desktop: boolean;
  cloning: boolean;
  tagline: string;
  recent: RecentEntry[];
  moreRecent: boolean;
  walks: Array<{ w: Walkthrough; progress: Progress; fresh: boolean }>;
  show: boolean;
}

function startItem(ic: Icon, icon: string, label: string, action: string, disabled?: string): string {
  return `<li><button class="wel-link" data-action="welcome:${action}"${disabled ? ` disabled title="${esc(disabled)}"` : ""}>${ic(icon)}<span>${esc(label)}</span></button></li>`;
}

export function renderWelcome(t: T, ic: Icon, m: WelcomeModel): string {
  const off = m.desktop ? undefined : t("desktopOnly");
  const start = [
    startItem(ic, "folder", t("newProject"), "newProject", off),
    startItem(ic, "file", t("newFile"), "newFile"),
    startItem(ic, "search", t("openFile"), "openFile"),
    startItem(ic, "folder", t("openFolder"), "openFolder", off),
    startItem(ic, "scm", m.cloning ? t("cloningShort") : t("clone"), "clone", off ?? (m.cloning ? t("cloningShort") : undefined)),
    startItem(ic, "remote", t("connect"), "connect"),
    startItem(ic, "broadcast", t("joinPair"), "pairJoin"),
  ].join("");
  const recent = m.recent.length
    ? `<ul class="wel-list">${m.recent.map((r) => `<li><button class="wel-link wel-recent" data-action="welcome:openRecent" data-on="${esc(r.path)}" title="${esc(r.path)}"${off ? " disabled" : ""}><span>${esc(r.name)}</span><span class="wel-dim">${esc(r.parent)}</span></button></li>`).join("")}${m.moreRecent ? `<li><button class="wel-link" data-action="welcome:moreRecent">${esc(t("more"))}</button></li>` : ""}</ul>`
    : `<p class="wel-dim">${esc(m.desktop ? t("noRecentDesktop") : t("noRecentBrowser"))}</p>`;
  const walks = m.walks.map(({ w, progress, fresh }) =>
    `<button class="wel-walk" data-action="welcome:openWalk" data-on="${w.id}"><span class="wel-walk-ic">${ic(w.icon)}</span><span class="wel-walk-b"><b>${esc(t(k(`${w.id}.title`)))}${fresh ? ` <span class="wel-new">${esc(t("fresh"))}</span>` : ""}</b><small>${esc(t(k(`${w.id}.desc`)))}</small>` +
    `<span class="wel-bar" title="${esc(t("progress", { done: progress.done, total: progress.total }))}"><span style="width:${progress.pct}%"></span></span></span></button>`).join("");
  return `<div class="page wel"><div class="wel-head"><div class="wel-logo">${ic("sparkle")}</div><div><h1>dxtutor</h1><div class="sub">${esc(m.tagline)}</div></div></div>
  <div class="wel-cols"><div class="wel-col"><h2>${esc(t("start"))}</h2><ul class="wel-list">${start}</ul><h2>${esc(t("recent"))}</h2>${recent}</div>
  <div class="wel-col"><h2>${esc(t("walkthroughs"))}</h2><div class="wel-walks">${walks}</div></div></div>
  <label class="wel-startup"><input type="checkbox" data-action="welcome:toggleShow"${m.show ? " checked" : ""}> ${esc(t("showOnStartup"))}</label></div>`;
}

export function renderWalk(t: T, ic: Icon, w: Walkthrough, st: WelcomeState, sel: number, progress: Progress, desktop: boolean): string {
  const i = Math.min(Math.max(sel, 0), w.steps.length - 1), s = w.steps[i];
  const steps = w.steps.map((x, j) => {
    const done = isDone(st, w.id, x.id);
    return `<li><button class="wel-step${j === i ? " on" : ""}${done ? " done" : ""}" data-action="welcome:step" data-on="${w.id}|${j}"><span class="wel-tick">${done ? ic("check") : ""}</span><span>${esc(t(k(`${w.id}.${x.id}`)))}</span></button></li>`;
  }).join("");
  const act = stepAction(s, desktop);
  const label = act && act !== s.action && act === "explorer" ? t("showExplorer") : t(k(`${w.id}.${s.id}.a`));
  const done = isDone(st, w.id, s.id);
  return `<div class="page wel wel-walkpage"><button class="wel-link wel-back" data-action="welcome:back">${esc("‹ " + t("back"))}</button>
  <div class="wel-head"><div class="wel-logo">${ic(w.icon)}</div><div><h1>${esc(t(k(`${w.id}.title`)))}</h1><div class="sub">${esc(t(k(`${w.id}.desc`)))}</div>
  <span class="wel-bar wide" title="${esc(t("progress", { done: progress.done, total: progress.total }))}"><span style="width:${progress.pct}%"></span></span></div></div>
  <div class="wel-cols"><ul class="wel-col wel-steps">${steps}</ul>
  <div class="wel-col wel-detail"><h2>${esc(t(k(`${w.id}.${s.id}`)))}</h2><p>${esc(t(k(`${w.id}.${s.id}.d`)))}</p>
  <div class="wel-acts">${act ? `<button class="btn" data-action="welcome:run" data-on="${w.id}|${s.id}">${esc(label)}</button>` : `<span class="wel-dim">${esc(t("desktopOnly"))}</span>`}
  ${done ? `<span class="wel-donelbl">${ic("check")} ${esc(t("doneLbl"))}</span>` : `<button class="mini" data-action="welcome:done" data-on="${w.id}|${s.id}">${esc(t("markDone"))}</button>`}</div></div></div></div>`;
}
