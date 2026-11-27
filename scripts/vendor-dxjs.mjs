#!/usr/bin/env node
// vendor-dxjs.mjs — rebuilds the support files of the Dxjs course (courses/dxjs/support/), so the
// evaluator grades offline against the REAL library: dxjs is not on npm, its releases are GitHub
// release tarballs (https://github.com/ngolacloud/dxjs/releases/tag/v1.3.0).
//
// Usage:  node scripts/vendor-dxjs.mjs <dxjs checkout> <folder with the release tarballs> [--check]
//
//   gh release download v1.3.0 -R ngolacloud/dxjs -D /tmp/dxjs-rel \
//     -p 'dxjs-core-*' -p 'dxjs-dom-*' -p 'dxjs-component-*' -p 'dxjs-ui-*' -p 'dxjs-query-*' -p 'dxjs-forms-*'
//
// Inputs, all pinned:
//   - the six release tarballs the cdn bundle is made of (sha256 below);
//   - cdn/dxjs.entry.ts of the tag (`git show v1.3.0:…`, read-only on the checkout);
//   - esbuild 0.28.2 and happy-dom 15.11.7 from the checkout's node_modules (its package-lock.json).
// It writes:
//   support/dxjs-1.3.0.js            the cdn bundle: cdn/dxjs.entry.ts over the released packages,
//                                    with the options of dxjs's scripts/build.mjs. Its sha256 must
//                                    equal DXJS_SHA256 (the same bytes as dxjs's own cdn/dxjs.js)
//   support/<pkg>/index.js           one shim per @dxjs package the course imports: exactly the
//   support/<pkg>/package.json       RUNTIME names of that released package's src/index.ts
//   support/happy-dom-15.11.7.js     happy-dom bundled into one ESM file (the DOM steps)
//   support/happy-dom/package.json
// With --check it rebuilds into a temp folder and fails if anything differs from what is committed.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "v1.3.0";
const VERSION = "1.3.0";
const TARBALLS = {
  core: "6dec569bb4bcb276e5372afb58780195a343043704ef68d2c96d01064c5b2369",
  dom: "b0d5b923b773c8248143706d534ba73fedeeaf58d31c4115707b3ed0677953f1",
  component: "7b3d2b3c1c4c6be94ee0df2e2d07d5fd4e602a91841ab3f06e68a67dfdbae0bc",
  ui: "565820fe744d1288a6a30c5b0e603cf27f3c0b8610c5f4e84ae48800452e0e87",
  query: "cb04b037e59b1ff8d504af9f197ef0579921d404c4bf4d92f597f8e0327ef7e7",
  forms: "c8341441d6d545d353c001e41ef89de5153ff8530d0cc5291ae66bf383ec72d1",
};
const DXJS_SHA256 = "5c6501507df4a8379b1771e0765acd7573306a6614a2b0f6bede9ac5072fb2f1";
const ESBUILD_VERSION = "0.28.2";
const HD_VERSION = "15.11.7";
/** The packages the course imports (`ui` is in the bundle but no step uses it). */
const SHIMS = ["core", "dom", "component", "query", "forms"];

const [checkout, tarDir, flag] = process.argv.slice(2);
if (!checkout || !tarDir) {
  console.error("usage: node scripts/vendor-dxjs.mjs <dxjs checkout> <release tarballs folder> [--check]");
  process.exit(2);
}
const DXJS = resolve(checkout);
const HERE = dirname(fileURLToPath(import.meta.url));
const COMMITTED = join(HERE, "..", "courses", "dxjs", "support");
const check = flag === "--check";
const OUT = check ? mkdtempSync(join(tmpdir(), "dxjs-support-")) : COMMITTED;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const req = createRequire(join(DXJS, "package.json"));
const esbuildVersion = JSON.parse(readFileSync(req.resolve("esbuild/package.json"), "utf8")).version;
if (esbuildVersion !== ESBUILD_VERSION) throw new Error(`esbuild ${esbuildVersion}, want ${ESBUILD_VERSION}`);
const { build } = req("esbuild");

// 1. A throwaway project: the tag's cdn entry + the released packages in node_modules/@dxjs.
const work = mkdtempSync(join(tmpdir(), "dxjs-rel-"));
mkdirSync(join(work, "cdn"));
writeFileSync(
  join(work, "cdn", "dxjs.entry.ts"),
  execFileSync("git", ["-C", DXJS, "show", `${TAG}:cdn/dxjs.entry.ts`]),
);
for (const [pkg, want] of Object.entries(TARBALLS)) {
  const file = join(resolve(tarDir), `dxjs-${pkg}-${VERSION}.tgz`);
  const got = sha256(readFileSync(file));
  if (got !== want) throw new Error(`${file}: sha256 ${got}, want ${want}`);
  const dest = join(work, "node_modules", "@dxjs", pkg);
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xzf", file, "-C", dest, "--strip-components=1"]);
}

