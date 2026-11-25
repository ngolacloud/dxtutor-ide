/* ═════════ serviços entre features (ADR-0004, U7g — decisão do dono) ═════════
   Quando uma feature precisa de outra que só avalia DEPOIS dela (no main.ts), não pode importá-la — o import
   puxava a avaliação para mais cedo e trocava a ordem dos efeitos. Até aqui lia-a pelo `window` no acto. O registo
   tipado faz o mesmo sem o `window`: o dono regista a sua API aqui ao avaliar, e quem a lê chama-a no acto
   (`services.learn!.course()`). Os tipos vêm por `import type`, que não muda a ordem de avaliação. Este módulo é
   puro (sem efeitos) e pode ser importado por qualquer um. */
import type * as Learn from "../features/learn";
import type * as Team from "../features/team";
import type * as Codev from "../features/codev";
import type * as I18n from "../features/i18n";
import type * as Workspace from "../features/workspace";
import type * as Tabs from "../features/tabs";
import type * as Checkpoint from "../features/checkpoint";
import type * as Studio from "../features/studio";
import type * as Shell from "../features/shell";
import type * as Menus from "../features/menus";
import type * as Explorer from "../features/explorer";
import type * as Terminal from "../features/terminal";
import type * as Theme from "../features/theme";
import type * as Infra from "../features/infra";
import type * as Scm from "../features/scm";
import type * as Diagnostics from "../features/diagnostics";
import type * as Project from "../features/project/index";
import type * as Protect from "../features/protect/index";

export interface Services {
  /** o Learning Track (features/learn.ts), lido pelo pane do tutor, que avalia antes */
  learn: Pick<typeof Learn, "LTS" | "saveLT" | "LT_BADGE" | "course" | "ltUnits" | "ltDone" | "ltSeq" | "ltPts" | "stars" | "ltOnboard" | "ltOpen">;
  /** o harness do projecto (features/team.ts): o Co-Dev (o resíduo e a ponte) e as tarefas lêem-no (U7h) */
  team: Pick<typeof Team, "HARN" | "MORD" | "RIGHTS" | "RIGHT_RE" | "isHuman" | "harnessCheck" | "harnessCmd" | "agentSys" | "agentPill" | "openTeam" | "reviewIssue" | "pickAgent">;
  /** a sentinela e as regras de comandos, o routing e as Definições (features/codev.ts): a ponte do Co-Dev e a conta (U7h) */
  codev: Pick<typeof Codev, "STOP" | "SAFE" | "DANGER" | "provFor" | "who" | "openSettings" | "MODES" | "ROUTE" | "provState" | "agCtl" | "openManager">;
  /** as línguas da interface (features/i18n.ts), lidas pela secção Language das Definições (U7h) */
  i18n: Pick<typeof I18n, "LOCALES">;
  /** os caminhos do workspace (features/workspace.ts): a ponte do Co-Dev, a equipa e o Learning Track (U7h) */
  workspace: Pick<typeof Workspace, "norm" | "LF">;
  /** os separadores (features/tabs.ts): a ponte do Co-Dev, a equipa e o Learning Track (U7h) */
  tabs: Pick<typeof Tabs, "miniOff" | "closeTab" | "rerender" | "EACT">;
  /** restaurar um checkpoint (features/checkpoint.ts), da ponte do Co-Dev (U7h) */
  checkpoint: Pick<typeof Checkpoint, "restoreCkpt">;
  /** abrir o Studio (features/studio.ts), da ponte do Co-Dev e das tarefas (U7h) */
  studio: Pick<typeof Studio, "openStudio" | "TECH" | "KIND" | "isApp" | "sl">;
  /** o layout (features/shell.ts): o boot, os separadores e a ponte do Co-Dev (U7h) */
  shell: Pick<typeof Shell, "hydrate" | "setVar" | "badges" | "getVar">;
  /** fechar os menus (features/menus.ts): o boot, a paleta e o shell (U7h) */
  menus: Pick<typeof Menus, "closeMenus" | "buildMenubar">;
  /** a árvore e o Outline (features/explorer.ts): os separadores e o workspace, que avaliam antes (U7l) */
  explorer: Pick<typeof Explorer, "syncTree" | "drawOutline" | "markActive">;
  /** o comando do terminal com a porta desktop (features/terminal.ts), da ponte do Co-Dev (U7m) */
  terminal: Pick<typeof Terminal, "termExec" | "echo" | "echoCmd" | "newInput">;
  /** os temas (features/theme.ts), lidos pelo config ao restaurar (U7m) */
  theme: Pick<typeof Theme, "THEMES">;
  /** o runtime, o desenho do pane e o contexto do projecto (features/infra.ts): o stack, a equipa e a ponte da ext (U7p2) */
  infra: Pick<typeof Infra, "needRt" | "infraDraw" | "projectContext">;
  /** o merge publicado (a porta desktop), o discard e as cores das faixas (features/scm.ts): a ponte do scm, que avalia antes (U7p3) */
  scm: Pick<typeof Scm, "gitMerge" | "discard" | "LANE">;
  /** os problemas (features/diagnostics.ts, com o painel real por cima no desktop): o editor, o workspace e os geradores (U7p6) */
  diagnostics: Pick<typeof Diagnostics, "diagnostics" | "drawProblems" | "has">;
  /** o atalho «a tecla é da shell» do terminal real (o painel, só no desktop): os atalhos globais (U7p6) */
  panel: { termOwnsKey: (e: KeyboardEvent) => boolean };
  /** abrir o Project (features/project/index.ts, que avalia depois das boas-vindas — r23 F6) */
  project: Pick<typeof Project, "openProject">;
  /** r23 F4a: um commit da UI que o secret scan bloqueou pergunta ao humano (features/protect, que avalia depois) */
  protect: Pick<typeof Protect.protect, "guard">;
}

export const services: Partial<Services> = {};
