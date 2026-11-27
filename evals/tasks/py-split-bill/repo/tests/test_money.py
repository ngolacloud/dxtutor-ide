import unittest
from decimal import Decimal
from app.money import split


class Visible(unittest.TestCase):
    def test_even(self):
        self.assertEqual(split("10.00", 2), [Decimal("5.00"), Decimal("5.00")])
