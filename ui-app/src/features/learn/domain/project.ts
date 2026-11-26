/* Passos de projecto (vários ficheiros) no Learning Track. PURO: sem DOM, sem window.
   O backend tem a regra que conta (tutor_core::ProjectFiles: caminhos seguros, só se entregam
   os editáveis, os só de leitura ficam com a cópia do curso); aqui está só o que a vista
   precisa para mostrar e entregar os ficheiros. */

import type { StepProject } from "./types";

/** Os caminhos do passo, com o principal primeiro e os outros por ordem alfabética. */
export function projectPaths(p: StepProject): string[] {
  const rest = Object.keys(p.files).filter(f => f !== p.main).sort();
  return p.main in p.files ? [p.main, ...rest] : rest;
}

export function isReadonly(p: StepProject, path: string): boolean {
  return p.readonly.includes(path);
}

/** Os ficheiros editáveis, pela ordem de `projectPaths`. */
export function editablePaths(p: StepProject): string[] {
  return projectPaths(p).filter(f => !isReadonly(p, f));
}

/** A entrega: o conteúdo actual de cada ficheiro editável (`read` devolve `undefined` para um
 *  ficheiro que o aluno nunca abriu: vai o conteúdo inicial). Os só de leitura nunca vão. */
export function projectSubmission(p: StepProject, read: (path: string) => string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of editablePaths(p)) out[f] = read(f) ?? p.files[f];
  return out;
}

/** O nome curto de um caminho (o separador do editor): `shop/cart.py` → `cart.py`. */
export function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}
