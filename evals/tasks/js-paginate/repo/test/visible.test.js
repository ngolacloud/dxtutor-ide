import test from "node:test";
import assert from "node:assert/strict";

test("module loads", async () => {
  await import("../src/paginate.js");
  assert.ok(true);
});
