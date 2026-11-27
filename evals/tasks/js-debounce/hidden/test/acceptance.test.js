import test from "node:test";
import assert from "node:assert/strict";
import { debounce } from "../src/debounce.js";

function fakeTimers() {
  let now = 0, id = 0;
  const pending = new Map();
  return {
    setTimeout: (f, ms) => { pending.set(++id, { f, at: now + ms }); return id; },
    clearTimeout: (i) => { pending.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) { pending.delete(i); t.f(); }
      }
    },
  };
}

test("calls once with the latest arguments after the quiet period", () => {
  const t = fakeTimers(), calls = [];
  const d = debounce((q) => calls.push(q), 100, t);
  d("a"); t.advance(50); d("ab"); t.advance(50); d("abc");
  assert.deepEqual(calls, []);
  t.advance(99);
  assert.deepEqual(calls, []);
  t.advance(1);
  assert.deepEqual(calls, ["abc"]);
  t.advance(1000);
  assert.deepEqual(calls, ["abc"]);
});

test("cancel and flush", () => {
  const t = fakeTimers(), calls = [];
  const d = debounce((q) => calls.push(q), 100, t);
  d("x"); d.cancel(); t.advance(200);
  assert.deepEqual(calls, []);
  d("y"); d.flush();
  assert.deepEqual(calls, ["y"]);
  t.advance(200);
  assert.deepEqual(calls, ["y"], "flush does not call twice");
  d.flush();
  assert.deepEqual(calls, ["y"], "nothing pending, nothing to flush");
});
