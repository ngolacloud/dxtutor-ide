/* ═════════ feature `arch` — regras puras do desenho ═════════
   Operações sobre o `Design` (componentes, ligações, grupos, painéis), a relação e o
   estilo inferidos das pontas, a conversão para o modelo do backend e a leitura tolerante
   do que estava guardado. Não valida a arquitectura: isso é SEMPRE do backend
   (arch_validate). PURO: sem DOM, sem window, sem Tauri. */

import type {
  ArchConnection, ArchGroup, ArchKind, ArchRelation, ArchView, Architecture, Design, DesignGroup, DesignNode,
  EdgeStyle, EventKind, GroupKind, GroupStyle, Protocol, SystemKind,
} from "./types";

export const EVENT_KINDS: readonly EventKind[] = ["service", "store", "broker", "consumer", "relay", "gateway"];
export const SYSTEM_KINDS: readonly SystemKind[] = [
  "cli", "daemon", "process", "runtime", "worker", "socket", "state", "port", "adapter", "client", "external", "kernel",
];
export const KINDS: readonly ArchKind[] = [...EVENT_KINDS, ...SYSTEM_KINDS];
export const GROUP_KINDS: readonly GroupKind[] = ["host", "plane", "node", "module", "layer", "boundary"];
export const PROTOCOLS: readonly Protocol[] = ["grpc", "http", "unix-socket", "fork-exec", "syscall", "fs", "ssh", "event"];
export const EDGE_STYLES: readonly EdgeStyle[] = ["control", "data", "optional"];
const RELATIONS: readonly ArchRelation[] = ["writes", "reads", "publishes", "consumes", "routes-to"];

/** Cor de cada Kind de eventos (o desenho de eventos não tem painéis). */
export const KIND_COLOR: Record<EventKind, string> = {
  service: "#dea584",
  store: "#5cc9a7",
  broker: "#d7a860",
  consumer: "#7aa2f7",
  relay: "#b48ead",
  gateway: "#e06c3b",
};

export const KIND_LABEL: Record<ArchKind, string> = {
  service: "Service", store: "Store", broker: "Broker", consumer: "Consumer", relay: "Relay", gateway: "Gateway",
  cli: "CLI", process: "Process", daemon: "Daemon", runtime: "Runtime", socket: "Socket", state: "State",
  kernel: "Kernel", external: "External", client: "Client", worker: "Worker", port: "Port", adapter: "Adapter",
};

export const GROUP_LABEL: Record<GroupKind, string> = {
  host: "Host", plane: "Plane", node: "Node", module: "Module", layer: "Layer", boundary: "Boundary",
};

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  grpc: "gRPC", http: "HTTP", "unix-socket": "Unix socket", "fork-exec": "fork/exec", syscall: "syscall", fs: "files",
  ssh: "SSH", event: "event",
};

/** As duas cores dos painéis por omissão (verde-azulado e roxo, como na referência). */
export const PANEL_COLORS = ["#0f766e", "#6d28d9"] as const;
export const MAX_VIEWS = 2;

const isOneOf = <T extends string>(list: readonly T[]) => (v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);
export const isKind = isOneOf(KINDS);
export const isEventKind = isOneOf(EVENT_KINDS);
export const isGroupKind = isOneOf(GROUP_KINDS);
export const isProtocol = isOneOf(PROTOCOLS);
export const isEdgeStyle = isOneOf(EDGE_STYLES);
const isRelation = isOneOf(RELATIONS);

/** Slug IGUAL ao do backend (`arch.rs::scaffold`): alfanumérico em minúsculas, o resto vira '-'. */
export const slug = (s: string): string =>
  Array.from(s).map((c) => (/[\p{L}\p{N}]/u.test(c) ? c.toLowerCase() : "-")).join("");

/** Relação inferida dos tipos das pontas (só entre Kind de eventos): escrever/ler numa
 *  store, publicar/consumir num broker, encaminhar a partir de um broker; o resto cai em
 *  `writes` (inócuo). */
