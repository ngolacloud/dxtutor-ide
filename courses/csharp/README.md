# C#: From Zero to Confident

The official C# course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. Modern **C# 12 on .NET 8**, in 34 units and 170 steps: from your first
program to collections, classes, records and structs, exceptions, generics, delegates and
LINQ, a block of everyday production skills, pattern matching, iterators, async/await,
concurrency, cancellation and channels, spans, and classic data structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a class or method, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello & top-level statements, variables & types, strings, control flow, loops, methods |
| Intermediate | arrays & lists, dictionaries & sets, classes, inheritance & interfaces, records & structs, exceptions, generics, delegates & lambdas, LINQ; **production C#**: nullable reference types, dates & times, files & streams, text & regex, equality & ordering, immutability |
| Advanced | pattern matching, iterators & yield, async/await, concurrency, cancellation & channels, spans, sorted collections, data structures & algorithms (6 units) |

Where some official courses have a SQLite database track, C# has the production block
instead, because SQLite needs a NuGet package and the course uses only the .NET SDK.

Grading needs the **.NET 8 SDK** (`dotnet`). It compiles with the Roslyn compiler inside
the SDK, with no project, no MSBuild and no NuGet, in about a second.

## Hidden tests

```csharp
Test("adds small numbers", () => Equal(Calc.Add(2, 3), 5));
Test("rejects negatives", () => Throws<ArgumentException>(() => Calc.Sqrt(-1)));
Test("async works", async () => Equal(await Fetcher.GetAsync(1), "one"));
```

The learner's code (types only) and the tests are two files of one program. The harness
methods are members, so they never clash with the learner's names.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install csharp        # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/csharp/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`.
