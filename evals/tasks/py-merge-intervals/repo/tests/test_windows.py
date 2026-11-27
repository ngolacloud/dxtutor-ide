import unittest
from app.windows import merge_intervals


class Visible(unittest.TestCase):
    def test_sorted_overlap(self):
        self.assertEqual(merge_intervals([(1, 3), (2, 5)]), [(1, 5)])
