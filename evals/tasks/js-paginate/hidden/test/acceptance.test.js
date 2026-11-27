import test from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";

const xs = Array.from({ length: 23 }, (_, i) => i + 1);

test("pages", () => {
  assert.deepEqual(paginate(xs, 1, 10), { items: xs.slice(0, 10), page: 1, size: 10, total: 23, pages: 3 });
  assert.deepEqual(paginate(xs, "3", "10").items, [21, 22, 23]);
  assert.deepEqual(paginate(xs, 4, 10), { items: [], page: 4, size: 10, total: 23, pages: 3 });
  assert.deepEqual(paginate([], 1, 5), { items: [], page: 1, size: 5, total: 0, pages: 1 });
});

test("invalid page or size", () => {
  for (const [p, s] of [[0, 10], [1, 0], [1, 101], ["x", 10], [1.5, 10], [1, "2.5"], [-1, 5]]) {
    assert.throws(() => paginate(xs, p, s), RangeError, `${p} ${s}`);
  }
});
