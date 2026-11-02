import test from "node:test";
import assert from "node:assert/strict";
import { falseAlarmSummary, detectionSummary, singleValueRule, simulateAstronaut, STEP_CHANGES, STABLE_PERSON, ASSUMED_KNEE_SD, PREVIOUS_SPREADS, ASSUMED_SPREADS, PVT_POOLED_SD, SENSITIVITY_SCENARIOS, personWithSpreads, assumptionSensitivity } from "../scripts/simulate-false-alarms.mjs";
import { SIMULATED_RELIABILITY, KNEE_REPEAT_NOISE } from "./selfCheck.js";

// Simulated healthy astronauts checking every indicator daily (scripts/simulate-false-alarms.mjs; the
// knee spreads are measured on real video, heart rate, blood pressure, sleep and temperature are published, the others
// are stated assumptions). Small runs here; the script's 1000-astronaut run is in docs/self-check.md.
// The numbers the app shows (SIMULATED_RELIABILITY) come from the full run; a small run with the same
// seeds must land near them, so a rule change that moves them fails here until they are re-measured.
test("a healthy astronaut is told to log a change on far fewer daily checks than with the single-value rule", () => {
  const single = falseAlarmSummary({ runs: 100, evaluate: singleValueRule }), multirule = falseAlarmSummary({ runs: 100 });
  assert.ok(single.reviewOrWorsePct > 40, `single-value rule ${single.reviewOrWorsePct} %`);
  assert.ok(multirule.reviewOrWorsePct < 20 && multirule.reviewOrWorsePct < single.reviewOrWorsePct / 2.5, `multirule ${multirule.reviewOrWorsePct} %`);
  assert.ok(multirule.astronautsWithDriftAlarmPct <= single.astronautsWithDriftAlarmPct);
  assert.ok(multirule.astronautsWithDriftAlarmPct < 5, `drift alarm in ${multirule.astronautsWithDriftAlarmPct} % of stable astronauts`);
  assert.ok(multirule.astronautsWithSleepDebtReviewPct < 8 && single.astronautsWithSleepDebtReviewPct === 0, `sleep-debt review in ${multirule.astronautsWithSleepDebtReviewPct} % of stable astronauts`);
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
  assert.ok(knee.withinThree >= 60 && knee.withinTwoWeeks >= 95, JSON.stringify(knee));
});

test("the knee spreads in the simulation are the measured ones, and they are larger than the old guess", () => {
  for (const key of ["kneeExtension", "kneeRom"]) {
    assert.equal(STABLE_PERSON[key].sd, KNEE_REPEAT_NOISE[key].sd);
    assert.ok(KNEE_REPEAT_NOISE[key].sd > ASSUMED_KNEE_SD[key], key);
  }
});

test("heart rate, blood pressure, sleep and temperature spreads are the published ones, wider than the guesses they replaced", () => {
  assert.deepEqual([STABLE_PERSON.restingHr.sd, STABLE_PERSON.systolicBp.sd, STABLE_PERSON.diastolicBp.sd, Number((STABLE_PERSON.sleepHours.sd * 60).toFixed(1)), STABLE_PERSON.bodyTemp.sd], [5.4, 8.6, 6.4, 85.8, 0.31]);
  for (const [key, sd] of Object.entries(PREVIOUS_SPREADS)) assert.ok(STABLE_PERSON[key].sd > sd, key);
  // Sleep varies too much from night to night for a 2 h drop to show in a few checks; the app says so.
  // Adding up 14 nights (sleep debt) is what catches it within two weeks.
  const sleep = SIMULATED_RELIABILITY.detected.find(d => d.key === "sleepHours");
  assert.ok(sleep.withinThree < 40 && sleep.withinTwoWeeks > 85, JSON.stringify(sleep));
});

