# Seiva: Backends That Keep Their Shape

The official [Seiva](https://ngolacloud.github.io/seiva/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **framework** course,
graded in Rust. You build one Seiva module, `tasks`, the way Seiva's own examples are built:

| Unit | Level | What you build |
|---|---|---|
| The domain | Basic | `Task::new` and `complete`: rules that cannot be skipped |
| Ports | Basic | ids, time and the tenant `Scope` through `seiva-ports`, with the `seiva-testing` doubles |
| One use case, one transaction | Intermediate | `TasksService::create` (project step) |
| Changing state safely | Intermediate | `TasksService::complete`, with rollback (project step) |
| The contract | Intermediate | the `#[seiva::facade]` trait, DTOs, `Validate`, permissions |
| The controller | Advanced | `#[seiva::controller]` routes, tested with `tower::ServiceExt::oneshot` (project step) |
| A module is five crates | Advanced | the capstone: a Cargo workspace of five crates and a composition root |

7 units, 28 steps: each unit has a concepts text, a concept step, two drills (retype a complete
program, a comment on every line) and a challenge judged by hidden `cargo test` tests.

## Dependencies: one place, prepared once

Every step compiles against **Seiva 0.2.0** from its Git repository (tag `v0.2.0`, commit
`ae83f7a`) plus `tokio`, `axum`, `tower` and `serde`. They are declared once, in the `[build]` table
of `courses/seiva.toml`; the Seiva source is a single line:

```toml
[build.vars]
seiva = 'git = "https://github.com/ngolacloud/seiva", tag = "v0.2.0"'
```

When Seiva 0.2.0 is on crates.io, that line becomes `seiva = 'version = "0.2.0"'` — nothing else
changes.

Grading never uses the network. The dependencies are downloaded **once** into a cache of this course
(its own `CARGO_HOME` and `target`, not `~/.cargo`), in an explicit step the learner approves:

- in the app: Learning Track → Seiva → **Prepare course** (shows the exact commands; audited);
- on the command line: `dxt plugin prepare courses/seiva`.

## Contribute

Source of truth: `courses/seiva/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request:

```sh
dxt plugin validate courses/seiva --strict
dxt plugin prepare courses/seiva     # once (network)
dxt plugin test courses/seiva        # every drill runs, every solution passes, every starter fails
```
