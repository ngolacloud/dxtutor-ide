# Rust: From Zero to Confident

The official Rust course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. It has 32 units and 159 steps, from your first `println!` to ownership,
traits and generics, lifetimes, threads and channels, SQLite with `rusqlite`, and classic
data structures and algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function, judged by hidden tests (`cargo test`).

| Level | Units |
|---|---|
| Basic | hello & printing, variables & types, control flow, loops, functions |
| Intermediate | ownership & borrowing, collections, structs & enums, error handling, databases (6 units) |
| Advanced | traits, generics, trait bounds, associated types, dispatch, lifetimes, Send/Sync, threads, channels, shared state, parallelism, data structures & algorithms (6 units) |

## Install

The course ships with dxtutor. Installing this plugin updates it to the latest version:

```sh
dxt plugin install rust          # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/rust/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Check your changes with `dxt plugin validate . --strict`.
