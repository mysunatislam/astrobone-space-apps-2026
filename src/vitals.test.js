import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INDICATORS, SAFETY_LIMITS, safetyLimit, describeBound, applyVitals, vitalsFromValues, vitalEntryProblem, evaluateIndicator, evaluateSelfCheck, newCheck, GLUCOSE_MG_PER_MMOL } from "./selfCheck.js";
import { ELENA_HISTORY, elenaDay147 } from "./elenaSelfCheck.js";
import { replayGlucoseLimits } from "../scripts/replay-i4-glucose-limits.mjs";

const vitalsCheck = vitals => applyVitals(newCheck("you"), vitals);

test("the challenge's named vital signs are indicators with units and a plain explanation", () => {
  for (const key of ["systolicBp", "diastolicBp", "spo2", "glucose", "bodyTemp", "restingHr", "sleepHours", "mood"]) assert.ok(INDICATORS[key], key);
  assert.equal(INDICATORS.glucose.unit, "mg/dL");
  for (const [key, def] of Object.entries(INDICATORS)) assert.ok(def.about?.length > 40, `${key} explains what it is and why it matters in space`);
});

test("safety limits follow the published bounds at their edges", () => {
  const level = (key, v) => safetyLimit(key, v)?.level ?? null;
  // AHA: stage 2 is 140/90 or higher; crisis is higher than 180/120; low is below 90/60.
  assert.deepEqual([139, 140, 180, 181, 89].map(v => level("systolicBp", v)), [null, "attention", "attention", "urgent", "attention"]);
  assert.deepEqual([89, 90, 120, 121, 59].map(v => level("diastolicBp", v)), [null, "attention", "attention", "urgent", "attention"]);
  // NHS England: 93-94 % contact a clinician, 92 % or less urgent.
  assert.deepEqual([95, 94, 93, 92].map(v => level("spo2", v)), [null, "attention", "attention", "urgent"]);
  // ADA: 54 mg/dL clinically significant low, check ketones above 240; 200 random-glucose threshold.
  assert.deepEqual([54, 53, 70, 199, 200, 241].map(v => level("glucose", v)), [null, "urgent", null, null, "attention", "urgent"]);
  // Mayo Clinic: fever 37.8 °C, call at 39.4 °C, hypothermia below 35 °C.
  assert.deepEqual([37.7, 37.8, 39.4, 34.9].map(v => level("bodyTemp", v)), [null, "attention", "urgent", "urgent"]);
  assert.equal(describeBound([">=", 140], "mmHg"), "at or above 140 mmHg");
  assert.equal(safetyLimit("restingHr", 200), null, "indicators without a fixed limit rely on the personal baseline");
});

test("a fixed limit applies from the first reading, before any baseline exists", () => {
  const row = evaluateIndicator("systolicBp", 186, []);
  assert.equal(row.status, "urgent");
  assert.equal(evaluateIndicator("systolicBp", 118, []).status, "baseline");
  const unrested = evaluateIndicator("systolicBp", 186, [], { usable: false });
  assert.equal(unrested.status, "repeat", "an unrested reading is repeated, not compared");
  assert.equal(unrested.limit.level, "urgent", "but the limit it crossed travels with it");
});

test("an impossible typed vital says why instead of being dropped, and spots a unit slip", () => {
  assert.match(vitalEntryProblem("glucose", 5.5, { unit: "mg/dL" }), /looks like a mmol\/L reading/);
  assert.match(vitalEntryProblem("glucose", 99, { unit: "mmol/L" }), /looks like a mg\/dL reading/);
  assert.match(vitalEntryProblem("bodyTemp", 98.6, { unit: "°C" }), /looks like a °F reading/);
  assert.match(vitalEntryProblem("spo2", 120), /outside 50–100 %/);
  assert.equal(vitalEntryProblem("glucose", 95, { unit: "mg/dL" }), null);
  assert.equal(vitalEntryProblem("glucose", null, { unit: "mg/dL" }), null, "a blank field is not a problem");
  assert.match(vitalEntryProblem("systolic", 80, { diastolic: 120 }), /the top number \(systolic\) is the larger one/);
  // Swapped, 80/120 would have read as low blood pressure and asked to tell the medical officer today.
  const swapped = vitalsCheck({ bp: { readings: [[80, 120]], rested: true } });
  assert.equal(swapped.values.systolicBp, undefined);
  assert.equal(evaluateSelfCheck(swapped, []).overall, "notChecked");
  assert.equal(vitalsCheck({ bp: { readings: [[80, 120], [118, 76]], rested: true } }).values.systolicBp, 118, "only the reading in the right order is used");
});

