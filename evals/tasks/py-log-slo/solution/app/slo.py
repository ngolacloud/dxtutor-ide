import math
import re

LINE = re.compile(r"^\S+ [A-Z]+ (\S+) (\d{3}) (\d+)ms$")


def summarize(lines):
    """Per-path request count, p95 latency (nearest rank) and 5xx error rate."""
    by = {}
    for line in lines:
        m = LINE.match(line.strip())
        if not m:
            continue
        path, status, ms = m.group(1), int(m.group(2)), int(m.group(3))
        by.setdefault(path, []).append((status, ms))
    out = {}
    for path, rows in by.items():
        lat = sorted(ms for _, ms in rows)
        n = len(rows)
        out[path] = {
            "requests": n,
            "p95_ms": lat[math.ceil(0.95 * n) - 1],
            "error_rate": round(sum(1 for st, _ in rows if 500 <= st <= 599) / n, 4),
        }
    return out