export function relationFor(from: ArchKind, to: ArchKind): ArchRelation {
  if (to === "store") return from === "relay" ? "reads" : "writes";
  if (to === "broker") return from === "consumer" ? "consumes" : "publishes";
  if (from === "broker") return "routes-to";
  return "writes";
}

/** Uma ligação nomeia um evento quando publica ou consome. */
export const relationTakesEvent = (r: ArchRelation | undefined): boolean => r === "publishes" || r === "consumes";

/** Estilo inicial de uma seta de sistema: pedidos de um cliente ou externo são dados; o
 *  resto é controlo. */
export const styleFor = (from: ArchKind, to: ArchKind): EdgeStyle =>
  from === "client" || from === "external" || to === "client" ? "data" : "control";

export const emptyDesign = (): Design => ({ components: [], connections: [], groups: [], views: [] });

export const findNode = (d: Design, id: string): DesignNode | undefined => d.components.find((c) => c.id === id);
export const findGroup = (d: Design, id: string): DesignGroup | undefined => d.groups.find((g) => g.id === id);
export const findView = (d: Design, id: string): ArchView | undefined => d.views.find((v) => v.id === id);

/** O desenho tem componentes de eventos (o scaffold só materializa esses). */
export const hasEventKinds = (d: Design): boolean => d.components.some((c) => isEventKind(c.kind));

const opt = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);

/** O desenho no formato do backend: sem geometria e sem campos vazios. */
export function toArchitecture(d: Design): Architecture {
  return {
    components: d.components.map((c) => {
      const o: Architecture["components"][number] = { id: c.id, name: c.name, kind: c.kind, outbox: c.outbox };
      if (opt(c.group)) o.group = c.group;
      if (opt(c.code)) o.code = c.code;
      if (opt(c.source)) o.source = c.source;
      return o;
    }),
    connections: d.connections.map((c) => {
      const o: ArchConnection = { from: c.from, to: c.to, event: c.event };
      if (c.relation) o.relation = c.relation;
      if (opt(c.label)) o.label = c.label;
      if (c.protocol) o.protocol = c.protocol;
      if (c.style) o.style = c.style;
      if (opt(c.source)) o.source = c.source;
      return o;
    }),
    groups: d.groups.map((g) => {
      const o: ArchGroup = { id: g.id, label: g.label, kind: g.kind, style: g.style };
      if (opt(g.parent)) o.parent = g.parent;
      if (opt(g.source)) o.source = g.source;
      return o;
    }),
    views: d.views.map((v) => ({ ...v, roots: [...v.roots] })),
  };
}

