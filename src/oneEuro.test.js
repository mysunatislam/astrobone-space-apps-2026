import test from "node:test";
import assert from "node:assert/strict";
import { OneEuroVector } from "./oneEuro.js";
test("one euro vector preserves constants and smooths a step", () => {
  const filter = new OneEuroVector();
  assert.deepEqual(filter.update([1, 2], 0), [1, 2]);
  assert.deepEqual(filter.update([1, 2], 33), [1, 2]);
  const result = filter.update([2, 3], 66);
  assert.ok(result[0] > 1 && result[0] < 2);
});
test("one euro rejects nonfinite output and resets after lost frames or dimensions", () => {
  const filter = new OneEuroVector(); filter.update([0], 1);
  assert.equal(filter.update([NaN], 2), null);
  assert.deepEqual(filter.update([8], 2000), [8]);
  assert.deepEqual(filter.update([2, 3], 2001), [2, 3]);
});
