import test from "node:test";
import assert from "node:assert/strict";
import { render } from "../src/template.js";

test("simple", () => {
  assert.equal(render("Hi {{name}}", { name: "Ana" }), "Hi Ana");
});
