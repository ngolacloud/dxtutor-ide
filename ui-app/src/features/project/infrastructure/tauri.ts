/* ═════════ feature `project` — gateway over the Tauri commands `project_*` ═════════ */

import { projectClient } from "../../../platform/tauri/project";
import { isDesktop } from "../../../platform/tauri/core";
import { fsClient } from "../../../platform/tauri/fs";
import type { ProjectGateway } from "../application/ports";

const client = projectClient();

export const tauriProjectGateway: ProjectGateway = {
  available: () => isDesktop(),
  load: (root) => client.load(root),
  apply: (root, op) => client.apply(root, op),
  issue: (root, key) => client.issue(root, key),
  reports: (root) => client.reports(root),
  audit: (root, issue) => client.audit(root, issue),
  issuePrompt: (root, key) => client.issuePrompt(root, key),
};

/** RF-B04: writes a template file inside the open folder (`write_file`). */
export const writeProjectFile = (root: string, rel: string, content: string): Promise<void> => fsClient().writeFile(root, rel, content);
