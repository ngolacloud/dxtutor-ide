# Podman: Images and Containers, Rootless

The official [Podman](https://docs.podman.io/en/v4.9.3/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **tool** course whose
exercises are Containerfiles (and one compose file), graded **live** in a private rootless Podman
sandbox.

| Unit | Level | What you write |
|---|---|---|
| Images and layers | Basic | a first image; read its configuration and count its layers |
| Containerfile instructions | Basic | WORKDIR, COPY, RUN, ENV, ARG and LABEL, with run-time overrides |
| ENTRYPOINT, CMD and running containers | Basic | an image used like a command; detached runs and logs |
| Multi-stage builds | Intermediate | a static Go binary `FROM scratch`, under 5 MB |
| Users and least privilege | Intermediate | a non-root server that cannot modify its code |
| Volumes | Intermediate | a non-root program that keeps its state in a named volume |
| Networks | Intermediate | two containers sharing one network namespace (the pod pattern) |
| Compose | Advanced | a web service and PostgreSQL with health, networks, a volume and a secret |
| Health checks | Advanced | a HEALTHCHECK on the real endpoint, kept with `--format docker` |
| Image size and build cache | Advanced | layer order, `.containerignore`, clean-up in the same layer |

10 units, 40 steps: each unit has a concepts text, a concept step, two drills (retype a
Containerfile, a comment on every line) and a project challenge.

## How it is graded

Each challenge is a project step with a hidden `checks.toml`. Its `[[run]]` commands come from a short
allow-list (`tutor_core::podcmd` in dxtutor): `podman build`, `podman run` (named volumes created in the
step, `--network none` or `container:<name>`, `--read-only`, a few capabilities — never host folders,
host network, published ports or privileges), `volume create`, `exec`, `healthcheck run`, `image
inspect`, `inspect`, `history`, `logs`, `stop`; `[[check]]`s then read the saved JSON (image
configuration, sizes, layers, health status) or YAML (the compose file).

The sandbox (`tutor_eval::sandbox`): rootless Podman with its **own storage and configuration**
(the learner's own images and containers are never read; the Docker daemon is never used), memory,
process and CPU limits verified before grading, `--cap-drop=ALL`, `no-new-privileges`,
`--network none`, `--pull=never`, a time limit per command, labels on everything, and everything
removed after each run. Each Containerfile passes a guard first: `FROM` only from the prepared images,
no `ADD <url>`, no `RUN --network`.

**Prepare course** pulls the three base images once, by digest, into the sandbox:

- `docker.io/library/alpine:3.24.4`
- `docker.io/library/python:3.15.2-alpine3.24`
- `docker.io/library/golang:1.27.4-alpine3.24`

## Requirements

- **Podman 4.4 or newer**, rootless, on Linux with a systemd user session
  (https://podman.io/docs/installation). Written and validated against **Podman 4.9.3** (Buildah 1.33).
- macOS and Windows: Podman runs in a VM there (`podman machine`), which the grader does not drive.

## Contribute

```sh
dxt plugin validate courses/podman
dxt plugin prepare courses/podman     # once: pulls the base images into the sandbox
dxt plugin test courses/podman        # every solution passes, every starter fails
```
