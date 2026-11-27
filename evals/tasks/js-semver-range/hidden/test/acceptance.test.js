import test from "node:test";
import assert from "node:assert/strict";
import { satisfies } from "../src/semver.js";

test("ranges", () => {
  const yes = [["1.2.3", "1.2.3"], ["1.9.0", "^1.2.3"], ["0.2.9", "^0.2.3"], ["1.2.9", "~1.2.3"], ["1.5.0", ">=1.0.0 <2.0.0"], ["3.0.0", "^1.0.0 || ^3.0.0"], ["9.9.9", "*"], ["1.0.1", ">1.0.0"], ["2.0.0", "<=2.0.0"]];
  const no = [["2.0.0", "^1.2.3"], ["0.3.0", "^0.2.3"], ["1.3.0", "~1.2.3"], ["1.2.2", "^1.2.3"], ["2.0.0", ">=1.0.0 <2.0.0"], ["2.1.0", "^1.0.0 || ^3.0.0"], ["1.0.0", ">1.0.0"]];
  for (const [v, r] of yes) assert.equal(satisfies(v, r), true, `${v} ${r}`);
  for (const [v, r] of no) assert.equal(satisfies(v, r), false, `${v} ${r}`);
});

test("invalid input", () => {
  for (const [v, r] of [["1.2", "^1.0.0"], ["1.2.3", "^1.x"], ["a.b.c", "*"], ["1.0.0", "=>1.0.0"]]) {
    assert.throws(() => satisfies(v, r), TypeError, `${v} ${r}`);
  }
});
