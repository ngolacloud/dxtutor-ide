/* ═════════ feature `arch` — regras puras do desenho ═════════
   Operações sobre o `Design` (acrescentar, ligar, remover), a relação inferida dos tipos
   das pontas, a conversão para o modelo do backend e a leitura tolerante do que estava
   guardado. Não valida a arquitectura: isso é SEMPRE do backend (arch_validate).
   PURO: sem DOM, sem window, sem Tauri. */

import type { ArchKind, ArchRelation, Architecture, Design, DesignNode } from "./types";

export const KINDS: readonly ArchKind[] = ["service", "store", "broker", "consumer", "relay", "gateway"];

export const KIND_COLOR: Record<ArchKind, string> = {
  service: "#dea584",
  store: "#5cc9a7",
  broker: "#d7a860",
  consumer: "#7aa2f7",
  relay: "#b48ead",
  gateway: "#e06c3b",
};

export const KIND_LABEL: Record<ArchKind, string> = {
  service: "Service",
  store: "Store",
  broker: "Broker",
  consumer: "Consumer",
  relay: "Relay",
  gateway: "Gateway",
};

const RELATIONS: readonly ArchRelation[] = ["writes", "reads", "publishes", "consumes", "routes-to"];

export const isKind = (k: unknown): k is ArchKind => typeof k === "string" && (KINDS as readonly string[]).includes(k);
const isRelation = (r: unknown): r is ArchRelation => typeof r === "string" && (RELATIONS as readonly string[]).includes(r);

/** Slug IGUAL ao do backend (`arch.rs::scaffold`): alfanumérico em minúsculas, o resto vira '-'. */
export const slug = (s: string): string =>
  Array.from(s).map((c) => (/[\p{L}\p{N}]/u.test(c) ? c.toLowerCase() : "-")).join("");

/** Relação inferida dos tipos das pontas: escrever/ler numa store, publicar/consumir num
 *  broker, encaminhar a partir de um broker; o resto cai em `writes` (inócuo). */
export function relationFor(from: ArchKind, to: ArchKind): ArchRelation {
  if (to === "store") return from === "relay" ? "reads" : "writes";
  if (to === "broker") return from === "consumer" ? "consumes" : "publishes";
  if (from === "broker") return "routes-to";
  return "writes";
}

/** Uma ligação nomeia um evento quando publica ou consome. */
export const relationTakesEvent = (r: ArchRelation): boolean => r === "publishes" || r === "consumes";

export const emptyDesign = (): Design => ({ components: [], connections: [] });

export const findNode = (d: Design, id: string): DesignNode | undefined => d.components.find((c) => c.id === id);

/** O desenho no formato do backend (a geometria fica no cliente). */
export function toArchitecture(d: Design): Architecture {
  return {
    components: d.components.map(({ id, name, kind, outbox }) => ({ id, name, kind, outbox })),
    connections: d.connections.map(({ from, to, relation, event }) => ({ from, to, relation, event })),
  };
}

/** Acrescenta um componente. O id é o slug do nome, único (sufixo -2, -3… em colisão).
 *  Posição em grelha de 4 colunas, como no Studio original. Devolve o id. */
export function addComponent(d: Design, kind: ArchKind, name: string): string {
  const base = slug(name) || "comp";
  let id = base;
  for (let n = 2; findNode(d, id); n++) id = `${base}-${n}`;
  const k = d.components.length;
  d.components.push({ id, name, kind, outbox: false, x: 24 + (k % 4) * 180, y: 24 + Math.floor(k / 4) * 110 });
  return id;
}

/** Liga `from` → `to` com a relação inferida. Devolve `false` se não ligou (ponta
 *  inexistente, laço, ou ligação repetida com o mesmo evento). */
export function connect(d: Design, from: string, to: string, event = ""): boolean {
  const a = findNode(d, from), b = findNode(d, to);
  if (!a || !b || from === to) return false;
  if (d.connections.some((c) => c.from === from && c.to === to && c.event === event)) return false;
  d.connections.push({ from, to, relation: relationFor(a.kind, b.kind), event });
  return true;
}

/** Remove um componente e todas as ligações que lhe tocam. */
export function removeComponent(d: Design, id: string): void {
  d.components = d.components.filter((c) => c.id !== id);
  d.connections = d.connections.filter((c) => c.from !== id && c.to !== id);
}

export function removeConnection(d: Design, index: number): void {
  if (index >= 0 && index < d.connections.length) d.connections.splice(index, 1);
}

const num = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lê um desenho guardado (o formato do Studio original: `{components:[{…,x,y}],
 *  connections:[…]}`). Tolerante: entradas inválidas caem, o resto abre. Desconhecido →
 *  desenho vazio. */
export function parseDesign(raw: unknown): Design {
  const d = emptyDesign();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as { components?: unknown; connections?: unknown };
  if (!Array.isArray(r.components) || !Array.isArray(r.connections)) return d;
  for (const c of r.components as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || !str(c.id) || !isKind(c.kind) || findNode(d, str(c.id))) continue;
    d.components.push({ id: str(c.id), name: str(c.name) || str(c.id), kind: c.kind, outbox: c.outbox === true, x: num(c.x, 24), y: num(c.y, 24) });
  }
  for (const c of r.connections as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || !isRelation(c.relation)) continue;
    d.connections.push({ from: str(c.from), to: str(c.to), relation: c.relation, event: str(c.event) });
  }
  return d;
}
