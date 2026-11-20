/* ═══════════ feature `infra` — constantes puras (ADR-0002, Fase 2) ═══════════
   Tabelas estáticas dos dois motores (runtime/K8s + environments) e as fábricas
   do estado inicial. Sem DOM, sem `window`. O resíduo importa daqui e publica no
   `window` (os onclick inline e as camadas v5/v6 resolvem RTN/KCTX/ENVL/DSTY como
   globais; `envDriftStyle` é a fachada-alias de DSTY). */

import type { Envs, EnvX } from "./types";

/** Runtimes de contentores suportados (rótulos). */
export const RTN: Record<string, string> = { docker: "Docker", podman: "Podman", delonix: "Delonix" };

/** Contextos de kubeconfig oferecidos no selector. */
export const KCTX: string[] = ["kind-dxtutor", "minikube", "k3d-local", "docker-desktop"];

/** Rótulos dos três ambientes. */
export const ENVL: Record<string, string> = { local: "Local", staging: "Staging", production: "Production" };

/** Estilos/rótulos de cada estado de drift (`[cor, rótulo]`). */
export const DSTY: Record<string, [string, string]> = {
  sync: ["var(--green)", "in sync"],
  drift: ["var(--yellow)", "drift"],
  behind: ["var(--blue)", "behind"],
  missing: ["var(--red)", "missing"],
  bad: ["var(--red)", "failing"],
  off: ["var(--fg-muted)", "not deployed"],
};

/** Estado inicial do runtime/cluster (antes da hidratação de LS). */
export const defaultEnvs = (): Envs => ({
  rt: "docker",
  sock: { docker: "/var/run/docker.sock", podman: "/run/user/1000/podman/podman.sock", delonix: "/run/delonix/delonix.sock" },
  rtOn: false,
  kube: "~/.kube/config",
  ctx: "kind-dxtutor",
  ns: "dxtutor",
  k8sOn: false,
  ssh: [],
});

/** Estado inicial dos environments (antes da hidratação de LS). */
export const defaultEnvx = (): EnvX => ({
  cur: "local",
  ctx: { staging: "staging", production: "production" },
  ns: { staging: "dxtutor-staging", production: "dxtutor" },
  sec: null,
  st: { staging: null, production: null },
  hist: [],
});
