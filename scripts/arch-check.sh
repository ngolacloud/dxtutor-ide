#!/usr/bin/env bash
# arch-check.sh — verificações automáticas de arquitectura (Etapa 1).
#
# Valida invariantes JÁ documentadas em docs/architecture/ contra o código, de
# forma a que a documentação de referência (IPC-MATRIX / MIGRATION) não possa
# divergir silenciosamente do que o backend regista e do que a cadeia de build
# faz. Não compila nada — é estático e barato; serve de porta de CI leve.
#
# Uso:   scripts/arch-check.sh        (da raiz do repositório)
# Saída: 0 = todas verdes; 1 = pelo menos uma falha (lista os motivos).

set -u
cd "$(dirname "$0")/.." || exit 2
ROOT="$(pwd)"
SRC="src-tauri/src"
MATRIX="docs/architecture/IPC-MATRIX.md"

fail=0
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; fail=1; }

# strip_comments <file> — remove comentários JS/TS (bloco /* */ e linha //),
# preservando as linhas (número), para distinguir `window`/imports de CÓDIGO do
# mesmo texto em prosa/JSDoc. Naïve quanto a strings (não há `window`/paths
# dentro de literais nos ficheiros da feature Co-Dev), mas suficiente e sem
# dependências — no estilo estático do resto deste script (A1 já usa awk).
strip_comments() {
  awk '
    BEGIN { inblk=0 }
    {
      line=$0; out=""; i=1; n=length(line)
      while (i<=n) {
        c=substr(line,i,1); d=substr(line,i,2)
        if (inblk)      { if (d=="*/"){inblk=0;i+=2} else i++; continue }
        if (d=="/*")    { inblk=1; i+=2; continue }
        if (d=="//")    { break }
        out=out c; i++
      }
      print out
    }' "$1"
}

