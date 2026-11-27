import os, subprocess, tarfile, tempfile, unittest

SCRIPT = os.path.abspath("scripts/backup.sh")


def run(*args):
    return subprocess.run(["bash", SCRIPT, *args], capture_output=True, text=True)


class Backup(unittest.TestCase):
    def test_strict_mode(self):
        self.assertIn("set -euo pipefail", open(SCRIPT).read())

    def test_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as t:
            src = os.path.join(t, "my data")
            os.makedirs(os.path.join(src, "sub dir"))
            open(os.path.join(src, "sub dir", "a file.txt"), "w").write("x")
            dest = os.path.join(t, "back ups", "nested")
            r = run(src, dest)
            self.assertEqual(r.returncode, 0, r.stderr)
            out = r.stdout.strip()
            self.assertEqual(len(r.stdout.strip().splitlines()), 1)
            self.assertTrue(out.startswith(dest + os.sep + "backup-") and out.endswith(".tar.gz"), out)
            with tarfile.open(out) as tf:
                self.assertIn("./sub dir/a file.txt", tf.getnames())

    def test_refuses_bad_input(self):
        with tempfile.TemporaryDirectory() as t:
            r = run(os.path.join(t, "missing"), os.path.join(t, "out"))
            self.assertEqual(r.returncode, 2)
            self.assertTrue(r.stderr.strip())
            self.assertEqual(r.stdout, "")
            self.assertEqual(run().returncode, 2)


if __name__ == "__main__":
    unittest.main()
