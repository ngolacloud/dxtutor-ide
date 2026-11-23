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
   resolver: boot publica as globais base; as features publicam os seus shims antes do
   app.ts (que lê THEMES/THEME eagerly); app/v5/v6 decoram; startup arranca; bridge
   substitui a simulação pelo desktop real (só com Tauri); pair e panel no fim.
   As fases seguintes do ADR-0004 trocam estas dependências implícitas por imports.

   U3: os proprietários de estado (`app/store`) vêm PRIMEIRO — publicam as globais de
   estado como acessores antes de o monólito as escrever, e cada mudança sai no bus. */

import "./app/store";
import "./boot";
import "./features/theme";
import "./features/notifications";
import "./features/remote";
import "./features/account";
import "./features/run";
import "./features/stack";
import "./features/test";
import "./features/search";
import "./features/debug";
import "./features/codereview";
import "./features/scm";
import "./features/changelog";
import "./features/tutor";
import "./features/tasks";
import "./features/ext";
import "./features/codev";
import "./features/checkpoint";
import "./features/infra";
import "./features/visualizer";
import "./features/router";
import "./features/team";
import "./features/studio";
import "./features/learn";
import "./features/generators";
import "./features/board";
import "./features/i18n";
import "./features/syntax";
import "./features/diff";
import "./features/graph";
import "./features/termgit";
import "./features/palette";
import "./features/editor";
import "./features/tabs";
import "./features/shell";
import "./features/menus";
import "./features/explorer";
import "./features/diagnostics";
import "./features/terminal";
import "./app";
import "./v5";
import "./v6";
import "./startup";
import "./bridge";
import "./pair";
import "./features/panel/index";
