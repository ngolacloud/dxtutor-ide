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
   as extensões) passa a ver as linguagens dos overrides.
   As linguagens que os VSIX instalados contribuem (LSP P4) entram por baixo do registo (`useContributed`,
   posto pela feature `ext`): só se perguntam quando as regras do registo não dizem nada — o registo
   ganha sempre. As mesmas regras do backend (`tutor_eval::langcontrib`): pelo nome inteiro, depois o
   padrão mais comprido, depois a extensão mais comprida; a primeira linha só quando o nome não diz nada
   (a do registo primeiro); uma linguagem com o id de uma do registo É essa; o servidor de uma linguagem
   só de um VSIX é o do registo que nomeia a extensão em `vscodeExtensions` e a linguagem em
   `vscodeLanguages`. PURO. */

import data from "../../../../../languages/registry.json";
import { patternMatches } from "./glob";

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
  /** a linguagem do outline sintáctico (`file_outline`) */
  outline?: string;
  /** o `id` do servidor em `servers` */
  server?: string;
  /** só nas linguagens que um VSIX contribui e o registo não conhece: as extensões que a trazem */
  contributedBy?: string[];
}

/** Uma linguagem que os VSIX instalados contribuem (LSP P4), juntada por id (`ext/domain/contributions`).
 *  O backend recebe a mesma forma (`lsp_contributions`, `tutor_eval::langcontrib::ContribLanguage`). */
