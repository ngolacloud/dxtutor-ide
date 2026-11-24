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
EXPECT_TOTAL=187
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
declare -A EXPECT_PER_FILE=( [lib.rs]=0 [commands/review.rs]=3 [commands/codeintel.rs]=10 [commands/tests.rs]=8 [commands/git.rs]=21 [commands/codev.rs]=5 [commands/codev_agent.rs]=16 [commands/dictation.rs]=4 [commands/search.rs]=4 [commands/agent.rs]=10 [commands/assistant.rs]=8 [commands/debug_cmds.rs]=10 [commands/devcontainer.rs]=8 [commands/sandbox.rs]=3 [commands/pair.rs]=4 [commands/plugins.rs]=3 [commands/study.rs]=11 [commands/missions.rs]=4 [bridge.rs]=16 [fsops.rs]=10 [lsp.rs]=14 [pty.rs]=7 [commands/panel.rs]=2 [board.rs]=6 )

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
for f in lib.rs commands/review.rs commands/codeintel.rs commands/tests.rs commands/git.rs commands/codev.rs commands/codev_agent.rs commands/dictation.rs commands/search.rs commands/agent.rs commands/assistant.rs commands/debug_cmds.rs commands/devcontainer.rs commands/sandbox.rs commands/pair.rs commands/plugins.rs commands/study.rs commands/missions.rs bridge.rs fsops.rs lsp.rs pty.rs commands/panel.rs board.rs; do
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
FEATURES="codev ext codereview scm debug board visualizer infra learn panel arch testing lsp project"
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

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32march-check: TODAS AS VERIFICAÇÕES VERDES\033[0m\n'
else
  printf '\033[31march-check: HÁ FALHAS (ver acima)\033[0m\n'
fi
exit $fail
