import test from "node:test";
import assert from "node:assert/strict";

import {
  PoseLandmarkFilter,
  RIG_SEGMENT_KEYS,
  buildPoseRetargetFrame,
} from "./poseRetargeting.js";

test("full visible pose maps to every supported rig segment", () => {
  const landmarks = makeFullBodyLandmarks();
  const frame = buildPoseRetargetFrame(landmarks, landmarks);

  assert.equal(frame.totalSegmentCount, RIG_SEGMENT_KEYS.length);
  assert.equal(frame.trackedSegmentCount, RIG_SEGMENT_KEYS.length);
  assert.equal(frame.rigCoverage, 1);
  assert.ok(frame.bodyScale > 0);
  RIG_SEGMENT_KEYS.forEach((key) => {
    const segment = frame.segments[key];
    const directionLength = Math.hypot(
      segment.direction.x,
      segment.direction.y,
      segment.direction.z,
    );
    assert.ok(segment.usable, `${key} should be usable`);
    assert.ok(Math.abs(directionLength - 1) < 1e-9);
  });
});

test("segment visibility reduces rig coverage without discarding the frame", () => {
  const landmarks = makeFullBodyLandmarks();
  landmarks[15].visibility = 0.1;
  landmarks[17].visibility = 0.1;
  landmarks[19].visibility = 0.1;
  landmarks[21].visibility = 0.1;
  const frame = buildPoseRetargetFrame(landmarks, landmarks);

  assert.equal(frame.segments.leftForeArm.usable, false);
  assert.equal(frame.segments.leftHand.usable, false);
  assert.equal(frame.trackedSegmentCount, RIG_SEGMENT_KEYS.length - 2);
});

test("adaptive filter smooths large landmark jumps", () => {
  const filter = new PoseLandmarkFilter({ minimumAlpha: 0.2, maximumAlpha: 0.7 });
  const first = makeFullBodyLandmarks();
  const second = makeFullBodyLandmarks();
  second[0].x += 1;

  filter.update(first);
  const filtered = filter.update(second);

  assert.ok(filtered[0].x > first[0].x);
  assert.ok(filtered[0].x < second[0].x);
});

test("adaptive filter briefly holds a landmark when confidence collapses", () => {
  const filter = new PoseLandmarkFilter();
  const first = makeFullBodyLandmarks();
  const hidden = makeFullBodyLandmarks();
  hidden[13] = { x: 8, y: 8, z: 8, visibility: 0.05 };

  filter.update(first);
  const filtered = filter.update(hidden);

  assert.equal(filtered[13].x, first[13].x);
  assert.ok(filtered[13].visibility < first[13].visibility);
  assert.ok(filtered[13].visibility > hidden[13].visibility);
});

function makeFullBodyLandmarks() {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 0.98,
  }));
  const set = (index, x, y, z = 0) => Object.assign(
    landmarks[index],
    { x, y, z },
  );

  set(0, 0, 0.04, -0.03);
  set(7, -0.05, 0.08, 0);
  set(8, 0.05, 0.08, 0);
  set(11, -0.2, 0.22, 0);
  set(12, 0.2, 0.22, 0);
  set(13, -0.34, 0.42, -0.02);
  set(14, 0.34, 0.42, -0.02);
  set(15, -0.38, 0.62, -0.04);
  set(16, 0.38, 0.62, -0.04);
  set(17, -0.4, 0.66, -0.05);
  set(18, 0.4, 0.66, -0.05);
  set(19, -0.38, 0.69, -0.06);
  set(20, 0.38, 0.69, -0.06);
  set(21, -0.35, 0.66, -0.03);
  set(22, 0.35, 0.66, -0.03);
  set(23, -0.12, 0.5, 0);
  set(24, 0.12, 0.5, 0);
  set(25, -0.12, 0.74, 0.02);
  set(26, 0.12, 0.74, 0.02);
  set(27, -0.12, 0.94, 0);
  set(28, 0.12, 0.94, 0);
  set(29, -0.12, 0.97, 0.02);
  set(30, 0.12, 0.97, 0.02);
  set(31, -0.12, 0.98, -0.12);
  set(32, 0.12, 0.98, -0.12);
  return landmarks;
}
