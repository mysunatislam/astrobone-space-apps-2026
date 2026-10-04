import { ELENA } from "./elenaMissionScenario.js";
import { MODEL_DEFAULTS, RISK_THRESHOLDS } from "./riskModel.js";

// Digital-twin state at mission day t. Every value the twin animates comes from here:
// fixture observations step to the last recorded checkpoint, model estimates are continuous.
export const MISSION_LENGTH = ELENA.identity.duration.value;
export const CURRENT_DAY = ELENA.identity.currentDay.value;
export const CHECKPOINTS = ELENA.observations.map(row => row.day.value);
const DAYS_PER_MONTH = 30.4375;

// Display scale for the skeletal tint: 0 % to the model's value at mission end (Day 240 ~ 9.9 %).
export const BONE_TINT_SCALE = Object.freeze({ min: 0, max: 0.10 });
// Visual multiplier only: radiation tracks drawn per mGy of cumulative synthetic dose.
export const TRACKS_PER_MGY = 2;
export const MAX_TRACKS = 120;
// Parameter-table confidence for the capacity-loss rate (docs/parameter-evidence-table.md, B-05).
export const BONE_MODEL_EVIDENCE = Object.freeze({ id: "B-05", level: "Low", solidity: 0.55 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const value = field => field?.value;

export function observationAt(day) {
  const rows = ELENA.observations.filter(row => row.day.value <= day);
  const row = rows.at(-1) ?? ELENA.observations[0];
  return {
    recordDay: row.day.value,
    stage: row.stage.value,
    kneeExtension: row.kneeExtension.value,
    kneeRom: row.kneeRom.value,
    heartRate: row.heartRate.value,
    absorbedDose: row.absorbedDose.value,
    trackingQuality: row.trackingQuality.value,
    heartQuality: row.heartQuality.value,
    authoredScenario: row.day.value > CURRENT_DAY,
  };
}

// Same capacity modifier as calculateRisk(): months x monthly rate, clamped by the model safeguard.
export function boneCapacityChange(day, { rate = MODEL_DEFAULTS.monthlyMicrogravityLossRate, max = MODEL_DEFAULTS.maximumMicrogravityLossFraction } = {}) {
  const lossFraction = clamp((Math.max(0, day) / DAYS_PER_MONTH) * rate, 0, max);
  return { lossFraction, capacityFactor: 1 - lossFraction, ratePerMonth: rate, parameter: BONE_MODEL_EVIDENCE.id };
}

const TINT_STOPS = [
  [0, [0.30, 0.86, 1.00]],
  [0.35, [0.36, 0.95, 0.80]],
  [0.6, [0.98, 0.86, 0.38]],
  [1, [1.00, 0.56, 0.22]],
];

// Cyan -> teal -> yellow -> amber. Red is reserved for capacity exceedance in the impact model.
export function boneTint(lossFraction) {
  const t = clamp((lossFraction - BONE_TINT_SCALE.min) / (BONE_TINT_SCALE.max - BONE_TINT_SCALE.min), 0, 1);
  for (let i = 1; i < TINT_STOPS.length; i++) {
    const [t1, c1] = TINT_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TINT_STOPS[i - 1], k = (t - t0) / (t1 - t0);
      return c0.map((v, j) => v + (c1[j] - v) * k);
    }
  }
  return TINT_STOPS.at(-1)[1];
}

const STRESS_STOPS = [[0, [0.10, 0.25, 0.95]], [0.2, [0.10, 0.80, 1.00]], [0.4, [0.20, 0.95, 0.45]], [0.6, [0.98, 0.92, 0.25]], [0.8, [1.00, 0.55, 0.15]], [1, [1.00, 0.18, 0.15]]];
// Blue -> cyan -> green -> yellow -> orange -> red for normalized solver output.
export function stressColor(relative) {
  const t = clamp(relative, 0, 1);
  for (let i = 1; i < STRESS_STOPS.length; i++) {
    const [t1, c1] = STRESS_STOPS[i];
    if (t <= t1) { const [t0, c0] = STRESS_STOPS[i - 1], k = (t - t0) / (t1 - t0); return c0.map((v, j) => v + (c1[j] - v) * k); }
  }
  return STRESS_STOPS.at(-1)[1];
}

export const beatHz = bpm => (Number.isFinite(bpm) && bpm > 0 ? bpm / 60 : 0);
export const radiationTrackCount = doseMgy => clamp(Math.round(Math.max(0, doseMgy) * TRACKS_PER_MGY), 0, MAX_TRACKS);

export function dcrBand(ratio) {
  if (ratio >= RISK_THRESHOLDS.capacityExceeded) return { key: "capacityExceeded", label: "CAPACITY EXCEEDED", range: "DCR ≥ 1.00" };
  if (ratio >= RISK_THRESHOLDS.elevated) return { key: "elevated", label: "ELEVATED", range: "0.80 ≤ DCR < 1.00" };
  if (ratio >= RISK_THRESHOLDS.monitor) return { key: "monitor", label: "MONITOR", range: "0.50 ≤ DCR < 0.80" };
  return { key: "lower", label: "LOWER", range: "DCR < 0.50" };
}

// Two-sided 97.5 % Student-t quantiles for small samples.
const T975 = [NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];

// Ordinary least squares on observations up to the forecast origin; 95 % prediction interval.
// A statistical trend extrapolation, not a physiological model.
export function trendPrediction(points, targetDay) {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.day, 0) / n, my = points.reduce((s, p) => s + p.value, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.day - mx) ** 2, 0);
  if (sxx === 0) return null;
  const slope = points.reduce((s, p) => s + (p.day - mx) * (p.value - my), 0) / sxx, intercept = my - slope * mx;
  const sse = points.reduce((s, p) => s + (p.value - (intercept + slope * p.day)) ** 2, 0);
  const sd = Math.sqrt(sse / (n - 2)), t = T975[n - 2] ?? 1.96;
  const at = day => {
    const predicted = intercept + slope * day, half = t * sd * Math.sqrt(1 + 1 / n + (day - mx) ** 2 / sxx);
    return { day, predicted, low: predicted - half, high: predicted + half, halfWidth: half };
  };
  return { slope, intercept, residualSd: sd, n, fitDays: points.map(p => p.day), ...at(targetDay), at };
}

