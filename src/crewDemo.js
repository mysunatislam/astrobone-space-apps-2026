import { SELF_CHECK_SCHEMA } from "./selfCheck.js";
import { ELENA_HISTORY, ELENA_CHECK_DAYS, VITAL_PROTOCOLS, elenaDay147 } from "./elenaSelfCheck.js";

// The rest of Elena's fictional crew, for the crew medical officer's and flight surgeon's view. Every
// value is authored for the demo, like Elena's; none is a measurement of a real person. Each crew member
// is judged by the same self-check engine against their own earlier checks, so the crew view shows how
// one rule set sorts four different people: one safety limit crossed, one change logged for review, one
// value to re-check, one steady.
export const CREW_BOUNDARY = "SYNTHETIC DEMO: four fictional crew members with authored self-check records. Not sensor data and not real astronauts.";

const PROTOCOLS = { kneeExtension: "restrained-knee-extension-demo-v1", kneeRom: "restrained-knee-extension-demo-v1", pvtSpeed: "pvt-b-3min-v2:touch", pvtLapses: "pvt-b-3min-v2:touch", restingHr: "resting-restrained-demo-v1", ...VITAL_PROTOCOLS };
const DAYS = [1, 30, 60, 90, 120, 147];
const KEYS = ["kneeExtension", "kneeRom", "restingHr", "systolicBp", "diastolicBp", "spo2", "glucose", "bodyTemp", "pvtSpeed", "pvtLapses", "sleepHours", "fatigue", "mood", "stress"];

// One row per checkpoint day, values in KEYS order.
function records(profileId, rows) {
  return DAYS.map((day, i) => ({
    schema: SELF_CHECK_SCHEMA, id: `DEMO-${profileId}-day-${day}`, profileId: `DEMO-${profileId}`, missionDay: day, at: `Mission day ${day}`,
    values: Object.fromEntries(KEYS.map((key, k) => [key, rows[i][k]])), protocols: { ...PROTOCOLS },
    quality: Object.fromEntries(KEYS.map(key => [key, true])), sources: { all: "SYNTHETIC DEMO" }, redFlags: {}, symptoms: {}, notes: "", synthetic: true,
  }));
}
const missed = (...days) => Array.from({ length: 147 }, (_, i) => i + 1).filter(day => !days.includes(day));

//                    knee ext, rom, HR, sys, dia, SpO2, glucose, temp, pvt speed, lapses, sleep, fatigue, mood, stress
const PRIYA = records("PRIYA", [
  [168, 82, 58, 116, 74, 98, 86, 36.6, 4.4, 1, 7.2, 2, 8, 3],
  [167, 81, 59, 114, 73, 98, 87, 36.7, 4.5, 1, 7.0, 2, 8, 3],
  [168, 82, 58, 115, 74, 98, 86, 36.8, 4.4, 1, 7.1, 2, 8, 3],
  [166, 81, 60, 114, 72, 97, 88, 36.8, 4.5, 2, 6.9, 2, 8, 3],
  [167, 80, 59, 115, 73, 98, 87, 36.8, 4.4, 1, 7.0, 2, 8, 3],
  [166, 80, 60, 114, 73, 98, 88, 36.9, 4.4, 1, 7.0, 2, 8, 3],
]);
// Blood pressure creeping up, then over the AHA stage 2 line (140/90) on Day 147: tell the crew medical officer today.
const DANIEL = records("DANIEL", [
  [163, 78, 64, 124, 80, 98, 92, 36.7, 4.1, 2, 6.6, 3, 7, 4],
  [162, 78, 65, 126, 81, 98, 93, 36.8, 4.1, 2, 6.5, 3, 7, 4],
  [163, 77, 66, 128, 82, 97, 93, 36.9, 4.0, 2, 6.4, 3, 7, 4],
  [161, 77, 66, 131, 84, 98, 94, 36.9, 4.1, 2, 6.5, 3, 7, 5],
  [162, 76, 67, 134, 86, 98, 94, 37.0, 4.0, 3, 6.4, 3, 7, 5],
  [161, 76, 68, 144, 92, 98, 95, 37.0, 4.0, 3, 6.3, 3, 6, 5],
]);
// One short night after a steady mission: outside her usual range once, so re-check at the next check.
const SOFIA = records("SOFIA", [
  [170, 84, 56, 110, 70, 99, 84, 36.5, 4.6, 1, 7.4, 2, 8, 3],
  [169, 84, 57, 109, 70, 99, 85, 36.6, 4.6, 1, 7.3, 2, 8, 3],
  [170, 83, 56, 110, 71, 98, 85, 36.7, 4.5, 1, 7.4, 2, 8, 3],
  [169, 83, 57, 109, 70, 99, 84, 36.7, 4.6, 1, 7.2, 2, 8, 3],
  [169, 84, 57, 110, 70, 99, 85, 36.7, 4.6, 1, 7.3, 2, 8, 3],
  [169, 83, 57, 110, 71, 99, 85, 36.8, 4.5, 1, 5.5, 3, 7, 4],
]);

const split = rows => ({ history: rows.slice(0, -1), today: rows.at(-1) });
export const CREW = Object.freeze([
  { id: "elena", name: "Elena Torres", role: "Commander", history: ELENA_HISTORY, today: elenaDay147(), checkDays: ELENA_CHECK_DAYS },
  { id: "daniel", name: "Daniel Okoye", role: "Flight engineer", ...split(DANIEL), checkDays: missed(12, 58, 101) },
  { id: "sofia", name: "Sofia Lindqvist", role: "Crew medical officer", ...split(SOFIA), checkDays: missed(77) },
  { id: "priya", name: "Priya Nair", role: "Mission specialist", ...split(PRIYA), checkDays: missed(19, 20, 64, 140) },
].map(Object.freeze));

export const crewMember = id => CREW.find(m => m.id === id) ?? null;
