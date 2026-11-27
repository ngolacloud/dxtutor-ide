#!/usr/bin/env bash
# Usage: backup.sh SRC DEST — writes DEST/backup-<UTC>.tar.gz and prints its path.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: backup.sh SRC DEST" >&2
  exit 2
fi
src=$1
dest=$2
if [ ! -d "$src" ]; then
  echo "not a directory: $src" >&2
  exit 2
fi
name="backup-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
mkdir -p "$dest"
tar -czf "$dest/$name" -C "$src" .
printf '%s\n' "$dest/$name"
