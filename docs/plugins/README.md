# Writing a course plugin for dxtutor

A **course plugin** adds a language, framework or tool track to dxtutor's Learning Track. It is a GitHub
repository with a manifest and one or more course files. Course files are data, not code.
You don't need to touch the dxtutor source code to publish a course.

- Official courses live in the [`ngolacloud`](https://github.com/ngolacloud) GitHub
  organization, one repository per language: `ngolacloud/dxtutor-course-<id>`.
- Anyone can publish a course in their own repository; users install it by URL.

## Quick start

```sh
dxt plugin new kotlin Kotlin kt      # creates ./kotlin with a valid skeleton
cd kotlin
$EDITOR courses/kotlin.toml          # write the course
dxt plugin validate .                # check the manifest and every step
dxt plugin install .                 # install your working copy and try it in the app
git init && git add . && git commit -m "Kotlin course" && git push
```

`dxt` is dxtutor's command-line tool (the `tutor-cli` crate). Install it with
`cargo install --git https://github.com/ngolacloud/dxtutor-ide tutor-cli --locked`.

## Repository layout

```text
dxtutor-plugin.json          the manifest (required, at the root)
courses/kotlin.toml          one or more course files (.toml or .json)
README.md                    what the course covers, how to install it
.github/workflows/validate.yml   CI: runs `dxt plugin validate . --strict`
```

Folders named `.git`, `.github`, `node_modules` and `target` are ignored on install.
A plugin can be at most 64 MiB and 5,000 files.

## The manifest: `dxtutor-plugin.json`

```json
{
  "schema": 1,
  "id": "kotlin",
  "name": "Kotlin",
  "version": "0.1.0",
  "description": "A guided, hands-on Kotlin course.",
  "authors": ["Ada Lovelace <ada@example.com>"],
  "license": "CC-BY-4.0",
  "repository": "https://github.com/ngolacloud/dxtutor-course-kotlin",
  "engine": ">=0.7.0",
  "kind": "course",
  "language": {
    "id": "kotlin",
    "name": "Kotlin",
    "icon": "🟣",
    "extension": "kt",
    "indent": "4",
    "testCommand": "gradle test"
  },
  "courses": ["courses/kotlin.toml"]
}
```

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Manifest format version. Always `1` today. |
| `id` | yes | Unique plugin id: `[a-z0-9-]`, 2–40 characters. It is also the install folder name. |
| `name` | yes | Display name. |
| `version` | yes | [Semantic version](https://semver.org) of the plugin (`1.2.0`). |
| `engine` | yes | dxtutor versions the plugin works with, as a semver requirement (`>=0.7.0`). |
| `kind` | yes | `course`. |
| `language.id` | yes | Language id (`kotlin`). Every course in the plugin must use this `language`. |
| `language.name` | yes | Language display name. |
| `language.extension` | yes | Exercise file extension, without the dot (`kt`). |
| `language.icon` | no | An emoji for the language card. |
| `language.indent` | no | What the Tab key inserts: `"tab"` or a number of spaces (`"4"`, the default). |
| `language.testCommand` | no | The test command shown to the learner. Display only. |
| `courses` | yes | Relative paths to the course files, `.toml` or `.json`. |
| `description`, `authors`, `license`, `repository` | no | Shown in listings. |

The official languages (Rust, Go, Python, TypeScript, Java, Kotlin, Swift, C#, C++, SQL) use
these `language.id` values: `rust`, `go`, `python`, `typescript`, `java`, `kotlin`, `swift`,
`csharp`, `cpp`, `sql`. A plugin for any other language shows up as a **Community** card.

A JSON Schema for editor completion is in [`dxtutor-plugin.schema.json`](dxtutor-plugin.schema.json).

## Framework and tool courses

Frameworks and tools are a **separate category** from the languages: they have their own
section in the app («Frameworks & tools») and their own official catalog, and they don't count
towards the 10 official languages. A framework or tool plugin adds two manifest fields:

```json
{
  "kind": "course",
  "category": "framework",
  "subject": {
    "id": "django",
    "name": "Django",
    "icon": "🎸",
    "docs": "https://docs.djangoproject.com/"
  },
  "language": { "id": "python", "name": "Python", "icon": "🐍", "extension": "py", "indent": "4" },
  "courses": ["courses/django.toml"]
}
```

| Field | Required | Meaning |
|---|---|---|
| `category` | no | `language` (the default: leave it out for a language course), `framework` or `tool`. |
| `subject.id` | with `framework`/`tool` | Id of what the course teaches (`django`, `docker`). Every course's `subject` must equal it, and it can't be the same as `language.id`. |
| `subject.name` | with `framework`/`tool` | Display name. |
| `subject.icon` | no | An emoji for the card. |
| `subject.docs` | no | The official documentation (`https://…`), shown to the learner. |

In a framework or tool plugin, `language` is the language the exercises are written in and
**graded** by (`python` for Django), so the extension, the indentation and the evaluator come
from it. Each course file repeats the category:

```toml
id = "django-basics"
language = "python"      # graded by the Python evaluator
category = "framework"   # must equal the manifest
subject = "django"       # must equal subject.id
```

Step ids still have to be unique among the courses of the same `language`, because grading
finds a step by (language, id): prefix them with the subject (`dj-p1-views`).

The official frameworks and tools are Dxjs, Seiva, Django, Delonix Engine, Docker, Podman,
Kubernetes and Odoo (ids `dxjs`, `seiva`, `django`, `delonix`, `docker`, `podman`,
`kubernetes`, `odoo`), in `ngolacloud/dxtutor-course-<id>`. Any other subject shows up as a
**Community** card.

## The course format

TOML is recommended, because code reads naturally in multi-line strings (`"""…"""`). JSON
with the same fields works too (`units`/`steps` instead of `[[unit]]`/`[[unit.step]]`).

### Course

```toml
id = "kotlin-basics"            # unique across all installed courses
language = "kotlin"             # must equal language.id in the manifest
title = "Kotlin from zero"
level = "beginner"              # free text, display only
summary = "One or two sentences for the language card."
overview = """
What Kotlin is, where it is used, and the mental model this course builds.
Shown before the first step.
"""
```

### Units: one per topic

```toml
[[unit]]
id = "kotlin-u1-values"
title = "Values and variables"
level = "basic"                 # basic | intermediate | advanced  (learners filter by level)
difficulty = 1                  # increasing marker, display only
intro = "One sentence: what this unit is about."
concepts = """
## Values and variables
The reading text for this topic. Explain the concepts first, then how Kotlin expresses them.
"""
```

**Every unit should have a `concepts` text.** It is what lets a reader understand the
topic and the language before practising: the app opens it on the unit's first step, and
the learner can reopen it at any time. Validation warns when it is missing.
Good concepts texts:

- start from the idea (what is a variable, and why does it exist), then show the syntax;
- use short paragraphs, `##` headings and small fenced examples in the course language;
- say what is special about this language (immutability by default, ownership, null safety…);
- stay under about 600 words: the steps carry the practice.

### Steps: concept, drill and challenge

Steps run in order; each one unlocks when the previous one is done.

```toml
[[unit.step]]
kind = "concept"
id = "kotlin-c1-val-var"
title = "val and var"
points = 5
intro = "A short briefing shown before the step."
body = """
A focused explanation in markdown.
"""

[[unit.step]]
kind = "drill"                  # the learner retypes a complete program, line by line
id = "kotlin-d1-hello"
title = "Hello, world"
points = 10
placeholder_policy = "shown"    # shown | on_demand (target hidden until the learner asks)
prompt = "Type the program exactly as shown."
target = """
fun main() {
    println("Hello, world")
}
"""
line_comments = [               # one per line of `target`, aligned by index ("" to skip)
  "Every Kotlin program starts at main.",
  "println writes a line to standard output.",
  "",
]
explanation = "Shown once the program matches."

[[unit.step]]
kind = "challenge"              # the learner implements a function; hidden tests judge it
id = "kotlin-x1-add"
title = "Add two numbers"
points = 20
instructions = "Implement `add` so that it returns the sum of its arguments."
entry = "add"                   # the function the learner writes; the starter must mention it
starter = """
fun add(a: Int, b: Int): Int {
    TODO()
}
"""
tests = """
// Hidden tests. They are never sent to the learner's editor.
"""

[unit.step.gabarito]            # reference solution, revealed only after the tests pass
solution = """
fun add(a: Int, b: Int): Int = a + b
"""
time = "O(1)"
space = "O(1)"
justification = "One addition, no allocation."
```

Optional step fields: `difficulty`, `install_commands` (package-manager commands shown to the
learner), `run_command` (the CLI command to run the exercise, shown to the learner) and
`dependencies` (extra Cargo dependency lines, Rust only).

### Project steps: several files

A challenge can be a small project instead of one function: a `project` table replaces
`starter`, `tests` and `gabarito`. This is what framework and tool courses need (a package of
modules, a manifest and its config).

```toml
[[unit.step]]
kind = "challenge"
id = "shop-p1-cart"
title = "A cart that charges VAT"
points = 30
instructions = "Implement `with_vat` in `shop/prices.py` and `total` in `shop/cart.py`."
entry = "total"                       # optional; fills the {entry} placeholder

[unit.step.project]
main = "shop/cart.py"                 # opened first; must be an editable starter file
readonly = ["shop/__init__.py", "shop/config.py"]   # shown, never changed
explanation = "Why the solution is shaped this way (markdown, shown after a pass)."

[unit.step.project.starter]           # path → content: what the learner starts with
"shop/__init__.py" = ""
"shop/config.py" = '''
VAT = 0.14
'''
"shop/prices.py" = '''
def with_vat(amount):
    raise NotImplementedError
'''
"shop/cart.py" = '''
def total(items):
    raise NotImplementedError
'''

[unit.step.project.tests]             # hidden: never sent to the app
"test_shop.py" = '''
import unittest
...
'''

[unit.step.project.solution]          # the reference solution: editable files as they should end
"shop/prices.py" = '''...'''
"shop/cart.py" = '''...'''
```

The rules (checked by `dxt plugin validate` and again by the evaluator):

- Paths are relative, use `/`, and each segment is made of `A–Z a–z 0–9 . _ - + @` (no `..`,
  no empty or `.` segments, at most 10 levels). A path can't be both a file and a folder.
- `main` and every `solution` path must be editable starter files; `readonly` paths must be
  starter files; hidden test files must not also be starter files.
- `starter`, `tests` and `solution` can't be empty. At most 64 files (starter + tests),
  256 KiB per file and 2 MiB in all.
- A project step has no `starter`, `tests` or `gabarito` of its own.

When the learner submits, the app sends every editable file. Missing ones count as their
starter version, and read-only files always use the course's copy. A read-only or unknown
file in a submission is refused. The evaluator writes the learner's tree and the hidden test
files into a fresh folder and runs the language's **project test command**. Exit 0 means the
step passed. The reference solution files are revealed only after a pass.

Project steps are graded only for languages whose evaluator has a project test command:

- **Python:** `python3 -m unittest discover -s . -t . -p 'test*.py'`, so the hidden tests are
  `test*.py` files (in a folder, the folder needs an `__init__.py`), and a test file that
  defines no test fails.
- **TypeScript:** every hidden `*.test.ts` file (outside `node_modules`) runs with
  `node --experimental-transform-types --test`, so the tests use `node:test` and
  `node:assert/strict` and import the learner's files with their extension
  (`import { total } from "./src/cart.ts"`). A step with no `*.test.ts` file fails. The
  evaluator writes `package.json` with `{"type":"module"}` unless the step has one.

A custom descriptor can add one with `project_test_cmd` (see the top of
`crates/tutor-eval/src/plugin.rs`).

### Support files: shared by every step

Some courses need files that belong to no step: a library that is not in a public registry,
a test environment, a shared configuration. Instead of copying them into every step, the course
declares them once, in a `[support]` table (before the first `[[unit]]`): the path where the
evaluator writes the file → the file in your plugin.

```toml
[support]
"node_modules/.dxjs/dxjs.js" = "support/dxjs-1.2.0.js"
"node_modules/@dxjs/core/package.json" = "support/core/package.json"
"node_modules/@dxjs/core/index.js" = "support/core/index.js"
```

- They are written next to the files of **every** drill, challenge and project step, after
  them. A support file never replaces a step's file, and a step's file never replaces a support
  file: a clash is an error (`dxt plugin validate` reports it for project steps).
- Both sides use the project path rules above. The plugin file must be a regular UTF-8 text
  file inside the plugin (no symbolic links). At most 64 files, 2 MiB each and 4 MiB in all.
- Keep them out of folders named `node_modules` in your repository: those are skipped on
  install. Map them to `node_modules/…` in the work folder instead, as above.
- They are never sent to the app. Only languages graded by a descriptor write them; the native
  Rust and Go runners refuse a course that has them.

The official Dxjs course uses them to grade offline against the real dxjs 1.2.0
([`courses/dxjs/support/`](../../courses/dxjs/support/README.md)).

### Ids

Step ids must be unique across **all** installed courses, including the ones built into
the app, because grading finds a step by its id. Prefix every id with your course or
language id (`kotlin-d1-hello`). Installing a plugin whose ids clash with an installed
course is refused.

## Validation

```sh
dxt plugin validate .            # errors fail; warnings are content advice
dxt plugin validate . --strict   # warnings fail too (use this in CI)
```

The validator checks the manifest fields, that every course parses, that each course's
`language` matches the manifest, that levels and placeholder policies are valid, and that
each step has the fields its kind needs (`body` for concepts; `target` for drills; and
`instructions`, `entry`, `starter`, `tests` and `gabarito` for challenges). It warns when a
course has no `overview`, a unit has no `concepts`, a step awards 0 points, or a starter
doesn't mention its entry function.

The skeleton from `dxt plugin new` includes a GitHub Actions workflow that runs
`dxt plugin validate . --strict` on every push and pull request.

### Testing the content with the real evaluator

```sh
dxt plugin test .                       # every unit
dxt plugin test . --only py-u05         # only units whose id starts with py-u05
```

`dxt plugin test` uses the same evaluator as the app:

- every **drill** `target` must run and exit 0;
- every **challenge** is graded twice. Its `gabarito.solution` must pass the hidden `tests`,
  and its `starter` must fail them. A starter that passes means the tests prove nothing.
- every **project step** is graded the same way with file sets: the `project.solution` files
  must pass and the `project.starter` files must fail.

It needs the language toolchain on your machine (for example `python3`, `go`, `cargo`), and it
prints the version it graded with (`graded as typescript with v22.18.0`). Run it before every
release.

## Publishing and versions

1. Bump `version` in the manifest.
2. Tag the commit: `git tag v0.2.0 && git push --tags`.
3. Learners install a fixed version with `owner/repo@v0.2.0`, or the default branch with `owner/repo`.

Installing again updates the plugin in place, and the learner's progress is kept.
Progress is stored per step id, so **don't rename the ids of published steps**. Add new
steps instead.

## Installing

In the app: **Learning Track → Choose what to learn → Course plugins**. Paste a source and
press Install. From a terminal, use `dxt plugin install <source>`. Both write to the same
place, so a plugin installed by one appears in the other.

| Source | Installs |
|---|---|
| `kotlin` | the official course, `github.com/ngolacloud/dxtutor-course-kotlin` |
| `owner/repo` · `owner/repo@v1.2.0` · `github:owner/repo` | a GitHub repository, optionally at a tag or branch |
| `https://github.com/owner/repo[/tree/<ref>]` | the same, as a URL |
| `https://example.org/plugin.zip` | a zip over HTTPS |
| `./folder` · `./plugin.zip` | a local folder or zip (for authors) |

Other commands: `dxt plugin list` and `dxt plugin remove <id>`. Plugins are stored in
`$DXTUTOR_PLUGINS_DIR` if set, otherwise in `~/.local/share/dxtutor/plugins` (Linux),
`~/Library/Application Support/dxtutor/plugins` (macOS) or `%APPDATA%\dxtutor\plugins`
(Windows).

## Security model

- Plugins are **data**. Installing one never runs anything from it.
- Zip entries that escape the plugin folder (`../`, absolute paths) and symlinks are
  rejected or skipped, and size limits apply.
- Challenge tests run later, in dxtutor's evaluator, the same way as the built-in courses'
  tests. Only install courses you trust, as you would with any code you run.

## Grading support per language

Concept and drill steps work for every language. Challenge steps are graded by dxtutor's
evaluator, which must support the course language:

| Language | Runner | Hidden tests are… | Toolchain |
|---|---|---|---|
| Rust | native | `#[test]` functions (`cargo test`) | `cargo` |
| Go | native | `func TestXxx(t *testing.T)` (`go test`) | `go` |
| Python | descriptor | `unittest.TestCase` classes. The test file starts with `import unittest` and `from student import *`, so don't import them yourself | `python3` |
| C++ | descriptor | `TEST(name) { CHECK(…); CHECK_EQ(a, b); }` from a built-in mini framework. The test file `#include`s the student file, so student code has no `main` | `g++` (C++20), `libsqlite3-dev` for SQLite |
| TypeScript | descriptor | `dxt.test("name", () => { dxt.equal(actual, expected); })` (deep equality; tests may be `async`). The student file and tests run as one ES module, so never import the student file, and import anything else under an alias that cannot clash with the learner's names (`import { effect as effectForTest } from "…"`). Project steps: `node:test` files, see above | `node` 22.18+ (found on PATH or via nvm/Volta/fnm) |
| SQL (SQLite) | descriptor | Python `unittest` cases using the prelude helpers `query(setup)` → `(columns, rows)`, `script(setup)` → connection, `connect(setup)` | `python3` (its built-in SQLite) |
| Java | descriptor | the body of a method using `test("name", () -> equal(actual, expected))`, plus `check`, `near` and `assertThrows`. Imports go one per line at the start. The learner's classes are compiled with the tests, so they have no `main` and no `package` | JDK 21 (`java`) |
| Kotlin | descriptor | the body of an extension on the harness: `test("name") { equal(actual, expected) }`, plus `expect`, `near` and `assertThrows<T> { }`. `kotlinx.coroutines` is on the classpath. The learner's code has no `main` and no `package` | `kotlinc` 2.x and a JDK |
| C# | descriptor | the body of a method using `Test("name", () => Equal(actual, expected))`, plus `Check`, `Near` and `Throws<T>`; async lambdas are awaited. The learner's file has only types (no top-level statements) | .NET 8 SDK (`dotnet`) |
| Swift | descriptor | `test("name") { self.equal(actual, expected) }`, plus `expect`, `near` and `assertThrows`; tests may be `async`. The learner's file has only declarations; Swift 6 language mode | Swift 6 toolchain (`swiftc`, also via swiftly) |
| C | descriptor | a `main` that `assert`s (the test file `#include`s the student file) | `cc` |

A language without a native runner uses a **descriptor**: a small TOML file that says how
to scaffold the files and which commands run the program, the tests (exit 0 = passed) and
the diagnostics. Built-in descriptors live in `crates/tutor-eval/src/plugin.rs`. You can
drop your own into `~/.config/dxtutor/plugins/<language>.toml` to grade a new language
without rebuilding dxtutor; the format is documented at the top of that file.

If no runner supports the language, the app shows the evaluator's error instead of
pretending the tests passed.

## Contributing an official course

Open an issue in [`ngolacloud/dxtutor-ide`](https://github.com/ngolacloud/dxtutor-ide/issues) proposing the language and an outline
of units. Official courses must pass `--strict` validation, have a `concepts` text for every
unit, and cover Basic, Intermediate and Advanced units.
