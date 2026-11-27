import test from "node:test";
import assert from "node:assert/strict";
import { Emitter } from "../src/emitter.js";

test("once runs once and can be removed with off", () => {
  const e = new Emitter(), got = [];
  const f = (v) => got.push(v);
  e.once("x", f);
  e.emit("x", 1);
  e.emit("x", 2);
  assert.deepEqual(got, [1]);
  e.once("y", f).off("y", f);
  e.emit("y", 3);
  assert.deepEqual(got, [1]);
});

test("changes during an emit do not skip or double-call", () => {
  const e = new Emitter(), got = [];
  const a = () => { got.push("a"); e.off("x", a); };
  const b = () => got.push("b");
  const c = () => { got.push("c"); e.on("x", () => got.push("new")); };
  e.on("x", a).on("x", b).on("x", c);
  e.emit("x");
  assert.deepEqual(got, ["a", "b", "c"]);
  e.emit("x");
  assert.deepEqual(got, ["a", "b", "c", "b", "c", "new"]);
});

test("a listener removed by an earlier one in the same emit is not called", () => {
  const e = new Emitter(), got = [];
  const b = () => got.push("b");
  e.on("x", () => { got.push("a"); e.off("x", b); }).on("x", b);
  e.emit("x");
  assert.deepEqual(got, ["a"]);
});
