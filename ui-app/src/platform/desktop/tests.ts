/* ═════════ dxtutor IDE — desktop: testes reais (A0.5, docs/v2/UI-AUDIT.md) ═════════
   Instala a porta `desktopPorts.tests` que o pane «Testing» (features/test.ts) consulta: com
   uma pasta aberta, a lista vem do `list_tests` (descoberta sintáctica no backend) e as
   execuções do `run_test`/`run_all_tests` (com tecto de tempo, fora da thread da janela).
   Antes de correr, força o autosave para o backend testar o que o editor mostra. */

import { testsClient } from "../tauri/tests";
import { desktopPorts } from "../../app/desktop";
import type { DesktopContext } from "./context";

export function installTests(ctx: DesktopContext): void {
  const { R } = ctx;
  const client = testsClient();
  /* o backend lê o disco: espera que o autosave e a fila de escrita terminem */
  const saved = async (): Promise<void> => { ctx.flushSave(); if (R.idle) await R.idle(); };
  desktopPorts.tests = {
    root: () => R.root,
    list: async () => (R.root ? client.list(R.root) : []),
    run: async (t) => { if (!R.root) throw new Error("no folder open"); await saved(); return client.runOne(R.root, t.path, t.lang); },
    runAll: async () => { if (!R.root) throw new Error("no folder open"); await saved(); return client.runAll(R.root); },
    open: (file, line) => openPath(ROOT + file.replace(/\\/g, "/"), line),
  };
}
