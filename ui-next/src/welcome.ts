// The welcome screen: the v7 look (hero + a grid of cards), but every card fires a REAL
// action — no scripted missions, no Design/Deploy theatre. Shown while no file is open.

import { svg } from "./icons";
import { Workspace } from "./workspace";
import { t } from "./i18n";

export interface WelcomeActions {
  openFolder(): void;
  openRecent(path: string): void;
  newFile(): void;
  goView(view: string): void;
  focusCodev(): void;
}

export function renderWelcome(host: HTMLElement, acts: WelcomeActions): void {
  const card = (icon: string, title: string, sub: string): string =>
    `<button class="wbtn"><span class="wi">${svg(icon)}</span><span><b>${title}</b><span class="ws">${sub}</span></span></button>`;

  const recent = Workspace.recent();
  const recentCards = recent
    .slice(0, 3)
    .map((p) => card("folder", p.split("/").pop() || p, p))
    .join("");

  host.innerHTML = `
    <div class="wl">
      <div class="wl-hero">
        <div class="logo"></div>
        <div>
          <div class="wl-title">dxtutor <b>IDE</b></div>
          <div class="wl-sub">${t("welcome.sub")}</div>
        </div>
      </div>
      <div class="wl-sec">${t("welcome.start")}</div>
      <div class="wgrid" data-grid="start">
        ${card("folderOpen", t("welcome.openFolder"), t("welcome.openFolderSub"))}
        ${card("file", t("welcome.newFile"), t("welcome.newFileSub"))}
      </div>
      ${recent ? `<div class="wl-sec">${t("welcome.recent")}</div><div class="wgrid" data-grid="recent">${recentCards}</div>` : ""}
      <div class="wl-sec">${t("welcome.work")}</div>
      <div class="wgrid" data-grid="work">
        ${card("sparkle", t("welcome.codev"), t("welcome.codevSub"))}
        ${card("search", t("welcome.search"), t("welcome.searchSub"))}
        ${card("scm", t("welcome.scm"), t("welcome.scmSub"))}
      </div>
    </div>`;

  const grids = host.querySelectorAll<HTMLElement>(".wgrid");
  const wire = (grid: string, fns: ((...a: string[]) => void)[]) => {
    const g = host.querySelector(`[data-grid="${grid}"]`);
    g?.querySelectorAll(".wbtn").forEach((b, i) => b.addEventListener("click", () => fns[i]?.()));
  };
  void grids;
  wire("start", [() => acts.openFolder(), () => acts.newFile()]);
  if (recent) wire("recent", recent.slice(0, 3).map((p) => () => acts.openRecent(p)));
  wire("work", [() => acts.focusCodev(), () => acts.goView("search"), () => acts.goView("scm")]);
}
