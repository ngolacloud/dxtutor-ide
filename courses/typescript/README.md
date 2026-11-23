# TypeScript: From Zero to Confident

The official TypeScript course for the [dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide)
Learning Track. Modern TypeScript on Node.js, in 34 units and 170 steps: from your first
typed program to unions and narrowing, classes and generics, async code, SQLite with
`node:sqlite`, conditional and mapped types, the event loop, and classic data structures and
algorithms.

Every unit opens with a **concepts** reading text, then alternates:
- **concept**: a short focused explanation;
- **drill**: retype a complete program line by line, with a comment for every line;
- **challenge**: implement a function or class, judged by hidden tests.

| Level | Units |
|---|---|
| Basic | hello & console.log, variables & types, strings, control flow, loops, functions |
| Intermediate | arrays & tuples, objects & interfaces, unions & narrowing, classes, generics, maps & sets, errors, utility types, promises & async/await, databases (6 units) |
| Advanced | advanced generics, type-level programming, iterators & generators, functional programming, the event loop, async control, async iterators & events, data structures & algorithms (6 units) |

Grading needs **Node.js 22.18 or newer**, which runs TypeScript by stripping its types. No
`tsc` is required. dxtutor also finds a Node installed with nvm, Volta or fnm.

## Hidden tests

The student's file and the hidden tests run as one module, after a small harness:

```ts
dxt.test("adds small numbers", () => {
  dxt.equal(add(2, 3), 5);
});
dxt.test("works asynchronously", async () => {
  dxt.equal(await fetchAll([1, 2]), [1, 2]);
});
```

`dxt.equal` is a deep equality that understands arrays, objects, `Map` and `Set`.
`dxt.check(cond)` and `dxt.throws(fn)` complete the set.

## Install

The course ships with the dxtutor desktop app. Installing this plugin updates it to the
latest version:

```sh
dxt plugin install typescript    # or, in the app: Learning Track → Course plugins
```

## Contribute

Source of truth: `courses/typescript/` in the dxtutor repository. Format and rules:
`docs/plugins/README.md`. Before a pull request, run `dxt plugin validate . --strict` and
`dxt plugin test .`, and type-check every solution with `tsc --strict` (Node.js runs the code
without checking types).
