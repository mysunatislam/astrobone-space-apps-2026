import test from "node:test";
import assert from "node:assert/strict";
import { falseAlarmSummary, detectionSummary, singleValueRule, STEP_CHANGES } from "../scripts/simulate-false-alarms.mjs";
import { SIMULATED_RELIABILITY } from "./selfCheck.js";

// Simulated healthy astronauts checking every indicator daily (scripts/simulate-false-alarms.mjs; the
// day-to-day spreads are stated assumptions). Small runs here; the script's 1000-astronaut run is in
// docs/self-check.md.
// The numbers the app shows (SIMULATED_RELIABILITY) come from the full run; a small run with the same
// seeds must land near them, so a rule change that moves them fails here until they are re-measured.
test("a healthy astronaut is told to log a change on far fewer daily checks than with the single-value rule", () => {
  const single = falseAlarmSummary({ runs: 60, evaluate: singleValueRule }), multirule = falseAlarmSummary({ runs: 60 });
  assert.ok(single.reviewOrWorsePct > 25, `single-value rule ${single.reviewOrWorsePct} %`);
  assert.ok(multirule.reviewOrWorsePct < 10, `multirule ${multirule.reviewOrWorsePct} %`);
  assert.ok(multirule.astronautsWithDriftAlarmPct <= single.astronautsWithDriftAlarmPct);
  assert.ok(Math.abs(multirule.reviewOrWorsePct - SIMULATED_RELIABILITY.reviewPct) < 2, `${multirule.reviewOrWorsePct} vs ${SIMULATED_RELIABILITY.reviewPct}`);
  assert.ok(Math.abs(multirule.recheckOrWorsePct - SIMULATED_RELIABILITY.recheckPct) < 3, `${multirule.recheckOrWorsePct} vs ${SIMULATED_RELIABILITY.recheckPct}`);
  assert.ok(Math.abs(single.reviewOrWorsePct - SIMULATED_RELIABILITY.singleRuleReviewPct) < 3);
});

test("a real change is still flagged, and the app's detection numbers match the simulation", () => {
  assert.deepEqual(SIMULATED_RELIABILITY.detected.map(d => d.key).sort(), STEP_CHANGES.map(c => c.key).sort());
  for (const shown of SIMULATED_RELIABILITY.detected) {
    const result = detectionSummary(STEP_CHANGES.find(c => c.key === shown.key), { runs: 60 });
    assert.ok(Math.abs(result.withinThreeChecksPct - shown.withinThree) < 10, `${shown.key} within 3: ${result.withinThreeChecksPct} vs ${shown.withinThree}`);
    assert.ok(Math.abs(result.withinTwoWeeksPct - shown.withinTwoWeeks) < 6, `${shown.key} within 14: ${result.withinTwoWeeksPct} vs ${shown.withinTwoWeeks}`);
  }
  for (const key of ["kneeExtension", "pvtLapses"]) assert.ok(SIMULATED_RELIABILITY.detected.find(d => d.key === key).withinThree >= 85);
});
