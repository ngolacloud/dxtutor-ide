PAIRS = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]


def to_roman(n: int) -> str:
    if not 1 <= n <= 3999:
        raise ValueError(f"{n} is out of range 1..3999")
    out = []
    for v, s in PAIRS:
        while n >= v:
            out.append(s)
            n -= v
    return "".join(out)


def from_roman(s: str) -> int:
    t = s.strip().upper()
    vals = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    if not t or any(c not in vals for c in t):
        raise ValueError(f"not a roman numeral: {s!r}")
    total = 0
    for i, c in enumerate(t):
        v = vals[c]
        total += -v if i + 1 < len(t) and vals[t[i + 1]] > v else v
    if not 1 <= total <= 3999 or to_roman(total) != t:
        raise ValueError(f"not a canonical roman numeral: {s!r}")
    return total
