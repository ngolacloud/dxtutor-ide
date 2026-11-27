# Support files

Read-only files that the evaluator writes next to every step's files when it grades a drill,
a challenge or a project step. The course declares them once, in the `[support]` table of
`courses/dxjs.toml` (path in the work folder → file here). They make grading work **offline**
against the real dxjs: the library is not on npm.

| File | Written to | What it is |
|---|---|---|
| `dxjs-1.3.0.js` | `node_modules/.dxjs/dxjs.js` | dxjs 1.3.0's `cdn/dxjs.js` bundle (core, dom, component, ui, query, forms) |
| `core/`, `dom/`, `component/`, `query/`, `forms/` | `node_modules/@dxjs/<pkg>/` | one shim per package: exactly the runtime names of that package's `src/index.ts`, re-exported from the bundle, so `import { signal } from "@dxjs/core"` works as in a real project |
| `happy-dom-15.11.7.js`, `happy-dom/` | `node_modules/happy-dom/` | happy-dom 15.11.7 (the version dxjs's own DOM tests use) bundled into one ES module |
| `dxtutor-dom/` | `node_modules/@dxtutor/dom/` | written for this course: installs the happy-dom DOM on `globalThis` the way dxjs's `packages/dom/test/setup.ts` does, plus `body()`, `fire()` and `typeInto()` for the hidden tests |

## Where they come from

- **`dxjs-1.3.0.js`**, sha256 `5c6501507df4a8379b1771e0765acd7573306a6614a2b0f6bede9ac5072fb2f1`
  (68,888 bytes). The cdn bundle is not a release asset, so it is rebuilt from the official
  [v1.3.0 release](https://github.com/ngolacloud/dxjs/releases/tag/v1.3.0) tarballs
  (`dxjs-{core,dom,component,ui,query,forms}-1.3.0.tgz`, sha256 pinned in the script) and the
  tag's `cdn/dxjs.entry.ts` (tag commit `8aa9f77`), with esbuild 0.28.2 and the exact options of
  dxjs's `scripts/build.mjs`. The result is byte-identical to the `cdn/dxjs.js` that `npm run
  build` produces at the tag. `@dxjs/stream` (new in 1.3.0) is not in the cdn entry, and no step
  uses it, so it has no shim.
- **`happy-dom-15.11.7.js`**, sha256 `6ea4c9f2ccd9e1af1b55bff550022ff7fcae8e4da1fd7c54bfe57459637ab5e8`,
  happy-dom 15.11.7 and its dependencies (entities 4.5.0, webidl-conversions 7.0.0,
  whatwg-mimetype 3.0.0) as pinned by dxjs's `package-lock.json`, bundled with esbuild 0.28.2.

To rebuild them, or to check that the committed files are what the script produces:

```sh
gh release download v1.3.0 -R ngolacloud/dxjs -D /tmp/dxjs-rel \
  -p 'dxjs-core-*' -p 'dxjs-dom-*' -p 'dxjs-component-*' -p 'dxjs-ui-*' -p 'dxjs-query-*' -p 'dxjs-forms-*'
node scripts/vendor-dxjs.mjs <dxjs checkout> /tmp/dxjs-rel --check   # from the dxtutor-ide root
```

Licenses: see [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).
