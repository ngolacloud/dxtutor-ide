import unittest
from app.retry import retry


class Acceptance(unittest.TestCase):
    def test_retries_with_backoff(self):
        waits, calls = [], []

        @retry(attempts=4, base_delay=0.5, max_delay=1.5, exceptions=(IOError,), sleep=waits.append)
        def flaky():
            """doc"""
            calls.append(1)
            if len(calls) < 4:
                raise IOError("down")
            return "paid"

        self.assertEqual(flaky(), "paid")
        self.assertEqual(waits, [0.5, 1.0, 1.5])
        self.assertEqual(flaky.__name__, "flaky")
        self.assertEqual(flaky.__doc__, "doc")

    def test_gives_up_with_the_last_error(self):
        waits = []

        @retry(attempts=2, base_delay=1, sleep=waits.append)
        def down():
            raise ValueError("nope")

        with self.assertRaises(ValueError):
            down()
        self.assertEqual(waits, [1])

    def test_other_errors_propagate_at_once(self):
        waits = []

        @retry(attempts=5, exceptions=(IOError,), sleep=waits.append)
        def bug():
            raise KeyError("x")

        with self.assertRaises(KeyError):
            bug()
        self.assertEqual(waits, [])
