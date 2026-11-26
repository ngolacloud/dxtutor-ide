# Dxjs: Reactive UIs from Signals Up

The official [dxjs](https://ngolacloud.github.io/dxjs/) course for the
[dxtutor IDE](https://github.com/ngolacloud/dxtutor-ide) Learning Track, in the
**Frameworks & tools** section. dxjs is NgolaCloud's fine-grained reactive UI engine: signals,
no Virtual DOM, components that run once, safe by construction under a strict CSP.

12 units, 45 steps, from the first signal to a small app:

| Level | Units |
|---|---|
| Basic | signals, computeds, effects |
| Intermediate | batch and untrack, the owner tree, context and error boundaries, a store in modules (project), `@dxjs/query`, `@dxjs/forms` (project) |
| Advanced | `html` templates and `render`, components and keyed lists (project), a todo app (project) |

Every unit opens with a **concepts** reading text, then a concept step, drills (retype a
complete program, a comment for every line) and a challenge judged by hidden tests. Project
steps span several files and are judged by hidden `node:test` files.

## Requirements

**Node.js 22.18 or newer** (it runs TypeScript by stripping types; no `tsc` needed). dxtutor
also finds a Node installed with nvm, Volta or fnm. Nothing else: the course brings dxjs 1.2.0
and a DOM for Node with it ([`support/`](support/README.md)), so grading works offline.

The course is graded by dxtutor's TypeScript evaluator:

- single-file challenges: the hidden tests use `dxt.test("name", () => { dxt.equal(a, b); })`
  and run in the same module as your file;
- project steps: every hidden `*.test.ts` runs with `node --test`.

## Install

Built into dxtutor. To install this repository's version on top of it:

```sh
dxt plugin install dxjs          # or ngolacloud/dxtutor-course-dxjs@v1.0.0
```

## Check the content

```sh
dxt plugin validate . --strict
dxt plugin test .                # every solution passes, every starter fails
```

License: MIT OR Apache-2.0 (third-party code in `support/`: see its notices).
