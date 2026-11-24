/* Portas falsas do Studio de arquitectura para os testes (sem Tauri, sem DOM de imagem). */
import type { ArchGateway, Files, Renderer } from "../../src/features/arch/application/ports";
import { emptyDesign } from "../../src/features/arch/domain/design";

/** Os métodos de importar/exportar do gateway, sem backend (os testes que precisam deles
 *  substituem-nos). */
export const ioGateway: Pick<ArchGateway, "exportMermaid" | "importMermaid" | "saveExport" | "readFile"> = {
  exportMermaid: async () => "graph TB\n",
  importMermaid: async () => ({ design: emptyDesign(), warnings: [] }),
  saveExport: async (_root, rel) => rel,
  readFile: async () => "",
};

export const fakeRenderer: Renderer = {
  svg: () => "<svg/>",
  png: async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
};

export const fakeFiles = (): Files & { downloads: { name: string; bytes: Uint8Array; mime: string }[] } => {
  const downloads: { name: string; bytes: Uint8Array; mime: string }[] = [];
  return { downloads, download: (name, bytes, mime) => { downloads.push({ name, bytes, mime }); } };
};
