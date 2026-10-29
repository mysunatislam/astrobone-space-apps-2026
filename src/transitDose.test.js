import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ELENA } from "./elenaMissionScenario.js";
import { personalDoseRate, doseRateContext, validateIssDosimetry } from "./issDosimetry.js";
import demo from "./demoMission.json" with { type: "json" };

const iss = validateIssDosimetry(JSON.parse(readFileSync(new URL("../public/data/iss-dosimetry.json", import.meta.url), "utf8")));
const elena = ELENA.observations.map(r => ({ mission_day: r.day.value, cumulative_personal_absorbed_dose_mgy: r.absorbedDose.value }));

// MSL/RAD cruise to Mars, absorbed dose rate in water: 458 +/- 32 uGy/day (Guo et al., A&A 577, A58, 2015).
test("both transit demos accrue dose at the measured Mars-cruise rate", () => {
  for (const readings of [elena, demo.radiation]) {
    const { rate } = personalDoseRate(readings);
    assert.ok(Math.abs(rate - ELENA.doseRate.value) < 0.001, `rate ${rate}`);
    assert.ok(rate >= 0.458 - 0.032 && rate <= 0.458 + 0.032);
  }
});

test("a deep-space transit reads above every ISS rate NASA measured, not below it", () => {
  for (const readings of [elena, demo.radiation]) {
    const context = doseRateContext(readings, iss);
    assert.equal(context.position, "above");
    assert.match(context.note, /beyond low Earth orbit/);
  }
});

test("the what-if dose control covers the whole authored mission", () => {
  const last = ELENA.observations.at(-1).absorbedDose.value + ELENA.event.increment.value;
  assert.ok(last <= ELENA.whatIf.exposureMax.value);
});