test("the reaction test's usual levels are the published PVT-B means, and each reading has its own random stream", () => {
  // Basner et al., Sleep 2018;41:zsx187, Table 2: 45 adults, 16 tests each.
  assert.equal(STABLE_PERSON.pvtSpeed.mean, 4.52);
  assert.equal(STABLE_PERSON.pvtLapses.poisson, 0.98);
  // Simulating lapses differently must not change anyone's knee, blood pressure or sleep values.
  const recorded = person => { const seen = []; simulateAstronaut(7, { days: 20, person, evaluate: check => { seen.push(check.values); return {}; } }); return seen; };
  const a = recorded(STABLE_PERSON), b = recorded({ ...STABLE_PERSON, pvtLapses: { poisson: 4 } });
  for (const key of Object.keys(STABLE_PERSON).filter(k => k !== "pvtLapses")) assert.deepEqual(a.map(v => v[key]), b.map(v => v[key]), key);
  assert.notDeepEqual(a.map(v => v.pvtLapses), b.map(v => v.pvtLapses));
  assert.equal(a.length, 20);
  // The screen says how far other simulated astronauts move the figures.
  assert.ok(SIMULATED_RELIABILITY.chance.sets >= 3 && SIMULATED_RELIABILITY.chance.maxShift > 0);
});

test("the screen says how far the still-assumed spreads move the false alarms, and the numbers match the simulation", () => {
  // Every reading whose spread is not measured or published is in the sweep, and the reaction test's bound is
  // Basner et al. 2018, Table 2 (SDs across all 16 tests of all 45 people).
  assert.deepEqual([...ASSUMED_SPREADS].sort(), ["fatigue", "mood", "pvtLapses", "pvtSpeed", "spo2", "stress"]);
  assert.deepEqual({ ...PVT_POOLED_SD }, { pvtSpeed: 0.41, pvtLapses: 1.61 });
  const doubled = personWithSpreads({ factor: 2 }), halved = personWithSpreads({ factor: 0.5 });
  assert.equal(doubled.pvtSpeed.sd, 0.3); assert.equal(doubled.pvtLapses.sd, 1.61); assert.equal(halved.mood.sd, 0.5);
  assert.equal(halved.pvtLapses, STABLE_PERSON.pvtLapses);
  for (const key of Object.keys(STABLE_PERSON).filter(k => !ASSUMED_SPREADS.includes(k))) assert.equal(doubled[key], STABLE_PERSON[key], key);
  const [h, d, p] = assumptionSensitivity({ runs: 100, detectionRuns: 50, scenarios: SENSITIVITY_SCENARIOS.slice(1) });
  const shown = SIMULATED_RELIABILITY.assumed;
  assert.ok(Math.abs(h.reviewPct - shown.halvedPct) < 2, `halved ${h.reviewPct} vs ${shown.halvedPct}`);
  assert.ok(Math.abs(d.reviewPct - shown.doubledPct) < 2, `doubled ${d.reviewPct} vs ${shown.doubledPct}`);
  assert.ok(Math.abs(p.reviewPct - shown.pvtUpperBoundPct) < 2, `upper bound ${p.reviewPct} vs ${shown.pvtUpperBoundPct}`);
  assert.ok(shown.halvedPct <= SIMULATED_RELIABILITY.reviewPct && SIMULATED_RELIABILITY.reviewPct < shown.pvtUpperBoundPct && shown.pvtUpperBoundPct < shown.doubledPct);
  // A lapse jump is still caught however spread out lapses are.
  for (const r of [h, d, p]) assert.ok(r.lapsesWithinThree >= 85 && r.lapsesWithinTwoWeeks >= 95, JSON.stringify(r));
});

test("overdispersed lapses keep their mean and take the requested spread", () => {
  const values = [];
  simulateAstronaut(11, { days: 4000, person: { pvtLapses: { poisson: 0.98, sd: 1.61 } }, evaluate: check => { values.push(check.values.pvtLapses); return {}; } });
  const m = values.reduce((a, b) => a + b, 0) / values.length, sd = Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
  assert.ok(Math.abs(m - 0.98) < 0.1, `mean ${m}`);
  assert.ok(Math.abs(sd - 1.61) < 0.15, `sd ${sd}`);
  assert.ok(values.every(v => Number.isInteger(v) && v >= 0));
});
