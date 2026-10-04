import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardiovascularAtDay, describeXray } from "./missionHealth.js";
import demo from "./demoMission.json" with { type: "json" };
import { createBrowserCompanion } from "./browserCompanion.js";

test("cardiovascular review respects selected day, quality refusal and device identity", () => {
  const day180 = cardiovascularAtDay(demo.health, 180);
  assert.equal(day180.current.metrics.heart_rate_bpm, 76);
  assert.equal(day180.delta, 12); assert.equal(day180.points.length, 4);
  const poor = cardiovascularAtDay(demo.health, 182);
  assert.equal(poor.status, "withheld"); assert.equal(poor.delta, null);
  assert.equal(poor.current.quality, .3);
  assert.equal(cardiovascularAtDay(demo.health, 183).status, "withheld");
  assert.equal(cardiovascularAtDay(demo.health, 181).status, "earlier");
  const changed = [...demo.health.slice(0, 2), { ...demo.health[3], device_id: "OTHER" }];
  assert.equal(cardiovascularAtDay(changed, 180).delta, null);
  assert.equal(cardiovascularAtDay([], 180).status, "missing");
});

test("current X-ray remains external precomputed evidence, never a patient-linked probability", () => {
  const raw = JSON.parse(readFileSync(new URL("../public/inference/demo/IMG0001739_prediction.json", import.meta.url)));
  const evidence = describeXray(raw);
  assert.equal(evidence.patientLinked, false); assert.equal(evidence.clinicalDiagnosis, false);
  assert.match(evidence.inference, /Precomputed/); assert.match(evidence.scoreLabel, /uncalibrated/);
  assert.throws(() => describeXray({ ...raw, fractureScore: NaN }), /incomplete/);
  assert.throws(() => describeXray({ ...raw, maskAreaFraction: 4 }), /incomplete/);
});

test("bundled NASA evidence preserves populations, research timing and source hashes", () => {
  const data = JSON.parse(readFileSync(new URL("../public/data/mission-research.json", import.meta.url)));
  assert.equal(data.cardiovascular.participants, 4); assert.equal(data.cardiovascular.records, 28);
  assert.deepEqual(data.cardiovascular.points.map(p => p.n), Array(7).fill(4));
  assert.match(data.cardiovascular.method, /after return, not mission day/);
  assert.equal(data.radiation.records, 1152);
  assert.equal(data.radiation.groups.reduce((total, row) => total + row.n, 0) + data.radiation.excludedMissing, data.radiation.records);
  assert.match(data.radiation.population, /Mouse/); assert.match(data.bone.population, /Mouse/);
  for (const source of Object.values(data).filter(value => value?.sources)) {
    assert.ok(source.sources.every(file => file.url.startsWith("https://osdr.nasa.gov/") && /^[a-f0-9]{64}$/.test(file.sha256)));
  }
});

test("browser review exports only cardiovascular observations available on selected day", async () => {
  const api = createBrowserCompanion(null);
  const post = (path, body) => api.request(path, { method: "POST", body: JSON.stringify(body) });
  const profile = await post("/demo", {});
  const run = await post("/runs", { astronaut_id: profile.astronaut_id, prompt: "Review", as_of_day: 180, use_llm: false, red_flags: [] });
  const result = await api.request(`/runs/${run.id}`);
  assert.equal(result.report.multisystem.series[0].last.value, 76);
  assert.equal(result.report.multisystem.series[0].points.length, 4);
});
