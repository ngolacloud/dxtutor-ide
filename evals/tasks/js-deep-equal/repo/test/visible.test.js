import test from "node:test";
import assert from "node:assert/strict";
import { deepEqual } from "../src/equal.js";

test("objects", () => {
  assert.equal(deepEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
});
