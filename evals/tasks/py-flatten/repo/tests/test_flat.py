import unittest


class Visible(unittest.TestCase):
    def test_imports(self):
        from app.flat import flatten, unflatten  # noqa: F401
