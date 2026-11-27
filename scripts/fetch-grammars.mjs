#!/usr/bin/env node
// Re-fetches the bundled TextMate grammars (languages/grammars/manifest.json) from the pinned
// commit of the VS Code repository and verifies them (LSP P5).
//
//   node scripts/fetch-grammars.mjs            download each file, check its sha256 and size against
//                                              the manifest AND against the committed copy (no writes)
//   node scripts/fetch-grammars.mjs --offline  only check the committed copies against the manifest
//   node scripts/fetch-grammars.mjs --write    as the default, then write the verified downloads
//                                              (restores a missing or edited file)
//   node scripts/fetch-grammars.mjs --update   after changing `source.commit` (or adding an entry):
//                                              download, write the files and rewrite sha256/bytes in
//                                              the manifest. Review the diff: this trusts the network.
//
// Exit code 1 on any mismatch. Needs Node 18+ (global fetch); no dependencies.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "languages", "grammars");
const MANIFEST = join(DIR, "manifest.json");
const args = new Set(process.argv.slice(2));
const offline = args.has("--offline");
const write = args.has("--write");
const update = args.has("--update");
for (const a of args) if (!["--offline", "--write", "--update"].includes(a)) fail(`unknown option ${a}`);
if (offline && (write || update)) fail("--offline cannot be combined with --write/--update");

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const { source, grammars } = manifest;
if (!/^[0-9a-f]{40}$/.test(source?.commit ?? "")) fail("manifest: source.commit must be a full 40-character commit hash");
const repo = new URL(source.repository).pathname.replace(/^\/|\.git$/g, "");

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
let bad = 0;
const problem = (msg) => {
  bad++;
  console.error(`✗ ${msg}`);
};

for (const g of grammars) {
  const local = join(DIR, g.file);
  if (!/^[\w.-]+\.tmLanguage\.json$/.test(g.file)) {
    problem(`${g.file}: the file name must be <name>.tmLanguage.json`);
    continue;
  }
  if (offline) {
    if (!existsSync(local)) {
      problem(`${g.file}: missing`);
      continue;
    }
    check(g, readFileSync(local), "committed copy");
    continue;
  }
  const url = `https://raw.githubusercontent.com/${repo}/${source.commit}/${g.path}`;
  const res = await fetch(url);
  if (!res.ok) {
    problem(`${g.file}: ${url} answered ${res.status}`);
    continue;
  }
  const body = Buffer.from(await res.arrayBuffer());
  let raw;
  try {
    raw = JSON.parse(body.toString("utf8"));
  } catch (e) {
    problem(`${g.file}: the download is not JSON (${e.message})`);
    continue;
  }
  if (raw.scopeName !== g.scopeName) problem(`${g.file}: scopeName ${raw.scopeName} ≠ manifest ${g.scopeName}`);
  if (update) {
    g.sha256 = sha256(body);
    g.bytes = body.length;
    writeFileSync(local, body);
    console.log(`↻ ${g.file}  ${g.bytes} bytes  ${g.sha256}`);
    continue;
  }
  if (!check(g, body, "download")) continue;
  if (existsSync(local)) {
    if (!readFileSync(local).equals(body)) {
      if (write) console.log(`  ${g.file}: the committed copy differs from upstream — rewritten`);
      else problem(`${g.file}: the committed copy differs from the verified download (run with --write to restore it)`);
    }
  } else if (!write) problem(`${g.file}: not committed (run with --write)`);
  if (write) writeFileSync(local, body);
}

if (update) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
const total = grammars.reduce((n, g) => n + g.bytes, 0);
if (bad) fail(`${bad} problem(s)`);
console.log(`✓ ${grammars.length} grammars verified (${total} bytes) — ${source.repository} @ ${source.commit.slice(0, 12)}${offline ? " (offline: committed copies only)" : ""}`);

function check(g, buf, what) {
  const h = sha256(buf);
  if (h !== g.sha256 || buf.length !== g.bytes) {
    problem(`${g.file}: ${what} has sha256 ${h} (${buf.length} bytes); the manifest pins ${g.sha256} (${g.bytes} bytes)`);
    return false;
  }
  console.log(`✓ ${g.file}  ${g.bytes} bytes  ${what} matches`);
  return true;
}

function fail(msg) {
  console.error(`fetch-grammars: ${msg}`);
  process.exit(1);
}
