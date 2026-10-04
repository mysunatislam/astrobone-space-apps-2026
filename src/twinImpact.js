import { calculateRisk } from "./riskModel.js";
import { dcrBand } from "./twinModel.js";

const field = (value, unit, boundary = "Authored reconstruction input for the synthetic impact branch; not a measured event.") =>
  ({ value, unit, provenance: "SYNTHETIC DEMO", boundary });

// Impact branch of the fictional Elena mission. Inputs are the Level-A reference scenario
// (public/simulations/astrobone-level-a-v1.json) re-evaluated at Elena's mission day.
// The main mission record is unchanged; the post-event check exists only in this branch.
export const IMPACT_SCENARIO = Object.freeze({
  schema: "astrobone-elena-impact-branch-v1",
  label: field("Unsecured tool strikes left tibia", "label"),
  day: field(147, "mission day"),
  target: field("Tibia.l", "atlas structure"),
  object: field("Loose stowage tool", "label"),
  massKg: field(2, "kg"),
  speedMps: field(4, "m/s"),
  angleFromSurfacePlaneDegrees: field(75, "deg", "Measured from the local surface plane; 90 deg is a normal impact."),
  contactAreaMm2: field(60, "mm2"),
  impactDurationMs: field(8, "ms"),
  baselineCapacityMPa: field(25, "MPa", "Effective research-envelope stress proxy from the Level-A reference; not calibrated whole-tibia strength."),
  maximumLossFraction: field(0.35, "fraction", "Level-A reference safeguard; not a biological limit."),
  postEventCheck: Object.freeze({
    day: field(148, "mission day"),
    kneeExtension: field(141, "deg", "Authored post-event observation for this branch only."),
    kneeRom: field(52, "deg", "Authored post-event observation for this branch only."),
    trackingQuality: field(0.92, "fraction", "Synthetic input-quality indicator, not accuracy."),
  }),
  boundary: "Fictional event. Reconstruction inputs are authored. Outputs are research-model estimates, not an injury assessment or diagnosis.",
});

export function impactInputs(scenario = IMPACT_SCENARIO, overrides = {}) {
  return {
    target: "tibia",
    massKg: scenario.massKg.value,
    speedMps: scenario.speedMps.value,
    angleDegrees: scenario.angleFromSurfacePlaneDegrees.value,
    contactAreaMm2: scenario.contactAreaMm2.value,
    impactDurationMs: scenario.impactDurationMs.value,
    baselineCapacityMPa: scenario.baselineCapacityMPa.value,
    maximumMicrogravityLossFraction: scenario.maximumLossFraction.value,
    microgravityDays: scenario.day.value,
    boneIndex: 1,
    ...overrides,
  };
}

export function evaluateImpact(scenario = IMPACT_SCENARIO, overrides = {}) {
  const result = calculateRisk(impactInputs(scenario, overrides));
  return { ...result, band: dcrBand(result.demandCapacityRatio) };
}

// Deterministic PRNG so the same seed always gives the same Monte Carlo result.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampler(spec, random) {
  if (spec.distribution === "fixed") return () => spec.value;
  if (spec.distribution === "uniform") return () => spec.minimum + (spec.maximum - spec.minimum) * random();
  if (spec.distribution === "triangular") {
    const { minimum: a, mode: c, maximum: b } = spec, split = (c - a) / (b - a);
    return () => { const u = random(); return u < split ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)); };
  }
  if (spec.distribution === "truncated normal") {
    return () => {
      for (let i = 0; i < 1000; i++) {
        const u = Math.max(random(), 1e-12), v = random();
        const x = spec.mean + spec.standardDeviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        if (x >= spec.minimum && x <= spec.maximum) return x;
      }
      return Math.min(spec.maximum, Math.max(spec.minimum, spec.mean));
    };
  }
  throw new RangeError(`Unsupported distribution: ${spec.distribution}`);
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

