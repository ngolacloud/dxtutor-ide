import unittest
from app.roman import to_roman, from_roman


class Acceptance(unittest.TestCase):
    def test_known(self):
        for n, s in [(1, "I"), (4, "IV"), (9, "IX"), (14, "XIV"), (40, "XL"), (90, "XC"), (400, "CD"), (1994, "MCMXCIV"), (3999, "MMMCMXCIX")]:
            self.assertEqual(to_roman(n), s)
            self.assertEqual(from_roman(s), n)
        self.assertEqual(from_roman("mcmxciv"), 1994)

    def test_round_trip(self):
        for n in range(1, 4000):
            self.assertEqual(from_roman(to_roman(n)), n)

    def test_invalid(self):
        for n in (0, 4000, -1):
            with self.assertRaises(ValueError):
                to_roman(n)
        for s in ("IIII", "VX", "IC", "MMMM", "", "ABC", "IIV"):
            with self.assertRaises(ValueError):
                from_roman(s)