# Baseline esperada (Etapa 0 — MIGRATION §2/§3). Actualizar DELIBERADAMENTE.
EXPECT_TOTAL=330
# @ts-nocheck: contamos a DIRECTIVA real (linha-comentário `// @ts-nocheck`), não
# a palavra por substring (A6 antigo contava 24 com `grep -rl`, inflado por 13
# ficheiros que só a mencionam em prosa/JSDoc). Baseline = 0 desde a U4j5b do ADR-0004
# (o app.ts foi o último: era 11 na Etapa 0; o startup foi tipado na U4a, o v5/v6
# dissolveram-se na U4g, infra/visualizer/interpreter na U4i e o boot.ts na U4j1).
# Todo o código da UI é tipado: nenhum ficheiro pode voltar a ter a directiva.
EXPECT_TSNOCHECK=0
# Etapa 3: o grupo `review` (3 cmd) saiu de lib.rs (95→92) para commands/review.rs;
# depois o grupo `code-intel` (10 cmd) saiu de lib.rs (92→82) para commands/codeintel.rs;
# depois o grupo `testes`/execução (5 cmd) saiu de lib.rs (82→77) para commands/tests.rs;
# depois o grupo `git` (13 cmd) saiu de lib.rs (77→64) para commands/git.rs;
# depois o grupo `co-dev` (5 cmd) saiu de lib.rs (64→59) para commands/codev.rs;
# depois o grupo `pesquisa` (4 cmd) saiu de lib.rs (59→55) para commands/search.rs;
# depois o grupo `agente`/`arquitectura` (7 cmd) saiu de lib.rs (55→48) para commands/agent.rs;
# depois o grupo `assistant`/providers (8 cmd) saiu de lib.rs (48→40) para commands/assistant.rs;
# depois o grupo `debug`/DAP (10 cmd) saiu de lib.rs (40→30) para commands/debug_cmds.rs;
# depois o grupo `devcontainers` (8 cmd) saiu de lib.rs (30→22) para commands/devcontainer.rs;
# depois o grupo `sandbox`/run (3 cmd) saiu de lib.rs (22→19) para commands/sandbox.rs;
# depois o grupo `PairCode` (4 cmd) saiu de lib.rs (19→15) para commands/pair.rs;
# depois o 13º e último grupo `estudo`/`missões` (15 cmd) saiu de lib.rs (15→0) para
# commands/study.rs (11) + commands/missions.rs (4) — lib.rs fica sem #[tauri::command].
# Plugins de curso: commands/plugins.rs (3) — plugin_list/plugin_install/plugin_remove.
# Fase 4 do ADR-0005 (extensões VS Code): bridge.rs ganha vsix_fetch_open_vsx (14→15).
# Juntos com a develop (panel 2 + pty 3 = 155): 155 + 3 + 1 = 159.
# Studio de arquitectura (F2): commands/agent.rs ganha arch_export_mermaid e
# arch_import_mermaid (7→9): 159 + 2 = 161.
# ADR-0006 R6b (catálogo de extensões real): bridge.rs ganha vsix_search_open_vsx (15→16): 162.
# Aviso de servidor em falta no editor: lsp.rs ganha lsp_server_status; com o lsp_completion do
# develop, lsp.rs fica com 10: 164.
# Assinatura da chamada (lsp_signature_help): lsp.rs fica com 11: 165.
# Consolidação (2026-11-24) do develop local (Parte A) com o origin/develop (ADR-0006), a partir dos
# 165 do ADR-0006: F5 arch_save_export (commands/agent.rs 9→10): 166; A2 codev_agent_review
# (commands/codev_agent.rs 13→14): 167; A5 project_load/apply/issue/reports (board.rs 2→6 — o
# board_load/board_save do quadro Tasks fica, num SQLite próprio): 171.
# A3 (harness): commands/codev_agent.rs ganha codev_agent_permissions e
# codev_agent_save_permissions (14→16): 171 + 2 = 173.
# Code actions (lsp_code_action + lsp_execute_command): lsp.rs 11→13: 175.
# A6 (testes): commands/tests.rs ganha test_runners, test_run e test_history (5→8): 175 + 3 = 178.
# Formatação (lsp_format, PR #12): lsp.rs 13→14: 178 + 1 = 179.
# A4 (SCM): commands/git.rs ganha git_blame, git_history, git_show_path, git_compare, git_stash,
# git_worktree, git_rebase e git_amend (13→21): 179 + 8 = 187.
# A7 (debug DAP): commands/debug_cmds.rs ganha debug_set_breakpoints, debug_stop_on_panic,
# debug_threads, debug_variables, debug_evaluate, debug_pause, debug_snapshot, breakpoints_load e
# breakpoints_save (10→19): 187 + 9 = 196.
# A8 (under the hood): commands/hood.rs novo com hood_line_asm, hood_python_bytecode e
# measure_growth: 196 + 3 = 199.
# A9 (devops): commands/ops.rs novo com ops_iac_dirs, ops_iac_plan, ops_kube_state, ops_kube_history,
# ops_cloud_status e ops_cloud_inventory: 199 + 6 = 205.
# Símbolos do ficheiro (lsp_document_symbols, PR #21): lsp.rs 14→15: 205 + 1 = 206.
# RF do Co-Dev (docs/v2/RF-DELONIX-PLANO.md): board.rs ganha project_audit e project_issue_prompt (6→8) e
# commands/agent.rs ganha arch_conformance (10→11): 206 + 3 = 209.
# Símbolos da pasta (lsp_workspace_symbols, PR #28): lsp.rs 15→16: 209 + 1 = 210.
# A10 (lacunas): commands/codebase.rs novo (deps_report, onboard_map), git.rs ganha git_diff_range
# (21→22), debug_cmds.rs ganha debug_attach_targets e debug_attach (19→21): 210 + 5 = 215.
# Bloco 1 dos RF restantes (F2.7, RF-E08): board.rs ganha project_change_sets (8→9): 216.
# Hierarquia de tipos (lsp_prepare_type_hierarchy + lsp_type_hierarchy): lsp.rs 16→18: 216 + 2 = 218.
# Bloco 3 (F5.2/F5.5): agent.rs ganha arch_rules_load/save, adr_list/accept e arch_rules_commit (11→16): 218 + 5 = 223.
# r23 F1 (docs/v2/AUDIT-r23.md): board.rs ganha audit_record — o registo de auditoria das operações do IDE (9→10): 224.
# r23 F6: git.rs ganha git_clone_plan — o comando exacto do clone antes da aprovação (22→23): 225.
# Sessão de fecho dos RF, bloco 3 (RF-A03/A04): codev_agent.rs ganha codev_agent_override (16→17): 225 + 1 = 226 (junto com o git_clone_plan da r23 F6).
# r23 F3: git.rs ganha git_refs — a barra lateral do Commit Graph (commands/git.rs 23→24): 227.
# r23 F3: git.rs ganha git_hunks — os hunks de um ficheiro (commands/git.rs 24→25): 228.
# r23 F3: git.rs ganha git_stage_hunks — staging de parte de um ficheiro (commands/git.rs 25→26): 229.
# r23 F3: git.rs ganha git_undo_snapshot (commands/git.rs 26→27): 230.
# r23 F3: git.rs ganha git_undo_list (commands/git.rs 27→28): 231.
# r23 F3: git.rs ganha git_undo_plan (commands/git.rs 28→29): 232.
# r23 F3: git.rs ganha git_undo_restore (commands/git.rs 29→30): 233.
# r23 F3: git.rs ganha git_predict_conflicts (commands/git.rs 30→31): 234.
# r23 F3: git.rs ganha git_merge — o merge em curso (commands/git.rs 31→32): 235.
# r23 F3: git.rs ganha git_conflict_stages (commands/git.rs 32→33): 236.
# r23 F3: git.rs ganha git_sync_plan (commands/git.rs 33→34): 237.
# r23 F3: git.rs ganha git_sync (commands/git.rs 34→35): 238.
# r23 F3: git.rs ganha gh_status (o gh, só leitura) (commands/git.rs 35→36): 239.
# r23 F3: git.rs ganha gh_prs (commands/git.rs 36→37): 240.
# r23 F3: git.rs ganha gh_runs_for (commands/git.rs 37→38): 241.
# r23 F3: git.rs ganha gh_prs_for (commands/git.rs 38→39): 242.
# r23 F3: board.rs ganha test_results_record (board.rs 10→11): 243.
# r23 F3: board.rs ganha test_results_for (board.rs 11→12): 244.
# r23 F3: git.rs ganha git_commit_paths (Commit Composer) (commands/git.rs 39→40): 245.
# r23 F3: git.rs ganha git_lane_commit (lanes, experimental) (commands/git.rs 40→41): 246.
# r23 F2 (depurador real): commands/debug_cmds.rs ganha debug_run_to, debug_restart_frame, debug_data_breakpoints,
# debug_read_memory, debug_exception_filters e debug_test_targets (21→27): 246 + 6 = 252.
# r23 F2b (rr): commands/debug_cmds.rs ganha debug_record, debug_replay, debug_reverse, debug_position, debug_travel,
# debug_last_write e debug_writes (27→34): 252 + 7 = 259.
# r23 F4a (protecção de dados): commands/protect.rs (novo) com protect_learn, secret_scan e secret_scan_allow: 259 + 3 = 262.
# r23 F4b (pipeline de IaC): commands/iac.rs (novo) com iac_pipeline_run, iac_apply_command e iac_state; board.rs ganha
# iac_risk_accept, iac_risks e iac_risk_revoke (12→15): 262 + 6 = 268.
# r23 F4c (Vault): commands/vault.rs (novo) com vault_status, vault_login_token, vault_login_oidc, vault_renew,
# vault_revoke, vault_kv_meta, vault_reveal_local, vault_reveal_read, vault_dynamic e vault_lease_revoke: 268 + 10 = 278.
# r23 F4c2 (deploy guiado): commands/deploy.rs (novo) com deploy_plan e deploy_rollout; board.rs ganha deploy_records
# (15→16): 278 + 3 = 281.
# r23 F5a (runbooks, fontes, evidências): commands/runbook.rs (novo) com runbook_list, runbook_parse, runbook_step,
# runbook_decide e sources_status; board.rs ganha runbook_judge, runbook_runs e audit_export_evidence (16→19): 281 + 8 = 289.
# r23 F5b (fila, revisão de PR, incidentes): commands/platform.rs (novo) com queue_items, queue_verify, queue_handover,
# pr_infra_review, pr_review_submit e os 6 incident_*: 289 + 11 = 300.
# Multi Co-Dev fase 1 (plano paralelo da sprint): board.rs ganha project_sprint_plan (19→20): 301.
# Mapa de agentes do Co-Dev: commands/codev_agent.rs ganha codev_agent_live (17→18): 302.
# r23 endurecimento (hook de pre-commit): commands/protect.rs ganha protect_hook_plan e protect_hook_install (3→5): 304.
# Multi Co-Dev fase 2 (várias sessões e os dados da porta de integração): board.rs ganha project_scope_overlap e
# project_checks (20→22): 306.
# Board B (cada método muda as regras): board.rs ganha project_method_preview (22→23): 307.
# NOTAS-r23 ponto 3 (fonte de métricas): commands/metrics.rs (novo) com metrics_status, metrics_token_set,
# metrics_token_clear e incident_metrics_check: 307 + 4 = 311.
# LSP P2 (overrides do registo): lsp.rs ganha lsp_config, lsp_config_file, lsp_user_config_save e
# lsp_approve_server (18→22): 311 + 4 = 315.
# LSP P3 (receitas de instalação): commands/lsp_install.rs (novo) com lsp_install_plan e lsp_install_download: 315 + 2 = 317.
# Multi Co-Dev fase 3 (worktree e ficheiros reservados por Co-Dev): commands/codev_worktree.rs (novo) com
# codev_worktree_plan, codev_worktree_create, codev_worktrees, codev_worktree_remove, codev_worktree_file,
# codev_worktree_commit e codev_claims: 317 + 7 = 324.
# LSP P6 (recursos dos servidores): lsp.rs ganha lsp_did_close, lsp_folder_closed, lsp_servers, lsp_server_log,
# lsp_server_stop e lsp_server_restart (22→28): 324 + 6 = 330.
declare -A EXPECT_PER_FILE=( [lib.rs]=0 [commands/review.rs]=3 [commands/codeintel.rs]=10 [commands/tests.rs]=8 [commands/git.rs]=41 [commands/codev.rs]=5 [commands/codev_agent.rs]=18 [commands/codev_worktree.rs]=7 [commands/dictation.rs]=4 [commands/search.rs]=4 [commands/agent.rs]=16 [commands/assistant.rs]=8 [commands/debug_cmds.rs]=34 [commands/hood.rs]=3 [commands/ops.rs]=6 [commands/codebase.rs]=2 [commands/devcontainer.rs]=8 [commands/sandbox.rs]=3 [commands/pair.rs]=4 [commands/plugins.rs]=3 [commands/study.rs]=11 [commands/missions.rs]=4 [bridge.rs]=16 [fsops.rs]=10 [lsp.rs]=28 [pty.rs]=7 [commands/panel.rs]=2 [commands/protect.rs]=5 [commands/iac.rs]=3 [commands/vault.rs]=10 [commands/deploy.rs]=2 [commands/runbook.rs]=5 [commands/platform.rs]=11 [commands/metrics.rs]=4 [commands/lsp_install.rs]=2 [board.rs]=23 )

