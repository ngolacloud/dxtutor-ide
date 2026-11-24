/* O desenho de referência «Docker vs Kubernetes» (a imagem do guia visual), feito com as
   funções do domínio e com posições à mão. Dados de TESTE: usados pelo e2e
   arch-reference e por arch.layout.test.ts — a app nunca traz desenhos de demonstração. */
import { addComponent, addGroup, addView, connect, emptyDesign, setGroupView } from "../../src/features/arch/domain/design";
import type { Design } from "../../src/features/arch/domain/types";

export function reference(): Design {
  const d = emptyDesign();
  const docker = addView(d, "Docker")!, k8s = addView(d, "Kubernetes")!;
  const dBody = addGroup(d, "Docker", { x: 40, y: 80, w: 320, h: 300 });
  setGroupView(d, dBody, docker);
  const host = addGroup(d, "Host", { x: 60, y: 250, w: 280, h: 300 }, dBody, "host");
  const kBody = addGroup(d, "Kubernetes", { x: 440, y: 80, w: 700, h: 300 });
  setGroupView(d, kBody, k8s);
  const cp = addGroup(d, "Control Plane", { x: 460, y: 250, w: 660, h: 120 }, kBody, "plane");
  const n1 = addGroup(d, "Node 1", { x: 460, y: 430, w: 380, h: 120 }, kBody, "node");
  const n2 = addGroup(d, "Node 2", { x: 460, y: 680, w: 380, h: 120 }, kBody, "node");

  const at = (x: number, y: number) => ({ x, y });
  addComponent(d, "cli", "Docker CLI", at(125, 110), dBody);
  d.components[0].code = "docker run checkout:v2";
  addComponent(d, "daemon", "dockerd", at(125, 285), host);
  addComponent(d, "runtime", "containerd", at(125, 395), host);
  addComponent(d, "runtime", "runc", at(125, 505), host);
  addComponent(d, "process", "Container", at(125, 615), host);
  addComponent(d, "kernel", "Linux kernel", at(80, 725), host);
  const dep = addComponent(d, "state", "Deployment", at(720, 110), kBody);
  d.components.find((c) => c.id === dep)!.code = "replicas: 3\nimage: checkout:v2";
  addComponent(d, "process", "API Server", at(480, 285), cp);
  addComponent(d, "state", "etcd", at(650, 285), cp);
  addComponent(d, "process", "Controller Manager", at(820, 285), cp);
  addComponent(d, "process", "Scheduler", at(990, 285), cp);
  addComponent(d, "daemon", "kubelet", at(480, 470), n1);
  addComponent(d, "runtime", "CRI runtime", at(670, 470), n1);
  addComponent(d, "worker", "Pod A", at(480, 580), n1);
  addComponent(d, "worker", "Pod B", at(670, 580), n1);
  addComponent(d, "daemon", "kubelet", at(480, 715), n2);
  addComponent(d, "runtime", "CRI runtime", at(670, 715), n2);
  addComponent(d, "worker", "Pod C", at(480, 825), n2);
  addComponent(d, "client", "Client", at(900, 600), kBody);
  addComponent(d, "adapter", "Ingress", at(900, 720), kBody);
  addComponent(d, "port", "Service", at(900, 840), kBody);

  for (const [a, b] of [
    ["docker-cli", "dockerd"], ["dockerd", "containerd"], ["containerd", "runc"], ["runc", "container"],
    ["deployment", "api-server"], ["api-server", "etcd"], ["api-server", "controller-manager"], ["api-server", "scheduler"],
    ["api-server", "kubelet"], ["api-server", "kubelet-2"], ["kubelet", "cri-runtime"], ["cri-runtime", "pod-a"],
    ["cri-runtime", "pod-b"], ["kubelet-2", "cri-runtime-2"], ["cri-runtime-2", "pod-c"],
    ["client", "ingress"], ["ingress", "service"], ["service", "pod-a"], ["service", "pod-c"],
  ]) connect(d, a, b);
  const label = (from: string, to: string, text: string) => { d.connections.find((c) => c.from === from && c.to === to)!.label = text; };
  label("deployment", "api-server", "kubectl apply");
  label("kubelet", "cri-runtime", "gRPC CRI");
  // o pedido do cliente é dados do princípio ao fim (verde), como na imagem
  for (const [from, to] of [["ingress", "service"], ["service", "pod-a"], ["service", "pod-c"]]) d.connections.find((c) => c.from === from && c.to === to)!.style = "data";
  return d;
}
