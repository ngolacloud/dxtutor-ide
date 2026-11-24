# Go: From Zero to Backend

The official Go course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. It has 26 units and 122 steps, from your first `fmt.Println` to structs,
interfaces, errors, SQLite with `database/sql`, goroutines and channels, and classic data
structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function, judged by hidden tests (`go test`).

| Level | Units |
|---|---|
| Basic | hello & fmt, variables & types, control flow, loops, functions & multiple returns |
| Intermediate | structs & methods, interfaces, slices & maps, errors, goroutines & packages, databases (6 units) |
| Advanced | goroutines & WaitGroup, channels, select & timeouts, Mutex & worker pools, data structures & algorithms (6 units) |

## Install

The course ships with dxtutor. Installing this plugin updates it to the latest version:

```sh
dxt plugin install go            # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/go/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Check your changes with `dxt plugin validate . --strict`.
