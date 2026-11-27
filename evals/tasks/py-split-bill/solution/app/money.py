from decimal import Decimal

CENT = Decimal("0.01")


def split(total, n):
    """Splits a bill into `n` amounts (2 decimals) that add up exactly; extra cents to the first."""
    if n < 1:
        raise ValueError("n must be at least 1")
    total = Decimal(total).quantize(CENT)
    if total < 0:
        raise ValueError("the total cannot be negative")
    cents = int(total * 100)
    base, extra = divmod(cents, n)
    return [(Decimal(base + (1 if i < extra else 0)) / 100).quantize(CENT) for i in range(n)]
