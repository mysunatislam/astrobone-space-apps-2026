import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hybridKneeAngle, kneeHybridFeatures, predictKneeHybrid, KNEE_HYBRID_SIDE_YAW } from "./kneeHybrid.js";
import { KNEE_HYBRID_MODEL } from "./kneeHybridModel.js";
import { summarizeKneeCapture, ASSESSMENT_MIN_SAMPLES } from "./functionalAssessment.js";

const fixture = JSON.parse(readFileSync(new URL("./kneeHybridModel.fixture.json", import.meta.url), "utf8"));

test("the JavaScript trees predict exactly what the validated Python model predicts", () => {
  assert.equal(KNEE_HYBRID_MODEL.trees.length, 100);
  assert.equal(KNEE_HYBRID_MODEL.features.length, 9);
  for (const { input, expected } of fixture) {
    const got = predictKneeHybrid(kneeHybridFeatures(input));
    assert.ok(Math.abs(got - expected) < 1e-3, `${got} vs ${expected}`);
  }
});

test("inside its training range the hybrid uses the trees; outside, the fixed rule", () => {
  const { input } = fixture[0];
  const inside = hybridKneeAngle(input);
  assert.ok(["hybrid", "rule"].includes(inside.method));
  // A thigh 20 times shorter than the shank (pointing straight at the camera) was never seen in training.
  const sideOn = hybridKneeAngle({ ...input, thigh2d: input.shank2d / 20, yawDeg: 80 });
  assert.deepEqual(sideOn, { angle: input.angle2d, method: "rule" });
  const facing = hybridKneeAngle({ ...input, thigh2d: input.shank2d / 20, yawDeg: 10 });
  assert.deepEqual(facing, { angle: input.angle3d, method: "rule" });
  assert.equal(KNEE_HYBRID_SIDE_YAW, 60);
  assert.deepEqual(hybridKneeAngle({ angle3d: 150 }), { angle: 150, method: "3d" }, "without image features, the 3D angle as before");
  assert.equal(hybridKneeAngle({}), null);
});

test("most validation frames fall inside the training range", () => {
  const share = fixture.filter(({ input }) => hybridKneeAngle(input).method === "hybrid").length / fixture.length;
  assert.ok(share >= 0.85, `share ${share}`);
});

test("a capture with hybrid angles is summarized from them under protocol v3", () => {
  const frames = Array.from({ length: ASSESSMENT_MIN_SAMPLES + 4 }, (_, i) => ({
    angles: { left: { knee: 150 + i }, right: { knee: 152 + i } },
    kneeHybrid: { left: { angle: 120 + 3 * i, method: "hybrid" }, right: { angle: 125 + 3 * i, method: i % 2 ? "hybrid" : "rule" } },
    sideUsable: { left: true, right: true }, sideVisibility: { left: 0.9, right: 0.9 }, bodyYawDeg: 10, nearSide: "left",
  }));
  const result = summarizeKneeCapture(frames);
  assert.equal(result.angleMethod, "hybrid");
  assert.equal(result.protocol, "self-check-seated-knee-extension-v3-bilateral");
  assert.equal(result.worseSide, "left");
  assert.ok(result.kneeRom > 40, "range of motion from the hybrid angles, not the 3D ones");
  assert.equal(result.hybridShare, 1);
  // One frame without hybrid angles keeps the whole capture on the 3D angles and protocol v2.
  const mixed = summarizeKneeCapture([...frames, { ...frames[0], kneeHybrid: null }]);
  assert.equal(mixed.angleMethod, "3d");
  assert.equal(mixed.protocol, "self-check-seated-knee-extension-v2-bilateral");
});

test("pose analysis adds hybrid knee angles only when it knows the frame's aspect ratio", async () => {
  const { analyzePoseLandmarks } = await import("./functionalAssessment.js");
  // A person facing the camera with knees bent: hips, knees and ankles in image and world coordinates.
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  const set = (i, x, y, z = 0) => Object.assign(points[i], { x, y, z });
  set(11, 0.42, 0.2); set(12, 0.58, 0.2); set(13, 0.36, 0.35); set(14, 0.64, 0.35); set(15, 0.34, 0.5); set(16, 0.66, 0.5);
  set(23, 0.45, 0.45); set(24, 0.55, 0.45); set(25, 0.44, 0.62); set(26, 0.56, 0.62); set(27, 0.45, 0.85); set(28, 0.55, 0.85); set(31, 0.47, 0.9); set(32, 0.53, 0.9);
  const world = points.map(p => ({ x: (p.x - 0.5) * 1.6, y: (p.y - 0.5) * 1.6, z: p.z, visibility: p.visibility }));
  world[25].z = world[26].z = -0.15; // knees forward, toward the camera
  const without = analyzePoseLandmarks(world, points);
  assert.equal(without.kneeHybrid, null);
  const withAspect = analyzePoseLandmarks(world, points, { aspect: 4 / 3 });
  for (const side of ["left", "right"]) {
    assert.ok(["hybrid", "rule"].includes(withAspect.kneeHybrid[side].method));
    assert.ok(withAspect.kneeHybrid[side].angle > 60 && withAspect.kneeHybrid[side].angle <= 180);
  }
  assert.equal(withAspect.aspect, 4 / 3);
});
