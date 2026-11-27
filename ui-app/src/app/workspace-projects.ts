/* ═════════ dxtutor IDE — the projects of the open workspace and the current one (H2, decision D2) ═════════
   A workspace (the folder that is open) holds one or several projects: the build manifests up to two levels deep,
   or what `.dxtutor/workspace.json` declares (backend: `tutor_agent::workspace`). The CURRENT project is what the
   Project board shows and where a new Co-Dev conversation works (its commands, instructions and boundaries). It
   is remembered per folder; with several projects the status bar shows it (`#st-project`) and a click picks
   another in the palette. Without the desktop app there is no workspace: nothing here runs. */

import { esc } from "../core";
import { isDesktop } from "../platform/tauri/core";
import { workspaceProjects as fetchProjects } from "../platform/tauri/projects";
import { callGlobal, registerActions } from "./actions";

export interface WsProject {
  name: string;
  /** relative to the workspace, `"."` for the root */
  path: string;
  language: string;
  test: string | null;
  lint: string | null;
  declared: boolean;
}

/** Narrows `workspace_projects`. */
export function parseWorkspace(v: unknown): WsProject[] {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const list = Array.isArray(o.projects) ? o.projects : [];
  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  return list
    .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null && !!str((p as Record<string, unknown>).path))
    .map((p) => ({ name: str(p.name) || str(p.path), path: str(p.path), language: str(p.language), test: str(p.test) || null, lint: str(p.lint) || null, declared: p.declared === true }));
}

/** The folder of a project of `root`. */
export const projectDir = (root: string, path: string): string => (path === "." ? root : `${root.replace(/\/+$/, "")}/${path}`);

const KEY = (root: string): string => `dx-project:${root}`;
let root: string | null = null;
let projects: WsProject[] = [];
let current = ".";
const listeners = new Set<() => void>();

function remember(): void {
  try {
    if (root) localStorage.setItem(KEY(root), current);
  } catch {
    /* no storage here: the choice lasts this session */
  }
}

function recall(r: string): string | null {
  try {
    return localStorage.getItem(KEY(r));
  } catch {
    return null;
  }
}

function drawChip(): void {
  let el = document.getElementById("st-project");
  if (!el) {
    const anchor = document.getElementById("st-tests");
    if (!anchor) return;
    el = document.createElement("span");
    el.id = "st-project";
    el.className = "si";
    el.setAttribute("data-action", "workspace:pickProject");
    anchor.insertAdjacentElement("beforebegin", el);
  }
  const p = workspaceProjects.current();
  el.style.display = projects.length > 1 && p ? "" : "none";
  el.innerHTML = p ? `◫ ${esc(p.name)}` : "";
  el.title = p ? `Project: ${p.path === "." ? "the workspace root" : p.path} — click to work in another project of this workspace` : "";
}

function changed(): void {
  drawChip();
  listeners.forEach((f) => f());
}

export const workspaceProjects = {
  list: (): WsProject[] => projects,
  current: (): WsProject | null => projects.find((p) => p.path === current) ?? projects[0] ?? null,
  /** The current project's path relative to the workspace (`"."`: the root). */
  currentPath: (): string => workspaceProjects.current()?.path ?? ".",
  /** The current project's folder (absolute), or `null` without a workspace. */
  currentDir: (): string | null => (root ? projectDir(root, workspaceProjects.currentPath()) : null),
  select(path: string): void {
    if (!projects.some((p) => p.path === path) || path === current) return;
    current = path;
    remember();
    changed();
  },
  onChange(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
  /** Reads the projects of `r` (the folder just opened). */
  async load(r: string, fetch: (root: string) => Promise<unknown> = fetchProjects): Promise<void> {
    root = r;
    projects = [];
    current = ".";
    try {
      projects = parseWorkspace(await fetch(r));
    } catch {
      projects = [];
    }
    if (root !== r) return; // another folder opened meanwhile
    const saved = recall(r);
    current = saved && projects.some((p) => p.path === saved) ? saved : projects.find((p) => p.path === ".")?.path ?? projects[0]?.path ?? ".";
    changed();
  },
};

registerActions({
  "workspace:pickProject": {
    click: () =>
      void callGlobal("palette", "", {
        ph: "Work in which project of this workspace?",
        items: projects.map((p) => ({ l: p.name, d: `${p.path === "." ? "(root)" : p.path}${p.language ? ` · ${p.language}` : ""}`, run: () => workspaceProjects.select(p.path) })),
      }),
  },
});

/* in a setTimeout(0), like the debugger's capabilities: the board loads first when a folder opens (its IPC order
   is fixed by board.persist.test) */
document.addEventListener("dx:workspace", (e) => {
  const r = (e as CustomEvent<{ root?: string }>).detail?.root;
  if (isDesktop() && r) setTimeout(() => void workspaceProjects.load(r), 0);
});