// Each run is one calculateRisk() call, the same engine as the deterministic event result.
export function runMonteCarlo({ runs = 10000, seed = 24072026, distributions }) {
  const random = mulberry32(seed), draw = Object.fromEntries(Object.entries(distributions).map(([key, spec]) => [key, sampler(spec, random)]));
  const ratios = new Float64Array(runs), bands = new Uint8Array(runs), counts = { lower: 0, monitor: 0, elevated: 0, capacityExceeded: 0 };
  const order = ["lower", "monitor", "elevated", "capacityExceeded"];
  for (let i = 0; i < runs; i++) {
    const inputs = { target: "tibia", boneIndex: 1 };
    for (const key of Object.keys(draw)) inputs[key] = draw[key]();
    const ratio = calculateRisk(inputs).demandCapacityRatio, band = dcrBand(ratio).key;
    ratios[i] = ratio; bands[i] = order.indexOf(band); counts[band]++;
  }
  const sorted = Float64Array.from(ratios).sort(), mean = sorted.reduce((s, x) => s + x, 0) / runs;
  const sd = Math.sqrt(sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (runs - 1));
  return {
    runs, seed, ratios, bands, order,
    fractions: Object.fromEntries(order.map(key => [key, counts[key] / runs])),
    summary: { mean, median: percentile(sorted, 0.5), standardDeviation: sd, p05: percentile(sorted, 0.05), p95: percentile(sorted, 0.95), p99: percentile(sorted, 0.99), maximum: sorted[runs - 1] },
    interpretation: "Fractions of simulated runs under the stated input distributions; not mission-occurrence or clinical probabilities.",
  };
}

// Uncertainty around the reconstructed event. Mass/speed/angle spreads are authored assumptions;
// contact area, pulse, capacity and loss-rate distributions are the Level-A reference distributions.
export function eventDistributions(scenario = IMPACT_SCENARIO, reference) {
  const ref = name => reference.find(row => row.input === name);
  const m = scenario.massKg.value, v = scenario.speedMps.value, a = scenario.angleFromSurfacePlaneDegrees.value;
  return {
    massKg: { distribution: "triangular", minimum: m * 0.75, mode: m, maximum: m * 1.25, note: "Authored ±25 % reconstruction spread" },
    speedMps: { distribution: "triangular", minimum: v * 0.75, mode: v, maximum: v * 1.25, note: "Authored ±25 % reconstruction spread" },
    angleDegrees: { distribution: "triangular", minimum: Math.max(0, a - 15), mode: a, maximum: Math.min(90, a + 15), note: "Authored ±15 deg reconstruction spread" },
    contactAreaMm2: { ...ref("Contact area") },
    impactDurationMs: { ...ref("Impact duration") },
    baselineCapacityMPa: { ...ref("Baseline capacity") },
    monthlyMicrogravityLossRate: { ...ref("Monthly capacity loss") },
    microgravityDays: { distribution: "fixed", value: scenario.day.value, note: "Elena's mission day at the event" },
    maximumMicrogravityLossFraction: { distribution: "fixed", value: scenario.maximumLossFraction.value },
  };
}

// The stored Level-A research envelope, expressed in calculateRisk() inputs.
export function envelopeDistributions(simulation) {
  const ref = name => simulation.monteCarlo.assumedInputDistributions.find(row => row.input === name);
  const months = ref("Microgravity exposure"), normal = ref("Impact angle from surface normal");
  return {
    massKg: { ...ref("Object mass") },
    speedMps: { ...ref("Impact speed") },
    // Uniform 0-90 from the normal maps to uniform 0-90 from the surface plane (plane = 90 - normal).
    angleDegrees: { distribution: "uniform", minimum: 90 - normal.maximum, maximum: 90 - normal.minimum },
    contactAreaMm2: { ...ref("Contact area") },
    impactDurationMs: { ...ref("Impact duration") },
    baselineCapacityMPa: { ...ref("Baseline capacity") },
    monthlyMicrogravityLossRate: { ...ref("Monthly capacity loss") },
    microgravityDays: { distribution: "triangular", minimum: months.minimum * 30.4375, mode: months.mode * 30.4375, maximum: months.maximum * 30.4375 },
    maximumMicrogravityLossFraction: { distribution: "fixed", value: simulation.scenario.maximumCapacityLossFraction },
  };
}

