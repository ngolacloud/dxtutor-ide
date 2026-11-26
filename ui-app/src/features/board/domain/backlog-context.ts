/* ═══════════ feature `board` — domínio: o desenho do Studio como contexto do `/backlog` ═══════════
   O «Generate backlog» do Studio, com o agente (desktop, pasta aberta), pede ao Co-Dev o backlog da pasta
   com o desenho como contexto: um componente por linha, com a tecnologia, a pasta, o estado e as ligações. O
   backlog vai para o Project (`/backlog` → `/project`), não para o quadro Tasks. Puro. */

import type { Design } from "./types";

export interface StudioComponent {
  name: string;
  tech: string;
  folder: string;
  /** `planned` (contorno tracejado), `in progress` ou `done`. */
  state: string;
  links: string[];
}

const STATE: Record<string, string> = { plan: "planned", wip: "in progress", ok: "done" };

/** Os componentes do desenho, com os nomes da tecnologia e a pasta dados por quem chama. */
export function studioComponents(d: Design, techName: (tech: string) => string, folder: (node: Design["nodes"][number]) => string): StudioComponent[] {
  const name = (id: string): string => (d.nodes.find((n) => n.id === id) || { n: id }).n;
  return d.nodes.map((n) => ({
    name: n.n,
    tech: techName(n.tech),
    folder: folder(n),
    state: STATE[n.st] ?? n.st,
    links: d.edges.filter((e) => e[0] === n.id).map((e) => name(e[1])),
  }));
}

/** O pedido `/backlog` com o desenho; sem componentes, o backlog vem só da pasta. */
export function studioBacklogRequest(components: StudioComponent[]): string {
  if (!components.length) return "/backlog from the code of this folder";
  const lines = components.map(
    (c) => `- ${c.name} (${c.tech}${c.folder ? `, folder ${c.folder}/` : ""}, ${c.state})${c.links.length ? ` → ${c.links.join(", ")}` : ""}`,
  );
  return `/backlog from the code of this folder and the components of the Studio design — scope each issue to its component's folder and set its "component" (a "done" component only needs what is missing):\n${lines.join("\n")}`;
}
