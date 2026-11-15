#!/usr/bin/env sh
# Smoke test: opens a throw-away git repo in the app, checks autosave, commit, gitflow and the terminal,
# writes a JSON report and quits. Needs a display (on a headless Linux box: xvfb-run sh scripts/selftest.sh).
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d)
git -C "$T" init -q -b main
git -C "$T" config user.email selftest@example.com
git -C "$T" config user.name selftest
printf 'fn main() {}\n' > "$T/main.rs"
git -C "$T" add . && git -C "$T" commit -qm "chore: initial"
git -C "$T" branch develop
cargo build -q -p dxtutor-ide
DXTUTOR_SELFTEST="$T/report.json" ./target/debug/dxtutor-ide "$T"
cat "$T/report.json"
echo
git -C "$T" log --all --oneline --graph
