export const TARGET_META = {
  tibia: { label: "Tibia shaft", capacityFactor: 1, inResearchScope: true },
  femur: { label: "Femur shaft", capacityFactor: 1, inResearchScope: false },
  knee: { label: "Knee joint", capacityFactor: 1, inResearchScope: false },
  ankle: { label: "Ankle joint", capacityFactor: 1, inResearchScope: false },
};

export const MODEL_DEFAULTS = Object.freeze({
  impactDurationMs: 10,
  boneModulusGPa: 17,
  baselineCapacityMPa: 110,
  monthlyMicrogravityLossRate: 0.0125,
  maximumMicrogravityLossFraction: 0.3,
});

export const ANGLE_CONVENTION = Object.freeze({
  field: "angleFromSurfacePlaneDegrees",
  reference: "local surface plane",
  zeroDegrees: "tangential or glancing",
  ninetyDegrees: "normal impact",
});

export const RISK_THRESHOLDS = Object.freeze({
  monitor: 0.5,
  elevated: 0.8,
  capacityExceeded: 1,
});

export const RESEARCH_RANGES = Object.freeze({
  massKg: [0.1, 5],
  speedMps: [0.1, 5],
  angleDegrees: [0, 90],
  contactAreaMm2: [10, 5000],
  impactDurationMs: [1, 100],
  boneModulusGPa: [11.8, 20.9],
  baselineCapacityMPa: [75, 205],
  microgravityDays: [0, 183],
  boneIndex: [0.45, 1.2],
});

const MODEL_ASSUMPTIONS = Object.freeze([
  "Impact angle is measured from the local surface plane, so 90 degrees is a normal impact.",
  "The normal velocity component is arrested over the selected impact duration with no rebound.",
  "Contact stress is a uniform nominal stress over the selected area, not a local peak stress.",
  "Estimated strain uses a homogeneous, linear-elastic cortical-bone modulus.",
  "The baseline capacity is a tissue-level stress proxy, not a whole-tibia fracture load.",
  "The microgravity density-loss rate is used as an uncertain capacity modifier and is not a calibrated strength law.",
  "Demand-capacity thresholds are research bands requiring biomechanical and clinical validation.",
]);

export function calculateRisk(inputs) {
  const parameters = normalizeInputs(inputs);
  const targetMeta = TARGET_META[parameters.target];
  const warnings = collectWarnings(parameters, targetMeta);

  const angleRad = degToRad(parameters.angleDegrees);
  const normalComponent = Math.sin(angleRad);
  const normalImpactSpeedMps = parameters.speedMps * normalComponent;
  const kineticEnergyJ = 0.5 * parameters.massKg * parameters.speedMps ** 2;
  const normalImpactEnergyJ = 0.5 * parameters.massKg * normalImpactSpeedMps ** 2;

  // Level-A contact proxy: the normal velocity is brought to rest during the pulse.
  const estimatedImpulseNs = parameters.massKg * normalImpactSpeedMps;
  const averageForceN = estimatedImpulseNs / (parameters.impactDurationMs / 1000);
  const contactAreaM2 = parameters.contactAreaMm2 * 1e-6;
  const contactStressPa = averageForceN / contactAreaM2;
  const boneModulusPa = parameters.boneModulusGPa * 1e9;
  const estimatedStrain = contactStressPa / boneModulusPa;

  const microgravityMonths = parameters.microgravityDays / 30.4375;
  const microgravityLossFraction = clamp(
    microgravityMonths * parameters.monthlyMicrogravityLossRate,
    0,
    parameters.maximumMicrogravityLossFraction,
  );
  const microgravityCapacityFactor = 1 - microgravityLossFraction;
  const personCapacityFactor = parameters.boneIndex;
  const siteCapacityFactor = targetMeta.capacityFactor;

  const baselineCapacity = parameters.baselineCapacityMPa * 1e6;
  const adjustedCapacity = baselineCapacity
    * microgravityCapacityFactor
    * siteCapacityFactor
    * personCapacityFactor;
  const mechanicalDemandRatio = contactStressPa / baselineCapacity;
  const demandCapacityRatio = contactStressPa / adjustedCapacity;
  const riskBand = getRiskBand(demandCapacityRatio);

  return {
    kineticEnergyJ,
    normalImpactEnergyJ,
    estimatedImpulseNs,
    averageForceN,
    contactStressPa,
    estimatedStrain,
    baselineCapacity,
    adjustedCapacity,
    demandCapacityRatio,
    riskBand,
    assumptions: [...MODEL_ASSUMPTIONS],
    warnings,
    normalImpactSpeedMps,
    normalComponent,
    mechanicalDemandRatio,
    mechanicalDemandScore: clamp(mechanicalDemandRatio * 100, 0, 100),
    displaySeverity: clamp(demandCapacityRatio * 100, 0, 100),
    capacityFactors: {
      microgravity: microgravityCapacityFactor,
      site: siteCapacityFactor,
      person: personCapacityFactor,
    },
    fragility: baselineCapacity / adjustedCapacity,
    spaceLoss: microgravityLossFraction,
    confidence: warnings.length === 0 ? "Research model" : "Outside frozen scope",
    inputs: parameters,
  };
}

