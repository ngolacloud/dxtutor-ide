import re, sys, unittest

def lines():
    text = open("Dockerfile").read()
    return [l.strip() for l in text.replace("\\\n", " ").splitlines() if l.strip() and not l.strip().startswith("#")]

class Dockerfile(unittest.TestCase):
    def test_pinned_base(self):
        froms = [l.split()[1] for l in lines() if l.upper().startswith("FROM")]
        self.assertTrue(froms)
        for f in froms:
            self.assertNotIn(":latest", f)
            self.assertTrue(":" in f or "@sha256:" in f, f)

    def test_non_root(self):
        users = [l for l in lines() if l.upper().startswith("USER")]
        self.assertTrue(users, "no USER instruction")
        last = users[-1].split()[1]
        self.assertNotIn(last.split(":")[0], ("root", "0"))

    def test_healthcheck_and_no_secrets(self):
        ls = lines()
        self.assertTrue(any(l.upper().startswith("HEALTHCHECK") for l in ls))
        self.assertFalse(any(re.search(r"(PASSWORD|SECRET|TOKEN)=", l, re.I) for l in ls if l.upper().startswith(("ENV", "ARG"))))

    def test_app_still_runs_with_python(self):
        cmd = [l for l in lines() if l.upper().startswith(("CMD", "ENTRYPOINT"))]
        self.assertTrue(cmd and "app.py" in cmd[-1])

if __name__ == "__main__":
    unittest.main()
