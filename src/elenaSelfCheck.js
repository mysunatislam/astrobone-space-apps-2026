import { ELENA } from "./elenaMissionScenario.js";
import { SELF_CHECK_SCHEMA } from "./selfCheck.js";

// Fictional self-check records for the demo astronaut. Knee and heart-rate values are the
// existing checkpoint values from elenaMissionScenario.js; behavioral and immune entries are
// authored here. None of these are measurements of a real person.
export const ELENA_SELF_CHECK_BOUNDARY = "SYNTHETIC DEMO: authored self-check records for a fictional astronaut. Not sensor data, not a validated behavioral or immune assessment.";

const BEHAVIOR = {
  1: { sleepHours: 7.0, fatigue: 2, mood: 8, stress: 3, pvtSpeed: 3.6, pvtLapses: 2 },
  30: { sleepHours: 6.8, fatigue: 2, mood: 8, stress: 3, pvtSpeed: 3.6, pvtLapses: 2 },
  60: { sleepHours: 6.9, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.5, pvtLapses: 3 },
  90: { sleepHours: 6.5, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.5, pvtLapses: 3 },
  120: { sleepHours: 6.4, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.4, pvtLapses: 4 },
  147: { sleepHours: 5.2, fatigue: 4, mood: 6, stress: 6, pvtSpeed: 3.0, pvtLapses: 9 },
};

const PROTOCOLS = { kneeExtension: "restrained-knee-extension-demo-v1", kneeRom: "restrained-knee-extension-demo-v1", pvtSpeed: "pvt-b-3min", pvtLapses: "pvt-b-3min", restingHr: "resting-restrained-demo-v1" };

function record(day, overrides = {}) {
  const row = ELENA.observations.find(r => r.day.value === day), behavior = BEHAVIOR[day];
  const values = { kneeExtension: row.kneeExtension.value, kneeRom: row.kneeRom.value, restingHr: row.heartRate.value, ...behavior, ...overrides.values };
  const quality = Object.fromEntries(Object.keys(values).map(key => [key, true]));
  return {
    schema: SELF_CHECK_SCHEMA, id: `DEMO-ELENA-day-${day}${overrides.suffix ?? ""}`, profileId: "DEMO-ELENA", missionDay: day, at: `Mission day ${day}`,
    values, protocols: { ...PROTOCOLS }, quality: { ...quality, ...overrides.quality }, sources: { all: "SYNTHETIC DEMO" },
    redFlags: {}, symptoms: {}, notes: "", synthetic: true, ...overrides.extra,
  };
}

export const ELENA_HISTORY = [1, 30, 60, 90, 120].map(day => record(day));

// Day 147 demo session: a first movement capture that fails its quality gate, then a usable repeat.
export const ELENA_POOR_CAPTURE = Object.freeze({ kneeExtension: 135, kneeRom: 40, trackingQuality: 0.35, sampleCount: 8 });
export const ELENA_USABLE_CAPTURE = Object.freeze({ kneeExtension: 151, kneeRom: 62, trackingQuality: 0.94, sampleCount: 120 });
export const ELENA_PVT = Object.freeze({ protocol: "pvt-b-3min", validResponses: 46, falseStarts: 1, lapses: 9, meanSpeed: 3.0, medianRtMs: 318, usable: true });

export function elenaDay147(capture = ELENA_USABLE_CAPTURE) {
  return record(147, {
    values: { kneeExtension: capture.kneeExtension, kneeRom: capture.kneeRom },
    quality: { kneeExtension: capture.trackingQuality >= 0.7 && capture.sampleCount >= 12, kneeRom: capture.trackingQuality >= 0.7 && capture.sampleCount >= 12 },
  });
}
