export const SIMULATION_EVIDENCE_SCHEMA = "astrobone-simulation-evidence-v1";

export function validateSimulationEvidence(payload) {
  if (!payload || typeof payload !== "object") {
    throw new TypeError("Simulation evidence must be a JSON object.");
  }
  if (payload.schemaVersion !== SIMULATION_EVIDENCE_SCHEMA) {
    throw new Error(`Unsupported simulation schema: ${payload.schemaVersion ?? "missing"}.`);
  }
  if (payload.provenance?.modelClass !== "Simulink mathematical control-envelope model") {
    throw new Error("Simulation evidence does not identify the expected model class.");
  }
  if (payload.provenance?.simscapeUsed !== false) {
    throw new Error("Simulation evidence must state whether Simscape was used.");
  }
  if (
    payload.angleConvention?.canonicalField
    !== "impactAngleFromSurfacePlaneDegrees"
  ) {
    throw new Error("Simulation evidence uses an ambiguous impact-angle convention.");
  }

  const values = payload.thresholds?.values;
  assertClose(values?.monitor, 0.5, "monitor threshold");
  assertClose(values?.elevated, 0.8, "elevated threshold");
  assertClose(values?.capacityExceeded, 1, "capacity threshold");

  const scenario = payload.scenario;
  [
    "objectMassKg",
    "impactSpeedMps",
    "impactAngleFromSurfacePlaneDegrees",
    "contactAreaMm2",
    "impactDurationMs",
    "impactTimeSeconds",
    "boneElasticModulusGPa",
    "baselineCapacityMPa",
    "boneStrengthIndex",
    "microgravityMonths",
    "monthlyCapacityLossFraction",
    "maximumCapacityLossFraction",
  ].forEach((field) => assertFinite(scenario?.[field], `scenario.${field}`));

  if (scenario.impactAngleFromSurfacePlaneDegrees < 0
    || scenario.impactAngleFromSurfacePlaneDegrees > 90) {
    throw new RangeError("Simulation angle must be between 0 and 90 degrees.");
  }

  [
    "peakImpactForceN",
    "peakContactStressMPa",
    "adjustedCapacityMPa",
    "demandCapacityRatio",
  ].forEach((field) => assertFinite(payload.outputs?.[field], `outputs.${field}`));

  if (payload.scope?.clinicalProbability !== false) {
    throw new Error("Simulation evidence must not claim a clinical probability.");
  }
  if (payload.monteCarlo?.interpretation?.includes("not mission-occurrence") !== true) {
    throw new Error("Monte Carlo scenario fractions need an explicit interpretation.");
  }

  return payload;
}

export function simulationScenarioToUiState(payload) {
  const evidence = validateSimulationEvidence(payload);
  const scenario = evidence.scenario;

  return {
    mode: scenario.mode,
    objectType: scenario.objectType,
    motionMode: "stand",
    target: scenario.targetRegion,
    mass: scenario.objectMassKg * 1000,
    speed: scenario.impactSpeedMps,
    angle: scenario.impactAngleFromSurfacePlaneDegrees,
    contactArea: scenario.contactAreaMm2,
    boneIndex: scenario.boneStrengthIndex,
    microgravityDays: scenario.microgravityMonths * 30.4375,
    impactDurationMs: scenario.impactDurationMs,
    boneModulusGPa: scenario.boneElasticModulusGPa,
    baselineCapacityMPa: scenario.baselineCapacityMPa,
    monthlyMicrogravityLossRate: scenario.monthlyCapacityLossFraction,
    maximumMicrogravityLossFraction: scenario.maximumCapacityLossFraction,
  };
}

export function compareRiskToSimulation(calculatedRisk, payload, tolerance = {}) {
  const evidence = validateSimulationEvidence(payload);
  const limits = {
    forceRelative: tolerance.forceRelative ?? 1e-6,
    stressRelative: tolerance.stressRelative ?? 1e-6,
    capacityRelative: tolerance.capacityRelative ?? 1e-6,
    dcrRelative: tolerance.dcrRelative ?? 1e-6,
  };
  const comparisons = {
    force: relativeError(
      calculatedRisk.averageForceN,
      evidence.outputs.peakImpactForceN,
    ),
    stress: relativeError(
      calculatedRisk.contactStressPa / 1e6,
      evidence.outputs.peakContactStressMPa,
    ),
    capacity: relativeError(
      calculatedRisk.adjustedCapacity / 1e6,
      evidence.outputs.adjustedCapacityMPa,
    ),
    dcr: relativeError(
      calculatedRisk.demandCapacityRatio,
      evidence.outputs.demandCapacityRatio,
    ),
  };

  return {
    matches:
      comparisons.force <= limits.forceRelative
      && comparisons.stress <= limits.stressRelative
      && comparisons.capacity <= limits.capacityRelative
      && comparisons.dcr <= limits.dcrRelative,
    relativeErrors: comparisons,
  };
}

function assertFinite(value, label) {
  if (!Number.isFinite(Number(value))) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function assertClose(value, expected, label, tolerance = 1e-12) {
  assertFinite(value, label);
  if (Math.abs(Number(value) - expected) > tolerance) {
    throw new Error(`${label} must be ${expected}.`);
  }
}

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12);
}