echo "== A1 · comandos registados em generate_handler! =="
# Extrai o bloco generate_handler!, remove comentários //, apanha os identificadores
# (com ou sem prefixo module::) terminados em vírgula.
reg_list=$(awk '/generate_handler!/{f=1;next} f&&/\]\)/{exit} f{print}' "$SRC/lib.rs" \
  | sed -E 's://.*$::' \
  | grep -oE '[a-z_]+::[a-z_0-9]+|[a-z_][a-z_0-9]+' \
  | sort -u)
reg_names=$(echo "$reg_list" | sed -E 's/^[a-z_]+:://' | sort -u)
reg_count=$(echo "$reg_names" | grep -c .)
if [ "$reg_count" -eq "$EXPECT_TOTAL" ]; then
  pass "generate_handler! regista $reg_count comandos (== $EXPECT_TOTAL)"
else
  bad "generate_handler! regista $reg_count comandos (esperado $EXPECT_TOTAL)"
fi

echo "== A2 · #[tauri::command] por ficheiro =="
sum=0
for f in lib.rs commands/review.rs commands/codeintel.rs commands/tests.rs commands/git.rs commands/codev.rs commands/codev_agent.rs commands/codev_worktree.rs commands/dictation.rs commands/search.rs commands/agent.rs commands/assistant.rs commands/debug_cmds.rs commands/hood.rs commands/ops.rs commands/codebase.rs commands/devcontainer.rs commands/sandbox.rs commands/pair.rs commands/plugins.rs commands/study.rs commands/missions.rs bridge.rs fsops.rs lsp.rs pty.rs commands/panel.rs commands/protect.rs commands/iac.rs commands/vault.rs commands/deploy.rs commands/runbook.rs commands/platform.rs commands/metrics.rs commands/lsp_install.rs board.rs; do
  # `grep -c` imprime 0 E sai com status 1 quando não há matches (ex. lib.rs após o 13º
  # grupo sair), por isso NÃO encadeamos `|| echo 0` (duplicaria para "0\n0" e partia a
  # aritmética); normalizamos o vazio para 0 à parte.
  n=$(grep -c '#\[tauri::command\]' "$SRC/$f" 2>/dev/null)
  n=${n:-0}
  sum=$((sum + n))
  if [ "$n" -eq "${EXPECT_PER_FILE[$f]}" ]; then
    pass "$f tem $n comandos (== ${EXPECT_PER_FILE[$f]})"
  else
    bad "$f tem $n comandos (esperado ${EXPECT_PER_FILE[$f]})"
  fi
