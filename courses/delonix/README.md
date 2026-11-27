# Delonix Engine: Manifests and Compose Files

The official [Delonix Engine](https://ngolacloud.github.io/delonix/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **tool** course whose
exercises are Delonix manifests and compose files, graded **offline**.

| Unit | Level | What you write |
|---|---|---|
| Manifests | Basic | the four fields and the API groups; fix a manifest the engine refuses |
| Pods | Basic | containers, commands, ports, environment, and the defaults `render` reveals |
| Volumes and mounts | Basic | a named Volume, a Pod volume and a mount that agree by name |
| Networks and Services | Intermediate | Pods on a user network and a Service whose selector matches |
| Config and Secret | Intermediate | a Secret with no value in the manifest, delivered as files |
| Applications and Jobs | Intermediate | replicas and a run-to-completion job, checked on what they lower to |
| Compose files | Intermediate | a three-service compose file accepted by `delonix compose config` |
| Compose: health, order, profiles | Advanced | healthchecks, `service_healthy`, an `x-` anchor and a profile |
| Capstone: one Stack | Advanced | a whole project in one namespaced Stack |

9 units, 36 steps: each unit has a concepts text, a concept step, two drills (retype a manifest,
a comment on every line) and a project challenge.

## Version

Written for **Delonix 0.2.1** (`delonix --version` → `delonix 0.2.1`, tag `v0.2.1` = `9f8745b7`). The
Delonix README still describes the "0.1.x line" in places; where the two differ, the course follows the
0.2.1 binary. It also grades with 0.2.0: the only change between the two that a challenge can see is
how a `depends_on` naming no service is refused, and dxtutor reports that one itself (below).

## How it is graded

Each challenge is a project step: the learner edits YAML and a hidden `checks.toml` declares what must
be true — structural checks on the YAML (`tutor_core::toolcheck` in dxtutor) plus two Delonix
commands from dxtutor's allow-list:

- `delonix manifest render -f <file>` — loads the manifest as `apply` would (unknown fields refused,
  types checked, Applications, Jobs and Stacks expanded) and prints it with the defaults. The checks
  read that output.
- `delonix compose config -f <file> -p <project>` — validates a compose file and prints the resolved
  project (container names, networks, ports, volumes), which the checks read.

Both were proven host-free from the Delonix source at the commit of the 0.2.0 binary (`edba10a1c`) and
measured with `strace` (no socket, no write): they read the file and nothing else. Measured again with
the 0.2.1 binary: between the two tags, the only change to these commands is the `depends_on`
validation in `load_compose` (#1060). Grading runs them
with a clean environment and a temporary `HOME`, `XDG_*` and `DELONIX_ROOT`. Two more rules close the
gaps:

- `compose config` picks a random free host port (it binds a socket) for a `ports` entry without a
  host port, so every graded port must say `"HOST:CONTAINER"`; a compose file with `$` variable
  interpolation is not graded either (its result would depend on the environment);
- a `depends_on` naming no service is reported in words before running: Delonix 0.2.0 panics on it, and
  0.2.1 refuses it (`service 'web' depends_on undefined service 'db'`); the check gives every learner
  the same message, whichever of the two is installed.

**Not used:** `delonix manifest validate`. It resolves references against the engine's stores and, on
the way, sweeps empty cgroup leaves of the host — the course checks references itself, from the files.

## Requirements

- **delonix 0.2.1** (0.2.0 also works) — https://ngolacloud.github.io/delonix/ (installer:
  `https://github.com/ngolacloud/delonix/releases/latest/download/install.sh`). Without it, the
  challenges say what to install instead of failing.

## Contribute

```sh
dxt plugin validate courses/delonix
dxt plugin test courses/delonix     # every solution passes, every starter fails
```
