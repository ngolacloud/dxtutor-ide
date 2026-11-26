/* ═════════ feature `project` — domain: what creating the Project from a backlog did (`/project`) ═════════
   The answer of `project_create_from_backlog` (`tutor_board::project::backlog::Created`), narrowed. Pure. */

import { parseProject, type Project } from "./types";

export interface NotReady {
  key: string;
  missing: string[];
}

export interface BacklogCreated {
  project: Project;
  /** `[ref, key]` of each issue created, in the draft's order. */
  created: Array<[string, string]>;
  /** `[ref, key]` of each issue the project already had (same title): not created again. */
  existing: Array<[string, string]>;
  sprints: string[];
  /** The keys approved as Ready. */
  ready: string[];
  notReady: NotReady[];
}

const pairs = (v: unknown): Array<[string, string]> =>
  Array.isArray(v)
    ? v.filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string")
    : [];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseBacklogCreated(v: unknown): BacklogCreated | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const project = parseProject(o.project);
  if (!project) return null;
  const notReady = Array.isArray(o.notReady)
    ? o.notReady
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && typeof (x as Record<string, unknown>).key === "string")
        .map((x) => ({ key: x.key as string, missing: strings(x.missing) }))
    : [];
  return { project, created: pairs(o.created), existing: pairs(o.existing), sprints: strings(o.sprints), ready: strings(o.ready), notReady };
}
