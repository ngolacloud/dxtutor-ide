#!/usr/bin/env bash
# Métricas da migração da ui-app para Clean Architecture (ADR-0004, U0).
#
# Cada métrica tem um baseline que SÓ PODE DESCER: se uma mudança a faz subir, falha; se a
# faz descer, avisa para baixar o baseline aqui (para a melhoria não se perder). Estática,
# sem dependências — só bash/grep, como o arch-check.
#
#   bash scripts/ui-metrics.sh        (também corre no `npm run arch:check`)
set -uo pipefail
cd "$(dirname "$0")/.."

UI=ui-app
SRC="$UI/src"
fail=0

# nome | baseline (2026-11-23, HEAD 3ea370d) | alvo | valor actual
declare -a ROWS
metric() { ROWS+=("$1|$2|$3|$4"); }

count() { wc -l | tr -d ' '; }

metric "tags <script> no index.html (U1)" 1 1 \
  "$(grep -c '<script' "$UI/index.html")"
metric "ficheiros com // @ts-nocheck (U4)" 4 0 \
  "$(grep -rlE '^// @ts-nocheck' "$SRC" | count)"
# nomes publicados em Object.assign(window, { … }) — mede o que o monólito ainda resolve
# por global; mover uma função de módulo não muda o número (U4), deixar de a publicar sim
published_names() {
  local total=0 f n
  for f in $(grep -rl 'Object\.assign(window' "$SRC" --include=*.ts); do
    n=$(sed -E 's#//.*$##' "$f" | tr '\n' ' ' | grep -oE 'Object\.assign\(window, *\{[^}]*\}' \
      | grep -oE '[{,][[:space:]]*[A-Za-z_$][A-Za-z0-9_$]*' | count)
    total=$((total + n))
  done
  echo "$total"
}
# globais publicadas no window, nas duas sintaxes (window.X = … e os nomes em
# Object.assign(window, {…})): mover uma função de módulo pode trocar de sintaxe sem mudar
# o número; deixar de a publicar (o consumidor importa) é que baixa (U3/U4/U7)
window_assigns() { grep -rhoE 'window\.[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]*=[^=]' "$SRC" --include=*.ts | count; }
metric "globais publicadas no window (U3/U4/U7)" 409 0 \
  "$(( $(window_assigns) + $(published_names) ))"
metric "handlers inline on*=\"…\" (U5)" 160 0 \
  "$(grep -rhoE '[[:space:]]on(click|dblclick|change|input|keydown|keyup|submit|mousedown|mouseup|contextmenu|blur|focus|dragstart|dragover|dragleave|drop|load|error)=' "$SRC" "$UI/index.html" | count)"
metric "invoke cru inv(\"…\") fora de platform/ (U2)" 0 0 \
  "$(grep -rhoE '\binv\("' "$SRC" --include=*.ts --exclude-dir=platform | count)"

# informativas (não falham): crescem durante a U3 e vão a 0 na U7
declare -a INFO
info() { INFO+=("$1|$2|$3"); }
info "shims de estado no window (ownedGlobal, U3→U7)" 0 \
  "$(grep -rhoE '= ownedGlobal<' "$SRC" --include=*.ts | count)"

printf '\n== Métricas da migração da ui-app (ADR-0004) ==\n'
printf '  %-46s %8s %8s %6s\n' "métrica" "actual" "baseline" "alvo"
for r in "${ROWS[@]}"; do
  IFS='|' read -r name base target now <<<"$r"
  if [ "$now" -gt "$base" ]; then
    printf '  \033[31m%-46s %8s %8s %6s  ✗ subiu\033[0m\n' "$name" "$now" "$base" "$target"
    fail=1
  elif [ "$now" -lt "$base" ]; then
    printf '  \033[32m%-46s %8s %8s %6s  ↓ baixa o baseline em scripts/ui-metrics.sh\033[0m\n' "$name" "$now" "$base" "$target"
  else
    printf '  %-46s %8s %8s %6s\n' "$name" "$now" "$base" "$target"
  fi
done

for r in "${INFO[@]}"; do
  IFS='|' read -r name target now <<<"$r"
  printf '  %-46s %8s %8s %6s  (informativa)\n' "$name" "$now" "—" "$target"
done

if [ "$fail" -ne 0 ]; then
  printf '\n\033[31mui-metrics: uma métrica subiu — a migração não pode recuar (ADR-0004)\033[0m\n'
  exit 1
fi
printf '\n\033[32mui-metrics: nenhuma métrica subiu\033[0m\n'
