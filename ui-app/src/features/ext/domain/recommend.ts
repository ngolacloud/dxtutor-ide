/* ═══════════ feature `ext` — recomendações, funcionalidades do dxtutor e migração (ADR-0006, R6b) ═══════════
   PURO: sem DOM, sem `window`, sem Tauri. Substitui o catálogo fixo `EXT` (13 extensões com
   descrições escritas à mão, uma «bundled» que nunca foi instalada e três «com efeito» que eram
   código do dxtutor vestido de extensão):
   - as RECOMENDAÇÕES são ids reais do Open VSX escolhidos pela pilha detectada no projecto;
     instalar uma descarrega o VSIX a sério (app desktop);
   - as FUNCIONALIDADES DO DXTUTOR (diagnósticos na linha, verificação de YAML, formatar o
     documento) dizem o que são, em vez de se fazerem passar por Error Lens/YAML/Prettier;
   - `migrateExs` traz o estado guardado pela versão anterior (só as extensões que eram VSIX
     instalados de verdade, e as escolhas das funcionalidades). */

import type { ExsState, ExtItem } from "./types";

/** Uma recomendação: a etiqueta de contexto do projecto (`projectContext`), o id no Open VSX e porquê. */
export interface Recommendation { ctx: string; id: string; why: string }

/** Ids reais do Open VSX por pilha do projecto. */
export const RECOMMENDATIONS: Recommendation[] = [
  { ctx: "rust", id: "rust-lang.rust-analyzer", why: "Rust project" },
  { ctx: "go", id: "golang.go", why: "Go project" },
  { ctx: "python", id: "ms-python.python", why: "Python project" },
  { ctx: "node", id: "dbaeumer.vscode-eslint", why: "JavaScript/TypeScript project" },
  { ctx: "compose", id: "ms-azuretools.vscode-docker", why: "docker-compose.yml in this project" },
  { ctx: "k8s", id: "redhat.vscode-yaml", why: "Kubernetes manifests in this project" },
];

/** As recomendações para um projecto com as etiquetas `cx` que ainda não estão instaladas. */
export function recommendationsFor(cx: string[], installed: (id: string) => boolean): ExtItem[] {
  const seen = new Set<string>();
  return RECOMMENDATIONS.filter((r) => cx.includes(r.ctx) && !installed(r.id) && !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({ id: r.id, n: r.id.split(".")[1], pub: r.id.split(".")[0], d: "", ctx: [r.ctx], why: r.why }));
}

/** Um resultado da pesquisa do Open VSX (`vsix::OvsxHit`) como item do pane. */
export function fromHit(h: { id: string; name: string; publisher: string; description: string; version: string; downloads: number; verified: boolean }): ExtItem {
  return { id: h.id, n: h.name, pub: h.publisher, d: h.description, ctx: [], ver: h.version, remote: { downloads: h.downloads, verified: h.verified } };
}

/** Uma funcionalidade do próprio dxtutor que se liga e desliga no pane «Extensions». */
export interface Builtin { key: string; n: string; d: string; on: boolean }

/** As funcionalidades do dxtutor (e se nascem ligadas). Formatar o documento (Shift+Alt+F) está
 *  sempre disponível e não entra aqui. */
export const BUILTINS: Builtin[] = [
  { key: "inline-diagnostics", n: "Inline diagnostics", d: "Shows each problem at the end of its line in the editor.", on: false },
  { key: "yaml", n: "YAML checks", d: "Flags tab indentation in .yaml/.yml files and Kubernetes Deployments without resource requests (dxtutor's own checker, not a language server).", on: false },
];

/** Uma funcionalidade está ligada? (o que o utilizador escolheu, senão o valor por omissão). */
export function builtinOn(s: Pick<ExsState, "builtin">, key: string): boolean {
  const b = BUILTINS.find((x) => x.key === key);
  return s.builtin && key in s.builtin ? !!s.builtin[key] : !!b?.on;
}

/** O estado da versão anterior (`ext6`) no formato novo: ficam os VSIX instalados de verdade e o
 *  seu on/off; as entradas do catálogo fixo saem; Error Lens/YAML ligados passam às
 *  funcionalidades correspondentes. */
export function migrateExs(old: unknown): ExsState {
  const o = (old && typeof old === "object" ? old : {}) as { inst?: Record<string, { on: number | boolean }>; vsix?: ExtItem[] };
  const vsix = Array.isArray(o.vsix) ? o.vsix.filter((x) => x && x.id) : [];
  const inst: ExsState["inst"] = {};
  vsix.forEach((x) => { inst[x.id] = o.inst?.[x.id] ?? { on: 1 }; });
  const builtin: Record<string, boolean> = {};
  if (o.inst?.["usernamehw.errorlens"]?.on) builtin["inline-diagnostics"] = true;
  if (o.inst?.["redhat.vscode-yaml"]?.on) builtin.yaml = true;
  return { inst, vsix, builtin };
}
