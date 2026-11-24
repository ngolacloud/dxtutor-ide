/* ═════════ feature `project` — gateway over the Tauri commands `project_*` ═════════ */

import { projectClient } from "../../../platform/tauri/project";
import { isDesktop } from "../../../platform/tauri/core";
import type { ProjectGateway } from "../application/ports";

const client = projectClient();

export const tauriProjectGateway: ProjectGateway = {
  available: () => isDesktop(),
  load: (root) => client.load(root),
  apply: (root, op) => client.apply(root, op),
  issue: (root, key) => client.issue(root, key),
  reports: (root) => client.reports(root),
};
