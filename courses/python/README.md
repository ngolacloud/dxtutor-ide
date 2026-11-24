# Python: From Zero to Confident

The official Python course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. It has 34 units and 170 steps, from your first `print` to classes,
dataclasses and generators, SQLite with the standard-library `sqlite3`, decorators,
threads, asyncio and multiprocessing, and classic data structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function or class, judged by hidden `unittest` tests.

| Level | Units |
|---|---|
| Basic | hello & print, variables & types, strings & f-strings, control flow, loops, functions |
| Intermediate | lists & tuples, dicts & sets, comprehensions, exceptions, files, classes, dataclasses & type hints, generators, modules & testing, databases (6 units) |
| Advanced | decorators, closures & functools, dunder methods & protocols, threads, queues & pools, asyncio, parallelism, data structures & algorithms (6 units) |

Requires Python 3.12 (`python3`) for grading. Everything uses the standard library only.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install python        # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/python/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request:

```sh
dxt plugin validate . --strict
dxt plugin test .                # runs every drill and grades every challenge for real
```
