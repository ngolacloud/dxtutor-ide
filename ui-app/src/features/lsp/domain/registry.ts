/* ═════════ feature `lsp` — o registo de linguagens (um só ficheiro de dados) ═════════
   `languages/registry.json`, na raiz do repositório, diz para cada linguagem como se reconhece
   um ficheiro (extensões, nomes de ficheiro como `Dockerfile`, a primeira linha) e o que o
   editor precisa (nome na barra de estado, marcador de comentário, outline), e para cada
   servidor de linguagem como se arranca. O backend embute o MESMO ficheiro
   (`tutor_eval::langreg`, `include_str!`) e valida-o nos testes; aqui importa-se pelo Vite, por
   isso o browser não precisa do backend. Antes havia nove tabelas copiadas à mão.
   Na app com uma pasta aberta, o registo EFECTIVO (o embutido com o `lsp.json` do utilizador e o
   `.dxtutor/lsp.json` do projecto por cima, LSP P2) vem do backend (`lsp_config`) e troca-se aqui por
   `useRegistry` — só a raiz de composição do lsp o faz; quem lê o registo (o editor, o explorador,
   as extensões) passa a ver as linguagens dos overrides. PURO. */

import data from "../../../../../languages/registry.json";

/** Uma linguagem do registo (ver `tutor_eval::langreg` para cada campo). */
export interface RegLanguage {
  id: string;
  name: string;
  /** o `languageId` do LSP (por omissão, o `id`) */
  lspLanguageId?: string;
  extensions?: string[];
  filenames?: string[];
  /** expressão regular para a primeira linha (um shebang) */
  firstLine?: string;
  lineComment?: string;
  /** `[abre, fecha]` (`["<!--", "-->"]`, a barra-asterisco do C…): o Toggle Block Comment, e o Ctrl+/ de uma
   *  linguagem sem `lineComment` (LSP P5) */
  blockComment?: [string, string];
  /** a linguagem do outline sintáctico (`file_outline`) */
  outline?: string;
  /** o `id` do servidor em `servers` */
  server?: string;
}

/** Um servidor de linguagem do registo. */
export interface RegServer {
  id: string;
  /** a linguagem como o aviso a diz («C/C++») */
  name: string;
  /** o servidor como se conhece («rust-analyzer», «pyright») */
  label: string;
  command: string;
  args?: string[];
  resolver?: string;
  envOverride?: string;
  searchDirs?: string[];
  rootMarkers?: string[];
  readySignal?: string;
  initOptions?: unknown;
  /** as definições do servidor (a resposta ao `workspace/configuration`), quase sempre de um override */
  settings?: unknown;
  /** barato o bastante para arrancar só para um pedido (o `file_outline`) */
  oneShot?: boolean;
  quirks?: string[];
  /** como instalar à mão (só texto, nunca corre): o aviso mostra-o quando nenhuma receita serve */
  install?: string;
  /** como o dxtutor o pode instalar (LSP P3): o backend constrói o comando a partir daqui */
  recipes?: RegRecipe[];
  vscodeExtensions?: string[];
}

/** Uma receita de instalação (ver `tutor_eval::langreg::Recipe`). */
export interface RegRecipe {
  manager: string;
  packages?: string[];
  version?: string;
  assets?: { platform: string; url: string; sha256: string; archive: string; bin?: string }[];
}

export interface Registry {
  version: number;
  languages: RegLanguage[];
  servers: RegServer[];
}

/** O registo embutido (`languages/registry.json`). */
export const REGISTRY: Registry = data as Registry;

/** O registo em uso: o embutido, ou o efectivo da pasta aberta (com os overrides). */
let active: Registry = REGISTRY;

/** Troca o registo em uso pelo efectivo da pasta aberta (`null` volta ao embutido). */
export function useRegistry(r: Registry | null): void {
  active = r ?? REGISTRY;
}

/** O registo em uso (ver `useRegistry`). */
export const activeRegistry = (): Registry => active;

const fileName = (path: string): string => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** A linguagem pelo NOME do ficheiro: o nome inteiro primeiro (`Dockerfile`), depois a extensão
 *  depois do último ponto — sem distinguir maiúsculas. Um ficheiro só com um ponto à cabeça
 *  (`.gitignore`) não tem extensão. */
export function languageForName(path: string): RegLanguage | null {
  const name = fileName(path), lower = name.toLowerCase();
  if (!name) return null;
  const byName = active.languages.find((l) => (l.filenames ?? []).some((f) => f.toLowerCase() === lower));
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return languageByExtension(name.slice(dot + 1));
}

/** A linguagem de uma extensão (sem o ponto, sem distinguir maiúsculas). */
export function languageByExtension(ext: string): RegLanguage | null {
  const e = ext.toLowerCase();
  return active.languages.find((l) => (l.extensions ?? []).includes(e)) ?? null;
}

/** A linguagem cuja `firstLine` casa com a primeira linha de `content`. */
export function languageForFirstLine(content: string): RegLanguage | null {
  const nl = content.indexOf("\n");
  const line = nl < 0 ? content : content.slice(0, nl);
  return (
    active.languages.find((l) => {
      if (!l.firstLine) return false;
      try {
        return new RegExp(l.firstLine).test(line);
      } catch {
        return false;
      }
    }) ?? null
  );
}

/** A linguagem de um ficheiro: pelo nome; se o nome não diz nada e há conteúdo, pela primeira linha. */
export function languageFor(path: string, content?: string | null): RegLanguage | null {
  return languageForName(path) ?? (content ? languageForFirstLine(content) : null);
}

export const languageById = (id: string): RegLanguage | null => active.languages.find((l) => l.id === id) ?? null;
export const serverById = (id: string): RegServer | null => active.servers.find((s) => s.id === id) ?? null;

/** O servidor de uma linguagem, se tem. */
export const serverOf = (lang: RegLanguage | null): RegServer | null => (lang?.server ? serverById(lang.server) : null);

/** O `languageId` LSP de uma linguagem. */
export const lspIdOf = (lang: RegLanguage): string => lang.lspLanguageId ?? lang.id;
