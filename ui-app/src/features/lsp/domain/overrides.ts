/* ═════════ feature `lsp` — os overrides do registo de linguagens (LSP P2) ═════════
   O backend junta ao registo embutido o `lsp.json` do utilizador e o `.dxtutor/lsp.json` do projecto
   (`tutor_eval::lspconf`) e devolve-o com o estado de cada ficheiro (`lsp_config`). Aqui, as regras
   PURAS sobre essa resposta: o registo efectivo para o editor, os ficheiros ignorados (com os erros), a
   entrada efectiva de um servidor para inspeccionar e o texto de um comando aprovável. As regras que
   contam (o que se junta, o que precisa de aprovação) vivem no Rust. */

import type { RegLanguage, RegServer, Registry } from "./registry";
import type { ServerApproval } from "./server-status";

/** `lspconf::FileReport`. */
export interface FileReport {
  path: string;
  exists: boolean;
  applied: boolean;
  errors: string[];
}

/** `lsp::ServerView`: a entrada efectiva, de onde veio e a aprovação que ainda falta. */
export interface ServerView extends RegServer {
  sources: string[];
  projectLaunch: string[];
  approval: ServerApproval | null;
}

/** `lsp::LspConfigView`. */
export interface LspConfigView {
  root: string | null;
  userFile: FileReport | null;
  projectFile: FileReport | null;
  languages: RegLanguage[];
  servers: ServerView[];
}

/** O registo efectivo (para `useRegistry`), sem o que só a inspecção usa. */
export function effectiveRegistry(v: LspConfigView): Registry {
  return {
    version: 1,
    languages: v.languages,
    servers: v.servers.map(({ sources: _s, projectLaunch: _p, approval: _a, ...entry }) => entry),
  };
}

/** Os ficheiros de overrides que existem e foram ignorados por terem erros. */
export function invalidFiles(v: LspConfigView | null): FileReport[] {
  if (!v) return [];
  return [v.userFile, v.projectFile].filter((f): f is FileReport => !!f && f.exists && !f.applied && f.errors.length > 0);
}

/** Uma assinatura dos erros (para não repetir o mesmo aviso a cada recarga). */
export const errorsKey = (files: FileReport[]): string => files.map((f) => `${f.path}\n${f.errors.join("\n")}`).join("\n\n");

/** A entrada de um servidor como se inspecciona: os campos que contam, as definições efectivas, de onde
 *  veio, as linguagens que serve e a aprovação. */
export interface EffectiveEntry {
  id: string;
  label: string;
  sources: string[];
  languages: string[];
  approval: ServerApproval | null;
  /** o projecto mudou o arranque e o comando já está aprovado */
  approved: boolean;
  /** o JSON da entrada efectiva (sem os campos de inspecção) */
  json: string;
}

export function effectiveEntry(v: LspConfigView, serverId: string): EffectiveEntry | null {
  const s = v.servers.find((x) => x.id === serverId);
  if (!s) return null;
  const { sources, projectLaunch, approval, ...entry } = s;
  return {
    id: s.id,
    label: s.label,
    sources,
    languages: v.languages.filter((l) => l.server === s.id).map((l) => l.id),
    approval,
    approved: projectLaunch.length > 0 && !approval,
    json: JSON.stringify(entry, null, 2),
  };
}

/** Os servidores pela ordem da inspecção: os que algum override tocou primeiro, depois os outros. */
export function serversForInspection(v: LspConfigView): ServerView[] {
  const touched = (s: ServerView): number => (s.sources.some((x) => x !== "bundled") ? 0 : 1);
  return [...v.servers].sort((a, b) => touched(a) - touched(b));
}

/** A chave do editor do ficheiro do projecto (`<prefixo>.dxtutor/lsp.json`). */
export const projectFileKey = (virtualPrefix: string): string => `${virtualPrefix}.dxtutor/lsp.json`;
