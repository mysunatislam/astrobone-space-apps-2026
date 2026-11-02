import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCrewmate, handoffText, DEMO_CREWMATE, PAIN_SITES, LEVELS, nextSteps } from "./crewmateCheck.js";
import { environmentFor } from "./missionEnvironment.js";

test("chest pressure spreading to the arm is CONTACT NOW (AHA warning signs)", () => {
  const a = assessCrewmate({ site: "chest", qualities: ["pressure"], spreads: ["arm"] });
  assert.equal(a.level, "now"); assert.equal(a.word, "CONTACT NOW");
  assert.ok(a.systems.includes("cardiovascular")); assert.equal(a.focus, "thorax");
  assert.ok(a.reasons.some(r => /AHA/.test(r.text)));
});
test("sharp chest pain that changes on pressing, mild, no other signs, is CONTACT TODAY, never WATCH", () => {
  const a = assessCrewmate({ site: "chest", onset: "gradual", qualities: ["sharp"], associated: ["pressingHurts", "exercise"], severity: 3 });
  assert.equal(a.level, "today");
  assert.ok(a.reasons.some(r => r.kind === "context" && /does not rule out the heart/.test(r.text)));
});
test("any BE-FAST sign is CONTACT NOW and adds the nervous system", () => {
  for (const sign of ["faceDroop", "armWeak", "speech", "vision", "balance"]) {
    const a = assessCrewmate({ site: "head", associated: [sign] });
    assert.equal(a.level, "now", sign); assert.ok(a.systems.includes("nervous"));
  }
});
test("one swollen leg, or sudden chest pain on breathing, raises clot warning signs", () => {
  assert.equal(assessCrewmate({ site: "leg", associated: ["legSwelling"] }).level, "now");
  assert.equal(assessCrewmate({ site: "chest", onset: "sudden", associated: ["breathingHurts"] }).level, "now");
});
test("flank pain in waves to the groin points at the kidneys", () => {
  const a = assessCrewmate({ site: "side", qualities: ["cramp"], spreads: ["groin"], severity: 5 });
  assert.equal(a.level, "today"); assert.ok(a.systems.includes("renal")); assert.equal(a.focus, "kidneys");
});
test("gradual back ache adds the spaceflight back-pain context but stays at least CONTACT TODAY", () => {
  const a = assessCrewmate({ site: "back", onset: "gradual", qualities: ["ache"], severity: 2 });
  assert.equal(a.level, "today"); assert.ok(a.reasons.some(r => /Kerstman/.test(r.text)));
});
test("severity 7 or more is CONTACT NOW", () => assert.equal(assessCrewmate({ site: "leg", severity: 8 }).level, "now"));
test("measured pulse: only a trusted estimate counts; very high or very low, or a big change from usual, raises the level", () => {
  assert.equal(assessCrewmate({ measures: { pulse: { status: "estimated", bpm: 130 } } }).level, "now");
  assert.equal(assessCrewmate({ measures: { pulse: { status: "insufficient", bpm: 130 } } }).level, "watch");
  assert.equal(assessCrewmate({ measures: { pulse: { status: "estimated", bpm: 88 }, baselineHr: 62 } }).level, "today");
  assert.equal(assessCrewmate({ measures: { pulse: { status: "estimated", bpm: 66 }, baselineHr: 62 } }).level, "watch");
});
test("held mouth asymmetry from the camera is CONTACT NOW; other face and speech changes are CONTACT TODAY", () => {
  assert.equal(assessCrewmate({ measures: { face: [{ key: "mouthAsymmetry", status: "changed", text: "x" }] } }).level, "now");
  assert.equal(assessCrewmate({ measures: { face: [{ key: "perclos", status: "changed", text: "x" }] } }).level, "today");
  assert.equal(assessCrewmate({ measures: { speech: [{ key: "pauseShare", status: "changed", text: "x" }] } }).level, "today");
});
test("next steps follow the environment and never name a medicine or a dose", () => {
  for (const site of PAIN_SITES.map(s => s.key)) for (const env of ["station", "marsTransit", "rover"]) {
    const a = assessCrewmate({ site, qualities: ["pressure"], associated: ["faceDroop"], environment: env });
    for (const s of a.steps) assert.doesNotMatch(s, /diagnos|prescri|dose|aspirin|nitro|medication|treatment|\bmg\b/i, s);
  }
  assert.ok(nextSteps("now", environmentFor("rover")).some(s => /Stop the drive/.test(s)));
  assert.ok(nextSteps("today", environmentFor("marsTransit")).some(s => /min to reach Earth/.test(s)));
});
test("the handoff names the level and the reasons and says the app does not identify a condition", () => {
  const d = DEMO_CREWMATE, a = assessCrewmate({ ...d.input, measures: d.measures });
  assert.equal(a.level, "now");
  const text = handoffText({ name: d.name, assessment: a, input: d.input, measured: d.measured, at: new Date("2026-11-02T10:00:00Z") });
  assert.match(text, /2026-11-02 10:00 UTC/); assert.match(text, /CONTACT NOW/); assert.match(text, /Chest, started sudden 10 min ago, 6\/10/);
  assert.match(text, /does not identify a condition/); assert.match(d.name, /synthetic/);
  assert.doesNotMatch(text, /diagnos|prescri/i);
});
test("levels carry a word, never colour alone", () => { for (const l of Object.values(LEVELS)) assert.match(l.word, /^[A-Z ]+$/); });
