/* ═════════ acções da moldura do IDE (ADR-0004, U5a) ═════════
   Os botões fixos do index.html (barra de título, cabeçalho do Explorer, painel inferior, painel
   do Co-Dev, barra de estado) e os dois que o arranque acrescenta (`#pill-agent`, `#st-stack`)
   tinham `onclick="f(…)"` inline; agora têm `data-action="chrome:f"` (+ `data-on` com o argumento)
   e estas acções chamam a mesma função publicada, no acto. Dissolvem-se quando cada feature for
   dona dos seus botões (U7). */
import { registerActions, globalCalls, callGlobal } from "./actions";
import { cycleMode, pickModel, newChat, agCtl, assistantCenter, toggleAgent, openManager } from "../features/codev";
import { newFile, newFolder, collapseAll } from "../features/explorer";
import { termClear } from "../features/terminal";
import { pickAgent } from "../features/team";
import { toggleNotes } from "../features/notifications";

/* U7n: os botões chamam as funções importadas (avaliam todas antes deste módulo); os nomes que módulos de outras
   sessões ainda lêem no window (toggleSide, togglePanel, refresh, palette, goPane, setPanelTab, pickBranch) continuam a
   ser chamados pelo publicado, no acto. */
registerActions({
  ...globalCalls("chrome", ["toggleSide", "togglePanel", "pickBranch"]),
  "chrome:toggleAgent": { click: () => toggleAgent() },
  "chrome:newFile": { click: () => newFile() },
  "chrome:newFolder": { click: () => newFolder() },
  "chrome:collapseAll": { click: () => collapseAll() },
  "chrome:termClear": { click: () => termClear() },
  "chrome:pickModel": { click: () => pickModel() },
  "chrome:assistantCenter": { click: () => assistantCenter() },
  "chrome:openManager": { click: () => openManager() },
  "chrome:newChat": { click: () => newChat() },
  "chrome:cycleMode": { click: () => cycleMode() },
  "chrome:toggleNotes": { click: () => toggleNotes() },
  "chrome:pickAgent": { click: () => pickAgent() },
  "chrome:refresh": { click: () => void callGlobal("refresh", false, true) },
  "chrome:palette": { click: (c) => void callGlobal("palette", c.on) },
  "chrome:goPane": { click: (c) => void callGlobal("goPane", c.on) },
  "chrome:agCtl": { click: (c) => agCtl(c.on) },
  "chrome:setPanelTab": { click: (c) => void callGlobal("setPanelTab", c.on) },
});
