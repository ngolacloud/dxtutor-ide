from decimal import Decimal


def split(total, n):
    """Splits a bill evenly."""
    each = round(Decimal(total) / n, 2)
    return [each] * n
