/* ═══════════ feature `infra` — geradores runtime/K8s (ADR-0002, Fase 2) ═══════════
   O núcleo PURO do motor de runtime de contentores / dev-container / Kubernetes:
   detecção do contexto do projecto, geração do devcontainer.json, das variáveis de
   ambiente de uma app, dos manifestos Kubernetes do design, e o parse dos manifestos
   em disco. Sem DOM, sem `window`, sem Tauri: recebem o mundo (FS, design, catálogo)
   por argumento. Byte-fiéis às versões do resíduo (`features/infra.ts`) — o golden
   de caracterização prova a identidade. */

import type { Catalog, Design, DesignNode, Files, K8sDoc, ProjectTech } from "./types";

/** Detecta as tecnologias presentes no projecto a partir dos caminhos do FS. */
export function projectContext(files: Files): ProjectTech[] {
  const k = Object.keys(files), h = (re: RegExp): boolean => k.some((p) => re.test(p)), c: ProjectTech[] = [];
  if (h(/Cargo\.toml$/)) c.push(["rust", "Rust"]);
  if (h(/\.tsx?$|package\.json$/)) c.push(["node", "TypeScript / Node"]);
  if (h(/go\.mod$/)) c.push(["go", "Go"]);
  if (h(/requirements\.txt$/)) c.push(["python", "Python"]);
  if (h(/__manifest__\.py$/)) c.push(["odoo", "Odoo module"]);
  if (h(/db\/migrations\//)) c.push(["sql", "SQL migrations"]);
  if (h(/docker-compose\.yml$/)) c.push(["compose", "Compose stack"]);
  if (h(/deploy\/k8s\//)) c.push(["k8s", "Kubernetes manifests"]);
  if (h(/\.devcontainer\//)) c.push(["devc", "Dev Container"]);
  if (h(/\.dxtutor\/regras\.md$/)) c.push(["rules", "Project rules"]);
  return c;
}

/** Gera o `devcontainer.json` a partir dos ids do contexto, das portas do compose e
 *  do socket do runtime seleccionado. */
export function devcontainerJson(ctx: string[], ports: number[], sock: string): string {
  const f: Record<string, unknown> = {}, F = "ghcr.io/devcontainers/features/";
  if (ctx.includes("rust")) f[F + "rust:1"] = {};
  if (ctx.includes("node")) f[F + "node:1"] = { version: "22" };
  if (ctx.includes("go")) f[F + "go:1"] = {};
  if (ctx.includes("python")) f[F + "python:1"] = {};
  f[F + "docker-outside-of-docker:1"] = {};
  f[F + "kubectl-helm-minikube:1"] = { minikube: "none" };
  return JSON.stringify({
    name: "dxtutor",
    image: "mcr.microsoft.com/devcontainers/base:bookworm",
    features: f,
    mounts: [`source=${sock},target=/var/run/docker.sock,type=bind`, "source=${localEnv:HOME}/.kube,target=/home/vscode/.kube,type=bind,readonly"],
    forwardPorts: ports.length ? ports : [1420],
    postCreateCommand: [ctx.includes("rust") ? "cargo fetch" : "", ctx.includes("node") ? "npm --prefix desktop install" : ""].filter(Boolean).join(" && ") || "true",
    remoteUser: "vscode",
    customizations: { dxtutor: { harness: ".dxtutor/harness.toml" } },
  }, null, 2) + "\n";
}

/** Variáveis de ambiente de uma app, derivadas das suas arestas no design. */
export function appEnv(n: DesignNode, D: Design, cat: Catalog): string[] {
  const { tech, kind, isApp, slug } = cat;
  const env = [`PORT: "${tech[n.tech].port}"`];
  D.edges.filter((e) => e[0] === n.id).map((e) => D.nodes.find((x) => x.id === e[1])).filter((d): d is DesignNode => !!d && tech[d.tech].kind !== "gateway").forEach((d) => {
    const K = kind[tech[d.tech].kind];
    if (K && K.wire) env.push(...K.wire(slug(d)));
    else if (isApp(d)) env.push(`${slug(d).toUpperCase().replace(/-/g, "_")}_URL: http://${slug(d)}`);
  });
  return [...new Set(env)];
}

/** Gera os manifestos Kubernetes (Deployment/Service para serviços, Secret para
 *  apps, Ingress a partir do gateway) do design inteiro. */
export function k8sInfra(D: Design, cat: Catalog): string {
  const { tech, kind, isApp, slug } = cat;
  const out = ["# Local stand-ins for managed services, secrets for every app and the ingress.", "# For a real cloud, delete the stand-ins and point the secrets at the managed services."];
  D.nodes.filter((n) => !isApp(n) && tech[n.tech].kind !== "gateway").forEach((n) => {
    const T = tech[n.tech], K = kind[T.kind] || {}, s = slug(n);
    out.push(`---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${s}\nspec:\n  replicas: 1\n  selector:\n    matchLabels: { app: ${s} }\n  template:\n    metadata:\n      labels: { app: ${s} }\n    spec:\n      containers:\n        - name: ${s}\n          image: ${T.img}${K.cmd ? `\n          args: [${K.cmd.split(" ").map((a) => JSON.stringify(a.replace(/"/g, ""))).join(", ")}]` : ""}${K.env ? "\n          env:\n" + K.env.map((e) => { const [k, ...v] = e.split(": "); return `            - { name: ${k}, value: ${JSON.stringify(v.join(": ").replace(/^"|"$/g, ""))} }`; }).join("\n") : ""}\n          ports: [{ containerPort: ${T.port} }]\n---\napiVersion: v1\nkind: Service\nmetadata:\n  name: ${s}\nspec:\n  selector: { app: ${s} }\n  ports: [{ port: ${T.port}, targetPort: ${T.port} }]`);
  });
  D.nodes.filter(isApp).forEach((n) => out.push(`---\napiVersion: v1\nkind: Secret\nmetadata:\n  name: ${slug(n)}-env\nstringData:\n${appEnv(n, D, cat).map((e) => "  " + e.replace(/: (?!")(.*)$/, (_m, v) => ": " + JSON.stringify(v))).join("\n")}`));
  const gw = D.nodes.find((n) => tech[n.tech].kind === "gateway"), rt = gw ? D.edges.filter((e) => e[0] === gw.id).map((e) => D.nodes.find((x) => x.id === e[1])).filter((d): d is DesignNode => !!d && isApp(d)) : [];
  if (rt.length) out.push(`---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: ${slug(gw as DesignNode)}\nspec:\n  rules:\n    - http:\n        paths:\n${rt.map((a) => `          - path: ${tech[a.tech].kind === "web" ? "/" : "/" + slug(a)}\n            pathType: Prefix\n            backend: { service: { name: ${slug(a)}, port: { number: 80 } } }`).join("\n")}`);
  return out.join("\n") + "\n";
}

/** Parse dos manifestos escritos em `deploy/k8s/*.yaml` (kind/name/replicas/img/port). */
export function k8sDocs(files: Files): K8sDoc[] {
  const out: K8sDoc[] = [];
  Object.keys(files).filter((p) => /deploy\/k8s\/.*\.yaml$/.test(p)).sort().forEach((p) => files[p].content.split(/^---$/m).forEach((d) => {
    const k = (d.match(/^kind:\s*(\w+)/m) || [])[1], n = (d.match(/^ {2}name:\s*(\S+)/m) || [])[1];
    if (k && n) out.push({ k, n, file: p, rep: +((d.match(/replicas:\s*(\d+)/) || [])[1] || 1), img: (d.match(/image:\s*(\S+)/) || [])[1], port: (d.match(/containerPort:\s*(\d+)/) || [])[1] });
  }));
  return out;
}
