import os, re, subprocess, unittest


def make(*args):
    return subprocess.run(["make", *args], capture_output=True, text=True)


class Makefile(unittest.TestCase):
    def test_targets_and_phony(self):
        text = open("Makefile").read()
        phony = set(" ".join(re.findall(r"^\.PHONY:(.*)$", text, re.M)).split())
        self.assertTrue({"test", "lint", "check", "clean"} <= phony, phony)
        first = re.search(r"^([A-Za-z_][\w-]*):", text, re.M).group(1)
        self.assertEqual(first, "check", "the default target is check")

    def test_check_passes_and_lint_fails_on_a_syntax_error(self):
        r = make()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(make("test").returncode, 0)
        open("app/broken.py", "w").write("def x(:\n")
        try:
            self.assertNotEqual(make("lint").returncode, 0)
            self.assertNotEqual(make("check").returncode, 0)
        finally:
            os.remove("app/broken.py")
        make("clean")
        self.assertFalse(any("__pycache__" in d for d, _, _ in os.walk("app")))


if __name__ == "__main__":
    unittest.main()