done
if [ "$sum" -eq "$EXPECT_TOTAL" ]; then
  pass "soma de #[tauri::command] == $sum"
else
  bad "soma de #[tauri::command] == $sum (esperado $EXPECT_TOTAL)"
fi

echo "== A3 · matriz IPC cobre exactamente os comandos registados =="
if [ -f "$MATRIX" ]; then
  matrix_names=$(grep -oE '^\| `[a-z_]+`' "$MATRIX" | sed -E 's/\| `//; s/`//' | sort -u)
  matrix_count=$(echo "$matrix_names" | grep -c .)
  missing=$(comm -23 <(echo "$reg_names") <(echo "$matrix_names"))
  extra=$(comm -13 <(echo "$reg_names") <(echo "$matrix_names"))
  if [ "$matrix_count" -eq "$EXPECT_TOTAL" ] && [ -z "$missing" ] && [ -z "$extra" ]; then
    pass "$MATRIX documenta os $matrix_count comandos, 1:1 com o registo"
  else
    bad "$MATRIX desalinhado (documenta $matrix_count)"
    [ -n "$missing" ] && printf '       em falta na matriz: %s\n' "$(echo "$missing" | tr '\n' ' ')"
    [ -n "$extra" ]   && printf '       na matriz mas não registados: %s\n' "$(echo "$extra" | tr '\n' ' ')"
  fi