export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

function normalizeInputs(inputs = {}) {
  const usesCanonicalMass = inputs.massKg !== undefined;
  const massValue = usesCanonicalMass
    ? readFinite(inputs.massKg, "massKg")
    : readFinite(inputs.mass, "mass") / 1000;
  const speedMps = readFinite(inputs.speedMps ?? inputs.speed, "speedMps");
  const angleDegrees = readFinite(
    inputs.angleDegrees ?? inputs.angle,
    "angleDegrees",
  );
  const contactAreaMm2 = readFinite(
    inputs.contactAreaMm2 ?? inputs.contactArea,
    "contactAreaMm2",
  );
  const impactDurationMs = readOptionalFinite(
    inputs.impactDurationMs,
    MODEL_DEFAULTS.impactDurationMs,
    "impactDurationMs",
  );
  const boneModulusGPa = readOptionalFinite(
    inputs.boneModulusGPa,
    MODEL_DEFAULTS.boneModulusGPa,
    "boneModulusGPa",
  );
  const baselineCapacityMPa = readOptionalFinite(
    inputs.baselineCapacityMPa,
    MODEL_DEFAULTS.baselineCapacityMPa,
    "baselineCapacityMPa",
  );
  const boneIndex = readOptionalFinite(inputs.boneIndex, 1, "boneIndex");
  const microgravityDays = readOptionalFinite(
    inputs.microgravityDays,
    0,
    "microgravityDays",
  );
  const monthlyMicrogravityLossRate = readOptionalFinite(
    inputs.monthlyMicrogravityLossRate,
    MODEL_DEFAULTS.monthlyMicrogravityLossRate,
    "monthlyMicrogravityLossRate",
  );
  const maximumMicrogravityLossFraction = readOptionalFinite(
    inputs.maximumMicrogravityLossFraction,
    MODEL_DEFAULTS.maximumMicrogravityLossFraction,
    "maximumMicrogravityLossFraction",
  );
  const target = inputs.target ?? "tibia";
  const mode = inputs.mode ?? "space";

  assertAtLeast(massValue, 0, "massKg");
  assertAtLeast(speedMps, 0, "speedMps");
  assertBetween(angleDegrees, 0, 90, "angleDegrees");
  assertGreaterThan(contactAreaMm2, 0, "contactAreaMm2");
  assertGreaterThan(impactDurationMs, 0, "impactDurationMs");
  assertGreaterThan(boneModulusGPa, 0, "boneModulusGPa");
  assertGreaterThan(baselineCapacityMPa, 0, "baselineCapacityMPa");
  assertGreaterThan(boneIndex, 0, "boneIndex");
  assertAtLeast(microgravityDays, 0, "microgravityDays");
  assertBetween(monthlyMicrogravityLossRate, 0, 1, "monthlyMicrogravityLossRate");
  assertBetween(
    maximumMicrogravityLossFraction,
    0,
    0.95,
    "maximumMicrogravityLossFraction",
  );

  if (!TARGET_META[target]) {
    throw new RangeError(`target must be one of: ${Object.keys(TARGET_META).join(", ")}`);
  }
  if (mode !== "space") {
    throw new RangeError('mode must be "space" for the exploration-crew model');
  }

  return {
    mode,
    target,
    massKg: massValue,
    speedMps,
    angleDegrees,
    contactAreaMm2,
    impactDurationMs,
    boneModulusGPa,
    baselineCapacityMPa,
    boneIndex,
    microgravityDays,
    monthlyMicrogravityLossRate,
    maximumMicrogravityLossFraction,
  };
}

