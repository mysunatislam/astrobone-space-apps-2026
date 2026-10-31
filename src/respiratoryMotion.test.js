import test from "node:test";
import assert from "node:assert/strict";
import { estimateRespiratoryMotion, validateDepthRecording } from "./respiratoryMotion.js";

function capture(rate = 15, seconds = 45, changes = {}) {
  return Array.from({ length: seconds * 10 + 1 }, (_, i) => {
    const t = i * 100 + (i > 0 && i < seconds * 10 ? Math.sin(i * 2.3) * 9 : 0);
    const wave = Math.sin(2 * Math.PI * rate / 60 * t / 1000);
    return { t, chest: 2 * wave, abdomen: 1.4 * wave, visibility: 0.95, motion: 0.001, ...changes };
  });
}

for (const rate of [7.5, 12, 18, 25, 36]) test(`estimates a stable ${rate}/min wave with timestamp jitter`, () => {
  const result = estimateRespiratoryMotion(capture(rate, 60));
  assert.equal(result.status, "estimated", result.reason);
  assert.ok(Math.abs(result.rate - rate) < 0.6, `${result.rate} vs ${rate}`);
  assert.ok(result.waveform.length > 50);
});

for (const rate of [6, 40]) test(`supported ${rate}/min boundary remains inside the reported range`, () => {
  const result = estimateRespiratoryMotion(capture(rate, 60));
  assert.equal(result.status, "estimated", result.reason);
  assert.ok(result.rate >= 6 && result.rate <= 40);
  assert.ok(Math.abs(result.rate - rate) < 0.2);
});

function highCadenceDepth({ hz = 9.75, breathingRate = 0, jitter = false } = {}) {
  return Array.from({ length: 6001 }, (_, i) => {
    const t = i * 10 + (jitter && i > 0 && i < 6000 ? Math.sin(i * 2.1) : 0);
    const wave = 2 * Math.sin(2 * Math.PI * hz * t / 1000) + (breathingRate ? 1.5 * Math.sin(2 * Math.PI * breathingRate / 60 * t / 1000) : 0);
    return { t, chest: 1000 + wave, abdomen: 1100 + wave * .8, visibility: 1, motion: 0 };
  });
}

for (const hz of [9.75, 10.3, 19.75]) test(`native 100Hz depth input at ${hz}Hz cannot alias into a breathing rate`, () => {
  assert.equal(estimateRespiratoryMotion(highCadenceDepth({ hz }), { source: "depth" }).rate, null);
});

test("true 18/min breathing survives high-frequency depth sensor motion and timestamp jitter", () => {
  const result = estimateRespiratoryMotion(highCadenceDepth({ breathingRate: 18, jitter: true }), { source: "depth" });
  assert.equal(result.status, "estimated", result.reason);
  assert.ok(Math.abs(result.rate - 18) < 0.6);
});

test("linear drift does not change the stable breathing rate", () => {
  const samples = capture(18, 60).map(s => ({ ...s, chest: s.chest + s.t * 0.001, abdomen: s.abdomen + s.t * 0.0006 }));
  const result = estimateRespiratoryMotion(samples);
  assert.equal(result.status, "estimated", result.reason);
  assert.ok(Math.abs(result.rate - 18) < 0.6);
});

test("short windows, flat input, missing torso and large motion withhold rates", () => {
  for (const samples of [capture(18, 15), capture(18, 45, { chest: 0, abdomen: 0 }), capture(18, 45, { visibility: 0.1 }), capture(18, 45, { motion: 0.2 })]) {
    const result = estimateRespiratoryMotion(samples);
    assert.notEqual(result.status, "estimated"); assert.equal(result.rate, null);
  }
});

test("missing values, timestamp reversal and long timing gaps withhold rates", () => {
  const a = capture(); a[60].chest = NaN;
  const b = capture(); b[60].t = b[59].t;
  const c = capture().filter(s => s.t < 10000 || s.t > 13000);
  for (const samples of [a, b, c]) assert.equal(estimateRespiratoryMotion(samples).rate, null);
});

test("invalid quality metadata and unsupported sources cannot produce readings", () => {
  for (const changes of [{ visibility: NaN }, { visibility: 2 }, { motion: NaN }, { motion: -1 }, { valid: false }]) assert.equal(estimateRespiratoryMotion(capture(18, 45, changes)).rate, null);
  assert.equal(estimateRespiratoryMotion(capture(), { source: "simulated-depth-from-webcam" }).rate, null);
});

test("broadband deterministic noise does not become a breathing estimate", () => {
  let state = 257;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32 - 0.5; };
  const samples = capture().map(s => ({ ...s, chest: random(), abdomen: random() }));
  assert.equal(estimateRespiratoryMotion(samples).rate, null);
});

test("changing the rate mid-capture is refused", () => {
  const samples = capture(12, 60).map(s => ({ ...s, chest: Math.sin(2 * Math.PI * (s.t < 30000 ? 0.2 : 0.45) * s.t / 1000), abdomen: Math.sin(2 * Math.PI * (s.t < 30000 ? 0.2 : 0.45) * s.t / 1000) }));
  assert.equal(estimateRespiratoryMotion(samples).rate, null);
});

test("slow motion outside the supported range is refused", () => {
  assert.equal(estimateRespiratoryMotion(capture(4.5, 60)).rate, null);
});

test("depth import requires measured units and declared motion compensation", () => {
  const samples = capture(18).map(s => ({ ...s, chest: s.chest + 1000, abdomen: s.abdomen + 1100 }));
  const input = { schema: "astrobone-depth-respiratory-v1", units: "mm", motionCompensated: true, samples };
  const validated = validateDepthRecording(input);
  const result = estimateRespiratoryMotion(validated, { source: "depth" });
  assert.equal(result.status, "estimated", result.reason);
  assert.equal(result.motionUnits, "mm");
  assert.throws(() => validateDepthRecording({ ...input, units: "pixels" }));
  assert.throws(() => validateDepthRecording({ ...input, motionCompensated: false }));
  assert.throws(() => validateDepthRecording({ ...input, samples: [{ t: 1, chest: -1, abdomen: 1 }, { t: 2, chest: 1, abdomen: 1 }] }));
});
