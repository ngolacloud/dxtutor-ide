# Java: From Zero to Confident

The official Java course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. Modern **Java 21**, in 34 units and 170 steps: from your first program to
collections, classes, interfaces, records and enums, exceptions, generics, lambdas and
streams, a block of everyday production skills, sealed types and pattern matching,
executors, `CompletableFuture`, virtual threads, and classic data structures and
algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a class or method, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello & main, variables & types, strings, control flow, loops, methods |
| Intermediate | arrays & lists, maps & sets, classes, inheritance & interfaces, records & enums, exceptions, generics, lambdas, streams; **production Java**: Optional, java.time, NIO files, text & regex, equality & ordering, immutability |
| Advanced | sealed types & pattern matching, iterators, threads & executors, synchronization, CompletableFuture, virtual threads, sorted collections, data structures & algorithms (6 units) |

Where the other official courses have a SQLite database track, Java has the production
block instead, because the JDK ships no SQLite driver and the course uses the JDK only.

Grading needs a **JDK 21** (`java` on the PATH, or in `/usr/lib/jvm` or SDKMAN). It uses
the single-file source launcher, so no Maven or Gradle is needed.

## Hidden tests

The hidden tests are written with a tiny built-in harness:

```java
test("adds small numbers", () -> equal(Calc.add(2, 3), 5));
test("rejects negatives", () -> assertThrows(IllegalArgumentException.class, () -> Calc.sqrt(-1)));
```

The learner's classes and the tests are compiled together, so challenge code has no `main`
and no `package` line.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install java          # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/java/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`.
