import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSESSMENT_MIN_SAMPLES,
  analyzePoseLandmarks,
  calculateJointAngle,
  summarizeFunctionalAssessment,
} from "./functionalAssessment.js";

test("joint angle returns a geometric angle in degrees", () => {
  assert.equal(calculateJointAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  assert.equal(calculateJointAngle({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 1 }), 180);
});

test("pose analysis produces bilateral upper- and lower-body angles", () => {
  const landmarks = makeLandmarks();
  const result = analyzePoseLandmarks(landmarks);
  assert.equal(result.usable, true);
  assert.ok(result.angles.left.knee > 170);
  assert.ok(result.angles.right.knee > 170);
  assert.ok(Number.isFinite(result.upperAngles.left.shoulder));
  assert.ok(Number.isFinite(result.upperAngles.right.elbow));
  assert.equal(result.upperTracking.left, true);
  assert.equal(result.upperTracking.right, true);
  assert.ok(result.visibility > 0.9);
});

test("assessment summary rejects too few visible samples", () => {
  const sample = analyzePoseLandmarks(makeLandmarks());
  const result = summarizeFunctionalAssessment(
    Array.from({ length: ASSESSMENT_MIN_SAMPLES - 1 }, () => sample),
  );
  assert.equal(result.status, "insufficient");
});

test("a hidden knee cannot qualify through a high average body confidence", () => {
  const landmarks = makeLandmarks();
  landmarks[25].visibility = 0.2;
  const result = analyzePoseLandmarks(landmarks);
  assert.ok(result.visibility > 0.8);
  assert.equal(result.usable, false);
  assert.equal(result.upperTracking.left, true);
});

test("assessment summary reports range, asymmetry, and baseline deltas", () => {
  const samples = Array.from({ length: ASSESSMENT_MIN_SAMPLES }, (_, index) => {
    const landmarks = makeLandmarks();
    landmarks[25].x += index * 0.004;
    landmarks[26].x -= index * 0.002;
    return analyzePoseLandmarks(landmarks);
  });
  const baseline = summarizeFunctionalAssessment(samples);
  const current = summarizeFunctionalAssessment(samples, baseline);

  assert.equal(current.status, "complete");
  assert.equal(current.comparedWithBaseline, true);
  assert.equal(current.sampleCount, ASSESSMENT_MIN_SAMPLES);
  assert.ok(Number.isFinite(current.asymmetry.knee));
  assert.equal(current.baselineDelta.knee, 0);
});

test("assessment summary reports aggregate camera reliability telemetry", () => {
  const sample = analyzePoseLandmarks(makeLandmarks());
  const samples = Array.from({ length: ASSESSMENT_MIN_SAMPLES }, () => sample);
  const telemetry = Array.from({ length: 16 }, (_, index) => ({
    detected: index < 14,
    usable: index < ASSESSMENT_MIN_SAMPLES,
    rigCoverage: index < ASSESSMENT_MIN_SAMPLES ? 0.9 : 0.25,
    frameRate: 24 + index,
    inferenceMs: 12 + index,
  }));
  const result = summarizeFunctionalAssessment(samples, null, {
    durationMs: 8_000,
    telemetry,
  });

  assert.equal(result.status, "complete");
  assert.equal(result.captureQuality.durationSeconds, 8);
  assert.equal(result.captureQuality.frameCount, 16);
  assert.equal(result.captureQuality.usableFrameRate, 0.75);
  assert.equal(result.captureQuality.detectedFrameRate, 0.875);
  assert.ok(result.captureQuality.meanRigCoverage < 0.9);
  assert.ok(result.captureQuality.p95InferenceMs > result.captureQuality.medianInferenceMs);
});

function makeLandmarks() {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.96,
  }));
  Object.assign(landmarks[11], { x: 0.42, y: 0.2 });
  Object.assign(landmarks[12], { x: 0.58, y: 0.2 });
  Object.assign(landmarks[13], { x: 0.34, y: 0.36 });
  Object.assign(landmarks[14], { x: 0.66, y: 0.36 });
  Object.assign(landmarks[15], { x: 0.3, y: 0.52 });
  Object.assign(landmarks[16], { x: 0.7, y: 0.52 });
  Object.assign(landmarks[23], { x: 0.44, y: 0.43 });
  Object.assign(landmarks[24], { x: 0.56, y: 0.43 });
  Object.assign(landmarks[25], { x: 0.44, y: 0.66 });
  Object.assign(landmarks[26], { x: 0.56, y: 0.66 });
  Object.assign(landmarks[27], { x: 0.44, y: 0.87 });
  Object.assign(landmarks[28], { x: 0.56, y: 0.87 });
  Object.assign(landmarks[31], { x: 0.49, y: 0.9 });
  Object.assign(landmarks[32], { x: 0.61, y: 0.9 });
  return landmarks;
}
