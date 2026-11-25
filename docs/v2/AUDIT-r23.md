# AUDIT-r23: bringing the 24 Nov 2026 prototype improvements into dxtutor-ide (phase F0)

- Date: 2026-11-25.
- Repository state audited: `develop` at `a0e4822`, read in a detached worktree.
- Prototype package (read-only): `~/Downloads/dxtutor-ide-desktop/dxtutor-ide`.
- No code was changed.
- All repo paths below are relative to the repository root.
- In the package, `ui/…` means the r23 prototype files.

---

## 1. Scope and package check

| Module | In package? | Size | Behaviour it specifies | Requirement IDs |
|---|---|---|---|---|
| `ui/welcome.js` | yes | 25,075 B | VS Code-style Welcome. Start actions: New File, Open File, Open Folder, Clone, Template, Connect to, Join PairCode. Recent folders plus "More…". Walkthroughs with progress, opened as a guided page (steps, a mock picture, one action per step, "Mark done"). "Show welcome page on startup". | none (F6) |
| `ui/debugx.js` | yes | 77,504 B | Debugger with a recorded run and time travel. Floating toolbar, inline values, exception helper, breakpoint kinds and groups, variables tree, watch, side-effect-free console, threads and Just My Code, timeline with queries, memory and diagnostics, Co-Dev hypotheses and fix. | UI-DBG-07…14 (also touches 01–06) |
| `ui/gitx.js` | yes | 62,938 B | Source Control and Commit Graph. Sidebar, token search, lifecycle per commit, hunk staging, lanes, undo timeline, conflict prediction, three-way merge, Launchpad, Commit Composer, sync/push with approval. | UI-SCM-08…14 |
| `ui/ops.js` | yes | 71,376 B | Work-first Platform activity. My queue, Team list, data sources ("not connected"), catalog and scorecards, GitOps tree/sync, runbooks as code plus runner, PR infra review, incidents, cost, inventory, ISO 27001 evidence export. | UI-PLAT-09…14, RF-BK-Q01–03, R01–03, C01–03, A01–03 |
| `ui/platform.js` | **NO** (not anywhere under `~/Downloads/dxtutor-ide-desktop`) | n/a | IaC workbench, Vault, guided deploy, data protection. Audited from the requirements only. | UI-PLAT-01…08, RF-BK-P01–06, K01–05, D01–04, X02–X04 |

Notes on the package:

- **`ops.js` depends on `platform.js`.**
  - It reads `window.PX` 21 times: `PX.findings()`, `runs`, `deploys`, `audit`, `drift`, `vaultOn()`, `openVault()`, `openIac()`, `deploy()`, `validate()`, `dynamic()`, `vsel`, `save()`.
  - Every call is wrapped in `try/catch`.
  - So the ops behaviour that consumes IaC/Vault/deploy state is only half-specified until `platform.js` arrives: queue items `iac` and `vault`, the scorecards, the evidence sections for A.8.32 and A.5.17/A.8.12, and "Deploys you ran".
- The other package files (`bridge.js`, `v9.js`, `project.js`, `pair.js`) were read only to resolve globals (§2.5).
- Requirements were read from:
  - `docs/v2/RF-backend.md` §8–§9 and §7 (G/L/B/X01, which §8–9 depend on);
  - `docs/v2/PROMPT-ui.en.md` A4, A7, A9;
  - `docs/v2/PROMPT-today.en.md`, the F0–F6 brief.
- Sample data that stays browser-only applies everywhere below. It may become test fixtures only:
  - `crates/store/src/lru.rs`, `infra/**`, `runbooks/**`, PR #49, INC-27;
  - the PEOPLE/SVC/DEPS tables;
  - the "sample data" chips.

---

## 2. Per module

### 2.1 welcome.js → `ui-app/src/features/welcome.ts` + `platform/desktop/workspace.ts`

| | Detail |
|---|---|
| **Exists** | (1) `ui-app/src/features/welcome.ts` (44 lines) registers `VIEW.welcome`. Cards: Design/Studio, Harness/Team, Deliver/Board, RUN, Deploy, Infra, Learning Track, Mission manager, Settings. Uses `data-action="welcome:*"` through `app/actions.ts`. Catalogue `features/welcome.messages.ts` holds only 3 keys; the card texts are still literal English. (2) Desktop port `desktopPorts.welcome` (`app/desktop.ts`), implemented in `platform/desktop/workspace.ts:172-188`. It adds an "Open Folder…" button and up to 4 recent folders from `LS["dx-recent"]` (max 8, written at `workspace.ts:43-45`), via `desktop:open` / `desktop:openRecent`. (3) File menu: Open Folder, Open Recent, Close Folder; `CMD` "File: Open Folder…"; Ctrl+O. (4) Tauri `git_clone(url, parent_dir)` exists (`src-tauri/src/commands/git.rs:135`, `gitops::clone`), but IPC-MATRIX §8 lists it with **no UI consumer**. |
| **Missing** | Two-column VS Code layout (Start / Recent / Walkthroughs). Start actions: New File, Open File (quick open), **Clone Git Repository…** (input, then approval showing the exact `git clone <url> <dir>`, then open the folder), New Project from a Template (needs a design decision, see §5), Connect to… (dev container → Infra, SSH (not available), pod, PairCode), Join PairCode. Recent: name + parent path, plus "More…" opening a palette over all of `dx-recent`. Walkthroughs: a `walk` tab kind, steps, progress bar, a "new" badge, persisted `wel.v1` (`done`, `show`), "Mark done", and an action per step. "Show welcome page on startup" toggle. Palette commands "Help: Welcome" and "Help: Walkthroughs". Theme picker modal. |
| **Prototype globals** | See the mapping table below. |

| Prototype global | Equivalent in our repo |
|---|---|
| `DXR.open` | `window.DXR` via the `desktop:open` action. Better: a `WelcomeDesktop.open(path?)` port method. |
| `LS` | `app/store/storage.ts` (`LS`) |
| `VIEW` | `app/store/registry.ts` |
| `openTab` / `tabOf` / `closeTab` / `show` / `cur` | `features/tabs.ts` exports; `editorStore` |
| `setPane` | `features/shell.ts` |
| `palette` | `features/palette.ts`, reached through bridges |
| `toast` | `core.ts` |
| `CMD` | `app/commands.ts` |
| `THEMES` / `THEME` / `setTheme` | `features/theme.ts` |
| `newFile` | `features/explorer.ts` |
| `codev.ask` | `app/codev-ask.ts` (`codevAsk.ask`) |
| `V9.ctx('file')` | does not exist as a registry. Pass explicit `AskContext` instead. |
| `V9.approve` | does not exist (see §2.5) |
| `V9.openTests` / `openDebug` / `openHood` / `openHistory` / `openRun` / `fixLexer` | exist as feature entry points (testing, debug, hood, scm file history). `fixLexer` is demo-only, so drop it. |
| `PJX.open` / `openIssue` | `features/project/index.ts` `openProject(sub)`. Wiring point only. |
| `PAIR.ui.open` | PairCode. Wiring point only. |
| `CLOUDX.*` | Cloud is out of scope. The closest is the Ops "Cloud" section. |
| `toggleAgent` | Co-Dev. Wiring point only. |

### 2.2 debugx.js → `ui-app/src/features/debug/` + `features/debug.ts` + backend DAP

