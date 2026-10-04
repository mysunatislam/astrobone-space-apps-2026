import test from "node:test";
import assert from "node:assert/strict";
import { validateHealthObservation, summarizeHealth } from "./healthObservations.js";
import { estimatePulse } from "./rppg.js";
const reading = overrides => ({ mission_day: 1, observed_at: "2025-01-01T12:00:00Z", source: "instrument", device_id: "PPG-01", protocol: "resting-v1", metrics: { heart_rate_bpm: 70 }, quality: 1, consent_to_store: true, ...overrides });
test("health observations require consent, valid units, time, and source isolation", () => {
  assert.equal(validateHealthObservation(reading()).metrics.heart_rate_bpm, 70);
  for (const invalid of [reading({ consent_to_store: false }), reading({ source: "synthetic" }), reading({ metrics: { heart_rate_bpm: NaN } }), reading({ metrics: { made_up_risk: 70 } }), reading({ observed_at: "tomorrow" }), reading({ observed_at: "2025-01-01" })]) assert.throws(() => validateHealthObservation(invalid));
  assert.throws(() => validateHealthObservation(reading(), true));
});
test("webcam may save quality-gated pulse only, never SpO2 or radiation", () => {
  assert.equal(validateHealthObservation(reading({ source: "camera_rppg", quality: .7 })).source, "camera_rppg");
  for (const metrics of [{ spo2_pct: 98 }, { hrv_rmssd_ms: 40 }, { dose_rate_usv_h: 4 }]) assert.throws(() => validateHealthObservation(reading({ source: "camera_rppg", metrics })));
  assert.throws(() => validateHealthObservation(reading({ source: "camera_rppg", quality: .4 })));
});
test("cumulative exposure is monotonic only within the same device and protocol", () => {
  const previous = [reading({ metrics: { cumulative_dose_msv: 4 } })];
  assert.throws(() => validateHealthObservation(reading({ observed_at: "2025-01-02T12:00:00Z", metrics: { cumulative_dose_msv: 3 } }), false, previous));
  assert.doesNotThrow(() => validateHealthObservation(reading({ protocol: "new-device-reset", metrics: { cumulative_dose_msv: 1 } }), false, previous));
});
test("series never merge sensor and camera or different protocols", () => {
  const summary = summarizeHealth([reading(), reading({ observed_at: "2025-01-02T12:00:00Z", metrics: { heart_rate_bpm: 79 } }), reading({ source: "camera_rppg" }), reading({ protocol: "post-exercise" })]);
  assert.equal(summary.series.length, 3); assert.equal(summary.series[0].delta, 9); assert.equal(summary.series[1].delta, null);
  assert.equal(summary.coverage.exposure, false);
});
const signal = ({ fps = 30, motion = 0, flat = false, bpm = 72 } = {}) => Array.from({ length: 22 * fps }, (_, i) => {
  const p = flat ? 0 : Math.sin(2 * Math.PI * bpm / 60 * i / fps);
  return { t: i * 1000 / fps, rgb: [120 + .1 * p, 100 + .6 * p, 80 - .3 * p], motion };
});
test("a failed newest reading is withheld, never replaced by an older usable reading", () => {
  const result = summarizeHealth([reading(), reading({ observed_at: "2025-01-02T12:00:00Z", mission_day: 2, quality: .3, metrics: { heart_rate_bpm: 112 } })]);
  assert.equal(result.series[0].last, null); assert.equal(result.series[0].delta, null);
  assert.equal(result.series[0].withheld, true); assert.equal(result.series[0].latestDay, 2);
});
test("POS pulse tracks a synthetic 72-bpm color signal without treating it as clinical evidence", () => {
  const result = estimatePulse(signal());
  assert.equal(result.status, "estimated"); assert.ok(Math.abs(result.bpm - 72) <= 3); assert.ok(result.quality >= .6);
});
test("POS rejects low cadence, moving face, flat, dark and incomplete windows", () => {
  for (const samples of [signal({ fps: 10 }), signal({ motion: .1 }), signal({ flat: true }), signal().map(s => ({ ...s, rgb: [3, 4, 5] })), signal().slice(0, 300)]) {
    const result = estimatePulse(samples); assert.equal(result.bpm, null); assert.equal(result.status, "insufficient");
  }
});
