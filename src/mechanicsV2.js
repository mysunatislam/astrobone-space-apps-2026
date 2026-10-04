export const MECHANICS_V2_STATUS = "reference-kernel-not-active";

export function reconstructAverageForce({
  massKg,
  speedMps,
  angleFromSurfacePlaneDegrees,
  impactDurationMs,
  transferFactor,
  forceDirection,
}) {
  const mass = readNonNegative(massKg, "massKg");
  const speed = readNonNegative(speedMps, "speedMps");
  const angle = readBetween(
    angleFromSurfacePlaneDegrees,
    0,
    90,
    "angleFromSurfacePlaneDegrees",
  );
  const duration = readPositive(impactDurationMs, "impactDurationMs") / 1000;
  const transfer = readNonNegative(transferFactor, "transferFactor");
  const direction = normalizeVector(forceDirection, "forceDirection");

  const normalSpeedMps = speed * Math.sin((angle * Math.PI) / 180);
  const transferredImpulseNs = transfer * mass * normalSpeedMps;
  const averageForceN = transferredImpulseNs / duration;

  return {
    normalSpeedMps,
    transferredImpulseNs,
    averageForceN,
    forceVectorN: scaleVector(direction, averageForceN),
    assumptions: [
      "Average force is reconstructed from transferred normal impulse over the selected pulse duration.",
      "Force direction is expressed in the tibia-local principal-axis frame.",
      "The transfer factor requires scenario evidence and is not a fracture parameter.",
    ],
  };
}

export function calculateReducedOrderRisk({
  forceVectorN,
  contactOffsetM,
  geometry,
  capacitiesPa,
  capacityFactors,
}) {
  const force = readVector(forceVectorN, "forceVectorN");
  const offset = readVector(contactOffsetM, "contactOffsetM");
  const section = readGeometry(geometry);
  const capacities = readCapacities(capacitiesPa);
  const factors = readCapacityFactors(capacityFactors);

  const axialForceN = force.z;
  const transverseForceXN = force.x;
  const transverseForceYN = force.y;
  const transverseForceN = Math.hypot(transverseForceXN, transverseForceYN);
  const moment = cross(offset, force);
  const bendingMomentXNm = moment.x;
  const bendingMomentYNm = moment.y;
  const torqueNm = moment.z;

  const axialStressPa = axialForceN / section.areaM2;
  const bendingStressBoundPa =
    (Math.abs(bendingMomentXNm) * section.outerDistanceYM)
      / section.secondMomentXM4
    + (Math.abs(bendingMomentYNm) * section.outerDistanceXM)
      / section.secondMomentYM4;
  const tensionDemandPa = Math.max(0, axialStressPa + bendingStressBoundPa);
  const compressionDemandPa = Math.max(0, -axialStressPa + bendingStressBoundPa);
  const transverseShearPa =
    (section.shearFactor * transverseForceN) / section.areaM2;
  const torsionalShearPa =
    (Math.abs(torqueNm) * section.torsionRadiusM) / section.torsionConstantM4;
  const shearDemandBoundPa = transverseShearPa + torsionalShearPa;

  const capacityMultiplier = factors.mission * factors.person * factors.site;
  const adjustedCapacitiesPa = {
    tension: capacities.tension * capacityMultiplier,
    compression: capacities.compression * capacityMultiplier,
    shear: capacities.shear * capacityMultiplier,
  };
  const utilization = {
    tension: tensionDemandPa / adjustedCapacitiesPa.tension,
    compression: compressionDemandPa / adjustedCapacitiesPa.compression,
    shear: shearDemandBoundPa / adjustedCapacitiesPa.shear,
  };
  const governingMode = Object.entries(utilization)
    .reduce((governing, candidate) => (
      candidate[1] > governing[1] ? candidate : governing
    ))[0];
  const relativeMechanicalRiskIndex = utilization[governingMode];

  return {
    modelStatus: MECHANICS_V2_STATUS,
    sectionResultants: {
      axialForceN,
      transverseForceXN,
      transverseForceYN,
      transverseForceN,
      bendingMomentXNm,
      bendingMomentYNm,
      torqueNm,
    },
    demandsPa: {
      axialStress: axialStressPa,
      bendingStressBound: bendingStressBoundPa,
      tension: tensionDemandPa,
      compression: compressionDemandPa,
      transverseShear: transverseShearPa,
      torsionalShear: torsionalShearPa,
      shearBound: shearDemandBoundPa,
    },
    adjustedCapacitiesPa,
    utilization,
    relativeMechanicalRiskIndex,
    governingMode,
    modeledCapacityExceeded: relativeMechanicalRiskIndex >= 1,
    assumptions: [
      "The tibia is represented by one principal-axis beam section.",
      "Bending and shear equations are conservative nominal outer-fiber bounds.",
      "Boundary reactions, local stress concentration, damage, and fracture propagation are not resolved.",
      "RI is a relative demand-capacity index, not a clinical fracture probability.",
    ],
  };
}

function readGeometry(value = {}) {
  return {
    areaM2: readPositive(value.areaM2, "geometry.areaM2"),
    secondMomentXM4: readPositive(
      value.secondMomentXM4,
      "geometry.secondMomentXM4",
    ),
    secondMomentYM4: readPositive(
      value.secondMomentYM4,
      "geometry.secondMomentYM4",
    ),
    torsionConstantM4: readPositive(
      value.torsionConstantM4,
      "geometry.torsionConstantM4",
    ),
    outerDistanceXM: readPositive(
      value.outerDistanceXM,
      "geometry.outerDistanceXM",
    ),
    outerDistanceYM: readPositive(
      value.outerDistanceYM,
      "geometry.outerDistanceYM",
    ),
    torsionRadiusM: readPositive(
      value.torsionRadiusM,
      "geometry.torsionRadiusM",
    ),
    shearFactor: readPositive(value.shearFactor, "geometry.shearFactor"),
  };
}

function readCapacities(value = {}) {
  return {
    tension: readPositive(value.tension, "capacitiesPa.tension"),
    compression: readPositive(value.compression, "capacitiesPa.compression"),
    shear: readPositive(value.shear, "capacitiesPa.shear"),
  };
}

function readCapacityFactors(value = {}) {
  return {
    mission: readPositive(value.mission, "capacityFactors.mission"),
    person: readPositive(value.person, "capacityFactors.person"),
    site: readPositive(value.site, "capacityFactors.site"),
  };
}

function readVector(value = {}, label) {
  return {
    x: readFinite(value.x, `${label}.x`),
    y: readFinite(value.y, `${label}.y`),
    z: readFinite(value.z, `${label}.z`),
  };
}

function normalizeVector(value, label) {
  const vector = readVector(value, label);
  const magnitude = Math.hypot(vector.x, vector.y, vector.z);
  if (magnitude <= 0) {
    throw new RangeError(`${label} must have non-zero magnitude`);
  }
  return scaleVector(vector, 1 / magnitude);
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function readFinite(value, name) {
  const number = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return number;
}

function readPositive(value, name) {
  const number = readFinite(value, name);
  if (number <= 0) throw new RangeError(`${name} must be greater than 0`);
  return number;
}

function readNonNegative(value, name) {
  const number = readFinite(value, name);
  if (number < 0) throw new RangeError(`${name} must be at least 0`);
  return number;
}

function readBetween(value, minimum, maximum, name) {
  const number = readFinite(value, name);
  if (number < minimum || number > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return number;
}
