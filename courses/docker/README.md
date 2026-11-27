# Docker: Dockerfiles That Ship

The official [Docker](https://docs.docker.com/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **tool** course whose
exercises are Dockerfiles (and one compose file), written in Docker's syntax and graded **live**.

| Unit | Level | What you write |
|---|---|---|
| Images and layers | Basic | a first image; its configuration and its layers |
| Dockerfile instructions | Basic | an ARG kept with ENV, run-time ENV overrides, labels |
| ENTRYPOINT, CMD and running containers | Basic | an image used like a command; detached runs and logs |
| Multi-stage builds | Intermediate | a version-stamped Go binary `FROM scratch`, under 5 MB |
| Users and least privilege | Intermediate | a static site served by a non-root user, read-only |
| Volumes | Intermediate | a non-root notes tool whose data lives in a named volume |
| Networks | Intermediate | a health-probe sidecar sharing the app's network namespace |
| Docker Compose | Advanced | an API and Redis: health, internal network, volume, hardening |
| Health checks | Advanced | a check that tests the service, with tuned timings |
| Image size and build cache | Advanced | layer order, `.dockerignore`, clean-up in the same layer |

10 units, 40 steps: each unit has a concepts text, a concept step, two drills and a project challenge.

## How it is graded — and why not with Docker

The checks write their commands as `docker …`, but grading **never uses a Docker daemon**: the daemon
runs as root, and grading through it would be root-equivalent. They run in dxtutor's **private
rootless Podman sandbox** (the same as the Podman course), through Podman's Docker-compatible `build`
and `run`: own storage and configuration (your Docker and Podman images are never touched), limits,
no capabilities, `--network none`, `--pull=never`, labels on everything, all removed afterwards.
`docker build` builds Docker-format images, as Docker does.

The course says where Docker and the grader differ: BuildKit (Docker) versus Buildah (the grader) —
BuildKit-only features such as build secrets and heredocs are not graded, and Buildah 1.33 can reuse a
cached `ENV`/`LABEL` after a `--build-arg` changes (the grader then builds without the cache); a few
`inspect` fields are laid out differently (`Healthcheck` at the top level instead of
`Config.Healthcheck`); the sandbox publishes no ports and creates no user-defined networks; Compose
files are read, not run with `docker compose up`.

**Prepare course** pulls the base images once, by digest: `alpine:3.24.4`, `python:3.15.2-alpine3.24`,
`golang:1.27.4-alpine3.24` (Docker Hub).

## Requirements

- To grade: **Podman 4.4 or newer**, rootless, Linux with a systemd user session
  (https://podman.io/docs/installation); validated against **Podman 4.9.3**.
- To practise with Docker itself: Docker Engine (https://docs.docker.com/engine/install/).

## Contribute

```sh
dxt plugin validate courses/docker
dxt plugin prepare courses/docker
dxt plugin test courses/docker        # every solution passes, every starter fails
```
