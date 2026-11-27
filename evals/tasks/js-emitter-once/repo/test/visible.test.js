import test from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../src/emitter.js";

test("on and emit", () => {
  const e = new Emitter(), got = [];
  e.on("x", (v) => got.push(v));
  e.emit("x", 1);
  assert.deepEqual(got, [1]);
});
