# Kubernetes: Manifests That Mean What They Say

The official [Kubernetes](https://kubernetes.io/docs/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **tool** course whose
exercises are YAML manifests. Units 1–11 are graded **offline**; units 12–18 run your manifests
**live** on the course's own practice cluster (kind on rootless Podman).

| Unit | Level | What you write |
|---|---|---|
| Objects | Basic | the four fields of every object; fix a Pod the API server would refuse |
| Pods | Basic | containers, command/args, ports and environment, with every type right |
| Deployments | Basic | labels, selector ⊆ template labels, replicas, a safe rolling update |
| Services | Intermediate | a Service that really selects a Deployment's Pods, by port name |
| ConfigMaps and Secrets | Intermediate | configuration by reference, placeholders only |
| Probes | Intermediate | startup, liveness and readiness probes |
| Resources | Intermediate | requests, limits, Burstable and Guaranteed QoS |
| Namespaces | Intermediate | a namespaced application with a ResourceQuota |
| Ingress | Advanced | host and path routing with TLS |
| Kustomize | Advanced | a production overlay, built with `kubectl kustomize` |
| Capstone | Advanced | generated configuration, a strategic-merge patch and an overlay |
| On a real cluster (live) | Advanced | a Deployment that rolls out, then is upgraded to a new image |
| Services with endpoints (live) | Advanced | a Service whose EndpointSlice lists exactly its Pods, not a stranger |
| Probes at work (live) | Advanced | a slow start survived, a busy moment out of traffic, no restart |
| Jobs (live) | Advanced | three completions, two at a time, with the logs read back |
| Configuration, mounted (live) | Advanced | a ConfigMap as a file and as a variable, proven by the logs |
| Limits, enforced (live) | Advanced | a quota, Guaranteed Pods and an `OOMKilled` memory hog |
| Rollback (live) | Advanced | a bad release that stalls at full capacity, is detected and undone |

18 units, 72 steps: each unit has a concepts text, a concept step, two drills (retype a manifest,
a comment on every line) and a project challenge.

## How it is graded

Each challenge is a project step: the learner edits YAML files and a hidden `checks.toml` says what
must be true. The checks are declarative (`tutor_core::toolcheck` in dxtutor): a path in a document
and one assertion — equals, matches, only these keys, a selector that selects the labels of another
document, a value among the names declared in another file, and so on.

The Kustomize units also **run** `kubectl kustomize <dir>` and check its output. That is the only
command this course runs, and it is on dxtutor's allow-list because it builds locally: it never talks
to a cluster (measured: no socket). Grading runs it with a clean environment, an **empty temporary
`KUBECONFIG`** and a temporary `HOME`, so the learner's real contexts are never read. A kustomization
that points at the network (a remote base, an `http(s)://` file) or uses Helm is refused before
anything runs. `kubectl apply|create --dry-run=client` is deliberately **not** used: it asks the API
server for discovery and the OpenAPI schema (measured: it connects to `localhost:8080` without a
kubeconfig).

Every object in the drills and solutions (and the kustomize builds of the solutions) was validated
strictly — unknown fields as errors — against the official OpenAPI spec of **Kubernetes v1.36.0**
while the course was written.

## Live units: the practice cluster

Units 12–18 add `[[live]]` checks (`tutor_core::livecheck` in dxtutor): the learner's files are
applied to a **fresh namespace** of a one-node Kubernetes **v1.36.4** made with **kind v0.33.0** on
**rootless Podman**, the grader waits for what the step asks (a rollout, a condition, or a query
repeated until a value matches) and reads the result with `kubectl get -o json`; the namespace is
deleted afterwards. Only allow-listed `kubectl` commands run, always with the cluster's own
kubeconfig, context and the grading namespace (no `exec`, no `port-forward`, no writes outside the
namespace), and each `apply` is checked first: namespaced kinds only, no host access, and only the
three images the course pins by digest — `nginx:1.27.5-alpine`, `nginx:1.28.0-alpine` and
`busybox:1.37.0`.

The cluster lives in the course cache with its own Podman storage, runtime folder, registries
configuration and kubeconfig, on an **internal** network (`198.18.250.0/24`, outside the Podman, Docker and
kind address pools; dxtutor refuses to create it if your networks or routes already use that range): it never reads `~/.kube/config`, never
touches the learner's containers or images, and cannot download anything while grading. «Prepare
course» (or `dxt plugin prepare courses/kubernetes`) downloads, once and with approval, the kind
release (checked by its SHA-256), the node image and the three images (by digest), about 1 GB. The
cluster is created when a live step is first graded (about a minute; about 900 MB of memory), and deleted
after 20 minutes without use, with «Delete cluster», or at the end of `dxt plugin test`.

## Requirements

- **kubectl** (https://kubernetes.io/docs/tasks/tools/), for the Kustomize units and the capstone.
  Written against kubectl **v1.36.6** with Kustomize **v5.8.1**. Without kubectl, those steps say
  what to install instead of failing.
- Units 1–11: no cluster.
- Units 12–18: **Podman 4.9+**, rootless (cgroup v2 with the `cpu`, `memory` and `pids` controllers
  delegated to the user, user namespaces and `/etc/subuid`, and the user's D-Bus session). Without
  them the live steps say what is missing; the offline units still grade.

## Contribute

```sh
dxt plugin validate courses/kubernetes
dxt plugin prepare courses/kubernetes  # once: kind, the node image and the three images
dxt plugin test courses/kubernetes     # every solution passes, every starter fails
```
