import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const data = JSON.parse(readFileSync(new URL("../public/data/circulation-reference.json",import.meta.url),"utf8"));

test("circulation artifacts retain a pinned published model and distinguish reference outputs", () => {
  const source=readFileSync(new URL("../scripts/vendor/physiome/windkessel.py",import.meta.url));
  assert.equal(data.sourceSha256,createHash("sha256").update(source).digest("hex"));
  assert.match(data.boundary,/Not calibrated/); assert.match(data.boundary,/No right-heart/);
  assert.deepEqual(data.scenarios.map(s=>s.bpm),[60,75,90]);
});

test("reference presets pass conservation, refinement and cycle continuity checks", () => {
  for(const s of data.scenarios) {
    assert.equal(s.samples.length,241);
    assert.equal(s.verification.passed,true);
    assert.ok(s.verification.conservedVolumeErrorMl<1e-4);
    assert.ok(s.verification.maxRefinementDifference<.05);
    assert.ok(s.verification.maxCycleDifference<.05);
    for(const p of s.samples) {
      assert.ok(Object.values(p).every(Number.isFinite));
      assert.ok(p.ventricularVolume>0); assert.ok(p.aorticFlow>=0); assert.ok(p.mitralFlow>=0);
    }
    assert.ok(s.samples.some(p=>p.aorticFlow>0)); assert.ok(s.samples.some(p=>p.mitralFlow>0));
    assert.ok(Math.abs(s.samples.at(-1).t-s.periodSeconds)<1e-5);
  }
});
