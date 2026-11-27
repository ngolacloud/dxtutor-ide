import unittest
from decimal import Decimal
from app.money import split


class Acceptance(unittest.TestCase):
    def test_cents_go_to_the_first(self):
        self.assertEqual(split("100.00", 3), [Decimal("33.34"), Decimal("33.33"), Decimal("33.33")])
        self.assertEqual(split(Decimal("0.05"), 3), [Decimal("0.02"), Decimal("0.02"), Decimal("0.01")])
        for total, n in (("1234.56", 7), (1, 6), ("0.00", 4)):
            parts = split(total, n)
            self.assertEqual(len(parts), n)
            self.assertEqual(sum(parts), Decimal(total).quantize(Decimal("0.01")))
            self.assertTrue(all(p.as_tuple().exponent == -2 for p in parts))

    def test_invalid(self):
        with self.assertRaises(ValueError):
            split("10", 0)
        with self.assertRaises(ValueError):
            split("-1", 2)
