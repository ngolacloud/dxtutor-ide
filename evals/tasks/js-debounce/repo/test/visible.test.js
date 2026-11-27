import test from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/debounce.js";

test("returns a function", () => {
  assert.equal(typeof debounce(() => {}, 10), "function");
});
