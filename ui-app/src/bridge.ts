/* ═════════ dxtutor IDE — desktop bridge (Tauri) ═════════
   No browser não faz nada; dentro da app desktop troca as partes simuladas pelas reais:
   pastas no disco, autosave, um terminal real, git real, modelos reais, docker/podman
   compose e kubectl.

   ADR-0004, U4h1: o bridge.ts é a COMPOSIÇÃO desktop. A parte desktop de cada área vive em
   platform/desktop/ (contexto partilhado + um módulo por área); aqui cria-se o contexto, os
   módulos instalam-se pela ordem das antigas secções (a mesma ordem de efeitos no eval) e
   corre o arranque. Avalia depois do startup (a app já arrancou) e antes do pair.ts. */

export {};
import "./platform/desktop/types";
import { createDesktopContext } from "./platform/desktop/context";
import { installTerminal } from "./platform/desktop/terminal";
import { installWorkspace, installFolderUi } from "./platform/desktop/workspace";
import { installGit } from "./platform/desktop/git";
import { installLlm } from "./platform/desktop/llm";
import { installAgentTasks } from "./platform/desktop/agent-tasks";
import { installInfra } from "./platform/desktop/infra";
import { installDemos } from "./platform/desktop/demos";
import { installExt } from "./platform/desktop/ext";
import { selftest } from "./platform/desktop/selftest";

(() => {
if (!window.__TAURI__ || !window.__TAURI__.core) return;
const ctx = createDesktopContext();
const { R, app, sh } = ctx;
installTerminal(ctx);
installWorkspace(ctx);
installGit(ctx);
installLlm(ctx);
installAgentTasks(ctx);
installInfra(ctx);
installDemos(ctx);
installExt();
installFolderUi(ctx);

/* ───── start ───── */
void (async () => {
  R.info = await app.info();
  try {
    R.user = (await sh("whoami", [], { cwd: R.info.home })).stdout.trim().split(/[\\/]/).pop();
    R.host = (await sh("hostname", [], { cwd: R.info.home })).stdout.trim().split(".")[0];
  } catch { /* sem shell */ }
  await ctx.loadKeys();
  try { updateAgentUI(); } catch { /* painel ainda não montado */ }
  const start = R.info.openAtStart || LS.get("dx-last-folder", "");
  if (start) await ctx.openFolder(start);
  try { if (tabOf("welcome") && cur === "welcome") show("welcome"); } catch { /* sem tab welcome */ }
  if (R.info.selftest && !R.info.pairtest) void selftest(ctx);
  R.ready = true;
})();
})();
