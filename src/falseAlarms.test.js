import test from "node:test";
import assert from "node:assert/strict";
import { falseAlarmSummary, detectionSummary, singleValueRule, STEP_CHANGES, STABLE_PERSON, ASSUMED_KNEE_SD, PREVIOUS_SPREADS } from "../scripts/simulate-false-alarms.mjs";
import { SIMULATED_RELIABILITY, KNEE_REPEAT_NOISE } from "./selfCheck.js";

// Simulated healthy astronauts checking every indicator daily (scripts/simulate-false-alarms.mjs; the
// knee spreads are measured on real video, heart rate, blood pressure and sleep are published, the others
// are stated assumptions). Small runs here; the script's 1000-astronaut run is in docs/self-check.md.
// The numbers the app shows (SIMULATED_RELIABILITY) come from the full run; a small run with the same
// seeds must land near them, so a rule change that moves them fails here until they are re-measured.
test("a healthy astronaut is told to log a change on far fewer daily checks than with the single-value rule", () => {
  const single = falseAlarmSummary({ runs: 100, evaluate: singleValueRule }), multirule = falseAlarmSummary({ runs: 100 });
  assert.ok(single.reviewOrWorsePct > 40, `single-value rule ${single.reviewOrWorsePct} %`);
  assert.ok(multirule.reviewOrWorsePct < 20 && multirule.reviewOrWorsePct < single.reviewOrWorsePct / 2.5, `multirule ${multirule.reviewOrWorsePct} %`);
  assert.ok(multirule.astronautsWithDriftAlarmPct <= single.astronautsWithDriftAlarmPct);
  assert.ok(Math.abs(multirule.reviewOrWorsePct - SIMULATED_RELIABILITY.reviewPct) < 2, `${multirule.reviewOrWorsePct} vs ${SIMULATED_RELIABILITY.reviewPct}`);
  assert.ok(Math.abs(multirule.recheckOrWorsePct - SIMULATED_RELIABILITY.recheckPct) < 3, `${multirule.recheckOrWorsePct} vs ${SIMULATED_RELIABILITY.recheckPct}`);
  assert.ok(Math.abs(single.reviewOrWorsePct - SIMULATED_RELIABILITY.singleRuleReviewPct) < 3);
});

test("a real change is still flagged, and the app's detection numbers match the simulation", () => {
  assert.deepEqual(SIMULATED_RELIABILITY.detected.map(d => d.key).sort(), STEP_CHANGES.map(c => c.key).sort());
  for (const shown of SIMULATED_RELIABILITY.detected) {
    const result = detectionSummary(STEP_CHANGES.find(c => c.key === shown.key), { runs: 100 });
    assert.ok(Math.abs(result.withinThreeChecksPct - shown.withinThree) < 10, `${shown.key} within 3: ${result.withinThreeChecksPct} vs ${shown.withinThree}`);
    assert.ok(Math.abs(result.withinTwoWeeksPct - shown.withinTwoWeeks) < 6, `${shown.key} within 14: ${result.withinTwoWeeksPct} vs ${shown.withinTwoWeeks}`);
  }
  assert.ok(SIMULATED_RELIABILITY.detected.find(d => d.key === "pvtLapses").withinThree >= 85);
  // With the camera noise measured on real video, a 10° knee drop takes longer to show but is still caught.
  const knee = SIMULATED_RELIABILITY.detected.find(d => d.key === "kneeExtension");
  assert.ok(knee.withinThree >= 60 && knee.withinTwoWeeks >= 90, JSON.stringify(knee));
});

test("the knee spreads in the simulation are the measured ones, and they are larger than the old guess", () => {
  for (const key of ["kneeExtension", "kneeRom"]) {
    assert.equal(STABLE_PERSON[key].sd, KNEE_REPEAT_NOISE[key].sd);
    assert.ok(KNEE_REPEAT_NOISE[key].sd > ASSUMED_KNEE_SD[key], key);
  }
});

test("heart rate, blood pressure and sleep spreads are the published ones, wider than the guesses they replaced", () => {
  assert.deepEqual([STABLE_PERSON.restingHr.sd, STABLE_PERSON.systolicBp.sd, STABLE_PERSON.diastolicBp.sd, Number((STABLE_PERSON.sleepHours.sd * 60).toFixed(1))], [5.4, 8.6, 6.4, 85.8]);
  for (const [key, sd] of Object.entries(PREVIOUS_SPREADS)) assert.ok(STABLE_PERSON[key].sd > sd, key);
  // Sleep varies too much from night to night for a 2 h drop to show in a few checks; the app says so.
  const sleep = SIMULATED_RELIABILITY.detected.find(d => d.key === "sleepHours");
  assert.ok(sleep.withinThree < 40 && sleep.withinTwoWeeks > 50, JSON.stringify(sleep));
});
