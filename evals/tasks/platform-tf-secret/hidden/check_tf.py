import os, re, unittest


def block(text, kind, name):
    m = re.search(r'^%s\s+"%s"(?:\s+"[^"]+")?\s*\{' % (kind, name), text, re.M)
    if not m:
        return None
    depth, i = 0, m.end() - 1
    for j in range(i, len(text)):
        depth += {"{": 1, "}": -1}.get(text[j], 0)
        if depth == 0:
            return text[m.start():j + 1]
    return None


class Terraform(unittest.TestCase):
    def setUp(self):
        self.tf = "".join(open(f).read() + "\n" for f in sorted(os.listdir(".")) if f.endswith(".tf"))

    def test_variable_is_sensitive_without_default(self):
        v = block(self.tf, "variable", "db_password")
        self.assertIsNotNone(v)
        self.assertRegex(v, r"sensitive\s*=\s*true")
        self.assertNotRegex(v, r"\bdefault\s*=")
        self.assertRegex(v, r"validation\s*\{")
        self.assertIn("16", v)
        self.assertNotIn("hunter2", self.tf)

    def test_resource_and_outputs(self):
        r = block(self.tf, "resource", "aws_db_instance")
        self.assertIsNotNone(r)
        self.assertRegex(r, r"password\s*=\s*var\.db_password")
        for m in re.finditer(r'^output\s+"([^"]+)"', self.tf, re.M):
            self.assertNotIn("db_password", block(self.tf, "output", m.group(1)))
        self.assertIsNotNone(block(self.tf, "output", "db_endpoint"))
        self.assertIsNotNone(block(self.tf, "variable", "db_name"))

    def test_example_tfvars(self):
        ex = open("terraform.tfvars.example").read()
        self.assertRegex(ex, r"db_password\s*=")
        self.assertNotIn("hunter2", ex)


if __name__ == "__main__":
    unittest.main()
