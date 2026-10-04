import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calculateRisk, RISK_THRESHOLDS } from "./riskModel.js";
import {
  observationAt, boneCapacityChange, boneTint, stressColor, beatHz, radiationTrackCount, dcrBand,
  trendPrediction, predictedVsObserved, twinState, kneeSeries, BONE_TINT_SCALE, TRACKS_PER_MGY, MAX_TRACKS,
} from "./twinModel.js";
import {
  IMPACT_SCENARIO, evaluateImpact, runMonteCarlo, envelopeDistributions, eventDistributions, bendingStressField, mulberry32, sampler,
} from "./twinImpact.js";

const simulation = JSON.parse(readFileSync(new URL("../public/simulations/astrobone-level-a-v1.json", import.meta.url), "utf8"));

test("observations step to the last recorded checkpoint, never interpolate", () => {
  assert.equal(observationAt(1).kneeExtension, 165);
  assert.equal(observationAt(29).recordDay, 1);
  assert.equal(observationAt(146).recordDay, 120);
  assert.equal(observationAt(146).heartRate, 72);
  assert.equal(observationAt(147).kneeExtension, 151);
  assert.equal(observationAt(200).authoredScenario, true);
});

test("bone capacity change is the same modifier calculateRisk applies", () => {
  for (const day of [0, 30, 120, 147, 240]) {
    const risk = calculateRisk({ massKg: 1, speedMps: 1, angleDegrees: 90, contactAreaMm2: 100, microgravityDays: day });
    assert.ok(Math.abs(boneCapacityChange(day).lossFraction - risk.spaceLoss) < 1e-12, `day ${day}`);
  }
  assert.ok(Math.abs(boneCapacityChange(120).lossFraction - 0.0493) < 1e-3);
});

test("bone tint spans cyan at baseline to amber at the scale maximum, never red", () => {
  const start = boneTint(0), end = boneTint(BONE_TINT_SCALE.max), beyond = boneTint(1);
  assert.ok(start[2] > start[0], "baseline is blue-dominant");
  assert.ok(end[0] > end[2], "scale end is warm");
  assert.deepEqual(beyond, end, "clamped at the scale maximum");
  assert.ok(end[1] > 0.4, "amber, not red");
});

test("stress color runs blue to red over normalized output", () => {
  assert.ok(stressColor(0)[2] > stressColor(0)[0]);
  assert.ok(stressColor(1)[0] > 0.9 && stressColor(1)[1] < 0.3);
});

test("heart animation frequency follows heart rate", () => {
  assert.equal(beatHz(72), 1.2);
  assert.equal(beatHz(0), 0);
  assert.equal(beatHz(Number.NaN), 0);
});

test("radiation track count scales with cumulative dose and is capped", () => {
  assert.equal(radiationTrackCount(0), 0);
  assert.equal(radiationTrackCount(22.05), Math.round(22.05 * TRACKS_PER_MGY));
  assert.equal(radiationTrackCount(1e6), MAX_TRACKS);
});

test("dcr bands use the frozen risk thresholds", () => {
  assert.equal(dcrBand(RISK_THRESHOLDS.monitor - 1e-9).key, "lower");
  assert.equal(dcrBand(RISK_THRESHOLDS.monitor).key, "monitor");
  assert.equal(dcrBand(RISK_THRESHOLDS.elevated).key, "elevated");
  assert.equal(dcrBand(RISK_THRESHOLDS.capacityExceeded).key, "capacityExceeded");
});

test("trend prediction is ordinary least squares with a 95% prediction interval", () => {
  const prior = kneeSeries().filter(p => p.day <= 120);
  const forecast = trendPrediction(prior, 147);
  assert.ok(Math.abs(forecast.slope - -627 / 8880.8) < 1e-9);
  assert.ok(Math.abs(forecast.predicted - 155.87) < 0.01);
  assert.ok(Math.abs(forecast.halfWidth - 5.09) < 0.02);
  assert.equal(trendPrediction(prior.slice(0, 2), 147), null);
});

test("predicted vs observed only uses earlier observations", () => {
  const day147 = predictedVsObserved(147);
  assert.deepEqual(day147.forecast.fitDays, [1, 30, 60, 90, 120]);
  assert.equal(day147.inside, true);
  const check = IMPACT_SCENARIO.postEventCheck;
  const post = predictedVsObserved(check.day.value, [{ day: check.day.value, value: check.kneeExtension.value, quality: check.trackingQuality.value }]);
  assert.equal(post.forecast.fitDays.at(-1), 147);
  assert.equal(post.inside, false);
  assert.equal(predictedVsObserved(1).verdict, "INSUFFICIENT HISTORY");
});

