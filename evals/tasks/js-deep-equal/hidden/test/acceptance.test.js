import test from "node:test";
import assert from "node:assert/strict";
import { deepEqual } from "../src/equal.js";

test("dates, NaN, arrays vs objects, undefined keys", () => {
  assert.equal(deepEqual(new Date(5), new Date(5)), true);
  assert.equal(deepEqual(new Date(5), new Date(6)), false);
  assert.equal(deepEqual(NaN, NaN), true);
  assert.equal(deepEqual([1, 2], { 0: 1, 1: 2 }), false);
  assert.equal(deepEqual({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(deepEqual({ a: { d: [new Date(1), { x: NaN }] } }, { a: { d: [new Date(1), { x: NaN }] } }), true);
  assert.equal(deepEqual([1, [2, 3]], [1, [2, 4]]), false);
  assert.equal(deepEqual(null, {}), false);
  assert.equal(deepEqual(0, -0), true);
  assert.equal(deepEqual("1", 1), false);
});