else
  bad "$MATRIX não existe"
fi

echo "== A4 · cadeia de build (tauri.conf.json) =="
CONF="src-tauri/tauri.conf.json"
fd=$(grep -oE '"frontendDist"[^,}]*' "$CONF" | head -1)
bbc=$(grep -oE '"beforeBuildCommand"[^,}]*' "$CONF" | head -1)
if echo "$fd" | grep -q '\.\./ui-app/dist'; then
  pass "frontendDist == ../ui-app/dist"
else
  bad "frontendDist não aponta para ../ui-app/dist ($fd)"
fi
if echo "$bbc" | grep -q 'ui:build'; then
  pass "beforeBuildCommand corre ui:build"
else
  bad "beforeBuildCommand não corre ui:build ($bbc)"
fi
# Não-recursão: o hook não pode chamar `npm run build` (recursão infinita).
if echo "$bbc" | grep -qE 'run +build'; then
  bad "beforeBuildCommand é recursivo (chama 'run build'): $bbc"
else
  pass "beforeBuildCommand não é recursivo"
fi
# Coerência com package.json: ui:build existe e não chama tauri build.
if grep -qE '"ui:build"[^,]*' package.json && ! grep -E '"ui:build"[^,]*' package.json | grep -q 'tauri build'; then
  pass "package.json: script ui:build existe e não chama 'tauri build'"
