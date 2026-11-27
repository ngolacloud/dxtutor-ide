# Co-Dev harness evaluation (H0)

Measures how many real tasks the Co-Dev agent solves **with the IDE's own harness** (the same tools, permissions,
system prompt and project instructions as the desktop app), headless, with tokens, cost and time per task. Every
phase of `docs/v2/AUDIT-harness.md` (H1–H6) is measured against the last baseline in `results/`.

## Running

```sh
# no model: prove each task is sound (the unsolved project fails its check, the reference solution passes)
cargo run -p dxtutor-ide --example codev-eval -- verify

# with a model (spends tokens): writes results/<time>-<model>.json and .md
cargo run -p dxtutor-ide --example codev-eval -- run [--only id,id] [--provider claude|codex|gemini|ollama] \
    [--model M] [--effort high] [--out evals/results] [--followups 1]
```

The keys come from the keychain, the app's `keys.json` (`DXTUTOR_CONFIG_DIR`, by default
`~/.config/ao.ngolacloud.dxtutor-ide`) or the provider's environment variable. The toolchains the tasks use must be
on the login shell's PATH: `cargo`, `python3`, `node` (≥ 22), `go`, `make`, `bash`, `tar`.

## How a task runs

1. `repo/` is copied into a fresh git repository (one commit).
2. A Co-Dev session starts there in **Auto** mode with `test` as its `run_tests`, and gets `prompt` as the person's
   request. Nobody is at the keyboard: the plan is approved, anything the policy still asks about is refused with a
   reason, and a question (`ask_human`) is answered once with «decide yourself».
3. When the agent finishes, `hidden/` is copied in (over anything with the same name) and `check` runs; exit 0 =
   solved.

## A task

```
tasks/<id>/
  task.json   {id, title, language, category, prompt, check, test?, timeout?}
  repo/       the project as the agent finds it
  hidden/     the acceptance tests (the agent never sees them)
  solution/   a reference solution (files over repo/), used only by `verify`
```

Tasks use only each language's standard library, so they run offline. A new task must pass `verify` before it is
committed. `cargo test -p dxtutor-ide eval` checks the suite's shape (≥ 30 tasks, ≥ 4 languages, a solution each).

## Baseline

`results/1795742224-claude-opus-5-5.md` (2026-11-27, `claude-opus-5-5`, effort high): **32 of 32 solved**, $3.03,
~17 min of agent time, 4–9 requests per task, ~107k output tokens and ~1.13M cache-read tokens in all.

The suite is saturated for this model: it now tells phases apart by cost, tokens and time, not by the solve rate. The
next tasks to add are the ones a stronger harness should make the difference on — multi-file changes in a larger
existing codebase, tasks that need the IDE's tools (a Project issue with its scope and DoD, a failing test to debug,
an IaC plan to read), and long sessions that need compaction.

While writing the suite, three runs showed that hidden tests must not share names with the tests an agent writes:
Go acceptance tests live in an external `_test` package, and every hidden test uses names of its own.
