// Camera-versus-reference knee angle check. A tester holds a knee still, reads it with a
// goniometer or phone inclinometer, and the camera averages the same knee over a short hold.
// Paired readings give Bland-Altman agreement (Bland & Altman, Lancet 1986) and a conservative
// minimal detectable change, so the self-check's 5° review trigger can be compared with
// measured error instead of assumed accuracy. Results describe this setup only.

import { cameraViewFor } from "./functionalAssessment.js";

export const ANGLE_CHECK_SCHEMA = "astrobone-angle-check-v1";
export const HOLD = Object.freeze({ durationMs: 3000, minSamples: 10, maxSd: 3 });
export const REFERENCE_TYPES = Object.freeze(["Goniometer", "Phone inclinometer", "Other"]);
const STORAGE_KEY = "astrobone-angle-check-pairs";

const mean = values => values.reduce((sum, v) => sum + v, 0) / values.length;
const sd = values => { if (values.length < 2) return 0; const m = mean(values); return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1)); };
const round = (value, digits = 1) => Number(value.toFixed(digits));

// Goniometers read knee flexion (0° = straight); the camera reports the interior angle (180° = straight).
export const flexionToInterior = flexion => 180 - flexion;
export const interiorToFlexion = interior => 180 - interior;

// Summarize one still hold from camera frames. A hold is usable only if enough frames tracked
// the chosen knee and the angle stayed steady, so a moving or poorly tracked knee is not paired.
// The knee angle is the one the self-check reports: the hybrid one (src/kneeHybrid.js) when every frame has it.
export function summarizeHold(frames, side) {
  const hybrid = frames.length > 0 && frames.every(f => Number.isFinite(f?.kneeHybrid?.[side]?.angle));
  const kneeOf = f => (hybrid ? f.kneeHybrid[side].angle : f?.angles?.[side]?.knee);
  const angles = frames.filter(f => (f?.sideUsable ? f.sideUsable[side] : f?.usable) && Number.isFinite(kneeOf(f))).map(kneeOf);
  if (angles.length < HOLD.minSamples) return { usable: false, samples: angles.length, reason: `only ${angles.length} usable frames (need ${HOLD.minSamples})` };
  const spread = sd(angles);
  if (spread > HOLD.maxSd) return { usable: false, samples: angles.length, sd: round(spread), reason: `knee moved during the hold (SD ${round(spread)}°, limit ${HOLD.maxSd}°)` };
  // Camera position during the hold, so the accuracy study can report facing and side-on separately.
  const yaws = frames.map(f => f?.bodyYawDeg).filter(Number.isFinite).sort((a, b) => a - b);
  const yaw = yaws.length ? yaws[yaws.length >> 1] : null;
  return { usable: true, samples: angles.length, sd: round(spread), interior: round(mean(angles)), flexion: round(interiorToFlexion(mean(angles))), bodyYawDeg: yaw === null ? null : round(yaw), cameraView: cameraViewFor(yaw), angleMethod: hybrid ? "hybrid" : "3d" };
}

// Two-sided 95% t quantiles for small samples; 1.96 beyond the table.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
const t95 = df => (df >= 1 && df <= T95.length ? T95[df - 1] : 1.96);

// Differences are camera minus reference, in flexion degrees.
export function agreement(pairs, { reviewTrigger = 5 } = {}) {
  const diffs = pairs.map(p => p.cameraFlexion - p.referenceFlexion).filter(Number.isFinite);
  const n = diffs.length, people = new Set(pairs.map(p => p.participant)).size;
  if (n < 2) return { n, people, ready: false, reason: "Record at least 2 pairs to estimate agreement; 20 or more across several people is a useful pilot." };
  const bias = mean(diffs), s = sd(diffs), half = t95(n - 1) * s / Math.sqrt(n);
  // Conservative: reference error is folded into the spread, so the camera alone is likely better.
  const mdc95 = 1.96 * Math.SQRT2 * s;
  return {
    n, people, ready: true,
    bias: round(bias), biasCi: [round(bias - half), round(bias + half)], sdDiff: round(s),
    loa: [round(bias - 1.96 * s), round(bias + 1.96 * s)],
    meanAbsError: round(mean(diffs.map(Math.abs))),
    mdc95: round(mdc95), reviewTrigger,
    triggerAboveNoise: reviewTrigger > mdc95,
    caution: n < 20 || people < 3 ? "Small pilot: fewer than 20 pairs or 3 people. Treat as preliminary." : null,
  };
}

// Once a pilot is large enough, the knee review floor is raised to the measured detectable change,
// so the self-check never calls a change that this camera setup cannot resolve. It is never lowered.
export const CALIBRATION = Object.freeze({ minPairs: 20, minPeople: 3 });
export function calibratedFloors(pairs, defaultFloor = 5) {
  const a = agreement(pairs, { reviewTrigger: defaultFloor });
  if (!a.ready || a.n < CALIBRATION.minPairs || a.people < CALIBRATION.minPeople || a.mdc95 <= defaultFloor) return {};
  return { kneeExtension: a.mdc95 };
}

export function pairsToCsv(pairs) {
  const head = "participant,side,camera_view,body_yaw_deg,reference_type,reference_flexion_deg,camera_flexion_deg,camera_hold_sd_deg,camera_samples,difference_deg,recorded_at";
  const cell = value => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [head, ...pairs.map(p => [p.participant, p.side, p.cameraView, p.bodyYawDeg, p.referenceType, p.referenceFlexion, p.cameraFlexion, p.holdSd, p.samples, round(p.cameraFlexion - p.referenceFlexion), p.at].map(cell).join(","))].join("\n");
}

// Pairs are kept in memory unless the tester consents to saving them on this device.
export function createAngleCheckStore(storage = globalThis.localStorage) {
  let memory = [];
  const read = () => { try { const value = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "[]"); return Array.isArray(value) ? value : []; } catch { return []; } };
  return {
    load(persist) { return persist ? read() : [...memory]; },
    save(pairs, persist) { memory = [...pairs]; if (!persist) return; try { storage?.setItem(STORAGE_KEY, JSON.stringify(pairs)); } catch { /* storage unavailable */ } },
    clear() { memory = []; try { storage?.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ } },
  };
}