| | Detail |
|---|---|
| **Exists: backend** | 21 commands in `src-tauri/src/commands/debug_cmds.rs`. Detection: `debug_capabilities`, `debug_available`. Session: `debug_launch(id, program, cwd, engine?)` (lldb-dap if found, else gdb/MI3), `debug_break`, `debug_run`, `debug_continue`, `debug_step(into, kind?)` (step out over DAP only), `debug_locals`, `debug_stack(thread?)`, `debug_stop`. DAP only: `debug_set_breakpoints` (condition, hitCondition, logMessage), `debug_stop_on_panic` (function bp on `rust_panic`), `debug_threads`, `debug_variables(frame, ref?)` (with a `changed` flag), `debug_evaluate` (`context:"watch"`), `debug_pause`. Also `debug_snapshot` (markdown linked to an issue, UI-DBG-05), `breakpoints_load` / `breakpoints_save` (SQLite `crates/tutor-board/src/project/breakpoints.rs`), `debug_attach_targets` / `debug_attach` (local, docker, podman, kubectl; `crates/tutor-eval/src/attach.rs`). Event `debug://output`. Files: gdb/MI in `src-tauri/src/debug.rs`; DAP client `crates/tutor-eval/src/dapc.rs` (stdio, `STDIO_ADAPTERS=["lldb-dap","lldb-vscode"]`); detector `crates/tutor-eval/src/dap.rs` (lists codelldb, but **dapc cannot drive it**). |
| **Exists: UI** | Engine `features/debug/application/debug-engine.ts`: Cargo build, binary picker, or an executable path. Domain: `domain/dap.ts` (`BpMeta`, `specsFor`, `bpKind`, `inlineValues`), `domain/breakpoints.ts`, `domain/session.ts`. Pane `renderDebugPane` (`features/debug.ts`): Continue/Over/Into/Stop (+ Out/Pause on DAP), "Stop on panic", threads, lazy variables tree with changed marks, call stack with frame selection, watch, output, breakpoints list, Co-Dev "explain" / "turn into a test", Save snapshot. Gutter menu `ui/dap-view.ts` `bpMenu`: condition, hit count, logpoint, enable/disable. Inline values via `app/inline-values.ts` → `features/editor.ts` `.dv-inline`. Bottom tab "Debug assistant" (`#pc-dbg`). Shortcuts F5, Shift+F5, F9, F10, F11 (`features/shortcuts.ts:46-48`). Ports: `DebugPort`, `ProjectDebugPort`, `DebugCodevPort`, `DebugStore`, `Editor`, `Shell`, `Picker`, `DebugView`, `Notifier` (`application/ports.ts`); adapters `infrastructure/tauri.ts`, `legacy-bridge.ts`. Catalogues `application/messages.ts`, `ui/dap-messages.ts`. Tests `debug.domain`, `debug.dap`, `debug.golden` (+snapshot); Rust live tests in `dapc.rs`, `debug.rs`, `attach.rs`. Selftest step `debug` (`platform/desktop/selftest.ts:550-580`). |
| **Missing: UI-DBG-07** | Floating toolbar over the editor: reverse continue, step back, continue, over, into, out, run to cursor, restart frame, restart, stop. LIVE/REPLAY badge and "step n/N". Draggable. Missing shortcuts: Shift+F11 (out), Ctrl+F10 (run to cursor), Shift+F10 (step back), Shift+F9 (reverse continue), Ctrl+Shift+F5 (restart). |
| **Missing: UI-DBG-08** | Inline values after **each executed line** (today: locals painted up to 40 lines above the stop), with changed values highlighted. Condition insights (true/false), return values, predicted value of the current line (needs a recording), dimmed lines that will not run (needs a recording), PerfTips (time since the previous stop), pinned inline watches. |
| **Missing: UI-DBG-09** | Exception helper card anchored under the panicking line: message, left/right of `assert_eq!`, a cause chain from the recording (each link jumps to the step). Actions: where did the value go, add a data breakpoint, Co-Dev analysis, copy. |
| **Missing: UI-DBG-10** | Triggered breakpoints (armed by another bp; enforced client-side). Data breakpoints (`dataBreakpointInfo` / `setDataBreakpoints`; lldb-dap supports watchpoints). Breakpoint groups (switch a scenario on/off). Exception settings: panic, plus "`Err` through `?` in my code" (no DAP filter exists for the latter; needs a design decision, see §5). |
| **Missing: UI-DBG-11** | Variable actions "where did this come from" (needs rr) and "pin inline". Deque view with oldest/newest and a raw buffer. **Debug console/REPL** with history. Evaluate "without side effects": DAP has no guarantee; lldb-dap `evaluate` can call functions (see §5). |
| **Missing: UI-DBG-12** | Just My Code (collapse frames whose source is outside the workspace or in `~/.cargo`/`rustlib`). Parallel Stacks view with a Co-Dev summary. Frame selection already moves the editor; inline values must follow the selected frame. |
| **Missing: UI-DBG-13** | Recording timeline: call depth, events, value tracks, scrub to travel. Queries ("when did map lose a", every write to X, every return value). Only real under rr: reverse-continue to watchpoint hits gives "last write". |
| **Missing: UI-DBG-14** | Memory: type layout with offsets (no DAP request; needs lldb `frame variable -L` / `memory read` through `evaluate` in repl context, or `readMemory`). Ring-buffer view. Heap over the run; steps by function. "Code changed, rebuild and replay to step n". |
| **Missing: time travel (F2)** | Nothing for rr exists. Needed: `rr record <test-binary> <filter>`, then `rr replay` served to the client. Option (a): rr's gdbserver + **gdb** (`gdb` is not installed). Option (b): lldb `gdb-remote` connect to `rr replay -s <port>`. lldb's reverse-execution support over gdb-remote is limited, so this must be verified before committing to it. Linux only; hide the reverse buttons elsewhere, with a reason. |
| **Missing: other** | Launch configurations for "debug this test" (`cargo test --no-run --message-format=json` to find the test binary, plus a filter arg). Core-dump attach. Opening an rr trace ("Recording…"). |

| Prototype global | Equivalent |
|---|---|
| `BPS` / `saveBps` | `features/debug.ts` (the breakpoints Set, exported as `dbgBreaks` since U7p5) + `BPMETA` (LS `bps6` / `bpmeta6`, and SQLite on desktop). Extend `BpMeta` with `trig`, `group`, `data`. |
| `CFG` (LS `dxdbg.v1`) | does not exist. Add watch/pins/exc/groups to `DebugStore`, persisted per project. |
| `FS` | `app/store/workspace.ts` (`workspaceStore`) |
| `GIT.trees` | scm residue `features/scm.ts`. Not needed outside browser fixtures. |
| `startDebug` / `dbgStep` / `dbgContinue` / `dbgStop` / `drawDbg` / `RP.debug` | `features/debug.ts` exports (no longer on `window` since ADR-0004 U7p5) |
| `debugConfigs` | does not exist. Launch configs are built in `debug-engine.ts` (`cargoTargets`). |
| `DBG` | the engine's session state |
| `paintEd` | `features/editor.ts` (through bridges) |
| `openPath` / `tabOf` / `cur` | `features/tabs.ts` / `editorStore` |
| `palette` / `toast` / `card` | palette / `core.ts` / panel `card` |
| `setPanelTab` / `togglePanel` / `setVar` / `getVar` | `features/shell.ts` (`services.shell`) |
| `MENUS` / `buildMenubar` / `CMD` | `app/commands.ts` (MENUS still on `window`, owned by `boot-steps.ts`) |
| `codev.ask` | `codevAsk.ask` |
| `codev.register('dbx')` | does not exist. Pass context in the ask. |
| `V9.stream({path,start,end,text})` | does not exist as a public API **by design**: Co-Dev streams its own proposals (RF-CODEV-STREAM). The debugger asks with `codevAsk.ask({intent:"fix", context:[frame, panic]})`. |
| `PJX.PJ` | `features/project/` (`project_load` via `ProjectDebugPort`) |
| `LS` | `app/store/storage.ts` |
| `ROOT` | `workspaceStore` root / `DXR.root` |

### 2.3 gitx.js → `ui-app/src/features/scm/` + `features/scm.ts` + `features/graph.ts` + `src-tauri/src/commands/git.rs`

