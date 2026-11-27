"""Acceptance of sre-incident-postmortem: the postmortem exists with its sections, names the real cause (release
v2.4.1 cut the payments-gw timeout from 2000 to 200 ms) with its evidence and times, does not blame the distractor
(stock), and nothing else in the project changed."""
import re
import subprocess
import sys

PATH = "docs/postmortems/INC-1.md"
fails = []
try:
    text = open(PATH, encoding="utf-8").read()
except OSError:
    print(f"FAIL: {PATH} was not written")
    sys.exit(1)
low = text.lower()

for section in ("summary", "impact", "timeline", "root cause", "actions"):
    if not re.search(rf"^#+\s*{section}", low, re.M):
        fails.append(f"no «{section}» section (a markdown heading)")

if "v2.4.1" not in low:
    fails.append("the release that caused it (v2.4.1) is not named")
if "payments-gw" not in low:
    fails.append("the failing upstream (payments-gw) is not named")
if not re.search(r"\b200\s*ms\b|\b200ms\b", low) or "timeout" not in low:
    fails.append("the cause is not the payments timeout cut to 200 ms")
if not re.search(r"10:0[12]", text):
    fails.append("the timeline has no UTC time of the start (10:01/10:02)")
# the root cause section must not blame the stock service (a distractor: 2 errors, a deploy after the start)
m = re.search(r"^#+\s*root cause(.*?)(^#+\s|\Z)", low, re.M | re.S)
if m and re.search(r"stock[^.\n]*(caused|root cause|responsible)", m.group(1)):
    fails.append("the root cause blames the stock service")

changed = subprocess.run(
    ["git", "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True
).stdout.splitlines()
other = [
    l for l in changed
    if not l[3:].startswith("docs/postmortems/") and not l[3:].startswith(".dxtutor")
    and l[3:] not in ("check_postmortem.py", ".dxtutor-eval-check.log")
]
if other:
    fails.append("other files changed: " + ", ".join(l[3:] for l in other))

for f in fails:
    print("FAIL:", f)
if fails:
    sys.exit(1)
print("OK: postmortem names v2.4.1, payments-gw, the 200 ms timeout and the times; nothing else changed")
