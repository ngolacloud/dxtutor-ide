#!/usr/bin/env sh
# PairCode smoke test: two instances of the app on this machine, one hosting a throw-away repo,
# the other joining with the token. A fake camera and microphone stand in for real ones.
# Checks: join, read-only while navigating, follow, request/accept control, guest edit saved on
# the host's disk, shared terminal, host edit reaching the guest, video and audio both ways.
# Needs a display (headless Linux: xvfb-run sh scripts/pairtest.sh).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d)
git -C "$T" init -q -b main repo 2>/dev/null || { mkdir -p "$T/repo"; git -C "$T/repo" init -q -b main; }
git -C "$T/repo" config user.email pair@example.com
git -C "$T/repo" config user.name pair
printf 'fn main() {}\n' > "$T/repo/main.rs"
git -C "$T/repo" add . && git -C "$T/repo" commit -qm "chore: initial"
mkdir -p "$T/host-home" "$T/guest-home"
(cd src-tauri && cargo build -q)
HOME="$T/host-home" DXTUTOR_PAIRTEST=host DXTUTOR_SELFTEST="$T/host.json" ./src-tauri/target/debug/dxtutor-ide "$T/repo" &
sleep 3
HOME="$T/guest-home" DXTUTOR_PAIRTEST=guest DXTUTOR_SELFTEST="$T/guest.json" ./src-tauri/target/debug/dxtutor-ide &
wait
echo "== host";  cat "$T/host.json";  echo
echo "== guest"; cat "$T/guest.json"; echo
