/* ═════════ acções da moldura do IDE (ADR-0004, U5a) ═════════
   Os botões fixos do index.html (barra de título, cabeçalho do Explorer, painel inferior, painel
   do Co-Dev, barra de estado) e os dois que o arranque acrescenta (`#pill-agent`, `#st-stack`)
   tinham `onclick="f(…)"` inline; agora têm `data-action="chrome:f"` (+ `data-on` com o argumento)
   e estas acções chamam a mesma função publicada, no acto. Dissolvem-se quando cada feature for
   dona dos seus botões (U7). */
import { registerActions, globalCalls, callGlobal } from "./actions";

registerActions({
  ...globalCalls("chrome", ["toggleSide", "togglePanel", "toggleAgent", "newFile", "newFolder", "collapseAll", "termClear", "pickModel",
    "assistantCenter", "openManager", "newChat", "pickBranch", "cycleMode", "toggleNotes", "pickAgent"]),
  "chrome:refresh": { click: () => void callGlobal("refresh", false, true) },
  "chrome:palette": { click: (c) => void callGlobal("palette", c.on) },
  "chrome:goPane": { click: (c) => void callGlobal("goPane", c.on) },
  "chrome:agCtl": { click: (c) => void callGlobal("agCtl", c.on) },
  "chrome:setPanelTab": { click: (c) => void callGlobal("setPanelTab", c.on) },
});
