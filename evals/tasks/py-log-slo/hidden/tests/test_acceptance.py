import unittest
from app.slo import summarize


class Acceptance(unittest.TestCase):
    def test_per_path(self):
        lines = [f"2026-11-20T10:00:{i:02d}Z GET /api/orders {500 if i % 10 == 0 else 200} {i * 10}ms" for i in range(1, 21)]
        lines += ["2026-11-20T10:01:00Z POST /api/pay 201 40ms", "garbage", "", "2026-11-20T10:01:00Z GET /api/pay 503 x"]
        s = summarize(lines)
        self.assertEqual(set(s), {"/api/orders", "/api/pay"})
        self.assertEqual(s["/api/orders"], {"requests": 20, "p95_ms": 190, "error_rate": 0.1})
        self.assertEqual(s["/api/pay"], {"requests": 1, "p95_ms": 40, "error_rate": 0.0})

    def test_rounding(self):
        lines = [f"2026-11-20T10:00:0{i}Z GET /a {503 if i == 0 else 200} 5ms" for i in range(3)]
        self.assertEqual(summarize(lines)["/a"]["error_rate"], 0.3333)
