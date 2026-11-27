import unittest
from app.retry import retry


class Visible(unittest.TestCase):
    def test_success_passes_through(self):
        @retry()
        def ok():
            return 5
        self.assertEqual(ok(), 5)
