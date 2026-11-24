# Kotlin: From Zero to Confident

The official Kotlin course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. Modern Kotlin 2.x on the JVM, in 34 units and 170 steps: from your first
program to null safety, collections, data and sealed classes, extensions and higher-order
functions, a block of everyday production idioms, coroutines, Flow and channels, DSL
builders, operators and value classes, and classic data structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function or class, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello, variables & types, strings, if/when, loops & ranges, functions |
| Intermediate | null safety, collections, collection operations, classes, data classes, inheritance & interfaces, sealed & when, extensions, higher-order functions; **production Kotlin**: scope functions, errors & Result, generics & variance, sequences, objects & enums, delegation |
| Advanced | coroutines, structured concurrency, Flow, channels, DSL builders, operators, value classes, data structures & algorithms (6 units) |

Where the other official courses have a SQLite database track, Kotlin has the production
block instead, because the JVM ships no SQLite driver and the course uses only the Kotlin
stdlib, `kotlinx.coroutines` and the JDK.

Grading needs `kotlinc` (Kotlin 2.x: snap, SDKMAN or on the PATH) and a JDK. The
`kotlinx-coroutines` jar that ships with the compiler is put on the classpath
automatically. Each compile starts a fresh compiler JVM, so grading a step takes a few
seconds.

## Hidden tests

```kotlin
test("adds small numbers") { equal(add(2, 3), 5) }
test("rejects negatives") { assertThrows<IllegalArgumentException> { sqrtOf(-1.0) } }
test("suspending code") { runBlocking { equal(fetchAll(listOf(1, 2)), listOf(1, 2)) } }
```

The harness functions are members of the test suite, so they never clash with the learner's
names. The learner's code is compiled with the tests, so it has no `main` and no `package`.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install kotlin        # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/kotlin/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`.
