/* ═════════ dxtutor IDE — Co-Dev works on an issue (docs/v2/RF-DELONIX-PLANO.md F4) ═════════
   How the Project hands an issue to Co-Dev without a window global: the Co-Dev feature
   registers the implementation here; the Project imports this module and calls it with the
   exact prompt the backend assembled from the project's template (`project_issue_prompt`),
   the issue's scope and the template version. Unset (Co-Dev not loaded) → `null`. */

export interface IssueRun {
  key: string;
  /** The prompt as it is sent (the template rendered with the issue). */
  text: string;
  scope: string[];
  /** The template version, kept on the issue (RF-B04). */
  template: string;
}

let impl: ((r: IssueRun) => Promise<boolean> | null) | null = null;

export const codevIssue = {
  /** Co-Dev: registers the implementation. */
  register(run: (r: IssueRun) => Promise<boolean> | null): void {
    impl = run;
  },
  /** Sends the issue to Co-Dev; `null` when the agent is not available. */
  run(r: IssueRun): Promise<boolean> | null {
    return impl ? impl(r) : null;
  },
};
