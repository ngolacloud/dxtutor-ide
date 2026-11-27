from datetime import datetime, timedelta


def _field(text, lo, hi):
    out = set()
    for part in text.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/", 1)
            if not s.isdigit() or int(s) == 0:
                raise ValueError(f"bad step: {text}")
            step = int(s)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            x, y = part.split("-", 1)
            if not (x.isdigit() and y.isdigit()):
                raise ValueError(f"bad range: {text}")
            a, b = int(x), int(y)
        elif part.isdigit():
            a = b = int(part)
        else:
            raise ValueError(f"bad field: {text}")
        if a > b or a < lo or b > hi:
            raise ValueError(f"out of range: {text}")
        out.update(range(a, b + 1, step))
    return out


def next_run(expr: str, after: datetime) -> datetime:
    parts = expr.split()
    if len(parts) != 5 or parts[2:] != ["*", "*", "*"]:
        raise ValueError(f"unsupported expression: {expr}")
    minutes, hours = _field(parts[0], 0, 59), _field(parts[1], 0, 23)
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(60 * 24 + 1):
        if t.minute in minutes and t.hour in hours:
            return t
        t += timedelta(minutes=1)
    raise ValueError(f"no run time: {expr}")