else
  bad "package.json: script ui:build ausente ou recursivo"
fi

echo "== A5 · UI oficial única (sem ui/ ou ui-next/ no grafo de build) =="
# Permite ../ui-app; proíbe ../ui-next e ../ui (bare) nas configs de build.
leak=$(grep -nE '\.\./ui-next|\.\./ui/|"ui-next"' package.json "$CONF" ui-app/vite.config.ts 2>/dev/null)
if [ -z "$leak" ]; then
  pass "nenhuma config de build referencia ui/ ou ui-next/"
else
  bad "config de build referencia UI não-oficial:"
  echo "$leak" | sed 's/^/       /'
fi

echo "== A6 · baseline @ts-nocheck (não pode crescer) =="
# A DIRECTIVA é uma linha-comentário `// @ts-nocheck` (só tem efeito assim); a
# palavra em prosa/JSDoc NÃO desliga o typecheck. Contamos a directiva, não a
# string, senão o baseline vigia ruído de documentação (A6 antigo: 24 vs 11 reais).
tsn=$(grep -rlE '^[[:space:]]*//[[:space:]]*@ts-nocheck' ui-app/src | grep -c .)
if [ "$tsn" -le "$EXPECT_TSNOCHECK" ]; then
  pass "@ts-nocheck (directiva) em $tsn ficheiros (<= baseline $EXPECT_TSNOCHECK)"
else
  bad "@ts-nocheck (directiva) cresceu para $tsn ficheiros (baseline $EXPECT_TSNOCHECK)"
  grep -rlE '^[[:space:]]*//[[:space:]]*@ts-nocheck' ui-app/src | sed 's/^/       /'
fi

# ─────────────────────────────────────────────────────────────────────────────
# Fronteiras da Clean Architecture das features extraídas (ADR-0002).
# Cada feature vive em ui-app/src/features/<f>/ com camadas:
#   domain/          — puro (tipos, policy, scoring, scenarios); sem DOM/window/Tauri
#   application/     — casos de uso (ports + motores); deps injectadas, sem HTML
#   ui/              — markup/handlers (chat-view, actions)
#   infrastructure/  — legacy-bridge.ts: ÚNICO ponto que toca `window.*`
#   index.ts         — raiz de composição (liga adapters↔ui↔casos de uso)
# O resíduo strangler `features/<f>.ts` (publica os shims window.*) está FORA
# desta subárvore e não é governado por A7/A8 — é transitório (ADR, passo 6).
# A7/A8 cobrem CADA feature nesta lista (codev + ext; a próxima acrescenta-se aqui).
FEATURES="codev ext codereview scm debug board visualizer infra learn panel arch testing lsp project hood ops codebase comments welcome protect vault deploy"
FEAT_ROOT=ui-app/src/features

echo "== A7 · domínio não importa application/ui/infrastructure =="
# A regra do fluxo de dependências: domain/ é o centro e não conhece as camadas
# de fora. Extraímos os especificadores de import/export-from/import() (pós-strip
# de comentários, p/ não apanhar imports comentados) e reprovamos qualquer um cujo
# caminho tenha um segmento application|ui|infrastructure.
a7bad=""
for feat in $FEATURES; do
  dom="$FEAT_ROOT/$feat/domain"
  [ -d "$dom" ] || continue
  while IFS= read -r f; do
    specs=$(strip_comments "$f" \
      | grep -oE "(import|export|from|import\()[^\"']*[\"'][^\"']+[\"']" \
      | grep -oE "[\"'][^\"']+[\"']" | tr -d "\"'")
    while IFS= read -r s; do
      [ -z "$s" ] && continue
      if printf '%s\n' "$s" | grep -qE '(^|/)(application|ui|infrastructure)(/|$)'; then
        a7bad="$a7bad$f -> $s"$'\n'
      fi
    done <<< "$specs"
  done < <(find "$dom" -name '*.ts')
