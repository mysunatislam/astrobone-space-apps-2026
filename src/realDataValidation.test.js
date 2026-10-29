import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv } from "./kneeRepeatability.js";
import { REAL_DATA_VALIDATION, kneeSummary, pulseSummary, testedOnRealData } from "./realDataValidation.js";

const read = name => parseCsv(readFileSync(new URL(`../data/validation/${name}`, import.meta.url), "utf8"));

test("the knee numbers on the Evidence view are the saved real-video results", () => {
  const { dataset, ...shown } = REAL_DATA_VALIDATION.knee;
  assert.equal(dataset, "REHAB24-6");
  assert.deepEqual(kneeSummary(read("rehab24-knee-methods.csv"), read("rehab24-knee-per-person.csv")), shown);
});

test("the pulse numbers on the Evidence view are the saved real-video results", () => {
  const { dataset, ...shown } = REAL_DATA_VALIDATION.pulse;
  assert.equal(dataset, "MCD-rPPG");
  assert.deepEqual(pulseSummary(read("mcd-pulse-methods.csv"), read("mcd-pulse-gate-sweep.csv"), read("mcd-pulse-rest-vs-squats.csv")), shown);
});

test("the Evidence view says what was tested and what was not", () => {
  const { tested, notYet } = testedOnRealData();
  assert.equal(tested.length, 5); assert.ok(notYet.length >= 3);
  assert.match(tested[0], /21\.7° → 13\.2°/); assert.match(tested[1], /±4\.4°/); assert.match(tested[2], /0\.6 bpm/);
  assert.ok(notYet.some(t => /No astronaut/.test(t)) && notYet.some(t => /goniometer/.test(t)));
  for (const line of [...tested, ...notYet]) assert.doesNotMatch(line, /diagnos|detects bone loss|predicts injury|\bvalidated\b/i, line);
});
