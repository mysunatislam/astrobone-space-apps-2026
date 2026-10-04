import test from "node:test";
import assert from "node:assert/strict";
import { assessmentForCompanion } from "./companionEvidence.js";

test("companion receives only finite aggregate metrics, not raw camera data", () => {
  const result = assessmentForCompanion({status:"complete",rangeOfMotion:{left:{knee:80,hip:20,ankle:15},right:{knee:78,hip:22,ankle:14}},asymmetry:{knee:2},trackingQuality:.9,captureQuality:{usableFrameRate:.8},sampleCount:100,cameraFeatures:{kneeExtensionP95Degrees:165,shoulderAlignmentMeanDegrees:2,hipSwayRmsBodyScale:.03},rawFrames:["private"],landmarks:["private"]},30,{consent:true});
  assert.equal(result.metrics.knee_extension_deg,165);
  assert.equal(result.tracking_quality,.8);
  assert.equal(result.calibrated_distance,false);
  assert.equal(result.metrics.gait_speed_m_s,undefined);
  assert.equal(JSON.stringify(result).includes("private"),false);
  assert.equal(result.consent_to_store,true);
});

test("incomplete camera observations cannot become a longitudinal assessment", () => {
  assert.throws(()=>assessmentForCompanion({status:"insufficient"},1),/Complete/);
});

test("uploaded video observations remain distinct from live-camera baselines", () => {
  const result = assessmentForCompanion({
    status: "complete", sourceKind: "video", rangeOfMotion: { left: { knee: 80 }, right: { knee: 78 } },
    trackingQuality: .9, captureQuality: { usableFrameRate: .8 }, sampleCount: 100,
  }, 30, { consent: true });
  assert.equal(result.source, "video");
  assert.match(result.protocol, /^video-motionguard-/);
});
