import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ISS_DOSIMETRY_FILE, validateIssDosimetry, personalDoseRate, doseRateContext } from "./issDosimetry.js";

const data = validateIssDosimetry(JSON.parse(await readFile(new URL(`../public/${ISS_DOSIMETRY_FILE}`, import.meta.url), "utf8")));
const reading = (mission_day, cumulative_personal_absorbed_dose_mgy) => ({ mission_day, cumulative_personal_absorbed_dose_mgy });

test("bundle: every kept OSDR measurement has dose = rate x duration within a day, and each study is hashed", () => {
  for (const m of data.missions) assert.ok(Math.abs(m.dose_mGy / m.rate_mGy_per_day - m.days) <= 1, m.studies.join());
  for (const s of data.sources.studies) assert.match(s.sha256, /^[0-9a-f]{64}$/);
  assert.ok(data.summary.flights.length >= 5 && data.missions.length >= 20);
  // OSDR rows whose fields disagree (e.g. a duration that holds the dose rate) are kept out, not repaired.
  for (const f of data.flagged) assert.ok(Math.abs(f.dose_mGy / f.rate_mGy_per_day - f.days) > 1);
});

test("bundle: ISS absorbed dose rates sit in the published 0.2-0.4 mGy/day band", () => {
  const { min, median, max } = data.summary.rate_mGy_per_day;
  assert.ok(min >= 0.15 && max <= 0.45 && min <= median && median <= max, JSON.stringify(data.summary));
});

test("validator refuses a summary that does not match its rows", () => {
  const bad = structuredClone(data); bad.summary.rate_mGy_per_day.max = 9;
  assert.throws(() => validateIssDosimetry(bad), /Summary/);
  const swapped = structuredClone(data); swapped.missions[0].days = swapped.missions[0].rate_mGy_per_day;
  assert.throws(() => validateIssDosimetry(swapped), /do not agree/);
});

test("personal rate uses the change between first and last readings", () => {
  assert.deepEqual(personalDoseRate([reading(90, 27), reading(30, 9)]), { rate: 0.3, fromDay: 30, toDay: 90 });
  assert.deepEqual(personalDoseRate([reading(10, 3)]), { rate: 0.3, fromDay: 0, toDay: 10 });
  assert.equal(personalDoseRate([]), null);
  assert.equal(personalDoseRate([reading(0, 0)]), null);
});

test("context places a rate below, within or above the measured ISS band", () => {
  const { min, max } = data.summary.rate_mGy_per_day;
  assert.equal(doseRateContext([reading(1, 0), reading(101, 100 * min * 0.5)], data).position, "below");
  assert.equal(doseRateContext([reading(1, 0), reading(101, 100 * (min + max) / 2)], data).position, "within");
  const high = doseRateContext([reading(1, 0), reading(101, 100 * max * 2)], data);
  assert.equal(high.position, "above");
  assert.match(high.note, /solar particle event/);
  assert.match(doseRateContext([reading(1, 0), reading(31, 9)], data).text, /NASA OSDR/);
  assert.equal(doseRateContext([], data), null);
});
