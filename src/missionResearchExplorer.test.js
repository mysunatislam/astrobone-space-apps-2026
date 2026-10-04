import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { researchSeries } from "./missionResearchExplorer.js";
import { deriveMission, initialMissionState } from "./missionIntelligenceState.js";
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const external = { research: json("../public/data/mission-research.json"), bone: json("../public/data/osdr-804-summary.json"), extended: json("../public/data/mission-research-extended.json") };

test("NASA explorer retains five source accessions and native units", () => {
  const series = researchSeries(external);
  assert.deepEqual([...new Set(series.map(s=>s.accession))].sort(), ["OSD-435","OSD-569","OSD-575","OSD-656","OSD-804"]);
  assert.equal(series.filter(s=>s.accession==="OSD-656").every(s=>s.unit==="NPQ"), true);
  assert.equal(series.filter(s=>s.accession==="OSD-569").length, 4);
  assert.equal(series.some(s=>s.field?.includes("hemoglobin")),false);
  assert.deepEqual(researchSeries({}), []);
});

test("more NASA data cannot change the synthetic personal observations", () => {
  const withExtra = deriveMission(initialMissionState(),external);
  const without = deriveMission(initialMissionState(),{...external,extended:null});
  assert.equal(withExtra.references.length,5); assert.equal(withExtra.passed,8);
  assert.deepEqual(withExtra.data,without.data); assert.deepEqual(withExtra.change,without.change);
  assert.deepEqual(withExtra.cardio,without.cardio);
  const state=initialMissionState(); state.lab=true; state.options.evidenceMissing=true;
  assert.equal(deriveMission(state,external).references.length,0);
});

test("human study aggregates have reconciled counts and no nonfinite values", () => {
  for(const study of external.extended.studies) {
    assert.equal(study.participants,4); assert.match(study.sources[0].sha256,/^[a-f0-9]{64}$/);
    for(const metric of study.metrics) {
      assert.equal(metric.points.reduce((n,p)=>n+p.n+p.missing,0),study.records);
      for(const p of metric.points) assert.ok(p.median===null || Number.isFinite(p.median));
    }
  }
});