// 2. The cdn bundle, with the options of dxjs's scripts/build.mjs.
mkdirSync(OUT, { recursive: true });
const bundle = join(OUT, `dxjs-${VERSION}.js`);
await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "es2021",
  legalComments: "none",
  absWorkingDir: work,
  entryPoints: [join(work, "cdn", "dxjs.entry.ts")],
  outfile: bundle,
});
const bundleSha = sha256(readFileSync(bundle));
if (bundleSha !== DXJS_SHA256) throw new Error(`cdn bundle sha256 ${bundleSha}, want ${DXJS_SHA256}`);

// 3. The names the bundle exports (its final `export{a as b,…}`).
const exported = new Set(
  [...readFileSync(bundle, "utf8").matchAll(/export\{([^}]*)\}/g)]
    .flatMap((m) => m[1].split(","))
    .map((e) => e.trim().split(/\s+as\s+/).pop()),
);

// 4. One shim per package: exactly the runtime names of the released src/index.ts.
function runtimeExports(file) {
  const ts = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
  const names = new Set();
  // `export * from "./async.ts"` (the async helpers of @dxjs/dom 1.3.0): that file's names too.
  for (const m of ts.matchAll(/export\s*\*\s*from\s*["'](\.[^"']+)["']/g)) {
    for (const n of runtimeExports(join(dirname(file), m[1]))) names.add(n);
  }
  for (const m of ts.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of ts.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const p = part.trim();
      if (p && !p.startsWith("type ")) names.add(p.split(/\s+as\s+/).pop());
    }
  }
  return [...names].sort();
}
for (const pkg of SHIMS) {
  const names = runtimeExports(join(work, "node_modules", "@dxjs", pkg, "src", "index.ts"));
  const missing = names.filter((n) => !exported.has(n));
  if (missing.length) throw new Error(`@dxjs/${pkg}: not in the cdn bundle: ${missing.join(", ")}`);
  mkdirSync(join(OUT, pkg), { recursive: true });
  writeFileSync(
    join(OUT, pkg, "index.js"),
    `// @dxjs/${pkg} ${VERSION} for the dxtutor Dxjs course: the runtime names of the released\n` +
      `// package's src/index.ts, re-exported from the dxjs cdn bundle. Generated by scripts/vendor-dxjs.mjs.\n` +
      `export {\n${names.map((n) => `  ${n},`).join("\n")}\n} from "../../.dxjs/dxjs.js";\n`,
  );
  writeFileSync(
    join(OUT, pkg, "package.json"),
    JSON.stringify({ name: `@dxjs/${pkg}`, version: VERSION, type: "module", exports: "./index.js" }, null, 2) + "\n",
  );
}

// 5. happy-dom in one ESM file; its CommonJS dependencies get a real `require` for node builtins.
const hdPkg = JSON.parse(readFileSync(join(DXJS, "node_modules", "happy-dom", "package.json"), "utf8"));
if (hdPkg.version !== HD_VERSION) throw new Error(`happy-dom ${hdPkg.version} in the checkout, want ${HD_VERSION}`);
const hd = join(OUT, `happy-dom-${HD_VERSION}.js`);
await build({
  bundle: true,
  minify: true,
  format: "esm",
  platform: "node",
  target: "node22",
  legalComments: "none",
  absWorkingDir: DXJS,
  entryPoints: [join(DXJS, "node_modules", "happy-dom", "lib", "index.js")],
  outfile: hd,
  banner: { js: 'import { createRequire as __dxtCreateRequire } from "node:module";const require = __dxtCreateRequire(import.meta.url);' },
});
mkdirSync(join(OUT, "happy-dom"), { recursive: true });
writeFileSync(
  join(OUT, "happy-dom", "package.json"),
  JSON.stringify({ name: "happy-dom", version: HD_VERSION, type: "module", exports: "./index.js" }, null, 2) + "\n",
);

rmSync(work, { recursive: true, force: true });
console.log(`dxjs-${VERSION}.js        sha256 ${bundleSha}`);
console.log(`happy-dom-${HD_VERSION}.js  sha256 ${sha256(readFileSync(hd))}`);

if (check) {
  const files = [`dxjs-${VERSION}.js`, `happy-dom-${HD_VERSION}.js`, "happy-dom/package.json"];
  for (const pkg of SHIMS) files.push(`${pkg}/index.js`, `${pkg}/package.json`);
  const differ = files.filter(
    (f) => !existsSync(join(COMMITTED, f)) || sha256(readFileSync(join(COMMITTED, f))) !== sha256(readFileSync(join(OUT, f))),
  );
  rmSync(OUT, { recursive: true, force: true });
  if (differ.length) {
    console.error(`differs from courses/dxjs/support: ${differ.join(", ")}`);
    process.exit(1);
  }
  console.log("courses/dxjs/support is up to date");
}
