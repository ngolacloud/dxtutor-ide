/* ═════════ feature `lsp` — chave do editor ↔ caminho no disco ═════════
   O editor guarda os ficheiros no `FS` em memória com a chave `<prefixo virtual><relativo>`
   (o prefixo é o `ROOT` da app, ex. `meu-projecto/`); o servidor de linguagem precisa do
   caminho absoluto no disco (`<pasta aberta>/<relativo>`). PURO. */

/** Chave do editor → caminho absoluto; `null` se a chave não é desta pasta. */
export function keyToAbsolute(key: string, virtualPrefix: string, diskRoot: string): string | null {
  if (!key.startsWith(virtualPrefix)) return null;
  const rel = key.slice(virtualPrefix.length).replace(/^\/+/, "");
  if (!rel || rel.split("/").includes("..")) return null;
  return `${diskRoot.replace(/\/+$/, "")}/${rel}`;
}

/** Caminho absoluto → chave do editor; `null` se o ficheiro está fora da pasta aberta. */
export function absoluteToKey(path: string, virtualPrefix: string, diskRoot: string): string | null {
  const root = diskRoot.replace(/\/+$/, "");
  if (!path.startsWith(root + "/")) return null;
  return virtualPrefix + path.slice(root.length + 1);
}
