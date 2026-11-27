import unittest
from app.windows import merge_intervals


class Acceptance(unittest.TestCase):
    def test_unsorted_and_touching(self):
        data = [(8, 10), (1, 3), (3, 4), (2, 2), (12, 15), (9, 11)]
        self.assertEqual(merge_intervals(data), [(1, 4), (8, 11), (12, 15)])
        self.assertEqual(data[0], (8, 10), "the input is not modified")

    def test_contained_and_empty(self):
        self.assertEqual(merge_intervals([(1, 10), (2, 3)]), [(1, 10)])
        self.assertEqual(merge_intervals([]), [])
