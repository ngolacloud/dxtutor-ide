# Swift: From Zero to Confident

The official Swift course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. **Swift 6** (language mode 6, with strict concurrency checking), in 34 units
and 170 steps: from your first program to optionals, collections, structs and classes, enums
with associated values, protocols, closures and errors, a block of everyday production
skills, async/await, task groups, actors, async sequences, result builders, ARC, and classic
data structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function or type, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello, variables & types, strings, control flow & guard, loops, functions |
| Intermediate | optionals, collections, collection operations, structs, classes, enums, protocols, closures, errors; **production Swift**: generics, Codable & JSON, dates, text parsing & Regex, Equatable/Hashable/Comparable, value semantics |
| Advanced | async/await, task groups, actors & Sendable, async sequences, result builders, ARC & memory, sequences & iterators, data structures & algorithms (6 units) |

Where some official courses have a SQLite database track, Swift has the production block
instead, because Swift on Linux ships no SQLite module and the course uses only the stdlib
and Foundation.

Grading needs a **Swift 6 toolchain** (`swiftc`). dxtutor also finds a toolchain installed
with swiftly. The course runs on Linux, so there is no UIKit or AppKit: everything uses the
standard library and Foundation.

## Hidden tests

```swift
test("adds small numbers") { self.equal(add(2, 3), 5) }
test("rejects negatives") { self.assertThrows { _ = try sqrtOf(-1) } }
test("async works") { self.equal(await later(7), 7) }
```

The learner's code (declarations only) and the tests are two files of one program. The
harness methods are members, so they never clash with the learner's names.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install swift         # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/swift/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`.
