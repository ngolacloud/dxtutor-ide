import unittest


class Visible(unittest.TestCase):
    def test_module_imports(self):
        import app.slo  # noqa: F401
