import test from "node:test";
import assert from "node:assert/strict";
import { beamCase, runEngineeringChecks, evaluateReferencePairs } from "./engineeringValidation.js";
import { videoPoseAt, seekVideoFrame, isPausedVideoPose } from "./videoPoseTrack.js";

test("paused video holds only its matched pose without refreshing the observation", () => {
  const frame = {detected:true,mediaTime:7.25,timestamp:1000};
  const video = {paused:true,seeking:false,readyState:2,currentTime:7.32};
  assert.equal(isPausedVideoPose(frame,video),true);
  for(const change of [{paused:false},{seeking:true},{readyState:1},{currentTime:3},{currentTime:NaN}]) {
    assert.equal(isPausedVideoPose(frame,{...video,...change}),false);
  }
  assert.equal(isPausedVideoPose({...frame,detected:false},video),false);
  assert.equal(isPausedVideoPose({...frame,mediaTime:undefined},video),false);
  assert.equal(isPausedVideoPose(null,video),false);
  assert.equal(frame.timestamp,1000);
});

test("analytical mechanics and joint-angle cases reproduce independent closed-form values", () => {
  const checks = runEngineeringChecks(); assert.equal(checks.length, 12); assert.ok(checks.every(c => c.passed));
  const a = beamCase(), b = beamCase({ radiusM: .02 });
  assert.ok(Math.abs(a.demandsPa.bendingStressBound / b.demandsPa.bendingStressBound - 8) < 1e-9);
  assert.throws(() => beamCase({ radiusM: 0 })); assert.throws(() => beamCase({ forceN: NaN }));
});
const reference = () => ({ schema: "astrobone-reference-v1", metric: "knee_flexion", unit: "deg", synthetic: true, reference_device: "fixture", protocol: "fixture-v1", pairs: [
  { id: "1", subject_id: "A", reference: 90, estimate: 92 }, { id: "2", subject_id: "B", reference: 60, estimate: 58 }, { id: "3", subject_id: "A", reference: 30, estimate: null },
] });
test("reference evaluation preserves failures, units, provenance and subject counts", () => {
  const r = evaluateReferencePairs(reference()); assert.equal(r.mae, 2); assert.equal(r.rmse, 2); assert.equal(r.bias, 0); assert.equal(r.coverage, 2/3); assert.equal(r.subjects, 2); assert.equal(r.synthetic, true);
});
test("invalid references, duplicates and incomparable units are rejected", () => {
  for (const alter of [x => x.unit = "bpm", x => delete x.synthetic, x => x.pairs[1].id = "1", x => x.pairs[0].reference = null, x => x.pairs[1].estimate = "58"]) {
    const r = reference(); alter(r); assert.throws(() => evaluateReferencePairs(r));
  }
});
test("subjects with entirely failed estimates remain in the reference report",()=>{
  const input=reference(); input.pairs[2].subject_id="C";
  const result=evaluateReferencePairs(input);
  assert.equal(result.subjects,3); assert.equal(result.evaluatedSubjects,2); assert.equal(result.fullyFailedSubjects,1);
});
test("cached video sample follows media time, supports seeking, rejects large gaps", () => {
  const track = [{ mediaTime: 0 }, { mediaTime: .1 }, { mediaTime: .2 }];
  assert.equal(videoPoseAt(track, .15), track[1]); assert.equal(videoPoseAt(track, .04), track[0]);
  assert.equal(videoPoseAt(track, 4), null); assert.equal(videoPoseAt(track, NaN), null);
});
test("cancelled video preparation cannot wait on decoded frames", async () => {
  const abort = new AbortController(); abort.abort(); await assert.rejects(seekVideoFrame({}, 0, abort.signal), /cancelled/);
});