done
if [ -z "$a7bad" ]; then
  pass "domain/ não importa application/ui/infrastructure ($FEATURES)"
else
  bad "domain/ importa uma camada de fora (viola o fluxo de dependências):"
  printf '%s' "$a7bad" | sed 's/^/       /'
fi

echo "== A8 · window restrito a infrastructure/legacy-bridge.ts =="
# Só o bridge pode tocar no global `window`. Varremos a subárvore de cada feature
# (domain/application/ui/index.ts) menos o seu bridge e reprovamos qualquer
# `window` que SOBREVIVA ao strip de comentários (= referência de código, não prosa).
a8bad=""
for feat in $FEATURES; do
  base="$FEAT_ROOT/$feat"
  bridge="$base/infrastructure/legacy-bridge.ts"
  [ -d "$base" ] || continue
  while IFS= read -r f; do
    [ "$f" = "$bridge" ] && continue
    hits=$(strip_comments "$f" | grep -nE '\bwindow\b')
    if [ -n "$hits" ]; then
      a8bad="$a8bad$f:"$'\n'"$(printf '%s' "$hits" | sed 's/^/         /')"$'\n'
    fi
  done < <(find "$base" -name '*.ts')
done
if [ -z "$a8bad" ]; then
  pass "window só aparece (como código) em infrastructure/legacy-bridge.ts ($FEATURES)"
else
  bad "window usado fora do bridge (deve passar por legacy-bridge.ts):"
  printf '%s' "$a8bad" | sed 's/^/       /'
fi

echo "== A9 · só os ficheiros da lista publicam no window (fecho da U7) =="
# ADR-0004, fecho da U7: o que fica no window está inventariado no ADR, e só estes ficheiros ainda publicam
# (`Object.assign(window, …)` ou `window.X = …`, depois do strip de comentários). Código novo não publica: lê por
# import, pelo store ou pelo registo `app/services.ts`. A lista só encolhe — quando um ficheiro deixa de publicar,
# sai daqui (o A9 avisa).
A9_ALLOW="
  app/boot-steps.ts app/commands.ts app/globals.ts app/store/agent.ts app/store/config.ts
  app/store/registry.ts app/store/storage.ts boot.ts features/board.ts
  features/board/infrastructure/legacy-bridge.ts features/checkpoint.ts features/codereview.ts
  features/codereview/infrastructure/legacy-bridge.ts features/codev.ts
  features/codev/infrastructure/legacy-bridge.ts features/debug/infrastructure/legacy-bridge.ts
  features/diff.ts features/editor.ts features/explorer.ts features/ext.ts
  features/ext/infrastructure/legacy-bridge.ts features/i18n.ts features/infra.ts features/learn.ts
  features/palette.ts features/panel/index.ts features/router.ts features/scm.ts
  features/scm/infrastructure/legacy-bridge.ts features/shell.ts features/studio.ts features/syntax.ts
  features/tabs.ts features/tasks.ts features/team.ts features/terminal.ts
  features/testing/infrastructure/legacy-bridge.ts features/visualizer.ts
  features/visualizer/infrastructure/legacy-bridge.ts features/workspace.ts pair.ts
  platform/desktop/context.ts platform/desktop/selftest.ts
