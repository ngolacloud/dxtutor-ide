import unittest
from datetime import datetime
from app.cron import next_run

T = datetime(2026, 11, 20, 10, 7, 30, 123)


class Acceptance(unittest.TestCase):
    def test_fields(self):
        self.assertEqual(next_run("*/15 * * * *", T), datetime(2026, 11, 20, 10, 15))
        self.assertEqual(next_run("0 * * * *", T), datetime(2026, 11, 20, 11, 0))
        self.assertEqual(next_run("30 2 * * *", T), datetime(2026, 11, 21, 2, 30))
        self.assertEqual(next_run("5,40 9-10 * * *", T), datetime(2026, 11, 20, 10, 40))
        self.assertEqual(next_run("* * * * *", T), datetime(2026, 11, 20, 10, 8))
        self.assertEqual(next_run("7 10 * * *", datetime(2026, 11, 20, 10, 7)), datetime(2026, 11, 21, 10, 7))

    def test_invalid(self):
        for bad in ("60 * * * *", "* 24 * * *", "*/0 * * * *", "a * * * *", "* *", "5-1 * * * *"):
            with self.assertRaises(ValueError):
                next_run(bad, T)