| | Detail |
|---|---|
| **Exists: backend** | 22 commands in `src-tauri/src/commands/git.rs`, all **git CLI**, via `crates/tutor-eval/src/git.rs`, `gitx.rs` and the use-case layer `src-tauri/src/gitops.rs`. Read: `git_changes`, `git_log` (`--all`, parents), `git_show`, `git_branch`, `git_branches`, `git_diff` (worktree/staged, file), `git_blame` (+authors), `git_history` (`--follow`, `-L`), `git_show_path`, `git_compare`, `git_diff_range`. Write: `git_stage`, `git_unstage`, `git_stage_all`, `git_commit`, `git_checkout`, `git_create_branch`, `git_clone`, `git_stash` (list/push/apply/drop/show), `git_worktree` (list/add/remove), `git_rebase` (plan/run), `git_amend` (refuses published commits unless `allowPublished`). **Most write commands have no UI consumer** (IPC-MATRIX §8, lines 235-265). Real mutations go through the generic `exec("git", …)` in `platform/desktop/context.ts:40` and `platform/desktop/git.ts`. |
| **Exists: UI** | State in `features/scm.ts:69-73` (`GIT`, `STAGED`, `BRANCH`, `COMMITS`, `AUTHOR`, `LANE`), window-published, typed in `scm/domain/types.ts`. Engine `scm/application/scm-engine.ts`. Port `desktopPorts.scm: ScmDesktop {commit, checkout, gitMerge, gfStart, gfFinish}` (`platform/desktop/git.ts`). `syncGit` rebuilds the DAG from `git log --all -n 400` + `for-each-ref refs/heads refs/tags` (no remotes, `files: []`). Graph tab `features/graph.ts` + `scm/domain/graph.ts` (lanes, refs, tags, merge badges). SCM pane: branches, last 7 commits, stashes, worktrees, Co-Dev change sets by issue, "More git" (`scm/extras.ts`, `scm/ui/git-views.ts`). A4 extras (`application/extras-ports.ts`: `GitExtrasPort`, `GitWorkspacePort`, `HumanPort`, `CodevPort`, `TabsPort`): inline blame (`app/line-annotation.ts`), File/line history, compare refs, branch review, interactive rebase with exact todo command (`domain/git-extras.ts:143`), worktrees, stash, amend. Gitflow start/finish. Trailers `Assisted-by:` / `Issue:` (`scm/domain/trailers.ts`, `issueKeyIn` regex `[A-Z][A-Z0-9]+-\d+`). Change-set grouping by issue (`scm/domain/changesets.ts`) is the nearest thing to Commit Composer. Hidden checkpoint refs via `commit-tree` exist for Co-Dev turns only (`crates/tutor-agent/src/checkpoint.rs`, `refs/dxtutor/cp/<session>/<n>`); reusable technique. Confirm uses `window.confirm` with `confirmCmd` ("{what}\n\n{cmd}\n\nRun it?", `scm/ui/git-messages.ts:28`). Catalogues: `scm/ui/messages.ts`, `scm/application/messages.ts`, `scm/ui/git-messages.ts`, `graph.messages.ts`. Hard-coded Portuguese remains in `scm.ts` `gfGuide` and `graph.ts`. Tests: `scm.domain`, `scm.golden`, `scm.norepo`, `scm.desktop-port`, `scm.git-extras`, `scm.changesets`, `diff.domain`. |
| **Missing: UI-SCM-08** | Commit Graph as the main Git screen with a sidebar: branches, **remotes**, **tags**, stashes, worktrees, **contributors**. Working-tree (WIP) row. Avatars (today a colour dot). Conventional-commit type chip and issue key per row. Token search `author:` `type:` `file:` `issue:` `branch:` `message:` with highlight vs filter mode. Activity minimap. Needs `for-each-ref refs/remotes` and per-commit files (`git log --name-only`, or lazy `git_show`). |
| **Missing: UI-SCM-09** | Lifecycle per commit (issue → tests → CI → PR → environments), in the row and as a vertical timeline in details. Sources: issue key → Project (`project_issue`); tests → results stored by the Test Runner (**not stored per commit today**); CI → `gh run list --commit <sha> --json`; PR → `gh pr list --search <sha> --state all --json`; environments → deploy records (`dxtutor.io/version` annotations read by the infra `EnvCluster.read`, and the future deploy record of F4). No source means an empty column (the prototype synthesises numbers from a hash; must not be ported). |
| **Missing: UI-SCM-10** | Hunk staging: expand a file, tick hunks, the commit takes only those (`git apply --cached --unidiff-zero` of a patch built from `git diff -U0`/`-U3`). Then line staging. Today `STAGED` is a file Set and commit runs `git add -A -- <files>`. |
| **Missing: UI-SCM-11** | Lanes: move files into a lane and commit to that branch without checkout (`git read-tree` into a temp index (`GIT_INDEX_FILE`) → `git update-index`/`apply --cached` → `write-tree` → `commit-tree -p <lane-tip>` → `update-ref` with old-value CAS). The workspace keeps every lane applied. Drag and drop. |
| **Missing: UI-SCM-12** | Undo timeline for commit, amend, checkout, merge, cherry-pick, revert, reset, discard, stash, lane commit. Before each op: record `HEAD`, refs (`for-each-ref`), index tree (`write-tree`) and `git stash create` (worktree snapshot, not added to the stash list), kept as refs under `refs/dxtutor/undo/*`. Undo restores and logs to audit. |
| **Missing: UI-SCM-13** | Conflict prediction: `git merge-tree --write-tree --name-only <ours> <theirs>` (git ≥ 2.38; installed 2.43) per local branch and per open PR head (`gh pr list`). Three-way merge editor from index stages `:1:`/`:2:`/`:3:` (`git show :n:path`, `git ls-files -u`), with a per-conflict Co-Dev proposal. Complete = approval with the exact command, plus the project check (`cargo check` / detected check) before commit. Today a conflict means `merge --abort` and "resolve in the terminal". |
| **Missing: UI-SCM-14** | Launchpad: PRs and review requests needing me (`gh pr list --search "review-requested:@me"` / `author:@me`, `gh pr checks`), severity, linked issue, "checkout into a worktree" (reuse `git_worktree`). Commit Composer: Co-Dev groups changes into drafts with English conventional messages; edit, move files between drafts, leave drafts out, then commit (proposal only). |
| **Missing: sync** | Pull/push/sync with an approval dialog showing `git pull --rebase` / `git push`. Ahead/behind against the upstream (`rev-list --left-right --count @{u}...HEAD`). Today there is no push at all. |
| **Missing: approval** | No confirm on commit/checkout/merge (fine: local and undoable once F3 lands). push/reset/delete branch/worktree must use the shared approval dialog (§2.5) and audit. |

| Prototype global | Equivalent |
|---|---|
| `GIT` (`c`, `order`, `refs`, `trees`, `base`, `tags`) | `features/scm.ts` `GIT: GitState` (window-published; A9 list). Desktop: rebuilt by `syncGit`. `trees` / `base` are browser-only. |
| `STAGED` / `BRANCH` / `COMMIT_MSG` | `features/scm.ts` (residue, published) |
| `commit` / `checkout` / `gitMerge` / `gfFinish` / `discard` | `features/scm.ts` published + `desktopPorts.scm`; `services.scm` (`gitMerge`, `discard`, `LANE`) |
| `openGraph` | `features/graph.ts` (published; read by board bridge) |
| `diffLines` / `diffStat` | `features/diff/domain/diff.ts` |
| `RP.scm` | `app/store/registry.ts` |
| `VIEW` | `app/store/registry.ts` |
| `openTab` / `openPath` / `closeTab` / `tabOf` / `show` / `cur` | `features/tabs.ts` |
| `palette` / `toast` / `card` | as above |
| `authorOf` / `slug` / `rid` | `scm/domain/author.ts` / `scm/domain/gitflow.ts` (`slug`) / engine ids |
| `PJX.openIssue` / `PJX.PJ.issues` | `features/project` (`openProject`, `project_issue`). Wiring point. |
| `codev.ask` | `codevAsk.ask` (`intent:"review"` / `"explain"`) |
| `V9.approve` | does not exist (§2.5) |
| `V9.openRebase` / `openHistory` | existing A4 extras (rebase editor, File history) |
| `LS` (`gx.v1`) | `app/store/storage.ts`. Lanes and undo must live in git refs / project DB, not LS. |
| `ROOT` | workspace root |

### 2.4 ops.js → `ui-app/src/features/ops/` + `src-tauri/src/commands/ops.rs` (+ `features/infra`)

| | Detail |
|---|---|
| **Exists: backend** | 6 read-only commands in `src-tauri/src/commands/ops.rs` → `crates/tutor-eval/src/ops.rs`. (1) `ops_iac_dirs`. (2) `ops_iac_plan(root, dir, refresh_only)`: tofu → terraform; `init`, `plan -out=<tmp>/plan.bin [-refresh-only]`, `show -json`; sensitive attributes are shown as "(sensitive)"; the plan file is discarded. (3) `ops_kube_state`. (4) `ops_kube_history`. (5) `ops_cloud_status`. (6) `ops_cloud_inventory`. Related: `devcontainer_*`, `compose_ps`, `deps_report`, `onboard_map`. Infra actions mostly shell out from `platform/desktop/infra.ts` (`kubectl`, `docker`/`podman`, `compose`). |
| **Exists: UI** | `features/ops/` (desktop only). `ui/ops-view.ts` sections: (1) IaC: folder picker, Plan, Drift, attribute diff, "Changed outside the code", "Apply in a terminal…", Co-Dev Explain/Propose. (2) Kubernetes: pods, deployments (logs/history/scale/restart/rollback), services (port-forward), events. (3) Cloud CLIs + inventory. Explicit empty states: `noTool`, `noKube`, `needDesktop`, "not installed". **Never shows a number without a source.** Changes go through `approveAndRun` (`application/ops-service.ts:35`): `window.confirm` with the full command → `runInTerminal`. No backend policy, **no audit**. Defect: `domain/commands.ts::iacApply` re-plans (`plan -out=tfplan && apply tfplan`) instead of applying the reviewed plan. Infra: `features/infra/` (envs local/staging/production, `promote` with approval and a typed "production", `driftReport`, `secretCheck` for missing/empty keys only; ports `InfraDesktop`, `EnvCluster`, `ObsSource`). |
| **Missing: UI-PLAT-09 / Q01–Q03** | "My queue" home. Items computed from real state, each with "why it is yours", one action, and a **verification function** (done only when it passes): incident I command; PRs requesting my review via CODEOWNERS (`gh pr list --search review-requested:@me` + `.github/CODEOWNERS` match); blocking IaC findings in files I changed (`git log --author` / blame); drift where I am on-call; recurring tasks. Plus "Hand over" (recipient + reason) → Team list; "Done — verified" with proof; "Measured in this workspace" (only local counts); data sources (CI/CD, cost, metrics/logs, cloud inventory) connected explicitly, read-only, with credentials from Vault, "not connected" otherwise. **Needs a source for on-call and incidents, which does not exist (see §5).** |
| **Missing: UI-PLAT-10 / R01–R03** | Runbooks as code: parser for `runbooks/*.md` (`## n. title [check|action|decision]`, a fenced command, `expect:`), list, runner. `check` runs only if on the read-only allowlist (X01); `action` needs approval with the exact command and per-step Vault creds. Output, result vs expectation, author, time stored as evidence. Co-Dev comments each output (proposal only). |
| **Missing: UI-PLAT-11 / C01–C02** | PR infra review: diff with Co-Dev comments anchored to lines; "Before you merge" (plan, policies, capacity, error budget, on-call, change window, cost, rollback, similar incidents), each with its source or "not connected". Approve with a failing check needs a reason, posted on the PR (`gh pr review --approve -b`) and audited. |
| **Missing: UI-PLAT-12 / A01–A03** | Incidents: checked / not-checked lists with reasons, confidence that drops without sources, "add evidence", "was the top cause right?" feedback, precision counter, resolve, postmortem draft (as a Co-Dev proposal in the editor). **No incident source exists.** |
| **Missing: UI-PLAT-13 / C03** | IaC findings as editor diagnostics in `.tf` while typing (needs F4 scanners + `features/panel` problems merge + `lsp`-style gutter). |
| **Missing: UI-PLAT-14 / A03** | "Export evidence (ISO 27001)" writes `docs/audit/evidence-YYYY-MM.md` grouped by A.8.32, A.8.9, A.5.17/A.8.12, A.8.13, A.5.24–A.5.27, **from the audit log**, opened for review. |
| **Missing: rest of ops.js** | Catalog + scorecards (Gold/Silver/Bronze from real rules); GitOps app tree / sync / diff / history / exec (Argo CD; `argocd` not installed); cost (Kubecost/Cost Explorer); inventory + IaC coverage + "codify" (`import` blocks). Not in UI-PLAT-09…14; propose deferring (see §5). |

