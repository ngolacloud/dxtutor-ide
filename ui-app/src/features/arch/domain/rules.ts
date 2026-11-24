/* ═════════ feature `arch` — domínio: as regras do arquitecto no Studio (RF-A01, F5.2) ═════════
   O `.dxtutor/architecture.toml` como o Studio o edita: camadas (caminhos, de quem podem
   depender), bibliotecas, nomes e excepções com ADR. A validação e a escrita são do Rust
   (`tutor_agent::conformance`, comando `arch_rules_save`); aqui ficam a forma, a leitura do que
   o backend manda e as camadas que nascem do desenho. PURO. */

import type { Design } from "./types";

export interface RulesLayer {
  name: string;
  paths: string[];
  /** As outras camadas de que esta pode depender; `null` = qualquer uma. */
  mayUse: string[] | null;
  /** Como um import para esta camada se reconhece (vazio: pelo nome da camada). */
  imports: string[];
}

export interface ArchRules {
  layers: RulesLayer[];
  libraries: { forbidden: string[]; approved: string[] };
  naming: Array<{ paths: string[]; pattern: string }>;
  exceptions: Array<{ adr: string; rule: string }>;
}

/** O que `arch_rules_load`/`arch_rules_save` devolvem. */
export interface RulesDoc {
  exists: boolean;
  rules: ArchRules;
  error: string | null;
  canEdit: boolean;
  note: string;
}

export interface Adr {
  path: string;
  id: string;
  title: string;
  status: string;
  accepted: boolean;
}

export const RULES_FILE = ".dxtutor/architecture.toml";

export const emptyRules = (): ArchRules => ({ layers: [], libraries: { forbidden: [], approved: [] }, naming: [], exceptions: [] });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** As regras como o serde as manda (`may_use` em snake_case; ausente = qualquer camada). */
export function parseRules(v: unknown): ArchRules {
  const o = isObj(v) ? v : {};
  const lib = isObj(o.libraries) ? o.libraries : {};
  return {
    layers: (Array.isArray(o.layers) ? o.layers : []).filter(isObj).map((l) => ({
      name: str(l.name),
      paths: strs(l.paths),
      mayUse: Array.isArray(l.may_use) ? strs(l.may_use) : null,
      imports: strs(l.imports),
    })),
    libraries: { forbidden: strs(lib.forbidden), approved: strs(lib.approved) },
    naming: (Array.isArray(o.naming) ? o.naming : []).filter(isObj).map((n) => ({ paths: strs(n.paths), pattern: str(n.pattern) })),
    exceptions: (Array.isArray(o.exceptions) ? o.exceptions : []).filter(isObj).map((e) => ({ adr: str(e.adr), rule: str(e.rule) })),
  };
}

/** As regras como o comando `arch_rules_save` as recebe. */
export function rulesToWire(r: ArchRules): Record<string, unknown> {
  return {
    layers: r.layers.map((l) => ({ name: l.name, paths: l.paths, imports: l.imports, ...(l.mayUse === null ? {} : { may_use: l.mayUse }) })),
    libraries: { forbidden: r.libraries.forbidden, approved: r.libraries.approved },
    naming: r.naming.map((n) => ({ paths: n.paths, pattern: n.pattern })),
    exceptions: r.exceptions.map((e) => ({ adr: e.adr, rule: e.rule })),
  };
}

export function parseRulesDoc(v: unknown): RulesDoc {
  const o = isObj(v) ? v : {};
  return { exists: o.exists === true, rules: parseRules(o.rules), error: typeof o.error === "string" && o.error ? o.error : null, canEdit: o.canEdit === true, note: str(o.note) };
}

export function parseAdrs(v: unknown): Adr[] {
  return (Array.isArray(v) ? v : []).filter(isObj).map(parseAdr).filter((a) => a.path !== "");
}

export function parseAdr(a: unknown): Adr {
  const o = isObj(a) ? a : {};
  return { path: str(o.path), id: str(o.id), title: str(o.title), status: str(o.status), accepted: o.accepted === true };
}

/** `a, b ,, c` → `["a", "b", "c"]` (o que se escreve num campo de lista). */
export const splitList = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);
export const joinList = (xs: string[]): string => xs.join(", ");

/** O nome de camada que um rótulo do desenho dá: `Application Layer` → `application_layer`
 *  (é também o segmento de caminho/módulo pelo qual um import se reconhece). */
export function layerName(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** A camada (grupo `layer`) onde um componente vive, subindo pelos grupos que o contêm. */
function layerOf(d: Design, componentId: string): string | null {
  const byId = new Map(d.groups.map((g) => [g.id, g]));
  let g = byId.get(d.components.find((c) => c.id === componentId)?.group ?? "");
  const seen = new Set<string>();
  while (g && !seen.has(g.id)) {
    if (g.kind === "layer") return layerName(g.label) || null;
    seen.add(g.id);
    g = g.parent ? byId.get(g.parent) : undefined;
  }
  return null;
}

/** As camadas que nascem do desenho (F5.2): cada grupo `layer` é uma camada (caminhos por omissão
 *  `src/<nome>/**`, a acertar), e cada seta de um componente de uma camada para um de outra diz
 *  que a primeira pode depender da segunda. Junta às regras sem tirar nada: uma camada que já
 *  existe guarda os seus caminhos; uma que pode depender de qualquer uma (`null`) fica assim. */
export function layersFromDesign(d: Design, r: ArchRules): { rules: ArchRules; added: string[]; uses: string[] } {
  const layers = r.layers.map((l) => ({ ...l, paths: [...l.paths], imports: [...l.imports], mayUse: l.mayUse === null ? null : [...l.mayUse] }));
  const added: string[] = [];
  for (const g of d.groups) {
    const name = g.kind === "layer" ? layerName(g.label) : "";
    if (!name || layers.some((l) => l.name === name)) continue;
    layers.push({ name, paths: [`src/${name}/**`], mayUse: [], imports: [] });
    added.push(name);
  }
  const uses: string[] = [];
  for (const c of d.connections) {
    const from = layerOf(d, c.from), to = layerOf(d, c.to);
    if (!from || !to || from === to) continue;
    const l = layers.find((x) => x.name === from);
    if (!l || l.mayUse === null || l.mayUse.includes(to)) continue;
    l.mayUse.push(to);
    uses.push(`${from} → ${to}`);
  }
  return { rules: { ...r, layers }, added, uses };
}
