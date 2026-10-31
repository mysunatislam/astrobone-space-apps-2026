import test from "node:test";
import assert from "node:assert/strict";
import { compareRespiratoryReference } from "./respiratoryValidation.js";

const fixture = () => ({
  schema: "astrobone-respiratory-validation-v1", synthetic: true,
  reference: { instrument: "Synthetic reference for engineering tests", clockOffsetMs: 1000 },
  pairs: [2, -2, null].map((difference, i) => ({ subjectId: i ? "P02" : "P01", captureId: `capture-${i}`, source: "webcam", startMs: i * 60000, endMs: i * 60000 + 45000, referenceStartMs: i * 60000 - 1000, referenceEndMs: i * 60000 + 44000, referenceRate: 15, accepted: difference !== null, estimatedRate: difference === null ? null : 15 + difference })),
});

test("reference report retains refusals in coverage and computes signed bias, MAE and limits", () => {
  const report = compareRespiratoryReference(fixture());
  assert.equal(report.synthetic, true);
  assert.equal(report.overall.coverage, 2 / 3);
  assert.equal(report.overall.refused, 1);
  assert.equal(report.overall.subjects, 2);
  assert.equal(report.overall.bias, 0);
  assert.equal(report.overall.mae, 2);
  assert.equal(report.overall.rmse, 2);
  assert.ok(Math.abs(report.overall.agreement.upper - 1.96 * Math.sqrt(8)) < 1e-10);
  assert.equal(report.bySubject.P02.coverage, 0.5);
});

test("a study with only refused estimates cannot produce zero error", () => {
  const data = fixture(); data.pairs = [data.pairs[2]];
  const report = compareRespiratoryReference(data);
  assert.equal(report.overall.mae, null);
  assert.equal(report.overall.bias, null);
  assert.equal(report.overall.agreement, null);
});

test("reference alignment rejects mismatched windows, duplicates and false accepted estimates", () => {
  for (const mutate of [
    d => d.pairs[0].referenceStartMs += 1000,
    d => d.pairs.push({ ...d.pairs[0] }),
    d => d.pairs[0].estimatedRate = Infinity,
    d => d.pairs[0].estimatedRate = 0,
    d => d.pairs[2].estimatedRate = 0,
    d => d.reference.clockOffsetMs = null,
    d => d.pairs[0].endMs = 5000,
  ]) {
    const data = fixture(); mutate(data);
    assert.throws(() => compareRespiratoryReference(data));
  }
});

test("webcam and depth comparisons remain separate", () => {
  const data = fixture(); data.pairs[1].source = "depth";
  const report = compareRespiratoryReference(data);
  assert.equal(report.bySource.webcam.coverage, 0.5);
  assert.equal(report.bySource.webcam.bias, 2);
  assert.equal(report.bySource.depth.bias, -2);
  assert.equal(report.bySource.depth.agreement, null);
});
