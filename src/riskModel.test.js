import test from "node:test";
import assert from "node:assert/strict";
import { calculateRisk, RISK_THRESHOLDS } from "./riskModel.js";

const baseline = {
  mode: "space",
  target: "tibia",
  massKg: 2,
  speedMps: 4,
  angleDegrees: 75,
  contactAreaMm2: 100,
  impactDurationMs: 10,
  boneModulusGPa: 17,
  baselineCapacityMPa: 110,
  boneIndex: 1,
  microgravityDays: 0,
};

test("increasing speed increases energy and mechanical demand", () => {
  const low = calculateRisk({ ...baseline, speedMps: 2 });
  const high = calculateRisk({ ...baseline, speedMps: 4 });

  assert.ok(high.kineticEnergyJ > low.kineticEnergyJ);
  assert.ok(high.demandCapacityRatio > low.demandCapacityRatio);
});

test("doubling speed quadruples kinetic energy", () => {
  const low = calculateRisk({ ...baseline, speedMps: 2 });
  const high = calculateRisk({ ...baseline, speedMps: 4 });

  assert.ok(almostEqual(high.kineticEnergyJ, low.kineticEnergyJ * 4));
});

test("increasing mass increases impulse, force, and demand", () => {
  const light = calculateRisk({ ...baseline, massKg: 1 });
  const heavy = calculateRisk({ ...baseline, massKg: 2 });

  assert.ok(heavy.estimatedImpulseNs > light.estimatedImpulseNs);
  assert.ok(heavy.averageForceN > light.averageForceN);
  assert.ok(heavy.demandCapacityRatio > light.demandCapacityRatio);
});

test("reducing contact area increases contact stress", () => {
  const broad = calculateRisk({ ...baseline, contactAreaMm2: 200 });
  const concentrated = calculateRisk({ ...baseline, contactAreaMm2: 20 });

  assert.ok(concentrated.contactStressPa > broad.contactStressPa);
  assert.ok(concentrated.demandCapacityRatio > broad.demandCapacityRatio);
});

test("a more normal impact increases normal energy and stress", () => {
  const oblique = calculateRisk({ ...baseline, angleDegrees: 20 });
  const normal = calculateRisk({ ...baseline, angleDegrees: 90 });

  assert.ok(normal.normalImpactEnergyJ > oblique.normalImpactEnergyJ);
  assert.ok(normal.contactStressPa > oblique.contactStressPa);
});

test("reducing skeletal capacity increases the demand-capacity ratio", () => {
  const baselineBone = calculateRisk({ ...baseline, boneIndex: 1 });
  const reducedBone = calculateRisk({ ...baseline, boneIndex: 0.7 });

  assert.ok(reducedBone.adjustedCapacity < baselineBone.adjustedCapacity);
  assert.ok(reducedBone.demandCapacityRatio > baselineBone.demandCapacityRatio);
});

test("microgravity exposure reduces capacity without changing mechanical demand", () => {
  const earth = calculateRisk({ ...baseline, microgravityDays: 0 });
  const mission = calculateRisk({ ...baseline, microgravityDays: 183 });

  assert.ok(mission.adjustedCapacity < earth.adjustedCapacity);
  assert.ok(mission.demandCapacityRatio > earth.demandCapacityRatio);
  assert.equal(mission.contactStressPa, earth.contactStressPa);
});

test("zero speed produces zero energy, force, stress, and DCR", () => {
  const result = calculateRisk({ ...baseline, speedMps: 0 });

  assert.equal(result.kineticEnergyJ, 0);
  assert.equal(result.normalImpactEnergyJ, 0);
  assert.equal(result.averageForceN, 0);
  assert.equal(result.contactStressPa, 0);
  assert.equal(result.demandCapacityRatio, 0);
});

test("negative mass or speed and non-positive area are rejected", () => {
  assert.throws(() => calculateRisk({ ...baseline, massKg: -1 }), /massKg/);
  assert.throws(() => calculateRisk({ ...baseline, speedMps: -1 }), /speedMps/);
  assert.throws(() => calculateRisk({ ...baseline, contactAreaMm2: 0 }), /contactAreaMm2/);
  assert.throws(() => calculateRisk({ ...baseline, contactAreaMm2: -1 }), /contactAreaMm2/);
});

test("all scalar model outputs remain finite", () => {
  const result = calculateRisk(baseline);
  const scalarKeys = [
    "kineticEnergyJ",
    "normalImpactEnergyJ",
    "estimatedImpulseNs",
    "averageForceN",
    "contactStressPa",
    "estimatedStrain",
    "baselineCapacity",
    "adjustedCapacity",
    "demandCapacityRatio",
  ];

  scalarKeys.forEach((key) => assert.ok(Number.isFinite(result[key]), key));
});

test("SI unit conversions match a hand-calculated normal-impact case", () => {
  const result = calculateRisk({
    ...baseline,
    massKg: 2,
    speedMps: 4,
    angleDegrees: 90,
    contactAreaMm2: 100,
    impactDurationMs: 10,
    boneModulusGPa: 20,
    baselineCapacityMPa: 100,
  });

  assert.ok(almostEqual(result.kineticEnergyJ, 16));
  assert.ok(almostEqual(result.estimatedImpulseNs, 8));
  assert.ok(almostEqual(result.averageForceN, 800));
  assert.ok(almostEqual(result.contactStressPa, 8e6));
  assert.ok(almostEqual(result.estimatedStrain, 0.0004));
  assert.ok(almostEqual(result.baselineCapacity, 100e6));
  assert.ok(almostEqual(result.adjustedCapacity, 100e6));
  assert.ok(almostEqual(result.demandCapacityRatio, 0.08));
  assert.equal(result.riskBand.key, "lower");
});

test("legacy UI mass in grams is converted to canonical kilograms", () => {
  const canonical = calculateRisk({ ...baseline, massKg: 2 });
  const { massKg: _removed, ...legacyInput } = baseline;
  const legacy = calculateRisk({ ...legacyInput, mass: 2000 });

  assert.ok(almostEqual(legacy.kineticEnergyJ, canonical.kineticEnergyJ));
  assert.equal(legacy.inputs.massKg, 2);
});

test("research-band boundaries remain frozen at 0.50, 0.80, and 1.00", () => {
  assert.deepEqual(RISK_THRESHOLDS, {
    monitor: 0.5,
    elevated: 0.8,
    capacityExceeded: 1,
  });
});

function almostEqual(actual, expected, tolerance = 1e-10) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}
