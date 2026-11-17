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

# Baseline esperada (Etapa 0 — MIGRATION §2/§3). Actualizar DELIBERADAMENTE.
EXPECT_TOTAL=133
EXPECT_TSNOCHECK=21
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
declare -A EXPECT_PER_FILE=( [lib.rs]=0 [commands/review.rs]=3 [commands/codeintel.rs]=10 [commands/tests.rs]=5 [commands/git.rs]=13 [commands/codev.rs]=5 [commands/search.rs]=4 [commands/agent.rs]=7 [commands/assistant.rs]=8 [commands/debug_cmds.rs]=10 [commands/devcontainer.rs]=8 [commands/sandbox.rs]=3 [commands/pair.rs]=4 [commands/study.rs]=11 [commands/missions.rs]=4 [bridge.rs]=14 [fsops.rs]=10 [lsp.rs]=8 [pty.rs]=4 [board.rs]=2 )

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
for f in lib.rs commands/review.rs commands/codeintel.rs commands/tests.rs commands/git.rs commands/codev.rs commands/search.rs commands/agent.rs commands/assistant.rs commands/debug_cmds.rs commands/devcontainer.rs commands/sandbox.rs commands/pair.rs commands/study.rs commands/missions.rs bridge.rs fsops.rs lsp.rs pty.rs board.rs; do
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
tsn=$(grep -rl '@ts-nocheck' ui-app/src | grep -c .)
if [ "$tsn" -le "$EXPECT_TSNOCHECK" ]; then
  pass "@ts-nocheck em $tsn ficheiros (<= baseline $EXPECT_TSNOCHECK)"
else
  bad "@ts-nocheck cresceu para $tsn ficheiros (baseline $EXPECT_TSNOCHECK)"
fi

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32march-check: TODAS AS VERIFICAÇÕES VERDES\033[0m\n'
else
  printf '\033[31march-check: HÁ FALHAS (ver acima)\033[0m\n'
fi
exit $fail