export interface ContributedLanguage {
  id: string;
  /** o primeiro dos `aliases`, senão o id (a barra de estado) */
  name: string;
  /** como o VSIX as declara, em minúsculas e com o ponto (`.go`, `.d.ts`) */
  extensions: string[];
  filenames: string[];
  filenamePatterns: string[];
  firstLine?: string;
  /** o `comments.lineComment` do `language-configuration.json` */
  lineComment?: string;
  /** as extensões (`publisher.name`) que a contribuem, pela ordem de instalação */
  from: string[];
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
  /** as linguagens VS Code, além das suas no registo, que serve quando um VSIX de `vscodeExtensions`
   *  as contribui (o gopls: `go.mod`, `go.sum`, `go.work`) — LSP P4 */
  vscodeLanguages?: string[];
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

/** As linguagens dos VSIX instalados (LSP P4): quem as fornece é a feature `ext` (lidas só quando são
 *  precisas — o armazenamento ainda não existe quando os módulos avaliam). */
let contributedSource: () => ContributedLanguage[] = () => [];

/** Liga a fonte das linguagens dos VSIX instalados (a feature `ext`, que a mantém em cache). */
export function useContributed(source: () => ContributedLanguage[]): void {
  contributedSource = source;
}

/** As linguagens dos VSIX instalados, juntadas por id. */
export const contributedLanguages = (): ContributedLanguage[] => contributedSource();

/** A linguagem do REGISTO pelo nome do ficheiro: o nome inteiro primeiro (`Dockerfile`), depois a
 *  extensão depois do último ponto — sem distinguir maiúsculas. Um ficheiro só com um ponto à cabeça
 *  (`.gitignore`) não tem extensão. As linguagens dos VSIX não contam (ver `languageForName`). */
export function registryLanguageForName(path: string): RegLanguage | null {
  const name = fileName(path), lower = name.toLowerCase();
  if (!name) return null;
  const byName = active.languages.find((l) => (l.filenames ?? []).some((f) => f.toLowerCase() === lower));
  if (byName) return byName;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return languageByExtension(name.slice(dot + 1));
}

/** Uma extensão declarada por um VSIX como se compara: minúsculas, com o ponto (`htaccess` → `.htaccess`). */
export const normExtension = (e: string): string => {
  const x = e.trim().toLowerCase();
  return x.startsWith(".") ? x : `.${x}`;
};

/** A linguagem de um VSIX pelo nome do ficheiro: o nome inteiro, depois o padrão mais comprido, depois a
 *  extensão mais comprida (`.d.ts` antes de `.ts`) — sem distinguir maiúsculas. */
export function contributedForName(path: string, langs: ContributedLanguage[] = contributedLanguages()): ContributedLanguage | null {
  const name = fileName(path), lower = name.toLowerCase();
  if (!name || !langs.length) return null;
  const byName = langs.find((l) => l.filenames.some((f) => f.toLowerCase() === lower));
  if (byName) return byName;
  let best: ContributedLanguage | null = null, len = 0;
  for (const l of langs) for (const p of l.filenamePatterns) if (p.length > len && patternMatches(p, path)) [best, len] = [l, p.length];
  if (best) return best;
  for (const l of langs)
    for (const raw of l.extensions) {
      const e = normExtension(raw);
      if (e.length > 1 && e.length > len && lower.endsWith(e)) [best, len] = [l, e.length];
    }
  return best;
}

/** A linguagem de um VSIX cuja `firstLine` casa com `line` (um padrão que não compila salta-se). */
export function contributedForFirstLine(line: string, langs: ContributedLanguage[] = contributedLanguages()): ContributedLanguage | null {
  return langs.find((l) => matchesLine(l.firstLine, line)) ?? null;
}

function matchesLine(pattern: string | undefined, line: string): boolean {
  if (!pattern) return false;
  try {
    return new RegExp(pattern).test(line);
  } catch {
    return false;
  }
}

/** O servidor do registo para uma linguagem só de um VSIX: o que nomeia uma das extensões que a trazem em
 *  `vscodeExtensions` E a lista em `vscodeLanguages`, e que ainda serve uma linguagem do registo. */
export function contributedServerOf(c: ContributedLanguage): RegServer | null {
  return (
    active.servers.find(
      (s) =>
        (s.vscodeLanguages ?? []).includes(c.id) &&
        c.from.some((x) => (s.vscodeExtensions ?? []).includes(x.toLowerCase())) &&
        active.languages.some((l) => l.server === s.id),
    ) ?? null
  );
}

/** Uma linguagem de um VSIX como linguagem do ficheiro: a do registo com o mesmo id (é essa), ou uma
 *  só do VSIX, com o servidor que o registo lhe dá. */
export function asLanguage(c: ContributedLanguage): RegLanguage {
  const same = languageById(c.id);
  if (same) return same;
  const server = contributedServerOf(c)?.id;
  return {
    id: c.id,
    name: c.name,
    lspLanguageId: c.id,
    extensions: c.extensions.map((e) => normExtension(e).slice(1)),
    filenames: c.filenames,
    firstLine: c.firstLine,
    lineComment: c.lineComment,
    ...(server ? { server } : {}),
    contributedBy: c.from,
  };
}

/** A linguagem pelo NOME do ficheiro: as regras do registo (`registryLanguageForName`) e, se não dizem
 *  nada, as linguagens dos VSIX instalados (LSP P4). */
export function languageForName(path: string): RegLanguage | null {
  const reg = registryLanguageForName(path);
  if (reg) return reg;
  const c = contributedForName(path);
  return c ? asLanguage(c) : null;
}

/** A linguagem de uma extensão (sem o ponto, sem distinguir maiúsculas). */
export function languageByExtension(ext: string): RegLanguage | null {
  const e = ext.toLowerCase();
  return active.languages.find((l) => (l.extensions ?? []).includes(e)) ?? null;
}

/** A linguagem cuja `firstLine` casa com a primeira linha de `content`: a do registo primeiro, depois a
 *  dos VSIX instalados. */
export function languageForFirstLine(content: string): RegLanguage | null {
  const nl = content.indexOf("\n");
  const line = nl < 0 ? content : content.slice(0, nl);
  const reg = active.languages.find((l) => matchesLine(l.firstLine, line));
  if (reg) return reg;
  const c = contributedForFirstLine(line);
  return c ? asLanguage(c) : null;
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
