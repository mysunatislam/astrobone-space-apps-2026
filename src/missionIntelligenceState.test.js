import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ELENA } from "./elenaMissionScenario.js";
import { initialMissionState, deriveMission, astraAnswer } from "./missionIntelligenceState.js";
import { describeXray } from "./missionHealth.js";
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const external = { research: json("../public/data/mission-research.json"), bone: json("../public/data/osdr-804-summary.json"), xray: describeXray(json("../public/inference/demo/IMG0001739_prediction.json")) };
test("Elena checkpoints have explicit synthetic provenance on every authored value", () => {
  for (const row of ELENA.observations) for (const field of Object.values(row)) { assert.equal(field.provenance, "SYNTHETIC DEMO"); assert.ok(field.boundary && field.unit); }
  assert.deepEqual(ELENA.observations.map(r => r.day.value), [1, 30, 60, 90, 120, 147, 180, 240]);
});
test("Day 147 computes actual subtraction and eight implemented gates", () => {
  const r = deriveMission(initialMissionState(), external);
  assert.equal(r.change.delta, -14); assert.equal(r.cardio.delta, 12); assert.equal(r.dose, 22.05); assert.equal(r.gates.length, 8); assert.equal(r.passed, 8);
  assert.equal(r.references.length, 3); assert.equal(r.day, 147); assert.match(r.engine, /no LLM/);
});
test("baseline has no invented follow-up and no future observation", () => {
  const r = deriveMission({ ...initialMissionState(), day: 1 }, external);
  assert.equal(r.change, undefined); assert.equal(r.cardio.delta, null); assert.equal(r.dose, 0); assert.equal(r.review.status, "baseline_recorded");
});
test("low quality withholds numerical movement change and does not mutate fixture", () => {
  const before = JSON.stringify(ELENA), state = initialMissionState(); state.lab = true; state.options.lowQuality = true;
  const r = deriveMission(state, external); assert.equal(r.change, undefined); assert.equal(r.movement, "INSUFFICIENT DATA");
  assert.equal(r.gates.find(g => g.id === "quality").pass, false); assert.match(astraAnswer("why", r).text, /withheld/);
  assert.equal(JSON.stringify(ELENA), before);
});
test("sensor and evidence failures abstain, independent of loaded assets", () => {
  const state = initialMissionState(); state.lab = true; state.options.sensorMissing = state.options.evidenceMissing = true;
  const r = deriveMission(state, external); assert.equal(r.cardio.current, null); assert.equal(r.references.length, 0); assert.equal(r.evidenceReady, false);
  assert.match(astraAnswer("evidence", r).text, /INSUFFICIENT EVIDENCE/); assert.match(astraAnswer("missing", r).text, /Cardiovascular input/);
});
test("event is time-scoped, deterministic and never overwrites dosimeter history", () => {
  const state = initialMissionState(); state.event = { day: 147 }; const r = deriveMission(state, external);
  assert.equal(r.dose, 22.05); assert.equal(r.doseWithEvent, 32.05); assert.equal(r.radiation, "REASSESSMENT REQUIRED");
  const early = deriveMission({ ...state, day: 120 }, external); assert.equal(early.event, null); assert.equal(early.doseWithEvent, 18);
});
test("what-if exposure remains separate; leaving lab restores authored readings", () => {
  const state = initialMissionState(); state.lab = true; state.options.exposure = 50;
  assert.equal(deriveMission(state, external).dose, 50); state.lab = false; assert.equal(deriveMission(state, external).dose, 22.05);
});
test("offline toggle changes remote status, not comparisons or source data", () => {
  const a = deriveMission(initialMissionState(), external), b = deriveMission({ ...initialMissionState(), offline: true }, external);
  assert.deepEqual(a.change, b.change); assert.deepEqual(a.references, b.references); assert.match(b.remoteReview, /Pending/);
});
test("reset state is fresh and deterministic; unsupported Astra request abstains", () => {
  const state = initialMissionState(); state.options.lowQuality = true;
  assert.equal(initialMissionState().options.lowQuality, false); assert.match(astraAnswer("diagnose", deriveMission(initialMissionState(), external)).text, /INSUFFICIENT EVIDENCE/);
});
test("empty evidence cannot satisfy NASA gates or claim readiness", () => {
  const result = deriveMission(initialMissionState()); assert.equal(result.references.length, 0); assert.equal(result.evidenceReady, false); assert.equal(result.passed, 7);
});
