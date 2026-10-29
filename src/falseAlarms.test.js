import test from "node:test";
import assert from "node:assert/strict";
import { falseAlarmSummary, detectionSummary, singleValueRule, STEP_CHANGES } from "../scripts/simulate-false-alarms.mjs";

// Simulated healthy astronauts checking every indicator daily (scripts/simulate-false-alarms.mjs; the
// day-to-day spreads are stated assumptions). Small runs here; the script's 1000-astronaut run is in
// docs/self-check.md.
test("a healthy astronaut is told to log a change on far fewer daily checks than with the single-value rule", () => {
  const single = falseAlarmSummary({ runs: 60, evaluate: singleValueRule }), multirule = falseAlarmSummary({ runs: 60 });
  assert.ok(single.reviewOrWorsePct > 25, `single-value rule ${single.reviewOrWorsePct} %`);
  assert.ok(multirule.reviewOrWorsePct < 10, `multirule ${multirule.reviewOrWorsePct} %`);
  assert.ok(multirule.astronautsWithDriftAlarmPct <= single.astronautsWithDriftAlarmPct);
});

test("a real knee or attention change is still flagged within three daily checks", () => {
  for (const key of ["kneeExtension", "pvtLapses"]) {
    const result = detectionSummary(STEP_CHANGES.find(c => c.key === key), { runs: 60 });
    assert.ok(result.withinThreeChecksPct >= 85, `${key} ${result.withinThreeChecksPct} %`);
  }
});
