import unittest
from app.text import slugify


class Visible(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(slugify("hello world"), "hello-world")