"
# publica = `Object.assign(window, …)`, `window.X = …`, uma superfície `publish({ … })` (as pontes das features fazem
# `Object.assign(window, surface)`) ou uma escrita por uma fachada do window (`const G = window as …; G.X = …`) —
# as duas últimas desde a correcção da medida no início da U7p
a9_publishes() {
  local src facs x
  src=$(strip_comments "$1" | tr -d '\000')
  printf '%s\n' "$src" | grep -qE 'Object\.assign\(window|window\.[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[^=]|\bpublish\(\{' && return 0
  facs=$(printf '%s\n' "$src" | grep -oE '(const|let|var) +[A-Za-z_$][A-Za-z0-9_$]* *= *\(?(window|globalThis) +as\b' \
    | sed -E 's/(const|let|var) +([A-Za-z_$][A-Za-z0-9_$]*).*/\2/' | sort -u)
  for x in $facs; do
    printf '%s\n' "$src" | grep -qE "(^|[^A-Za-z0-9_\$.])$x\.[A-Za-z_\$][A-Za-z0-9_\$]*[[:space:]]*=[^=>]" && return 0
  done
  return 1
}
a9bad=""; a9stale=""
while IFS= read -r f; do
  rel=${f#ui-app/src/}
  if a9_publishes "$f"; then
    printf '%s\n' $A9_ALLOW | grep -qxF "$rel" || a9bad="$a9bad       $rel"$'\n'
  fi
done < <(find ui-app/src -name '*.ts' -not -name '*.d.ts' | sort)
for rel in $A9_ALLOW; do
  f="ui-app/src/$rel"
  if [ ! -f "$f" ] || ! a9_publishes "$f"; then a9stale="$a9stale       $rel"$'\n'; fi
done
if [ -z "$a9bad" ] && [ -z "$a9stale" ]; then
  pass "só os $(printf '%s\n' $A9_ALLOW | grep -c .) ficheiros da lista publicam no window"
else
  [ -n "$a9bad" ] && { bad "ficheiro novo a publicar no window (lê por import, store ou app/services.ts):"; printf '%s' "$a9bad"; }
  [ -n "$a9stale" ] && { bad "já não publica no window — tira-o da lista A9_ALLOW em scripts/arch-check.sh:"; printf '%s' "$a9stale"; }
fi

echo "== A10 · comandos síncronos (correm na thread da UI) só os da lista =="
# No Tauri, um #[tauri::command] sem `async` corre na thread principal: enquanto dura, a janela não responde
# (medido: fsync do SQLite e leituras do keychain no arranque deram «not responding» com a máquina carregada).
# Ficam síncronos só os que dependem da ORDEM de chegada (teclas e tamanho do terminal, mensagens a um agente,
# a um par ou ao assistente em curso, o ditado, as gravações com debounce do quadro e dos breakpoints, parar o
# depurador ou um processo) e os puros e baratos. Um comando novo nasce `async`; esta lista só encolhe.
SYNC_ALLOW="
pty_write pty_resize pty_kill pty_info
pair_send pair_stop
codev_agent_send codev_agent_approve codev_agent_review codev_agent_override codev_agent_set_mode
codev_agent_cancel codev_agent_set_plan codev_agent_live
assistant_chat_stream assistant_cancel
dictation_status dictation_start dictation_cancel
board_save breakpoints_save debug_stop kill_shell agent_task_cancel agent_task_status
app_info expand_path codev_policy study_policy llm_plan selftest_report
"
a10bad=""; a10stale=""
sync_now=$(grep -rhzoP '#\[tauri::command\]\s*(#\[[^\]]*\]\s*)*pub\s+fn\s+\w+' src-tauri/src --include='*.rs' 2>/dev/null | tr '\0' '\n' | grep -oP 'pub\s+fn\s+\K\w+' | sort -u)
for n in $sync_now; do
  case " $(echo $SYNC_ALLOW) " in *" $n "*) ;; *) a10bad="$a10bad       $n\n";; esac
done
for n in $SYNC_ALLOW; do
  printf '%s\n' $sync_now | grep -qx "$n" || a10stale="$a10stale       $n\n"
done
if [ -z "$a10bad" ] && [ -z "$a10stale" ]; then
  pass "só os $(printf '%s\n' $SYNC_ALLOW | grep -c .) comandos da lista são síncronos"
else
  [ -n "$a10bad" ] && { bad "comando síncrono novo (corre na thread da UI) — torna-o async:"; printf "$a10bad"; }
  [ -n "$a10stale" ] && { bad "já é async — tira-o da lista SYNC_ALLOW em scripts/arch-check.sh:"; printf "$a10stale"; }
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32march-check: TODAS AS VERIFICAÇÕES VERDES\033[0m\n'
else
  printf '\033[31march-check: HÁ FALHAS (ver acima)\033[0m\n'
fi
exit $fail