export function kneeSeries(extra = []) {
  return [...ELENA.observations.map(row => ({ day: row.day.value, value: row.kneeExtension.value, quality: row.trackingQuality.value, source: "SYNTHETIC DEMO" })), ...extra]
    .sort((a, b) => a.day - b.day);
}

// Predicted vs observed at a checkpoint: the trend is fitted only to earlier observations.
export function predictedVsObserved(day, extra = []) {
  const series = kneeSeries(extra), observed = series.find(p => p.day === day);
  const prior = series.filter(p => p.day < day && p.quality >= 0.7);
  const forecast = observed ? trendPrediction(prior, day) : null;
  if (!observed || !forecast) return { day, observed: observed ?? null, forecast: null, verdict: "INSUFFICIENT HISTORY" };
  const residual = observed.value - forecast.predicted, inside = observed.value >= forecast.low && observed.value <= forecast.high;
  return { day, observed, forecast, residual, inside, verdict: inside ? "WITHIN PREDICTION INTERVAL" : "OUTSIDE PREDICTION INTERVAL" };
}

export function latestCheckpoint(day) {
  return CHECKPOINTS.filter(d => d <= day).at(-1) ?? CHECKPOINTS[0];
}

export function twinState(day, { eventDay = null, eventIncrement = value(ELENA.event.increment) } = {}) {
  const d = clamp(Math.round(day), 1, MISSION_LENGTH), obs = observationAt(d), base = observationAt(1), bone = boneCapacityChange(d);
  const event = eventDay !== null && d >= eventDay;
  const dose = Number((obs.absorbedDose + (event ? eventIncrement : 0)).toFixed(2));
  return {
    day: d,
    observation: obs,
    baseline: base,
    bone: { ...bone, tint: boneTint(bone.lossFraction), evidence: BONE_MODEL_EVIDENCE },
    heart: { bpm: obs.heartRate, baselineBpm: base.heartRate, delta: obs.heartRate - base.heartRate, hz: beatHz(obs.heartRate), quality: obs.heartQuality },
    knee: { extension: obs.kneeExtension, baseline: base.kneeExtension, delta: obs.kneeExtension - base.kneeExtension, rom: obs.kneeRom, baselineRom: base.kneeRom, quality: obs.trackingQuality },
    radiation: { doseMgy: dose, recordedDoseMgy: obs.absorbedDose, eventIncluded: event, tracks: radiationTrackCount(dose) },
    authoredScenario: obs.authoredScenario,
    mission: { name: value(ELENA.identity.mission), destination: value(ELENA.identity.destination), length: MISSION_LENGTH, currentDay: CURRENT_DAY },
  };
}

export const PROVENANCE = Object.freeze({
  SYNTHETIC: "Authored fixture value (src/elenaMissionScenario.js). Not a sensor measurement.",
  MODEL: "Calculated by an AstroBone model from stated parameters. Not a measurement.",
  DERIVED: "Arithmetic on fixture values (difference, fit or interval).",
  ATLAS: "Z-Anatomy / BodyParts3D reference geometry. Not Elena's anatomy.",
  NASA: "External NASA research population. Never Elena's data.",
  NONE: "No data source exists for this quantity in AstroBone.",
});
