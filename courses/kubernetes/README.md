# Kubernetes: Manifests That Mean What They Say

The official [Kubernetes](https://kubernetes.io/docs/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track — a **tool** course whose
exercises are YAML manifests, graded **offline**.

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

11 units, 44 steps: each unit has a concepts text, a concept step, two drills (retype a manifest,
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

## Requirements

- **kubectl** (https://kubernetes.io/docs/tasks/tools/), for the Kustomize units and the capstone.
  Written against kubectl **v1.36.6** with Kustomize **v5.8.1**. Without kubectl, those steps say
  what to install instead of failing.
- No cluster. Applying the manifests to a local cluster (kind on rootless Podman) is a separate,
  later part.

## Contribute

```sh
dxt plugin validate courses/kubernetes
dxt plugin test courses/kubernetes     # every solution passes, every starter fails
```