test("typed vitals convert units, average readings and gate blood pressure on rest", () => {
  const c = vitalsCheck({ bp: { readings: [[150, 95], [146, 91]], rested: true }, glucose: { value: 5.5, unit: "mmol/L", fasting: true }, temp: { value: 100.4, unit: "°F", site: "ear" }, spo2: { value: 96 } });
  assert.deepEqual([c.values.systolicBp, c.values.diastolicBp], [148, 93]);
  assert.equal(c.values.glucose, Math.round(5.5 * GLUCOSE_MG_PER_MMOL));
  assert.equal(c.values.bodyTemp, 38);
  assert.equal(c.protocols.bodyTemp, "temp-ear-v1", "each thermometer site is its own protocol");
  assert.equal(c.protocols.glucose, "glucose-fasting-v1");
  assert.equal(vitalsCheck({ glucose: { value: 120, fasting: false } }).protocols.glucose, "glucose-random-v1");
  assert.equal(vitalsCheck({ bp: { readings: [[150, 95]], rested: false } }).quality.systolicBp, false);
  const round = vitalsFromValues(c.values, c.protocols);
  assert.deepEqual(applyVitals(newCheck("you"), round).protocols, c.protocols, "a saved record pre-fills the same entries");
  const cleared = applyVitals(c, {});
  assert.equal("systolicBp" in cleared.values, false, "clearing a field removes the value");
});

test("one blood pressure reading over a limit gives one action, urgent before attention", () => {
  const check = vitalsCheck({ bp: { readings: [[186, 124]], rested: true }, temp: { value: 38.1 } });
  const result = evaluateSelfCheck(check, []);
  assert.equal(result.overall, "urgent");
  const ids = result.actions.map(a => a.id);
  assert.deepEqual(ids.slice(0, 2), ["limit-bp", "limit-bodyTemp"]);
  assert.match(result.actions[0].text, /systolic 186 mmHg is above 180 mmHg and diastolic 124 mmHg is above 120 mmHg/);
  assert.match(result.actions[0].text, /Sit quietly for 5 minutes and measure again\. If it is still above 180 mmHg, contact your crew medical officer now/);
  assert.equal(result.actions[1].priority, "attention");
  assert.equal(result.domains.find(d => d.key === "immune").status, "attention", "temperature counts in the immune domain");
});

test("a very low blood sugar points to the mission procedure first, never a dose", () => {
  const result = evaluateSelfCheck(vitalsCheck({ glucose: { value: 48 } }), []);
  const action = result.actions.find(a => a.id === "limit-glucose");
  assert.match(action.text, /^Blood sugar 48 mg\/dL is below 54 mg\/dL, the urgent safety limit\. Follow your mission's low blood sugar procedure now\./);
  for (const a of result.actions) assert.doesNotMatch(a.text, /diagnos|prescri|dose of|take \d|medication|treatment|grams/i);
});

test("an unrested reading over a limit asks for the repeat and names the limit", () => {
  const result = evaluateSelfCheck(vitalsCheck({ bp: { readings: [[150, 85]], rested: false } }), []);
  const action = result.actions.find(a => a.id === "limit-bp");
  assert.match(action.text, /did not pass its quality check\. Sit quietly for 5 minutes and measure again\. If it is still at or above 140 mmHg, tell your crew medical officer today/);
  assert.equal(result.actions.some(a => a.id === "repeat-systolicBp"), false, "no duplicate repeat action");
});

test("Elena's Day 147 vital signs are inside the limits and her usual range", () => {
  const result = evaluateSelfCheck(elenaDay147(), ELENA_HISTORY);
  const rows = result.domains.flatMap(d => d.indicators).filter(r => ["systolicBp", "diastolicBp", "spo2", "glucose", "bodyTemp"].includes(r.key));
  assert.deepEqual(rows.map(r => r.status), ["stable", "stable", "stable", "stable", "stable"]);
});

test("real Inspiration4 glucose: the fixed limit fires only on the suspect R+45 draws", () => {
  const data = JSON.parse(readFileSync(new URL("../public/data/i4-crew-blood.json", import.meta.url)));
  const rows = replayGlucoseLimits(data), fired = rows.filter(r => r.limit);
  assert.equal(rows.length, 28);
  assert.deepEqual(fired.map(r => `${r.crew} ${r.visit}`), ["C002 R+45", "C003 R+45", "C004 R+45"]);
  // The personal baseline flags every one too: a change on C002, a re-check (one draw outside) on C003 and
  // C004. The R+82 draws were back to usual, so a re-draw would have shown the drop was one draw.
  assert.deepEqual(fired.map(r => r.personal), ["changed", "recheck", "recheck"]);
  // The ADA's 70 mg/dL alert level (for people treated for diabetes) would fire on 4 healthy pre-flight draws.
  const pre = rows.filter(r => r.visit.startsWith("L"));
  assert.equal(pre.filter(r => r.value < 70).length, 4);
  assert.equal(SAFETY_LIMITS.glucose.attention.some(([op, v]) => op === "<" && v === 70), false);
});
