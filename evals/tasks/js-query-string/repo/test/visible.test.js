import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery } from "../src/query.js";

test("simple", () => {
  assert.deepEqual(parseQuery("?a=1&b=2"), { a: "1", b: "2" });
});
