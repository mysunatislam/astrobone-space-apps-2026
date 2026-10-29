import { ELENA } from "./elenaMissionScenario.js";
import { SELF_CHECK_SCHEMA } from "./selfCheck.js";

// Fictional self-check records for the demo astronaut. Knee and heart-rate values are the
// existing checkpoint values from elenaMissionScenario.js; behavioral, vital-sign and immune entries
// are authored here. None of these are measurements of a real person.
export const ELENA_SELF_CHECK_BOUNDARY = "SYNTHETIC DEMO: authored self-check records for a fictional astronaut. Not sensor data, not a validated behavioral or immune assessment.";

const BEHAVIOR = {
  1: { sleepHours: 7.0, fatigue: 2, mood: 8, stress: 3, pvtSpeed: 3.6, pvtLapses: 2 },
  30: { sleepHours: 6.8, fatigue: 2, mood: 8, stress: 3, pvtSpeed: 3.6, pvtLapses: 2 },
  60: { sleepHours: 6.9, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.5, pvtLapses: 3 },
  90: { sleepHours: 6.5, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.5, pvtLapses: 3 },
  120: { sleepHours: 6.4, fatigue: 3, mood: 7, stress: 4, pvtSpeed: 3.4, pvtLapses: 4 },
  147: { sleepHours: 5.2, fatigue: 4, mood: 6, stress: 6, pvtSpeed: 3.0, pvtLapses: 9 },
};

// Authored vital signs that follow the direction of published spaceflight findings, not their size for
// any one person: blood pressure a little lower in flight (Norsk et al. 2015), fasting blood sugar
// creeping up (insulin resistance, Hughson et al. 2016), resting temperature rising (Stahn et al. 2017).
const VITALS = {
  1: { systolicBp: 118, diastolicBp: 76, spo2: 98, glucose: 88, bodyTemp: 36.6 },
  30: { systolicBp: 114, diastolicBp: 73, spo2: 98, glucose: 90, bodyTemp: 36.9 },
  60: { systolicBp: 112, diastolicBp: 72, spo2: 97, glucose: 92, bodyTemp: 37.1 },
  90: { systolicBp: 113, diastolicBp: 72, spo2: 98, glucose: 93, bodyTemp: 37.2 },
  120: { systolicBp: 111, diastolicBp: 71, spo2: 98, glucose: 95, bodyTemp: 37.2 },
  147: { systolicBp: 112, diastolicBp: 72, spo2: 97, glucose: 97, bodyTemp: 37.3 },
};

export const VITAL_PROTOCOLS = Object.freeze({ systolicBp: "bp-seated-5min-v1", diastolicBp: "bp-seated-5min-v1", spo2: "spo2-rest-v1", glucose: "glucose-fasting-v1", bodyTemp: "temp-oral-v1" });
const PROTOCOLS = { kneeExtension: "restrained-knee-extension-demo-v1", kneeRom: "restrained-knee-extension-demo-v1", pvtSpeed: "pvt-b-3min-v2:touch", pvtLapses: "pvt-b-3min-v2:touch", restingHr: "resting-restrained-demo-v1", ...VITAL_PROTOCOLS };

function record(day, overrides = {}) {
  const row = ELENA.observations.find(r => r.day.value === day), behavior = BEHAVIOR[day];
  const values = { kneeExtension: row.kneeExtension.value, kneeRom: row.kneeRom.value, restingHr: row.heartRate.value, ...behavior, ...VITALS[day], ...overrides.values };
  const quality = Object.fromEntries(Object.keys(values).map(key => [key, true]));
  return {
    schema: SELF_CHECK_SCHEMA, id: `DEMO-ELENA-day-${day}${overrides.suffix ?? ""}`, profileId: "DEMO-ELENA", missionDay: day, at: `Mission day ${day}`,
    values, protocols: { ...PROTOCOLS }, quality: { ...quality, ...overrides.quality }, sources: { all: "SYNTHETIC DEMO" },
    redFlags: {}, symptoms: {}, notes: "", synthetic: true, ...overrides.extra,
  };
}

export const ELENA_HISTORY = [1, 30, 60, 90, 120].map(day => record(day));

// Authored adherence log for the routine and badges: the mission days Elena completed her daily check.
// Full records exist only for the checkpoint days above; she missed days 33-34, 88 and 131.
export const ELENA_CHECK_DAYS = Object.freeze(Array.from({ length: 146 }, (_, i) => i + 1).filter(day => ![33, 34, 88, 131].includes(day)));

// Day 147 demo session: a first movement capture that fails its quality gate, then a usable repeat.
export const ELENA_POOR_CAPTURE = Object.freeze({ kneeExtension: 135, kneeRom: 40, trackingQuality: 0.35, sampleCount: 8 });
export const ELENA_USABLE_CAPTURE = Object.freeze({ kneeExtension: 151, kneeRom: 62, trackingQuality: 0.94, sampleCount: 120 });
export const ELENA_PVT = Object.freeze({ protocol: "pvt-b-3min-v2", input: "touch", compareAs: "pvt-b-3min-v2:touch", validResponses: 46, falseStarts: 1, lapses: 9, meanSpeed: 3.0, medianRtMs: 318, usable: true });

export function elenaDay147(capture = ELENA_USABLE_CAPTURE) {
  return record(147, {
    values: { kneeExtension: capture.kneeExtension, kneeRom: capture.kneeRom },
    quality: { kneeExtension: capture.trackingQuality >= 0.7 && capture.sampleCount >= 12, kneeRom: capture.trackingQuality >= 0.7 && capture.sampleCount >= 12 },
  });
}
