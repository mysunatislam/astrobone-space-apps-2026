import { calculateJointAngle } from "./functionalAssessment.js";
import { calculateReducedOrderRisk, reconstructAverageForce } from "./mechanicsV2.js";

export function beamCase({ forceN = 100, offsetM = .05, radiusM = .01 } = {}) {
  if (![forceN, offsetM, radiusM].every(Number.isFinite) || forceN < 0 || offsetM < 0 || radiusM <= 0) throw new Error("Positive finite SI inputs required");
  const area = Math.PI * radiusM ** 2, inertia = Math.PI * radiusM ** 4 / 4;
  return calculateReducedOrderRisk({ forceVectorN: { x: forceN, y: 0, z: 0 }, contactOffsetM: { x: 0, y: 0, z: offsetM },
    geometry: { areaM2: area, secondMomentXM4: inertia, secondMomentYM4: inertia, torsionConstantM4: 2 * inertia, outerDistanceXM: radiusM, outerDistanceYM: radiusM, torsionRadiusM: radiusM, shearFactor: 4 / 3 },
    capacitiesPa: { tension: 1e8, compression: 1e8, shear: 1e8 }, capacityFactors: { mission: 1, person: 1, site: 1 } });
}

export function runEngineeringChecks() {
  const standard = beamCase(), doubled = beamCase({ forceN: 200 });
  const impulse = reconstructAverageForce({ massKg: .2, speedMps: 3, angleFromSurfacePlaneDegrees: 90, impactDurationMs: 10, transferFactor: 1, forceDirection: { x: 1, y: 0, z: 0 } });
  const angle = deg => calculateJointAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180), z: 0 });
  return [
    ["Impulse / pulse duration", impulse.averageForceN, 60, "N"],
    ["Bending moment r x F", standard.sectionResultants.bendingMomentYNm, 5, "N m"],
    ["Circular-section bending", standard.demandsPa.bendingStressBound, 4 * 5 / (Math.PI * .01 ** 3), "Pa"],
    ["Transverse shear", standard.demandsPa.transverseShear, 4 * 100 / (3 * Math.PI * .01 ** 2), "Pa"],
    ["Linear force scaling", doubled.demandsPa.bendingStressBound / standard.demandsPa.bendingStressBound, 2, "ratio"],
    ["Zero-load boundary", beamCase({ forceN: 0 }).demandsPa.bendingStressBound, 0, "Pa"],
    ...[0, 30, 60, 90, 120, 180].map(deg => [`Joint angle ${deg} deg`, angle(deg), deg, "deg"]),
  ].map(([name, actual, expected, unit]) => ({ name, actual, expected, unit, absoluteError: Math.abs(actual - expected), passed: Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-8 * Math.max(1, Math.abs(expected)) }));
}

const METRICS = { knee_flexion: "deg", elbow_flexion: "deg", heart_rate: "bpm" };
export function evaluateReferencePairs(input) {
  if (input?.schema !== "astrobone-reference-v1" || METRICS[input.metric] !== input.unit) throw new Error("Unknown schema or incompatible metric/unit");
  if (typeof input.synthetic !== "boolean" || !input.reference_device?.trim() || !input.protocol?.trim()) throw new Error("Reference device, protocol and synthetic declaration required");
  if (!Array.isArray(input.pairs) || input.pairs.length < 2 || input.pairs.length > 10000) throw new Error("Supply 2 to 10,000 matched reference pairs");
  const ids = new Set(), valid = [], subjects = new Map(), allSubjects = new Set();
  for (const p of input.pairs) {
    if (!p.id || ids.has(p.id) || !p.subject_id) throw new Error("Unique sample IDs and pseudonymous subject IDs required");
    ids.add(p.id);
    allSubjects.add(p.subject_id);
    if (!Number.isFinite(p.reference) || p.reference < 0 || p.reference > (input.unit === "deg" ? 180 : 300)) throw new Error("Invalid reference value");
    if (p.estimate === null) continue;
    if (!Number.isFinite(p.estimate) || p.estimate < 0 || p.estimate > (input.unit === "deg" ? 180 : 300)) throw new Error("Invalid estimated value; use null for failed estimates");
    valid.push(p); if (!subjects.has(p.subject_id)) subjects.set(p.subject_id, []); subjects.get(p.subject_id).push(p);
  }
  if (valid.length < 2) throw new Error("At least two valid matched predictions required");
  const errors = valid.map(p => p.estimate - p.reference), mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const bias = mean(errors), sd = Math.sqrt(errors.reduce((sum, e) => sum + (e - bias) ** 2, 0) / (errors.length - 1));
  const subjectMae = [...subjects.values()].map(rows => mean(rows.map(p => Math.abs(p.estimate - p.reference))));
  return { schema: input.schema, metric: input.metric, unit: input.unit, synthetic: input.synthetic, referenceDevice: input.reference_device, protocol: input.protocol,
    total: input.pairs.length, evaluated: valid.length, coverage: valid.length / input.pairs.length, subjects: allSubjects.size,
    evaluatedSubjects: subjects.size, fullyFailedSubjects: allSubjects.size-subjects.size,
    mae: mean(errors.map(Math.abs)), rmse: Math.sqrt(mean(errors.map(e => e * e))), bias,
    descriptiveLimitsOfAgreement: [bias - 1.96 * sd, bias + 1.96 * sd], subjectMacroMae: mean(subjectMae),
    limitation: "User-supplied paired observations, not independently audited. Repeated frames are correlated; descriptive agreement limits are not confidence intervals or clinical approval." };
}
