/* ═════════ dxtutor IDE — ponto de entrada único (ADR-0004, U1) ═════════
   Substitui as 43 tags <script type="module"> do index.html por UM grafo de imports.
   A ordem é EXACTAMENTE a das tags, e a semântica é a mesma: os módulos ES avaliam-se
   em profundidade e pela ordem dos imports — cada import (com as suas dependências)
   termina antes do seguinte começar, tal como cada tag terminava antes da seguinte; e
   um módulo partilhado (ex. core.ts) avalia-se uma só vez, no primeiro import.

   Diferença única: com tags separadas, uma excepção no topo de um módulo não impedia
   os das tags seguintes de correrem; aqui interrompe o resto do grafo. O teste de
   arranque (ui-app/e2e/boot.e2e.ts) garante que nenhum módulo lança no arranque.

   Ordem de dependências implícita (por globais no window) — não reordenar sem a
   resolver: boot publica as globais base; as features publicam os seus shims antes dos
   comandos (app/commands.ts, que lê THEMES e guarda acções por valor ao avaliar) e dos passos
   de arranque (app/boot-steps.ts) — o antigo app.ts, dividido na U4j5c (as camadas v5/v6
   dissolveram-se nas features na U4g); startup arranca; bridge
   substitui a simulação pelo desktop real (só com Tauri); pair e panel no fim.
   As fases seguintes do ADR-0004 trocam estas dependências implícitas por imports.

   U3: os proprietários de estado (`app/store`) vêm PRIMEIRO — publicam as globais de
   estado como acessores antes de o monólito as escrever, e cada mudança sai no bus.

   U6a: os estilos (`app/styles` — a lista ordenada dos CSS por dono) vêm à cabeça; não avaliam
   código, só fixam a ordem da cascata.

   U5: o despachante das acções delegadas partilhadas (`app/actions`) vem antes de tudo — o
   seu listener tem de ser o primeiro do document, como um handler inline (que corria no
   elemento, antes de o evento chegar ao document). */

import "./app/styles";
import "./app/actions";
import "./app/store";
import "./boot";
import "./app/globals";
import "./features/theme";
import "./features/notifications";
import "./features/remote";
import "./features/account";
import "./features/run";
import "./features/stack";
import "./features/testing/index";
import "./features/search";
import "./features/debug";
import "./features/codereview";
import "./features/hood/index"; /* A8: decora o VIEW.hood que o codereview acabou de registar */
import "./features/scm";
import "./features/changelog";
import "./features/tutor";
import "./features/tasks";
import "./features/ext";
import "./features/codev";
import "./features/checkpoint";
/* o terminal (dono do XC) avalia antes do infra, que lhe regista comandos (ADR-0004, U4g2) */
import "./features/terminal";
import "./features/infra";
import "./features/ops/index"; /* A9: decora o RP.infra que o infra acabou de registar */
import "./features/codebase/index"; /* A10: Dependencies e Onboarding */
import "./features/visualizer";
import "./features/router";
import "./features/team";
import "./features/studio";
import "./features/arch/index";
import "./features/learn";
import "./features/generators";
import "./features/board";
import "./features/i18n";
import "./features/syntax";
import "./features/diff";
/* r23 F3: o Commit Graph (era features/graph.ts) */
import "./features/scm/graph-screen";
import "./features/termgit";
import "./features/palette";
import "./features/editor";
import "./features/tabs";
import "./features/shell";
import "./features/menus";
import "./features/workspace";
import "./features/explorer";
import "./features/diagnostics";
import "./features/shortcuts";
/* r23 F6: Start · Recent · Walkthroughs */
import "./features/welcome/index";
import "./app/chrome-actions";
import "./app/commands";
import "./app/boot-steps";
import "./startup";
import "./bridge";
import "./pair";
import "./features/panel/index";
import "./features/lsp/index";
import "./features/comments/index";
