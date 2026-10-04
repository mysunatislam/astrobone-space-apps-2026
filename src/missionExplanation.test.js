import test from "node:test";
import assert from "node:assert/strict";
import { explainMission } from "./missionExplanation.js";
import { buildMissionCase } from "./missionCase.js";
import demo from "./demoMission.json" with { type: "json" };
const profile = { astronaut_id: "DEMO-TEST", is_demo: true };
const history = demo.observations.map((r, i) => ({ ...r, id: String(i), protocol: "same", source: "synthetic", gravity: "microgravity", pose_model: "same" }));
const external = { research: { cardiovascular: { accession: "OSD-575", population: "Human / short-duration flight", url: "https://osdr.nasa.gov/bio/repo/data/studies/OSD-575" } }, xray: {} };
test("explanation uses selected observations and never attributes changes to radiation", () => {
  const current = buildMissionCase({ profile, history, radiation: demo.radiation.map(r => ({ ...r, source: "synthetic" })), day: 180 });
  const scenario = { astronaut_id: profile.astronaut_id, day: 180, additionalDoseMgy: 10, synthetic: true };
  const report = explainMission(current, demo.health, external, scenario);
  assert.match(report.observation, /165 to 151/); assert.match(report.cardiovascular, /76 bpm/);
  assert.match(report.radiation, /27 mGy/); assert.match(report.interpretation, /not inferred/);
  assert.equal(report.scenario.additionalDoseMgy, 10); assert.equal(current.dose.cumulative_personal_absorbed_dose_mgy, 27);
  assert.match(report.imaging, /not assigned/); assert.match(report.engine, /no LLM/);
  assert.equal(explainMission({ ...current, day: 182 }, demo.health, external, scenario).scenario, null);
  assert.equal(explainMission({ ...current, synthetic: false }, demo.health, external, scenario).scenario, null);
});
