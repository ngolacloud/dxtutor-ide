import unittest


class Visible(unittest.TestCase):
    def test_imports(self):
        from app.cron import next_run  # noqa: F401
