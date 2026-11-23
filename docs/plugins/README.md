# Writing a course plugin for dxtutor

A **course plugin** adds a language track to dxtutor's Learning Track. It is a GitHub
repository with a manifest and one or more course files. Course files are data, not code.
You don't need to touch the dxtutor source code to publish a course.

- Official courses live in the [`dxtutor-courses`](https://github.com/dxtutor-courses)
  GitHub organization, one repository per language.
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
  "repository": "https://github.com/dxtutor-courses/kotlin",
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

It needs the language toolchain on your machine (for example `python3`, `go`, `cargo`). Run
it before every release.

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
| `kotlin` | the official course, `github.com/dxtutor-courses/kotlin` |
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
| TypeScript | descriptor | `dxt.test("name", () => { dxt.equal(actual, expected); })` (deep equality; tests may be `async`). The student file and tests run as one ES module, so never import the student file | `node` 22.18+ (found on PATH or via nvm/Volta/fnm) |
| SQL (SQLite) | descriptor | Python `unittest` cases using the prelude helpers `query(setup)` → `(columns, rows)`, `script(setup)` → connection, `connect(setup)` | `python3` (its built-in SQLite) |
| Java | descriptor | the body of a method using `test("name", () -> equal(actual, expected))`, plus `check`, `near` and `assertThrows`. Imports go one per line at the start. The learner's classes are compiled with the tests, so they have no `main` and no `package` | JDK 21 (`java`) |
| C | descriptor | a `main` that `assert`s (the test file `#include`s the student file) | `cc` |

A language without a native runner uses a **descriptor**: a small TOML file that says how
to scaffold the files and which commands run the program, the tests (exit 0 = passed) and
the diagnostics. Built-in descriptors live in `crates/tutor-eval/src/plugin.rs`. You can
drop your own into `~/.config/dxtutor/plugins/<language>.toml` to grade a new language
without rebuilding dxtutor; the format is documented at the top of that file.

If no runner supports the language, the app shows the evaluator's error instead of
pretending the tests passed.

## Contributing an official course

Open an issue in the `dxtutor-courses` organization proposing the language and an outline
of units. Official courses must pass `--strict` validation, have a `concepts` text for every
unit, and cover Basic, Intermediate and Advanced units.
