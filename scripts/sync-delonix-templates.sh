#!/usr/bin/env bash
# Copia os templates de projecto do Delonix (`bins/delonix/templates/`, os do `delonix init -t`) para
# `templates/projects/`, tal como estão, e grava de que commit vieram em `templates/projects/SOURCE`.
# O «New Project» do IDE embute-os (crates/tutor-scaffold). Não se editam aqui: muda-se no Delonix e
# corre-se isto outra vez.
#
#   scripts/sync-delonix-templates.sh [checkout-do-delonix] [ref]
#   (por omissão ../delonix e origin/develop; lê pelo `git archive`, sem tocar na árvore de trabalho)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
src=${1:-"$here/../delonix"}
ref=${2:-origin/develop}
[ -d "$src/.git" ] || [ -f "$src/.git" ] || { echo "não é um checkout git: $src" >&2; exit 1; }
git -C "$src" fetch -q origin || true
sha=$(git -C "$src" rev-parse "$ref")
dest="$here/templates/projects"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$src" archive "$sha" bins/delonix/templates | tar -x -C "$tmp"
rm -rf "$dest"
mkdir -p "$dest"
cp -a "$tmp/bins/delonix/templates/." "$dest/"
printf 'repository: ngolacloud/delonix\npath: bins/delonix/templates\ncommit: %s\n' "$sha" > "$dest/SOURCE"
echo "templates de $sha → $dest ($(find "$dest" -type f | wc -l) ficheiros)"
