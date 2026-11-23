# C++: From Zero to Confident

The official C++ course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. Modern **C++20**, in 34 units and 170 steps: from your first program to
references and pointers, RAII and smart pointers, move semantics, the SQLite C API wrapped
in RAII, templates and concepts, threads, atomics and futures, and classic data structures
and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function or class, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello & iostream, variables & types, strings, control flow, loops, functions |
| Intermediate | references & pointers, vectors & arrays, maps & sets, classes, RAII, smart pointers, errors, algorithms & lambdas, move semantics, databases (6 units) |
| Advanced | function & class templates, concepts, operators & iterators, threads, mutexes & atomics, async & futures, data structures & algorithms (6 units) |

Grading needs `g++` with C++20 (GCC 13 or newer), and the SQLite development files for the
database units (`libsqlite3-dev` on Debian/Ubuntu).

## Hidden tests

Challenges are graded by a tiny built-in test framework, so nothing has to be installed:

```cpp
TEST(adds_small_numbers) {
    CHECK_EQ(add(2, 3), 5);
    CHECK(add(-1, 1) == 0);
}
```

The student's file is `#include`d by the test file, so challenge code must not define `main`.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install cpp           # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/cpp/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request:

```sh
dxt plugin validate . --strict
dxt plugin test .                # compiles every drill and grades every challenge for real
```
