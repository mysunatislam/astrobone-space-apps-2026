import test from "node:test";
import assert from "node:assert/strict";
import {evaluateTimedAngleReference,KNEE_DEFINITION} from "./angleReferenceValidation.js";
const fixture=()=>({
  run:{sourceSha256:"a".repeat(64),subjectId:"s1",rows:[
    {timeSeconds:0,leftKneeFlexionDeg:10,rightKneeFlexionDeg:20},
    {timeSeconds:1,leftKneeFlexionDeg:null,rightKneeFlexionDeg:25},
    {timeSeconds:2,leftKneeFlexionDeg:34,rightKneeFlexionDeg:40}]},
  reference:{schema:"astrobone-timed-angle-reference-v1",videoSha256:"a".repeat(64),subjectId:"s1",trialId:"t1",
    unit:"deg",angleDefinition:KNEE_DEFINITION,independentFromPoseModel:true,synthetic:true,referenceDevice:"analytic fixture",
    sourceUrl:"fixture://test",protocol:"fixture-v1",split:"development",synchronization:{method:"known offset",referenceMinusVideoSeconds:.5,maxMatchDeltaSeconds:.02,lockedBeforeEvaluation:true},
    samples:[{timeSeconds:.5,leftKneeFlexionDeg:12,rightKneeFlexionDeg:20},{timeSeconds:1.5,leftKneeFlexionDeg:20,rightKneeFlexionDeg:23},{timeSeconds:2.5,leftKneeFlexionDeg:30,rightKneeFlexionDeg:38}]}
});
test("reference matching uses the declared clock offset and retains failed estimates",()=>{
  const {run,reference}=fixture(), result=evaluateTimedAngleReference(run,reference);
  assert.equal(result.matchedFrames,3); assert.equal(result.channels.left.metrics.mae,3);
  assert.equal(result.channels.left.predictionCoverage,2/3); assert.equal(result.channels.right.metrics.bias,4/3);
});
test("reference workflow rejects wrong source, definition, identity and unlocked timing",()=>{
  for(const alter of [x=>x.videoSha256="b".repeat(64),x=>x.angleDefinition="OpenSim_knee_angle_r",x=>x.subjectId="s2",x=>x.independentFromPoseModel=false,x=>x.synchronization.lockedBeforeEvaluation=false,x=>x.samples[1].timeSeconds=.5,x=>x.samples[0].leftKneeFlexionDeg=undefined]) {
    const {run,reference}=fixture(); alter(reference); assert.throws(()=>evaluateTimedAngleReference(run,reference));
  }
});
test("unmatched time windows do not produce zero-error success",()=>{
  const {run,reference}=fixture(); reference.synchronization.referenceMinusVideoSeconds=100;
  const result=evaluateTimedAngleReference(run,reference);
  assert.equal(result.matchedFrames,0); assert.equal(result.channels.left.metrics,null);
  assert.equal(result.channels.left.status,"insufficient_pairs");
});
