import unittest
from app.text import slugify


class Acceptance(unittest.TestCase):
    def test_accents(self):
        self.assertEqual(slugify("Café à Luanda"), "cafe-a-luanda")
        self.assertEqual(slugify("Ação & Reação!"), "acao-reacao")

    def test_runs_and_edges(self):
        self.assertEqual(slugify("  --Hello,   World!!  "), "hello-world")
        self.assertEqual(slugify("C++ / Rust"), "c-rust")

    def test_cut_without_trailing_dash(self):
        self.assertEqual(slugify("one two three", max_len=8), "one-two")
        self.assertEqual(len(slugify("x" * 100)), 60)
        self.assertEqual(slugify("!!!"), "")
