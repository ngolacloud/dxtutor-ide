/* ═════════ dxtutor IDE — proprietários de estado (ADR-0004, U3) ═════════
   Importado PRIMEIRO pelo main.ts: os acessores têm de existir antes de o monólito
   escrever as globais. Cada dono guarda o seu estado e emite as mudanças no bus. */
export { agentStore } from "./agent";
export { layoutStore } from "./layout";
export { editorStore } from "./editor";
export { workspaceStore } from "./workspace";
export { bus } from "../bus";