// Relative bending stress on a long bone, Euler-Bernoulli idealization:
// pinned at both ends, transverse point load at the impact, section from the mesh's
// own slice geometry (geometrically similar hollow cortex, so wall ratio cancels).
// Returns |sigma| / max|sigma| per vertex. Shape only; magnitude needs sourced section properties.
export function bendingStressField(positions, { impactPoint, loadDirection, slices = 48 }) {
  const count = positions.length / 3, centroid = [0, 0, 0];
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) centroid[k] += positions[i * 3 + k] / count;
  // Principal axis by power iteration on the covariance matrix.
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    const d = [0, 1, 2].map(k => positions[i * 3 + k] - centroid[k]);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r * 3 + c] += d[r] * d[c];
  }
  let axis = [0, 1, 0];
  for (let it = 0; it < 40; it++) {
    const next = [0, 1, 2].map(r => cov[r * 3] * axis[0] + cov[r * 3 + 1] * axis[1] + cov[r * 3 + 2] * axis[2]);
    const len = Math.hypot(...next) || 1; axis = next.map(x => x / len);
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const s = new Float64Array(count); let sMin = Infinity, sMax = -Infinity;
  for (let i = 0; i < count; i++) { s[i] = (positions[i * 3] - centroid[0]) * axis[0] + (positions[i * 3 + 1] - centroid[1]) * axis[1] + (positions[i * 3 + 2] - centroid[2]) * axis[2]; sMin = Math.min(sMin, s[i]); sMax = Math.max(sMax, s[i]); }
  const length = sMax - sMin;
  // Load direction projected into the cross-section plane.
  const along = dot(loadDirection, axis), d = [0, 1, 2].map(k => loadDirection[k] - along * axis[k]);
  const dl = Math.hypot(...d) || 1; for (let k = 0; k < 3; k++) d[k] /= dl;
  const e = [axis[1] * d[2] - axis[2] * d[1], axis[2] * d[0] - axis[0] * d[2], axis[0] * d[1] - axis[1] * d[0]];
  const bin = i => Math.min(slices - 1, Math.floor(((s[i] - sMin) / length) * slices));
  const sum = Array.from({ length: slices }, () => ({ n: 0, cd: 0, ce: 0, dd: 0, ee: 0 }));
  const local = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    const p = [0, 1, 2].map(k => positions[i * 3 + k] - centroid[k]);
    const pd = dot(p, d), pe = dot(p, e); local[i * 2] = pd; local[i * 2 + 1] = pe;
    const b = sum[bin(i)]; b.n++; b.cd += pd; b.ce += pe; b.dd += pd * pd; b.ee += pe * pe;
  }
  // Ellipse semi-axes from boundary-point variance (var = a^2 / 2), lightly smoothed along the shaft.
  const raw = sum.map(b => {
    if (b.n < 3) return null;
    const md = b.cd / b.n, me = b.ce / b.n;
    return { md, me, a: Math.sqrt(Math.max(2 * (b.dd / b.n - md * md), 1e-12)), b: Math.sqrt(Math.max(2 * (b.ee / b.n - me * me), 1e-12)) };
  });
  const section = raw.map((row, i) => {
    const near = [raw[i - 1], row, raw[i + 1]].filter(Boolean);
    return near.length ? { md: row?.md ?? near[0].md, me: row?.me ?? near[0].me, a: near.reduce((x, r) => x + r.a, 0) / near.length, b: near.reduce((x, r) => x + r.b, 0) / near.length } : null;
  });
  const impactS = dot([0, 1, 2].map(k => impactPoint[k] - centroid[k]), axis) - sMin, a = Math.min(Math.max(impactS, 0), length);
  const moment = x => (x <= a ? (length - a) * x : a * (length - x)) / length;
  const field = new Float32Array(count); let peak = 0, peakIndex = 0;
  for (let i = 0; i < count; i++) {
    const sec = section[bin(i)]; if (!sec) continue;
    // Second moment about the neutral axis (perpendicular to the load) of an elliptical section: (pi/4) a^3 b.
    const inertia = sec.a ** 3 * sec.b, distance = local[i * 2] - sec.md;
    const sigma = Math.abs(moment(s[i] - sMin) * distance / inertia);
    field[i] = sigma; if (sigma > peak) { peak = sigma; peakIndex = i; }
  }
  if (peak > 0) for (let i = 0; i < count; i++) field[i] /= peak;
  return { field, peakIndex, axis, length, impactFraction: a / length, centroid };
}