| Prototype global | Equivalent |
|---|---|
| `PX.*` (platform.js) | does not exist (module absent). F4 creates it as typed ports. |
| `ENVX.st` | `features/infra.ts` (owned; passed by reference since U7p2, no longer on `window`) |
| `localSecrets()` | `features/infra/domain/secrets.ts` |
| `FS` / `writeFile` | `workspaceStore` / `core.ts` `writeFile` |
| `GIT.refs` / `GIT.trees` | scm residue |
| `V9.approve` | does not exist (§2.5) |
| `V9.stream` | Co-Dev only (`codevAsk.ask`, intent `change`/`fix`) |
| `V9.openSRE` | does not exist |
| `codev.ask` / `codev.register` | `codevAsk.ask` / does not exist |
| `openTab` / `openPath` / `show` / `cur` / `tabOf` | `features/tabs.ts` |
| `palette` / `toast` / `card` | as above |
| `VIEW` / `RP` | registry |
| `PANE` | `layoutStore.pane` (`features/shell.ts`) |
| `startDebug` / `setPanelTab` | debug residue / shell |
| `PJX.PJ` | `features/project` |
| `LS` (`ops.v1`) | storage. Durable items (runs, handovers, feedback) belong in the project DB. |
| `ROOT` | workspace root |

### 2.5 Cross-cutting prototype globals and their status

| Prototype | Our repo | Consequence |
|---|---|---|
| `V9.approve(title, cmd, done)`: one modal "This changes something outside the editor… Approve and run" | **Does not exist.** Variants: scm `HumanPort.confirm` → `window.confirm`; ops `approveAndRun` → `window.confirm`; infra `nav.dlg` + typed "production"; Co-Dev `codev_agent_approve` (agent tool calls only). | A shared, typed approval dialog is a prerequisite for F3–F6 (§4.1). |
| Audit of those approvals | `audit` table exists (§2.6) but only Co-Dev writes to it. | Needs a generic `audit_record` path. |
| `codev.register(kind, fn)` context providers | does not exist. `codevAsk.ask` takes explicit `AskContext[]` (`features/codev/domain/ask.ts`, kinds selection, file, hunk, problem, test, lesson, issue, terminal, comment). | Adding kinds `frame` / `commit` / `plan` / `runbook` is a wiring point in Co-Dev's domain (out of scope; ask the owner). |
| `V9.stream` | intentionally absent: only Co-Dev writes in the editor. | All "Fix in the editor" actions become `codevAsk.ask({intent:"fix"|"change", context})`. |
| `PJX` | `features/project` (`openProject`, `project_issue`, `project_load`) | wiring only |
| `DXR` | `window.DXR` (`platform/desktop/context.ts` `R`) | new code reads it through ports, never directly |
| `LS` | `app/store/storage.ts` | per-viewer convenience only |

### 2.6 Audit log (RF-BK-L01): it exists, partially

- Table `audit` in the Project DB `app_local_data_dir/board.sqlite3`:
  - schema `crates/tutor-board/src/project/schema.rs:184` (migration 5);
  - insert `ProjectStore::record_audit`, `project/mod.rs:866`.
- Fields: `id, root, at, session, event, origin, issue_key, actor, mode, tool, call, path, lines, command, verdict, outcome, decided_by, decided_at, reason, model, tokens_in, tokens_out, driver, cost_usd`.
- **Written only by Co-Dev**: `src-tauri/src/codev_agent.rs:1214 fn audit`. Before writing it masks command, path and reason with `crates/tutor-agent/src/redact.rs`.
- Read via `project_audit(root, issue?)` (`src-tauri/src/board.rs:180`).
- Exported per issue as JSON (`features/project/application/project-service.ts:206 exportAudit`).
- Not audited today: git operations, ops/infra/terminal commands, approvals outside Co-Dev, Vault, deploys, runbooks.
- No period-based export, no ISO export.

---

## 3. Tools on this machine (checked 2026-11-25, x86_64 Linux)

| Tool | Installed? | Version | Minimum | Meets? |
|---|---|---|---|---|
| git | yes `/usr/bin/git` | 2.43.0 | ≥ 2.38 (`merge-tree --write-tree`) | **yes** |
| lldb-dap | yes, `~/.local/share/swiftly/bin/lldb-dap` (from the Swift toolchain) | LLVM 21.0.0 | DAP adapter | yes (note: on PATH only via swiftly) |
| codelldb | no | n/a | alternative | n/a |
| lldb | yes (swiftly) | 21.0.0 | n/a | yes |
| gdb | **no** | n/a | needed for the gdb/MI fallback and for rr's usual frontend | **no** |
| rr | **no** | n/a | Linux time travel | **no**. Also `kernel.perf_event_paranoid = 4`; rr needs ≤ 1 (sysctl change, owner decision). |
| tofu | yes `~/.local/bin/tofu` | OpenTofu 1.12.6 | ≥ 1.11 | **yes** |
| terraform | no | n/a | ≥ 1.11 (either one) | n/a (tofu suffices) |
| tflint | **no** | n/a | n/a | no |
| checkov | **no** | n/a | n/a | no |
| trivy | **no** | n/a | n/a | no |
| conftest | **no** | n/a | n/a | no |
| infracost | **no** | n/a | n/a | no |
| vault (or bao) | **no** | n/a | n/a | no |
| kubectl | yes | client 1.36.6 | n/a | yes |
| argocd | **no** | n/a | n/a | no |
| helm | yes | 4.3.0 | n/a | yes |
| gitleaks | **no** | n/a | n/a | no (built-in rules fallback per brief) |
| gh | yes | 2.105.0, logged in (token in keyring) | n/a | yes |
| cosign (D02, extra) | yes `~/go/bin/cosign` | 2.6.5 | n/a | yes |
| docker / podman (extra) | yes | 29.10.0 / 4.9.3 | n/a | yes |

Testing implications:

- The F2 rr path cannot be tested here until rr is installed and `perf_event_paranoid` is lowered.
- F4 scanner stages and Vault can only be tested as "not installed" until the tools are installed.
- A dev Vault (`vault server -dev`) is the cheapest real target for the K01/K02 tests.

---

## 4. Plan for F1–F6 adapted to this architecture

### 4.0 Why F1 as written cannot be done

- The brief's F1 is "copy the modules into `ui/` and add `<script>` tags to `ui/index.html`". That breaks:
  - **A4/A5**: no `ui/` or `ui-next/`. `ui-app/dist` is the only UI.
  - **A6**: the modules are untyped JS.
  - **A9**: they publish `window.WEL`, `DXD`, `GX`, `OPS`.
  - **the CSP**: `script-src 'self'`, and the modules use hundreds of inline `onclick=`.
  - **U6**: texts are not keyed.
  - **U7**: they monkey-patch `commit`, `checkout`, `startDebug`, `VIEW.*`, `MENUS`.
- They also embed the simulator in the shipped code, which the brief itself forbids for desktop.
- **Replacement rule for every phase:**
  - Each module's behaviour lands as typed code in the owning feature: `domain/` (pure rules ported from the module), `application/` (use cases with injected ports), `ui/` (markup with `data-action`/`data-on` and a keyed `messages.ts` en + ptAO), and `infrastructure/tauri.ts` (typed IPC).
  - Desktop-only behaviour goes behind a port declared by the feature and registered in `app/desktop.ts` when it wraps an existing published function. New capabilities use the feature's own `infrastructure/tauri.ts`.
  - The browser simulation becomes **test fixtures only**: `ui-app/tests/fixtures/` for `lru.rs`, the runbooks, PR #49, INC-27 and a sample git history (the scm fixture `sample-history.ts` already exists).
  - In the browser, desktop-only screens say "needs the desktop app" (the pattern already used by `ops`, `testing` and `lsp`).
