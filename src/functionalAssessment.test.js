import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSESSMENT_MIN_SAMPLES,
  analyzePoseLandmarks,
  calculateJointAngle,
  summarizeFunctionalAssessment,
  summarizeKneeCapture,
  bodyYaw,
  cameraViewFor,
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

const kneeFrame = (left, right, { leftOk = true, rightOk = true, yaw, near } = {}) => ({
  angles: { left: { knee: left }, right: { knee: right } },
  sideUsable: { left: leftOk, right: rightOk },
  sideVisibility: { left: leftOk ? 0.9 : 0.3, right: rightOk ? 0.9 : 0.3 },
  bodyYawDeg: yaw, nearSide: near,
});

test("knee capture compares the worse knee when both legs are tracked", () => {
  const frames = Array.from({ length: ASSESSMENT_MIN_SAMPLES + 4 }, (_, i) => kneeFrame(120 + i * 3, 125 + i * 3));
  const result = summarizeKneeCapture(frames);
  assert.equal(result.status, "complete");
  assert.equal(result.view, "bilateral");
  assert.equal(result.worseSide, "left");
  assert.equal(result.kneeExtension, result.sides.left.extension);
  assert.ok(result.asymmetry > 0);
  assert.equal(result.protocol, "self-check-seated-knee-extension-v2-bilateral");
});

test("knee capture uses the near knee when only one leg is tracked side-on", () => {
  const frames = Array.from({ length: ASSESSMENT_MIN_SAMPLES + 2 }, (_, i) => kneeFrame(90 + i * 5, 40, { leftOk: false }));
  const result = summarizeKneeCapture(frames);
  assert.equal(result.view, "right");
  assert.equal(result.worseSide, null);
  assert.equal(result.asymmetry, null);
  assert.equal(result.sides.left.usable, false);
  assert.equal(result.protocol, "self-check-seated-knee-extension-v2-right", "single-side checks are never mixed with bilateral ones");
});

test("body yaw reads facing vs side-on from the hip and shoulder lines, and names the near leg", () => {
  const world = (yawDeg) => {
    const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0.9 }));
    const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
    // Left hip and shoulder rotate toward the camera (smaller z) as the person turns.
    for (const [index, half] of [[23, 0.1], [24, -0.1], [11, 0.18], [12, -0.18]]) Object.assign(points[index], { x: half * c, z: -half * s });
    return points;
  };
  assert.ok(Math.abs(bodyYaw(world(0)).yawDeg) < 1e-9);
  const side = bodyYaw(world(80));
  assert.ok(Math.abs(side.yawDeg - 80) < 1e-6);
  assert.equal(side.nearSide, "left");
  assert.equal(cameraViewFor(10), "front");
  assert.equal(cameraViewFor(45), "oblique");
  assert.equal(cameraViewFor(75), "side");
  assert.equal(cameraViewFor(null), null);
});

test("side-on, only the near knee counts even if the model reports the far knee as visible", () => {
  // The far (right) knee reads lower but is occluded: it must not become the 'worse knee'.
  const frames = Array.from({ length: ASSESSMENT_MIN_SAMPLES + 4 }, (_, i) => kneeFrame(150 + i, 120 + i, { yaw: 78, near: "left" }));
  const result = summarizeKneeCapture(frames);
  assert.equal(result.cameraView, "side");
  assert.equal(result.view, "left");
  assert.equal(result.sides.right.hiddenSideOn, true);
  assert.equal(result.kneeExtension, result.sides.left.extension);
  assert.equal(result.protocol, "self-check-seated-knee-extension-v2-left");
  // Facing the camera, both knees count and the worse one is compared.
  const front = summarizeKneeCapture(frames.map(frame => ({ ...frame, bodyYawDeg: 8 })));
  assert.equal(front.cameraView, "front");
  assert.equal(front.view, "bilateral");
  assert.equal(front.worseSide, "right");
});

test("knee capture is insufficient when no leg is tracked well enough", () => {
  const frames = Array.from({ length: ASSESSMENT_MIN_SAMPLES - 1 }, () => kneeFrame(170, 170));
  const result = summarizeKneeCapture(frames);
  assert.equal(result.status, "insufficient");
  assert.equal(result.kneeExtension, null);
  assert.equal(result.protocol, null);
});

test("near full extension, depth noise hurts a side-on knee angle more than a facing one", async () => {
  const { viewError } = await import("../scripts/simulate-camera-view.mjs");
  const front = viewError({ view: "front", theta: 170, k: 3, runs: 4000 }), side = viewError({ view: "side", theta: 170, k: 3, runs: 4000 });
  assert.ok(side.rmse > 1.5 * front.rmse, `side ${side.rmse} vs front ${front.rmse}`);
  assert.ok(side.bias < front.bias - 2, "side-on reads lower: a position change can look like lost extension");
  // With equal noise on every axis the position does not matter.
  const even = ["front", "side"].map(view => viewError({ view, theta: 170, k: 1, runs: 4000 }).rmse);
  assert.ok(Math.abs(even[0] - even[1]) < 0.5);
});
