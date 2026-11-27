import unittest
from app.flat import flatten, unflatten

DOC = {"db": {"host": "x", "port": 5432, "replicas": [{"host": "r1"}, {"host": "r2"}]}, "tags": ["a", "b"], "empty": {}, "none": [], "debug": False}


class Acceptance(unittest.TestCase):
    def test_flatten(self):
        self.assertEqual(flatten(DOC), {
            "db.host": "x", "db.port": 5432, "db.replicas.0.host": "r1", "db.replicas.1.host": "r2",
            "tags.0": "a", "tags.1": "b", "empty": {}, "none": [], "debug": False,
        })

    def test_round_trip(self):
        self.assertEqual(unflatten(flatten(DOC)), DOC)
        self.assertEqual(unflatten({"a.1": "y", "a.0": "x"}), {"a": ["x", "y"]})
