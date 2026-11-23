#!/usr/bin/env bash
# publish-course.sh — publica um curso oficial (courses/<id>/) no seu repositório
# github.com/dxtutor-courses/<id>, com o histórico da pasta (git subtree split) e uma tag.
#
# Uso:   scripts/publish-course.sh <id> [--dry-run]
#        (a versão vem de courses/<id>/dxtutor-plugin.json; a tag é v<versão>)
#
# Pré-requisitos: o repositório dxtutor-courses/<id> existe no GitHub e tens permissão de
# escrita; o `dxt` está compilado (target/debug/dxt ou no PATH). Valida em modo estrito antes
# de publicar e recusa uma tag que já exista no remoto.

set -euo pipefail
export GIT_TERMINAL_PROMPT=0   # nunca ficar à espera de credenciais num terminal
cd "$(dirname "$0")/.." || exit 2

id="${1:-}"
dry=0
[ "${2:-}" = "--dry-run" ] && dry=1
[ -n "$id" ] || { echo "uso: scripts/publish-course.sh <id> [--dry-run]" >&2; exit 2; }
dir="courses/$id"
[ -f "$dir/dxtutor-plugin.json" ] || { echo "não existe $dir/dxtutor-plugin.json" >&2; exit 2; }

version=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$dir/dxtutor-plugin.json")
tag="v$version"
remote="https://github.com/dxtutor-courses/$id.git"

dxt=target/debug/dxt
[ -x "$dxt" ] || dxt=$(command -v dxt || true)
[ -n "$dxt" ] || { echo "compila o dxt primeiro: cargo build -p tutor-cli" >&2; exit 2; }

echo "== validar $dir (estrito)"
"$dxt" plugin validate "$dir" --strict

echo "== UI JSON em dia?"
python3 scripts/sync-ui-courses.py --check

if [ -n "$(git status --porcelain -- "$dir")" ]; then
  echo "$dir tem alterações por commitar" >&2; exit 1
fi

if git ls-remote --tags "$remote" "refs/tags/$tag" | grep -q .; then
  echo "a tag $tag já existe em $remote — sobe a versão no manifesto" >&2; exit 1
fi

branch="publish/$id"
echo "== subtree split $dir → $branch"
git subtree split --prefix "$dir" -b "$branch" >/dev/null
sha=$(git rev-parse "$branch")

if [ "$dry" -eq 1 ]; then
  echo "(dry-run) publicaria $sha em $remote main + tag $tag"
  git branch -D "$branch" >/dev/null
  exit 0
fi

echo "== push $remote (main + $tag)"
git push "$remote" "$branch:refs/heads/main"
git push "$remote" "$sha:refs/tags/$tag"
git branch -D "$branch" >/dev/null
echo "Publicado: dxt plugin install $id   (ou $id@$tag)"
