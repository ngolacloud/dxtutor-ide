// LSP P4: VSIX reais em miniatura, para os testes. Cada pasta em `fixtures/vsix/<publisher.name>/extension/` tem o
// `package.json` do VSIX publicado no Open VSX reduzido ao `contributes.languages`/`grammars` (o resto não conta aqui)
// e os ficheiros que ele referencia, tal como vêm no VSIX, com a licença:
//   golang.go 0.58.0 (MIT) · mrmlnc.vscode-apache 1.2.0 (MIT, gramática `.tmLanguage` em plist XML) ·
//   vscode.perl 1.95.3 (MIT, só a linguagem `perl`) · ms-python.python 2026.10.0 (MIT, só o manifesto).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "vsix");

export const VSIX_IDS = ["golang.go", "mrmlnc.vscode-apache", "vscode.perl", "ms-python.python"] as const;
export type VsixId = (typeof VSIX_IDS)[number];

/** Um zip como o JSZip o mostra ao motor (`file(path)?.async("string")`), lido da pasta do VSIX. */
export function vsixZip(id: VsixId) {
  return {
    file: (p: string) => {
      const f = join(ROOT, id, p);
      return existsSync(f) ? { async: async () => readFileSync(f, "utf8") } : null;
    },
    files: {},
  };
}

/** O `package.json` do VSIX. */
export function vsixManifest(id: VsixId): { publisher: string; name: string; contributes: Record<string, unknown> } {
  return JSON.parse(readFileSync(join(ROOT, id, "extension/package.json"), "utf8"));
}

/** Um ficheiro do VSIX (`extension/…`). */
export const vsixFile = (id: VsixId, p: string): string => readFileSync(join(ROOT, id, p), "utf8");
