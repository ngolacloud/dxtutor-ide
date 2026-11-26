/* ═════════ feature `project` — gateway over the Tauri commands `project_*` ═════════ */

import { projectClient } from "../../../platform/tauri/project";
import { isDesktop } from "../../../platform/tauri/core";
import { fsClient } from "../../../platform/tauri/fs";
import { archRulesCommit } from "../../../platform/tauri/arch";
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
  conformance: (root) => client.conformance(root),
  sprintPlan: (root, sprint, codevs) => client.sprintPlan(root, sprint, codevs),
};

/** RF-B04: writes a template file inside the open folder (`write_file`). */
export const writeProjectFile = (root: string, rel: string, content: string): Promise<void> => fsClient().writeFile(root, rel, content);

/** RF-B04 (F4.4): the template's own commit (`arch_rules_commit` takes only `.dxtutor/prompts/*.md`
 *  from the tech lead). */
export const commitProjectFile = (root: string, rel: string, message: string): Promise<string> => archRulesCommit(root, [rel], message);
