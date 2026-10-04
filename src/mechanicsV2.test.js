import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateReducedOrderRisk,
  reconstructAverageForce,
} from "./mechanicsV2.js";

const geometry = {
  areaM2: 4e-4,
  secondMomentXM4: 1e-8,
  secondMomentYM4: 2e-8,
  torsionConstantM4: 2.5e-8,
  outerDistanceXM: 0.012,
  outerDistanceYM: 0.015,
  torsionRadiusM: 0.015,
  shearFactor: 4 / 3,
};

const capacitiesPa = {
  tension: 120e6,
  compression: 160e6,
  shear: 60e6,
};

const capacityFactors = {
  mission: 0.95,
  person: 1,
  site: 1,
};

function evaluate(forceVectorN, contactOffsetM = { x: 0, y: 0, z: 0 }) {
  return calculateReducedOrderRisk({
    forceVectorN,
    contactOffsetM,
    geometry,
    capacitiesPa,
    capacityFactors,
  });
}

test("surface-plane angle convention gives zero glancing and full normal speed", () => {
  const shared = {
    massKg: 2,
    speedMps: 4,
    impactDurationMs: 10,
    transferFactor: 1,
    forceDirection: { x: 0, y: 0, z: 1 },
  };
  const glancing = reconstructAverageForce({
    ...shared,
    angleFromSurfacePlaneDegrees: 0,
  });
  const normal = reconstructAverageForce({
    ...shared,
    angleFromSurfacePlaneDegrees: 90,
  });

  assert.equal(glancing.normalSpeedMps, 0);
  assert.ok(almostEqual(normal.normalSpeedMps, 4));
  assert.ok(almostEqual(normal.averageForceN, 800));
});

test("zero force produces zero demand and RI", () => {
  const result = evaluate({ x: 0, y: 0, z: 0 });

  assert.equal(result.relativeMechanicalRiskIndex, 0);
  assert.equal(result.demandsPa.tension, 0);
  assert.equal(result.demandsPa.compression, 0);
  assert.equal(result.demandsPa.shearBound, 0);
  assert.equal(result.modeledCapacityExceeded, false);
});

test("centroidal axial force produces only an axial normal-stress mode", () => {
  const result = evaluate({ x: 0, y: 0, z: 1000 });

  assert.ok(result.demandsPa.tension > 0);
  assert.equal(result.demandsPa.bendingStressBound, 0);
  assert.equal(result.demandsPa.shearBound, 0);
  assert.equal(result.governingMode, "tension");
});

test("centroidal transverse force produces shear without a moment", () => {
  const result = evaluate({ x: 1000, y: 0, z: 0 });

  assert.ok(result.demandsPa.transverseShear > 0);
  assert.equal(result.demandsPa.bendingStressBound, 0);
  assert.equal(result.demandsPa.torsionalShear, 0);
  assert.equal(result.governingMode, "shear");
});

test("eccentric transverse loads resolve bending and torsion", () => {
  const bending = evaluate(
    { x: 1000, y: 0, z: 0 },
    { x: 0, y: 0, z: 0.2 },
  );
  const torsion = evaluate(
    { x: 1000, y: 0, z: 0 },
    { x: 0, y: 0.1, z: 0 },
  );

  assert.ok(bending.demandsPa.bendingStressBound > 0);
  assert.equal(bending.demandsPa.torsionalShear, 0);
  assert.equal(torsion.demandsPa.bendingStressBound, 0);
  assert.ok(torsion.demandsPa.torsionalShear > 0);
});

test("doubling force doubles all non-zero nominal demands and RI", () => {
  const low = evaluate(
    { x: 100, y: 50, z: 200 },
    { x: 0.01, y: 0.02, z: 0.1 },
  );
  const high = evaluate(
    { x: 200, y: 100, z: 400 },
    { x: 0.01, y: 0.02, z: 0.1 },
  );

  assert.ok(almostEqual(high.demandsPa.tension, low.demandsPa.tension * 2));
  assert.ok(almostEqual(high.demandsPa.compression, low.demandsPa.compression * 2));
  assert.ok(almostEqual(high.demandsPa.shearBound, low.demandsPa.shearBound * 2));
  assert.ok(almostEqual(
    high.relativeMechanicalRiskIndex,
    low.relativeMechanicalRiskIndex * 2,
  ));
});

test("increasing capacity lowers RI without changing demand", () => {
  const inputs = {
    forceVectorN: { x: 100, y: 50, z: 200 },
    contactOffsetM: { x: 0.01, y: 0.02, z: 0.1 },
    geometry,
    capacitiesPa,
  };
  const baseline = calculateReducedOrderRisk({
    ...inputs,
    capacityFactors,
  });
  const stronger = calculateReducedOrderRisk({
    ...inputs,
    capacityFactors: { ...capacityFactors, person: 2 },
  });

  assert.deepEqual(stronger.demandsPa, baseline.demandsPa);
  assert.ok(almostEqual(
    stronger.relativeMechanicalRiskIndex,
    baseline.relativeMechanicalRiskIndex / 2,
  ));
});

test("missing geometry or capacity evidence is rejected", () => {
  assert.throws(
    () => calculateReducedOrderRisk({
      forceVectorN: { x: 0, y: 0, z: 1 },
      contactOffsetM: { x: 0, y: 0, z: 0 },
      geometry: { ...geometry, torsionConstantM4: undefined },
      capacitiesPa,
      capacityFactors,
    }),
    /torsionConstantM4/,
  );
  assert.throws(
    () => calculateReducedOrderRisk({
      forceVectorN: { x: 0, y: 0, z: 1 },
      contactOffsetM: { x: 0, y: 0, z: 0 },
      geometry,
      capacitiesPa: { ...capacitiesPa, shear: 0 },
      capacityFactors,
    }),
    /capacitiesPa\.shear/,
  );
});

function almostEqual(actual, expected, tolerance = 1e-10) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}
