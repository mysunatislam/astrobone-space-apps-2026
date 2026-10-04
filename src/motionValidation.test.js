import test from "node:test";
import assert from "node:assert/strict";
import {distribution,summarizeMotionRun,repeatedRunAgreement,evaluateMotionTargets} from "./motionValidation.js";
const row=(i,left,right)=>({sampleIndex:i,timeSeconds:i/12,received:true,detected:true,assessmentUsable:true,
  leftKneeFlexionDeg:left,rightKneeFlexionDeg:right,inferenceMs:10,captureToResultMs:20});
test("validation distributions exclude unavailable values but retain zeros",()=>{
  assert.deepEqual(distribution([null,NaN]),{count:0,mean:null,p50:null,p95:null,max:null});
  assert.equal(distribution([0,10,20]).mean,10); assert.equal(distribution([0,10,20]).p95,19);
});
test("missing video samples remain in every coverage denominator",()=>{
  const rows=[row(0,0,5),{...row(1,null,null),received:false,detected:false,assessmentUsable:false,inferenceMs:null,captureToResultMs:null}];
  const report=summarizeMotionRun(rows,2);
  assert.equal(report.left.coverage,.5); assert.equal(report.receivedFrames,1); assert.equal(report.inferenceMs.count,1);
  assert.throws(()=>summarizeMotionRun(rows,3)); assert.throws(()=>summarizeMotionRun([rows[0],rows[0]],2));
});
test("same-video repeatability is time aligned and missing pairs are not zero errors",()=>{
  const a={sourceSha256:"a",rows:[row(0,10,20),row(1,null,40)]};
  const b={sourceSha256:"a",rows:[row(0,14,22),row(1,60,44)]};
  const result=repeatedRunAgreement([a,b]);
  assert.equal(result.left.absoluteDifferenceDeg.mean,4); assert.equal(result.left.pairedCoverage,.5);
  assert.equal(result.right.absoluteDifferenceDeg.mean,3);
  assert.throws(()=>repeatedRunAgreement([a,{...b,sourceSha256:"b"}]));
  assert.throws(()=>repeatedRunAgreement([a,{...b,rows:[row(1,14,22),row(0,60,44)]}]));
});
test("validation fails unsafe visibility instead of discarding a failed condition",()=>{
  const report=summarizeMotionRun([row(0,20,20),row(1,40,40)],2);
  const targets={occludedLegMaximumCoverage:.1,baselineMinimumCoverage:.9,inferenceP95Ms:100,captureToResultP95Ms:200};
  assert.equal(evaluateMotionTargets(report,"blank",targets)[0].status,"fail");
  assert.ok(evaluateMotionTargets(report,"occluded_legs",targets).every(check=>check.status==="fail"));
});