test("twin state adds the event increment only on and after the event day", () => {
  assert.equal(twinState(146, { eventDay: 147 }).radiation.eventIncluded, false);
  const after = twinState(147, { eventDay: 147 });
  assert.equal(after.radiation.doseMgy, 32.05);
  assert.equal(after.heart.delta, 12);
  assert.equal(after.knee.delta, -14);
  assert.equal(twinState(0).day, 1);
  assert.equal(twinState(999).day, 240);
});

test("event evaluation reproduces the stored Level-A reference scenario exactly", () => {
  const s = simulation.scenario;
  const ref = evaluateImpact(IMPACT_SCENARIO, { microgravityDays: s.microgravityMonths * 30.4375 });
  assert.ok(Math.abs(ref.averageForceN - simulation.outputs.peakImpactForceN) < 1e-6);
  assert.ok(Math.abs(ref.demandCapacityRatio - simulation.outputs.demandCapacityRatio) < 1e-9);
  const event = evaluateImpact();
  assert.equal(event.band.key, "monitor");
  assert.ok(event.demandCapacityRatio < ref.demandCapacityRatio, "Day 147 has less modeled loss than 6 months");
});

test("monte carlo is deterministic for a seed", () => {
  const distributions = eventDistributions(IMPACT_SCENARIO, simulation.monteCarlo.assumedInputDistributions);
  const a = runMonteCarlo({ runs: 500, seed: 7, distributions }), b = runMonteCarlo({ runs: 500, seed: 7, distributions });
  assert.deepEqual(a.fractions, b.fractions);
  assert.deepEqual(Array.from(a.ratios.slice(0, 20)), Array.from(b.ratios.slice(0, 20)));
});

test("browser monte carlo reproduces the stored 5,000-run reference within sampling error", () => {
  const mc = runMonteCarlo({ runs: 10000, seed: simulation.monteCarlo.randomSeed, distributions: envelopeDistributions(simulation) });
  for (const [key, expected] of Object.entries(simulation.monteCarlo.scenarioFractions)) {
    assert.ok(Math.abs(mc.fractions[key] - expected) < 0.02, `${key}: ${mc.fractions[key]} vs ${expected}`);
  }
  assert.ok(Math.abs(mc.summary.mean - simulation.monteCarlo.dcrSummary.mean) < 0.03);
  assert.ok(Math.abs(mc.summary.p95 - simulation.monteCarlo.dcrSummary.p95) < 0.08);
});

test("samplers respect their bounds", () => {
  const random = mulberry32(1);
  const tri = sampler({ distribution: "triangular", minimum: 1, mode: 2, maximum: 4 }, random);
  const tn = sampler({ distribution: "truncated normal", mean: 25, standardDeviation: 2.5, minimum: 18, maximum: 32 }, random);
  for (let i = 0; i < 2000; i++) { const x = tri(), y = tn(); assert.ok(x >= 1 && x <= 4); assert.ok(y >= 18 && y <= 32); }
});

function cylinder({ length = 10, radius = 1, rings = 60, segments = 24 }) {
  const out = [];
  for (let r = 0; r <= rings; r++) for (let s = 0; s < segments; s++) {
    const t = (s / segments) * Math.PI * 2; out.push(radius * Math.cos(t), (r / rings) * length, radius * Math.sin(t));
  }
  return new Float32Array(out);
}

test("bending field peaks at the load section and vanishes at the supports", () => {
  const positions = cylinder({});
  const { field, peakIndex, impactFraction } = bendingStressField(positions, { impactPoint: [0, 6, 1], loadDirection: [0, 0, 1] });
  assert.ok(Math.abs(impactFraction - 0.6) < 0.02);
  const peakY = positions[peakIndex * 3 + 1];
  assert.ok(Math.abs(peakY - 6) < 0.6, `peak at y=${peakY}`);
  for (let i = 0; i < field.length; i++) assert.ok(field[i] >= 0 && field[i] <= 1);
  const endRing = Array.from({ length: 24 }, (_, s) => field[s]);
  assert.ok(Math.max(...endRing) < 0.1, "near-zero moment at the support");
  // Points on the neutral axis (perpendicular to the load) carry no bending stress.
  const ring = 36 * 24, neutral = field[ring + 0], extreme = field[ring + 6];
  assert.ok(neutral < 0.05 && extreme > 0.8);
});

test("thinner sections carry more relative stress under the same moment", () => {
  const base = cylinder({ rings: 80 }), tapered = new Float32Array(base);
  for (let i = 0; i < tapered.length; i += 3) { const y = tapered[i + 1], scale = y > 5 ? 0.7 : 1; tapered[i] *= scale; tapered[i + 2] *= scale; }
  const { field } = bendingStressField(tapered, { impactPoint: [0, 5, 1], loadDirection: [0, 0, 1] });
  const at = y => { let best = 0; for (let i = 0; i < field.length; i++) if (Math.abs(tapered[i * 3 + 1] - y) < 0.07) best = Math.max(best, field[i]); return best; };
  assert.ok(at(6) > at(4), "the thinner side of a symmetric moment is more stressed");
});