function collectWarnings(parameters, targetMeta) {
  const warnings = [];
  if (!targetMeta.inResearchScope) {
    warnings.push(`${targetMeta.label} is outside the frozen tibia research scope.`);
  }
  const rangeChecks = [
    ["Object mass", parameters.massKg, RESEARCH_RANGES.massKg, "kg"],
    ["Impact speed", parameters.speedMps, RESEARCH_RANGES.speedMps, "m/s"],
    ["Impact angle", parameters.angleDegrees, RESEARCH_RANGES.angleDegrees, "degrees"],
    ["Contact area", parameters.contactAreaMm2, RESEARCH_RANGES.contactAreaMm2, "mm2"],
    ["Impact duration", parameters.impactDurationMs, RESEARCH_RANGES.impactDurationMs, "ms"],
    ["Bone modulus", parameters.boneModulusGPa, RESEARCH_RANGES.boneModulusGPa, "GPa"],
    ["Baseline capacity", parameters.baselineCapacityMPa, RESEARCH_RANGES.baselineCapacityMPa, "MPa"],
    ["Microgravity exposure", parameters.microgravityDays, RESEARCH_RANGES.microgravityDays, "days"],
    ["Bone strength index", parameters.boneIndex, RESEARCH_RANGES.boneIndex, "ratio"],
  ];

  rangeChecks.forEach(([label, value, [minimum, maximum], unit]) => {
    if (value < minimum || value > maximum) {
      warnings.push(
        `${label} (${formatNumber(value)} ${unit}) is outside the initial research range ${minimum}-${maximum} ${unit}.`,
      );
    }
  });

  return warnings;
}

function getRiskBand(demandCapacityRatio) {
  if (demandCapacityRatio >= RISK_THRESHOLDS.capacityExceeded) {
    return {
      key: "capacity-exceedance",
      label: "Potential capacity exceedance",
      range: "DCR >= 1.00",
    };
  }
  if (demandCapacityRatio >= RISK_THRESHOLDS.elevated) {
    return {
      key: "elevated",
      label: "Elevated relative concern",
      range: "0.80 <= DCR < 1.00",
    };
  }
  if (demandCapacityRatio >= RISK_THRESHOLDS.monitor) {
    return {
      key: "monitor",
      label: "Monitor",
      range: "0.50 <= DCR < 0.80",
    };
  }
  return {
    key: "lower",
    label: "Lower relative concern",
    range: "DCR < 0.50",
  };
}

function readFinite(value, name) {
  const number = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(number)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return number;
}

function readOptionalFinite(value, fallback, name) {
  return value === undefined ? fallback : readFinite(value, name);
}

function assertGreaterThan(value, minimum, name) {
  if (value <= minimum) {
    throw new RangeError(`${name} must be greater than ${minimum}`);
  }
}

function assertAtLeast(value, minimum, name) {
  if (value < minimum) {
    throw new RangeError(`${name} must be at least ${minimum}`);
  }
}

function assertBetween(value, minimum, maximum, name) {
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
