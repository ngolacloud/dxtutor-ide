import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/query.js";

test("repeated keys, spaces and escapes", () => {
  assert.deepEqual(parseQuery("tag=a&tag=b&q=red+shoes&name=Jo%C3%A3o&tag=c"), { tag: ["a", "b", "c"], q: "red shoes", name: "João" });
  assert.deepEqual(parseQuery("?flag&a=1&&b=x%3Dy"), { flag: "", a: "1", b: "x=y" });
  assert.deepEqual(parseQuery(""), {});
  assert.deepEqual(parseQuery("bad=%zz"), { bad: "%zz" });
});