- **Per-commit gates:**
  - `npm run ui:build`, `ui:test`, `arch:check`, `cargo test` for the touched crates;
  - every new Tauri command added to `generate_handler!`, to `docs/architecture/IPC-MATRIX.md`, and to `EXPECT_TOTAL` (223 before F1, 224 after it) in `scripts/arch-check.sh` in the same commit;
  - no golden diff unless the owner approves the UI change and it is recorded;
  - new features added to `FEATURES` in `arch-check.sh`.

**F1 (re-scoped): foundations, no module UI yet.** Small commits:

1. `app/approval.ts`: a shared typed approval dialog. Title, exact command (monospace, copyable), scope line ("changes something outside the editor"), optional reason field, optional typed confirmation (production), Cancel / "Approve and run". Keyed catalogue `app/approval-messages.ts`. Returns a decision object; it never runs anything itself. Tests in jsdom. Adopt it first in `features/ops` (`approveAndRun`), replacing `window.confirm`.
2. Backend `audit_record(root, entry)` plus a generic `AuditEntry` origin (`"ide"`), reusing `ProjectStore::record_audit` and `redact.rs`. Wire it from the approval use case (decision + command + outcome). New command → IPC-MATRIX + `EXPECT_TOTAL` 224. **Owner decision needed on where non-Co-Dev audit lives (§5 Q1).**
3. Fixtures: move the r23 sample data into `ui-app/tests/fixtures/r23/` (lru.rs, runbooks, PR #49 diff, INC-27 timeline) for later phases' tests.
4. Status bar: show the build id (brief acceptance). Check whether one exists before adding it.

### 4.1 Non-negotiables, and where each is enforced

| Rule | Enforcement point |
|---|---|
| Co-Dev proposes, the person decides | No feature writes code: "Fix in the editor", "Propose the fix", "Draft runbook/postmortem" go through `codevAsk.ask` (Co-Dev streams hunks; accept/reject stays in Co-Dev). Composer/merge proposals are drafts until the human commits. |
| Approval with the exact command outside the editor | `app/approval.ts` for push, reset, delete, worktree, apply, deploy, sync, exec, runbook actions, clone. The command string shown is the one the backend runs: the backend builds it and returns `{argv, display}`; the UI never composes shell strings for execution. |
| No staging/production secret values over IPC, disk, logs or LLM (in Rust) | A new Rust module (see F4) owns Vault access. The KV read API returns metadata only for non-`local` environments, refused in Rust. Redaction in the LLM request path (`crates/tutor-llm` request builders) is a mandatory filter. Terminal masking in `pty.rs` output. Unit tests prove refusal. |
| No invented numbers | Every metric field is `Option`/`"not connected"` / `"not installed"` in the Rust DTO; UI renders the state. Port nothing from the prototype's hash-derived values (`life()`, `stat()`, `synthFiles()`). |
| Short-lived least-privilege credentials | Vault dynamic engines per step with TTL and revoke at the end; read by default. |
| Everything to the audit log | Every approval decision + outcome → `audit_record`; runbook runs, deploys, Vault reveals, merges with failing checks, scan overrides. |

### 4.2 F2: real debugger (Linux rr time travel)

**Reuse:**

- `dapc.rs` (DAP over stdio with lldb-dap), `debug_cmds.rs` (21 commands), `attach.rs`;
- `BpMeta` / `specsFor`, `inlineValues`;
- the pane, the breakpoint store (SQLite) and the selftest step.

**Backend (`crates/tutor-eval/src/dapc.rs`, `src-tauri/src/commands/debug_cmds.rs`):**

| Command | Purpose |
|---|---|
| `debug_test_targets(root)` | `cargo test --no-run --message-format=json` → test binaries + test names; launch with `["--exact", name, "--nocapture"]` |
| `debug_data_breakpoint(frame, expr, access)` | `dataBreakpointInfo` + `setDataBreakpoints` |
| `debug_exception_filters(filters)` | `setExceptionBreakpoints` with adapter-reported filters. Rust panic stays as the `rust_panic` function bp. |
| `debug_evaluate(…, context)` | extend with `context: "repl"` for the console; "hover" for inline |
| `debug_goto_cursor(path, line)` | run to cursor: temporary bp + continue, removed on stop |
| `debug_restart_frame(frame)` | only if `supportsRestartFrame` (lldb-dap: check caps). Otherwise hide. |
| `debug_read_memory(ref, offset, count)` | when `supportsReadMemoryRequest` |
| `debug_record(root, test)` / `debug_replay(trace)` | Linux only. `rr record` the test binary, then `rr replay -s <port>`, connect lldb (`gdb-remote`) or gdb. Reverse requests `reverseContinue` / `stepBack` only if the adapter reports `supportsStepBack`. **Spike first** (see §5 Q4). Without rr: `debug_capabilities` reports `timeTravel: {available:false, reason}`. |
| `debug_capabilities` | already exists, never called. Make the UI call it once per session to show and hide features. |

- Each new command → IPC-MATRIX and `EXPECT_TOTAL`.
- Fix the codelldb mismatch: either drive codelldb (TCP or stdio `--port`) or remove it from the detector.

**Domain (`features/debug/domain/`):**

- `breakpoints.ts`: kinds `trig` and `data`, groups, enablement by group. The trigger arming is client-side: the DAP has no triggered breakpoints, so the client keeps them unverified until the trigger is hit.
- `just-my-code.ts`: frame classification by path vs workspace root.
- `perf-tips.ts`: monotonic time since the previous stop.
- `exception.ts`: parse `assert_eq!` left/right from the panic message.
- `timeline.ts`: events from a replay session. Only with rr.

**Application:**

- Extend `debug-engine.ts` with run to cursor, data breakpoints, exception settings, console history and test-target launch.
- New `replay-engine.ts` behind a `ReplayPort`, for time travel.

**UI:**

- `ui/toolbar.ts` (floating, draggable, LIVE/REPLAY badge);
- `ui/exception-helper.ts` (anchored card, same technique as the `comments` feature box inside `.ed-wrap`);
- `ui/console.ts`;
- breakpoint menu extended (trigger, data, group);
- shortcut additions in `features/shortcuts.ts`;
- `messages.ts` keys en + ptAO.
- Timeline/Memory/Diagnostics tabs render "needs a recording (rr, Linux)" or "not supported by this adapter" when capabilities are absent.

**Co-Dev:** explain frame, hypotheses, "propose the fix", "turn the session into a test". All are `codevAsk.ask` with a frame/panic context; nothing is edited by the debugger.

**Commits:**

1. call `debug_capabilities` + capability-gated UI;
2. toolbar + shortcuts;
3. console (repl evaluate + history);
4. run to cursor;
5. test targets ("debug this test");
6. exception settings + exception helper;
7. data breakpoints;
8. triggered bp + groups;
9. Just My Code + PerfTips;
10. rr spike (doc only);
11. rr record/replay behind capability;
12. timeline/queries on replay;
13. memory view if `readMemory` is supported.

**Acceptance (brief):** `evicts_least_recently_used` fails in the real debugger; Co-Dev streams `pop_front`; the re-run passes. Use the fixture crate under `ui-app/tests/fixtures/r23/` or a temp crate built by the selftest (like the existing `debug` step).

### 4.3 F3: real git

**Reuse:**

- all 22 `git_*` commands (wire the unused ones instead of `exec("git")`);
- `gitops.rs`, `tutor-eval/src/gitx.rs`;
- `scm/domain/graph.ts`, `changesets.ts`, `trailers.ts`;
- the A4 extras ports;
- the checkpoint `commit-tree` technique from `tutor-agent/src/checkpoint.rs`.

**Backend (`crates/tutor-eval/src/gitx.rs` + `src-tauri/src/commands/git.rs`; all git CLI):**

| Command | Purpose |
|---|---|
| `git_hunks(root, path, staged)` | parsed hunks of `git diff -U3` with stable ids |
| `git_stage_hunks(root, path, ids, reverse)` | build a patch, then `git apply --cached [--reverse]`. Later `git_stage_lines`. |
| `git_refs(root)` | heads, remotes, tags, stashes, worktrees, upstream ahead/behind (`for-each-ref --format`, `rev-list --left-right --count`) |
| `git_log` extension | `--name-only` lazily per commit, or `git_show` on select |
| `git_predict_conflicts(root, branches[])` | `git merge-tree --write-tree --name-only --no-messages HEAD <b>`; non-zero exit = conflicts, plus file list |
| `git_conflict_stages(root, path)` | `git ls-files -u` + `git show :1:/:2:/:3:` |
| `git_merge(root, src, resolution)` | merge with `--no-commit`, write resolutions, run the project check (`projectCmd` check, from the workspace detection), then commit only if green. Approval in the UI with the exact command. |
| `git_undo_snapshot(root, label)` / `git_undo_list` / `git_undo_restore(id)` | refs + index tree + `git stash create`, stored as `refs/dxtutor/undo/<n>` with a JSON note. Restore = `update-ref` / `read-tree` / `checkout` of the stash tree; refuses if HEAD moved remotely. Audited. |
| `git_lane_commit(root, lane, paths, message)` | temp `GIT_INDEX_FILE` from the lane tip, apply the files' diffs, `write-tree`, `commit-tree`, `update-ref` with the expected old value. **Ship disabled first if risky (§5 Q6).** |
| `git_sync(root, op)` | `pull --rebase` / `push`. Returns the argv for the approval first: `git_plan(op)` → `{argv, display}`, then `git_run(planId)`. Audited. |
| `gh_*` (new module `src-tauri/src/gh.rs` or `crates/tutor-eval/src/gh.rs`) | `gh_status` (installed/auth); `gh_prs(root, filter)`; `gh_runs_for(root, sha)`; `gh_pr_checks`. All read-only, `--json`. Missing gh → "not installed" / "not signed in". |

**Lifecycle sources:**

- issue: the existing `issueKeyIn` + `project_issue`;
- tests: a **new** per-commit result store (testing service writes `{sha, passed, failed}` into the project DB after a run; new command `test_results_for(sha)`);
- CI/PR: `gh_*`;
- environments: deploy records (F4) + `EnvCluster.read` annotations.

**Domain/application/UI:**

- `scm/domain/search.ts` (token parser + matcher, highlight vs filter);
- `domain/conventional.ts` (type);
- `domain/lifecycle.ts` (merge sources, `Option` per stage);
- `application/undo.ts`, `application/lanes.ts`, `application/merge3.ts`, `application/composer.ts` (Co-Dev groups via `codevAsk`, proposal only), `application/launchpad.ts`;
- UI: graph sidebar, WIP row, minimap, details timeline, hunk checkboxes in the SCM pane, lanes UI, undo list, three-way merge tab, Launchpad, Composer tab.
- Moves `features/graph.ts` toward the scm subtree (owner call, §5 Q7).
- Translate the remaining Portuguese literals into the catalogue.

**Commits:**

1. `git_refs` + sidebar sections;
2. search/filter + type/issue chips;
3. WIP row + minimap;
4. `git_hunks` / `git_stage_hunks` + UI;
5. undo snapshots (wrap commit/checkout/merge/stash/discard/amend);
6. `git_predict_conflicts` + banner;
7. conflict stages + three-way editor + checked merge;
8. sync with approval;
9. gh module + Launchpad;
10. lifecycle (issue → tests store → CI/PR → env);
11. Composer;
12. lanes (flagged).

**Acceptance (brief):** a test creates a temp repo, stages one hunk, commits, undoes, and predicts a conflict (Rust test in `gitx.rs` + UI wiring test).

### 4.4 F4: Platform (IaC, Vault, deploy, data protection), from the requirements only

**Reuse:**

- `ops_iac_plan` (init/plan/show-json, sensitive masking), `ops_iac_dirs`;
- infra `EnvCluster` (apply with annotations), `promote`, `driftReport`, `secretCheck`;
- `redact.rs` patterns;
- `tutor-agent/src/permissions/shell.rs` classifier (for the read-only allowlist);
- `features/panel` problems pipeline + `lsp` diagnostics painting for C03.

**Backend: new crate or module `crates/tutor-platform/` (Tauri-free, testable):**

| Area | Commands / pieces |
|---|---|
| IaC pipeline (P01) | `iac_pipeline_run(root, dir, stages)` streaming stage events `iac://stage`: init → fmt -check → validate → tflint → checkov / `trivy config` → sensitive-in-state check (`show -json` state, `sensitive_values`) → plan + `show -json` → conftest → infracost → (approval) → `apply plan.out` **of the same plan file**, kept in the app data dir, keyed by hash. Each stage: `ok`/`failed`/`not_installed{hint}`/`skipped`; a failed stage blocks apply in Rust. Fix the current `iacApply` re-plan defect. Terragrunt/Helm later. |
| Plan model (P02) | extend `IacPlan`: modules, actions incl. replace, attribute diff, blast radius (`terraform graph` or dependents from config), cost per resource (infracost JSON), write-only args flagged. Sensitive values never serialized (already partly true). |
| Findings (P03, C03) | `iac_findings(root, files)` → `{source, rule, file, line, severity}` from tflint/checkov/trivy JSON + built-in rules (e.g. `password = var.…`). Emit as Problems for `.tf` on save (panel problems merge). Risk acceptance: reason + 30-day expiry stored in the project DB. "Fix in the editor" = `codevAsk.ask`. |
| Drift (P04) | reuse `refresh_only`; schedule (6 h) and pre-apply; actions revert (targeted apply, approval) / accept in code (Co-Dev) / import (`import` block draft) / ignore with reason. CloudTrail author needs a cloud source (not connected → say so). |
| State (P05) | `iac_state_list` (addresses + ids only, `state list` / `show -json` filtered), lock info, versions if the backend supports them, `force-unlock` with approval, `moved` block refactor. The editor refuses `.tfstate` (workspace loader + `openPath` guard). |
| Vault (K01–K05) | `vault_status`, `vault_login_oidc(addr, ns, role)` (local callback listener on 127.0.0.1, browser open), token stored with the **`keyring` crate** (not yet a dependency) and never returned to the UI, `vault_renew`, `vault_revoke`, `vault_kv_meta(env, path)` (metadata only), `vault_reveal_local(path, key)` (only `local`, approval, 20 s expiry enforced in Rust, audited), `vault_dynamic(engine, role)` → lease id only, revoked at operation end. Refusal of staging/production value reads lives in Rust with a unit test. Patching values happens in the terminal (`vault kv patch … @/dev/stdin`); the IDE never sees the value. |
| Validation in target (K03) | `secret_check_job(env, workload)`: apply a `dx-secret-check` Kubernetes Job that reads the VSO-mounted secret and prints only `exists/non-empty/host-resolves/login-ok`. Until the image exists: "not available". |
| Guided deploy (D01–D04) | `deploy_plan(target)` → steps Target, Identity, Secrets, Preflight, Strategy, Approve, Rollout, Record. Preflight gates (SBOM, `cosign verify`, vulns, secrets validated, plan applied without drift, admission policy, SLO budget, change window, migrations, staging health) each `ok/failed/not_connected/not_installed`, blocking. Rollout reuses `EnvCluster.apply`; canary/blue-green later. Production: second approver + typed confirmation. Deploy record (commit, issue, env, leases issued/revoked) into the project DB, feeding F3 lifecycle and F5 evidence. |
| Redaction (X02) | move or duplicate `redact.rs` into a shared place used by `crates/tutor-llm` request builders, so **every** outgoing request (Co-Dev agent, assistant, studio) is filtered. Add known Vault values by hash (SHA-256 of values seen in reveal-local only). Return a count to the UI, audited. Unit test: `postgres://app:pw@…` arrives as `‹redacted›`. |
| Secret scan before commit (X03) | `secret_scan(root, paths|staged)`: gitleaks if installed (`gitleaks protect --staged --report-format json`), else built-in rules (redact patterns) + forbidden files (`.env`, `.tfstate`, `.pem`). Called by **every** commit path (scm commit port, Co-Dev commit, board runner). Override needs a reason → audit. |
| Masking (X04) | `pty.rs` output filter with known-secret hashes + patterns → `‹secret›`; also for `debug://output` and task output. |

**UI:**

- Extend `features/ops` with tabs Pipeline · Plan · Security & policy · Drift · State · Golden paths.
- New `features/vault/` (A7/A8, added to `FEATURES`) for the Vault screen and the status-bar token state.
- Deploy wizard in `features/infra` (Promote opens it; UI-PLAT-07).
- All copy keyed.

**Commits:**

1. shared redaction in the LLM path;
2. secret scan + commit hook in all commit paths;
3. terminal masking;
4. pipeline stages with "not installed";
5. apply of the reviewed plan (fix);
6. findings + `.tf` diagnostics;
7. plan model upgrades;
8. drift actions;
9. state browser + `.tfstate` guard;
10. `keyring` + Vault login/status (dev Vault test);
11. KV metadata + reveal-local + Rust refusal tests;
12. dynamic creds;
13. `dx-secret-check` (flag "not available");
14. deploy wizard steps 1–8;
15. deploy records.

### 4.5 F5: work-first Platform activity

**Reuse:**

- `features/ops` shell;
- `approval.ts`, `audit_record`, `gh_*` (F3), F4 findings/drift/deploy records;
- the agent permissions classifier as the basis of the runbook read-only allowlist (`shell.rs` `SAFE` + infra read verbs: `kubectl get/describe/logs/top`, `aws … describe-*/list-*/get-*`, `tofu plan/show`, `gh … view/list`).

**Backend:**

| Command | Purpose |
|---|---|
| `runbook_list(root)` / `runbook_parse(root, path)` | `runbooks/*.md` grammar from RF-BK-R01. Pure parser in Rust (`crates/tutor-platform/src/runbook.rs`) with tests. |
| `runbook_step(root, path, n, approval?)` | `check`: runs only if every command line is on the allowlist (`policy::is_read_only`), else refuses (`not_read_only`). `action`: requires an approval id; per-step Vault creds when available. Stores output, expectation match (text), author and time as a run record (project DB) → audit. |
| `queue_items(root, me)` | computed from sources. CODEOWNERS (parse `.github/CODEOWNERS`/`CODEOWNERS`; `gh` review requests); my IaC findings (files I last changed, via `git log --author`/blame); drift; recurring tasks (runbooks with a `schedule:` front-matter, to be defined); incidents (no source, so absent). Each item has `verify` as a server-side check id; `queue_verify(id)` re-runs it. Handovers stored with recipient + reason. |
| `sources_status` / `source_connect(kind)` | CI/CD (gh), cost, metrics/logs, cloud inventory; read-only, creds from Vault; `not_connected` by default. |
| `pr_infra_review(root, pr)` | `gh pr diff` + plan for the head + policies + checks, each line with source or `not_connected`. `pr_review_submit(pr, decision, reason)` → `gh pr review`; failing check without a reason is refused in Rust; audited. |
| `incident_*` | local incident record (open, evidence, checks run/not run with reason, feedback, resolve) in the project DB; confidence computed from available sources. **Owner decision on whether incidents exist without a pager source (§5 Q9).** |
| `audit_export_evidence(root, from, to)` | groups audit rows (+ runbook runs, deploys, pipeline runs, merges) by ISO/IEC 27001:2022 control; writes `docs/audit/evidence-YYYY-MM.md` **inside the project only**, opened for review. |

**UI:** `features/ops` views Home (My queue / Done / Team / Measured), Runbooks, Review, Incidents, plus the "Export evidence" button. Catalog/GitOps/Cost/Inventory deferred (§5 Q10).

**Commits:**

1. runbook parser (Rust + tests);
2. allowlist policy + `runbook_step` refusal test (brief acceptance);
3. runner UI + evidence;
4. sources status ("not connected");
5. queue items + verify + handover;
6. PR infra review + reasoned approval;
7. incidents;
8. evidence export (brief acceptance: real audit rows).

### 4.6 F6: Welcome

**Reuse:**

- `features/welcome.ts`, `desktopPorts.welcome`, `LS["dx-recent"]`, `openFolder`;
- `git_clone` (already registered, unused).

**Steps:**

1. Rewrite the base view as the VS Code layout: Start, Recent (browser: empty state, never fake folders), Walkthroughs. Keep or migrate the current cards (owner call, §5 Q11). Keyed catalogue, `data-action`.
2. `WelcomeDesktop` port: `open(path?)`, `recent()`, `clone(url, parent)`. Clone: input → `approval.ts` showing `git clone <url> <parent>/<name>` → `git_clone` → open the folder → audit.
3. Walkthroughs: a typed step list whose actions are **typed callbacks**, not `new Function(string)` (the prototype's `WEL.run` evals strings, which is incompatible with the CSP). New tab kind `walk` in the tabs registry. Progress in LS (per-viewer convenience).
4. "Show welcome page on startup" read in `boot-steps.ts`.
5. Commands "Help: Welcome" / "Help: Walkthroughs".

- Template and Connect to: either link to existing features, or show "not available" (no `delonix new` exists).
- Golden impact: the welcome page has no golden today. Check `tests/` before changing; if one exists, the change needs owner approval.
- **Acceptance:** opening a recent folder from the Welcome opens the right workspace (wiring test with a fake `__TAURI__`, as in `testing.wiring`).

### 4.7 Suggested order

| Order | Phase | Note |
|---|---|---|
| 1 | F1 foundations | approval + audit + fixtures |
| 2 | F6 | small, proves the approval/audit path with `git_clone` |
| 3 | F3 | git; the undo and approval patterns are reused later |
| 4 | F2 | debugger; rr blocked on tools |
| 5 | F4 | platform; largest, needs owner decisions on Vault/keyring |
| 6 | F5 | ops; depends on F4 data and the audit log |

The brief's numbering is kept for naming. One phase per PR on `develop`.

---

## 5. Risks and open questions for the owner

1. **Audit log location and scope.** The `audit` table is in `app_local_data_dir/board.sqlite3` (Project DB), keyed by `root`, and today only Co-Dev writes it. Should git, ops, infra, Vault, deploy, runbook and clone events go into the same table with `origin="ide"` (new nullable columns: `approval_id`, `exit_code`, `env`), or into a separate store? The evidence export (A03) and per-issue export both read it.
2. **Shared approval dialog.** OK to add `app/approval.ts` and migrate scm/ops/infra confirms to it? That changes markup (`window.confirm` becomes a DOM dialog): golden impact for the infra promote dialog, if any.
3. **Co-Dev wiring points.** Do we add `AskContext` kinds (`frame`, `panic`, `commit`, `plan`, `finding`, `runbook`, `incident`) to `features/codev/domain/ask.ts`, or squeeze everything into `problem`/`hunk`? Co-Dev is out of scope, so this needs your explicit OK. Same for the Commit Composer grouping and the merge proposal: who builds the prompt?
4. **rr frontend.** rr's replay server speaks gdb-remote. gdb is not installed, and lldb's reverse execution over gdb-remote is limited. Options: (a) install gdb and drive rr via gdb/MI (the existing `debug.rs` path); (b) gdb's DAP mode (`gdb -i dap`, gdb ≥ 14) against rr, which reuses `dapc.rs`; (c) lldb against `rr replay -s`. Recommendation: a spike on (b). Also: rr needs `kernel.perf_event_paranoid ≤ 1` (now 4) and supported hardware PMU (not in some VMs). OK to change the sysctl on this machine?
5. **"Err through `?`" and side-effect-free evaluate** have no DAP mechanism. Accept "panic only" exception settings and a label "may run code" on the console, or require something else?
6. **Lanes (UI-SCM-11).** Committing to another branch via `commit-tree` is safe for the ref. But "the workspace keeps every lane applied" means the working tree contains uncommitted changes of several branches, and checkout becomes confusing. Ship disabled first (brief allows it)?
7. **Graph ownership.** `features/graph.ts` sits outside the scm subtree and still has Portuguese literals. Move it into `features/scm/` as part of F3 (golden impact on the graph if any)?
8. **Vault.** Which Vault/OpenBao address, namespace and OIDC role for development? Can we add the `keyring` crate (and accept its Linux Secret Service dependency, `libsecret`/D-Bus)? Note that `features/codev.ts:267,270` already tells users keys are "in the keychain", which is false (they are in `keys.json`, 0600). Report only, per the refactor rule; should model keys also move to `keyring`?
9. **Incidents and on-call** have no source in the repo. Do incidents exist only as local records opened by a person, or do you want a PagerDuty/Opsgenie/Grafana OnCall source? Without one, "on-call" queue items cannot be computed. Show "not connected"?
10. **Ops screens beyond UI-PLAT-09…14** (catalog/scorecards, GitOps/Argo CD, cost, inventory/codify) exist in `ops.js` but have no UI-PLAT ID and need argocd/cloud sources. Defer?
11. **Welcome.** Replace the current Build/Learn/Co-Dev cards with the VS Code layout, or keep them as a walkthrough? "New Project from a Template" references `delonix new`, which does not exist: drop it, or map it to Studio/Team templates?
12. **`platform.js` is missing.** F4 is planned from RF §8 and UI-PLAT-01…08 only. Can you provide the file? Screens, texts and the exact pipeline order would otherwise be invented.
13. **Test result store per commit** (UI-SCM-09) is new state in the project DB, written by the testing feature. OK?
14. **Product name.** The package and requirements say "delonix-ide" (e.g. `Assisted-by: … (delonix Co-Dev)`, `delonix new`, `docs/audit` texts). Per the earlier decision, these become dxtutor. Confirm this applies to trailers and the evidence-export header.
15. **Existing defects found** (reported, not fixed, per CLAUDE.md rule 3):
    - (a) `features/ops/domain/commands.ts::iacApply` re-plans instead of applying the reviewed plan;
    - (b) `dap.rs` detects codelldb but `dapc.rs` cannot drive it;
    - (c) most `git_*` write commands are unused while the UI shells out to `exec("git")`;
    - (d) redaction is applied to logs and the audit, not to outgoing LLM requests (X02 gap);
    - (e) the keychain claim in `features/codev.ts`.
16. **Tools missing for acceptance tests:** rr, gdb, tflint, checkov, trivy, conftest, infracost, vault, argocd, gitleaks. Install them on this machine (and in CI), or accept "not installed" paths as the tested behaviour for now?

---

## 6. Owner decisions (2026-11-25) and F1 status

The owner approved four of the §5 questions, with one condition: everything follows the repository's
structure (typed layered features, ports, en + ptAO catalogues, IPC-MATRIX, no new `window` globals).

| § 5 | Decision |
|---|---|
| Q1 audit location | Same `audit` table as the Co-Dev, origin `"ide"`. No new columns yet: `tool` holds the feature, `call` the action, `path` the scope. Columns such as `approval_id`, `exit_code` and `env` are added (with their migration) by the phase that needs them. |
| Q2 approval dialog | Yes: `app/approval.ts`, adopted first in Ops. The other confirms (scm extras, infra promote, codebase, arch) move to it in their own phases. |
| Q12 `platform.js` | Not available. F4 is built from RF §8 and UI-PLAT-01…08 only; nothing is invented beyond them. |
| Q4, Q8, Q16 tools | rr, gdb, Vault and the `keyring` crate are approved. System installs are the owner's to run (they need `sudo`); until then the app shows "not installed" with the hint. |

Commands for the owner (Ubuntu; run once):

```sh
# gdb and rr (F2 time travel); rr needs perf events
sudo apt install gdb rr
echo 'kernel.perf_event_paranoid = 1' | sudo tee /etc/sysctl.d/60-rr.conf && sudo sysctl --system

# Vault (F4) from the HashiCorp apt repository; a dev server is enough for the tests: vault server -dev
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install vault

# keyring crate (F4): its Secret Service backend needs D-Bus headers to build (and a keyring daemon at run time)
sudo apt install libdbus-1-dev
```

The other questions (Q3, Q5, Q6, Q7, Q9, Q10, Q11, Q13, Q14) stay open and are asked at the start of
the phase they belong to. The defects in Q15 stay reported, not fixed.

### F1 status: done (foundations)

| Commit | What |
|---|---|
| `a416cb9` | `app/approval.ts` + `app/approval-messages.ts`: one dialog with the title, the exact command, where it runs, an optional required reason and an optional typed word (the button stays off until both are given). Returns the decision and runs nothing. Ops adopts it through its `HumanPort.approve` (structural type, the feature does not import `app/`); deleting a pod or an apply that destroys asks for the name typed. `window.confirm` is gone from Ops. |
| `5ea8115` | `audit_record(root, entry)` in `board.rs` (224 commands): the backend decides who (`git config user.name`) and when, and masks the `.env` values and the known secret patterns in the command, scope and reason (`Redactor::for_root`). Ops audits every decision through an `AuditPort`; a refusal is audited, and an approval that cannot be audited does not run. Self-test step `audit` proves the round trip (`audit_record` → `project_audit`) with a `.env` secret masked. |
| `44c91db` | The status bar shows the build (`#st-build`: version · commit, `*` for a dirty tree; the desktop app's version from `app_info`). |

Not done in F1, on purpose: the r23 fixtures (item 3) come in with the first phase whose tests use
them, so nothing unused is committed.

Checks on each commit: `tsc`, eslint (no new warnings), vitest (1004 tests), `arch:check` (all green,
no metric up), `ui:build`, e2e (26, with the Ops test driving the new dialog), `cargo test` for
`board.rs`, and the desktop self-test (52 steps, no FAIL).

### F6 status: done (Welcome)

Owner decisions at the start of the phase (§5 Q11, 2026-11-25): the old cards become the «Build» walkthrough;
«New Project from a Template» is dropped until real templates exist; every prototype walkthrough comes in except
Cloud.

- **Backend.** `git_clone_plan(url, parentDir)` (225 commands) returns the exact command, the folder and whether
  it exists. `git_clone` now uses the same validation and runs `git -C <parent> clone -- <url> <name>` with
  `GIT_TERMINAL_PROMPT=0`, refusing an existing folder. Before, it ran `git clone <url>` with no `--` (a URL
  starting with `-` was read as an option) and guessed the new folder; it had no UI consumer then.
- **UI.** `features/welcome/` (typed, layered, A7/A8): Start, Recent (the real `dx-recent`; none in the browser),
  Walkthroughs with progress and a «new» badge, a `walk:<id>` tab per walkthrough, «Mark done», «Show welcome page
  on startup», and the palette commands «Help: Welcome» / «Help: Walkthroughs». Step actions are typed ids mapped
  to feature entry points (no evaluated strings). The old `desktopPorts.welcome` port is gone.
- **Clone path.** URL → parent folder (next to the most recent one) → backend plan → approval dialog → audit
  (`sent`, then `ok`/`failed`) → clone → open. Refused: audited, nothing runs; not auditable: does not run.
- **Checks.** tsc, eslint, vitest (1028), `arch:check`, `ui:build`, e2e (29: the acceptance — a recent folder opens
  that workspace —, the clone through the dialog, and the startup choice), `cargo test -p tutor-eval`, desktop
  self-test (53 steps, no FAIL; new step `clone` with a real `file://` clone).

### F3a status: done (git, first half)

Owner decisions at the start of F3 (2026-11-25): lanes ship behind an experimental switch, off by default (F3b);
the graph moves into `features/scm/`; a per-commit test result table in the Project DB (F3b); review F3 in two
halves.

| Commit | What |
|---|---|
| `6d7f9a8` | `git_refs` (new module `tutor_eval::gitwork`): the Commit Graph's sidebar in one read — branches with upstream and ahead/behind, remotes, tags, stashes, worktrees, contributors. The graph moved from `features/graph.ts` into `features/scm/` (domain, use case, view, composition, en/ptAO catalogue). |
| `e80fc0e` | Search with `author:` `type:` `file:` `issue:` `branch:` `message:` tokens, Highlight/Filter, type and issue chips; `syncGit` reads each commit's files. |
| `6d91ed7` | WIP row on HEAD's lane, activity minimap, commit details in a panel under the graph (inline, they drifted from the SVG). |
| `85a8025` | Hunk staging: `git_hunks` / `git_stage_hunks` (`git apply --cached [--reverse]`), hunks under a file's row in the pane (desktop only); the desktop commit respects the index. |
| `f6b557b` | Undo: `git_undo_snapshot/list/plan/restore` (refs + index tree + `git stash create` under `refs/dxtutor/undo/<n>`); snapshots before commit, checkout, merge, branch delete, stash, amend, discard; undo through the approval dialog with the exact commands, audited, itself undoable. |
| `fd2b3f6` | The scm's `window.confirm`s (stash drop, worktree add/remove, amend, rebase, discarding a change set) now use the shared approval dialog and the audit log. |
| `01c3a4a` | `git_predict_conflicts` (`git merge-tree --write-tree`): ⚠ on branches that would conflict with HEAD, and a banner. |
| `8f34803` | Three-way merge: `git_merge` (status/resolve/commit/abort) and `git_conflict_stages`; a conflicted merge stays open in a «Merge» tab (base · ours · theirs, result, take a side, ask Co-Dev); completing runs the project check and commits only when it passes, approved and audited. |

236 commands after F3a. Acceptance of the brief (a temp repo stages one hunk, commits, undoes and predicts a
conflict) is covered by the `gitwork` Rust tests and by the desktop self-test steps `hunks`, `undo`, `graph`
(prediction) and `merge3` against real git.

Not in F3a (F3b): sync with approval (pull/push), the `gh` module and Launchpad, the commit lifecycle (with the
test-results table), the Commit Composer, lanes (off by default).

Known limits, reported: the merge check uses the folder's detected lint (else test) command; a folder without one
completes with «no project check found» in the dialog's scope. Untracked files are not part of undo snapshots
(`git stash create` covers tracked files only).

### F3b status: done (git, second half)

| Commit | What |
|---|---|
| `e41a852` | Sync: `git_sync_plan` builds the exact command (`fetch --all --prune`, `pull --rebase --autostash`, `push <remote> <b>:<dst>` or `push -u`; never `--force`) with upstream and ahead/behind; `git_sync` runs it only if it is still the approved one. Fetch/Pull ↓n/Push ↑n on the Commit Graph; approved, audited, an undo snapshot before a pull. |
| `8a0be7d` | `tutor_eval::gh` (read-only, `--json`): status, PRs (review requested, mine, open), CI runs and PRs of a commit; «not installed» with the hint without gh. The Launchpad tab (by severity, checks, review, linked issue); «Checkout into a worktree» (`git_worktree {op: add_pr}`), approved and audited; links open the system browser. |
| `e3faf41` | Commit lifecycle: Project DB migration 8 `test_results`; `test_results_record` (HEAD and dirty decided by the backend) written by the Testing pane after each whole-suite run; `test_results_for`; the graph's details panel shows issue → tests → CI → PR → environments, each from its real source or saying it has none (environments «not connected» until F4). |
| `894887c` | Commit Composer (`git_commit_paths`): drafts per theme with a Conventional Commits prefix, edit/move/leave out, ask Co-Dev for a grouping (proposal only), commit in order with undo snapshots. Lanes (`git_lane_commit`, temp index + commit-tree + update-ref, no checkout) behind «Git: Lanes (experimental) on/off», off by default. |

246 commands after F3b. Every new git write is tested against real repositories in `tutor_eval::gitwork`, and the
desktop self-test drives each one against real git: `sync` (push to a local bare remote), `launchpad` (real gh,
signed out), `lifecycle`, `composer` (two commits; a lane commit with HEAD unchanged). 60 self-test steps.

Known limits, reported: the Launchpad and the CI/PR stages need `gh` signed in (they say so otherwise); a lane
commit applies the diff against HEAD, so a change that does not apply on the target branch is refused rather than
merged; environments wait for F4's deploy records.