/** Um id único (entre componentes, grupos e painéis) a partir de um nome. */
export function uniqueId(d: Design, name: string, fallback: string): string {
  const taken = new Set([...d.components.map((c) => c.id), ...d.groups.map((g) => g.id), ...d.views.map((v) => v.id)]);
  const base = slug(name) || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Acrescenta um componente na posição dada. Devolve o id. */
export function addComponent(d: Design, kind: ArchKind, name: string, at?: { x: number; y: number }, group?: string): string {
  const id = uniqueId(d, name, "comp");
  const k = d.components.length;
  const pos = at ?? { x: 24 + (k % 4) * 180, y: 24 + Math.floor(k / 4) * 110 };
  const n: DesignNode = { id, name, kind, outbox: false, x: pos.x, y: pos.y };
  if (group && findGroup(d, group)) n.group = group;
  d.components.push(n);
  return id;
}

/** Liga `from` → `to`. Entre Kind de eventos infere a relação; nos outros casos é uma
 *  seta de sistema com estilo inicial. Devolve `false` se não ligou (ponta inexistente,
 *  laço, ou ligação repetida com o mesmo evento). */
export function connect(d: Design, from: string, to: string, event = ""): boolean {
  const a = findNode(d, from), b = findNode(d, to);
  if (!a || !b || from === to) return false;
  if (d.connections.some((c) => c.from === from && c.to === to && c.event === event)) return false;
  if (isEventKind(a.kind) && isEventKind(b.kind)) d.connections.push({ from, to, relation: relationFor(a.kind, b.kind), event });
  else d.connections.push({ from, to, event: "", style: styleFor(a.kind, b.kind) });
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

/** Os grupos dentro de `id` (filhos, netos…), sem entrar em laço num ciclo. */
export function descendants(d: Design, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (g: string): void => {
    for (const c of d.groups) if (c.parent === g && c.id !== id && !out.has(c.id)) { out.add(c.id); walk(c.id); }
  };
  walk(id);
  return out;
}

/** A cadeia de `id` até à raiz (inclusive), sem laços. */
export function ancestry(d: Design, id: string): string[] {
  const chain: string[] = [];
  let cur: string | undefined = id;
  while (cur && !chain.includes(cur) && findGroup(d, cur)) {
    chain.push(cur);
    cur = findGroup(d, cur)!.parent;
  }
  return chain;
}

/** Profundidade de um grupo (raiz = 0). */
export const depth = (d: Design, id: string): number => Math.max(0, ancestry(d, id).length - 1);

/** O painel que mostra o grupo (pelas raízes de cada painel). */
export function viewOfGroup(d: Design, id: string): ArchView | undefined {
  const chain = ancestry(d, id);
  return d.views.find((v) => v.roots.some((r) => chain.includes(r)));
}

/** O painel onde um componente vive (pelo seu grupo). */
export const viewOfNode = (d: Design, n: DesignNode): ArchView | undefined => (n.group ? viewOfGroup(d, n.group) : undefined);

export function addGroup(d: Design, label: string, rect: { x: number; y: number; w: number; h: number }, parent?: string, kind: GroupKind = "boundary"): string {
  const id = uniqueId(d, label, "group");
  const g: DesignGroup = { id, label, kind, style: "dashed", ...rect };
  if (parent && findGroup(d, parent)) g.parent = parent;
  d.groups.push(g);
  return id;
}

/** Muda o pai de um grupo. Recusa (devolve `false`) se criar um ciclo. */
export function setGroupParent(d: Design, id: string, parent: string | undefined): boolean {
  const g = findGroup(d, id);
  if (!g) return false;
  if (parent && (parent === id || descendants(d, id).has(parent) || !findGroup(d, parent))) return false;
  if (parent) {
    g.parent = parent;
    for (const v of d.views) v.roots = v.roots.filter((r) => r !== id); // segue o painel do pai
  } else delete g.parent;
  return true;
}

/** Põe um grupo raiz num painel (ou tira-o de todos com `undefined`). */
export function setGroupView(d: Design, id: string, viewId: string | undefined): void {
  for (const v of d.views) v.roots = v.roots.filter((r) => r !== id);
  const v = viewId ? findView(d, viewId) : undefined;
  if (v && findGroup(d, id)) v.roots.push(id);
}

/** Remove um grupo: o que estava dentro passa para o pai (ou fica solto); os grupos filhos
 *  de uma raiz de painel passam a raízes desse painel. */
export function removeGroup(d: Design, id: string): void {
  const g = findGroup(d, id);
  if (!g) return;
  const view = d.views.find((v) => v.roots.includes(id));
  for (const n of d.components) if (n.group === id) { if (g.parent) n.group = g.parent; else delete n.group; }
  for (const c of d.groups) {
    if (c.parent !== id) continue;
    if (g.parent) c.parent = g.parent;
    else { delete c.parent; if (view) view.roots.push(c.id); }
  }
  for (const v of d.views) v.roots = v.roots.filter((r) => r !== id);
  d.groups = d.groups.filter((x) => x.id !== id);
}

export function addView(d: Design, title: string): string | null {
  if (d.views.length >= MAX_VIEWS) return null;
  const id = uniqueId(d, title, "panel");
  const used = new Set(d.views.map((v) => v.color));
  const color = PANEL_COLORS.find((c) => !used.has(c)) ?? PANEL_COLORS[0];
  d.views.push({ id, title, color, roots: [], daemonless: false, strict: false });
  return id;
}

export function removeView(d: Design, id: string): void {
  d.views = d.views.filter((v) => v.id !== id);
}

// ───── leitura tolerante do que estava guardado ─────

const num = (v: unknown, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? v : dflt);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const optStr = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Lê um desenho guardado. Aceita o formato do Studio original (`{components, connections}`
 *  com x/y) e o actual (com grupos e painéis). Tolerante: entradas inválidas caem, o resto
 *  abre. Desconhecido → desenho vazio (nunca dados de demonstração). */
export function parseDesign(raw: unknown): Design {
  const d = emptyDesign();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.components) || !Array.isArray(r.connections)) return d;
  const ids = new Set<string>();
  for (const g of (Array.isArray(r.groups) ? r.groups : []) as Record<string, unknown>[]) {
    if (!g || typeof g !== "object" || !str(g.id) || ids.has(str(g.id))) continue;
    ids.add(str(g.id));
    const dg: DesignGroup = {
      id: str(g.id), label: str(g.label) || str(g.id), kind: isGroupKind(g.kind) ? g.kind : "boundary",
      style: (g.style === "solid" ? "solid" : "dashed") as GroupStyle,
      x: num(g.x, 24), y: num(g.y, 24), w: num(g.w, 220), h: num(g.h, 140),
    };
    if (optStr(g.parent)) dg.parent = str(g.parent);
    if (optStr(g.source)) dg.source = str(g.source);
    d.groups.push(dg);
  }
  for (const c of r.components as Record<string, unknown>[]) {
    if (!c || typeof c !== "object" || !str(c.id) || !isKind(c.kind) || findNode(d, str(c.id))) continue;
    const n: DesignNode = { id: str(c.id), name: str(c.name) || str(c.id), kind: c.kind, outbox: c.outbox === true, x: num(c.x, 24), y: num(c.y, 24) };
    if (optStr(c.group)) n.group = str(c.group);
    if (optStr(c.code)) n.code = str(c.code);
    if (optStr(c.source)) n.source = str(c.source);
    d.components.push(n);
  }
  for (const c of r.connections as Record<string, unknown>[]) {
    if (!c || typeof c !== "object") continue;
    if (c.relation !== undefined && !isRelation(c.relation)) continue; // relação inválida: cai
    const relation = isRelation(c.relation) ? c.relation : undefined;
    const style = isEdgeStyle(c.style) ? c.style : undefined;
    const cn: ArchConnection = { from: str(c.from), to: str(c.to), event: str(c.event) };
    if (relation) cn.relation = relation;
    if (style) cn.style = style;
    if (isProtocol(c.protocol)) cn.protocol = c.protocol;
    if (optStr(c.label)) cn.label = str(c.label);
    if (optStr(c.source)) cn.source = str(c.source);
    d.connections.push(cn);
  }
  for (const v of (Array.isArray(r.views) ? r.views : []) as Record<string, unknown>[]) {
    if (!v || typeof v !== "object" || !str(v.id) || d.views.length >= MAX_VIEWS) continue;
    d.views.push({
      id: str(v.id), title: str(v.title) || str(v.id),
      color: /^#[0-9a-fA-F]{3,8}$/.test(str(v.color)) ? str(v.color) : PANEL_COLORS[d.views.length],
      roots: (Array.isArray(v.roots) ? v.roots : []).filter((x): x is string => typeof x === "string"),
      daemonless: v.daemonless === true, strict: v.strict === true,
    });
  }
  return d;
}

/** Junta o modelo do backend (ex.: vindo de um import Mermaid) com uma geometria: o que já
 *  tinha posição mantém-na; o resto fica na origem para o auto-layout (F4) arrumar. */
export function fromArchitecture(a: Architecture): Design {
  return parseDesign({
    components: a.components.map((c) => ({ ...c, x: 24, y: 24 })),
    connections: a.connections,
    groups: a.groups.map((g) => ({ ...g, x: 24, y: 24, w: 220, h: 140 })),
    views: a.views,
  });
}
