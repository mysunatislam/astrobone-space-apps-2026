import test from "node:test";
import assert from "node:assert/strict";
import {
  CrewSafetyMonitor,
  classifyDirection,
  classifyPosture,
} from "./safetyMonitor.js";

function makePose({
  leftKnee = 170,
  rightKnee = 170,
  leftHip = 170,
  rightHip = 170,
  spine = { x: 0, y: -1, z: 0 },
} = {}) {
  return {
    usable: true,
    angles: {
      left: { hip: leftHip, knee: leftKnee, ankle: 90 },
      right: { hip: rightHip, knee: rightKnee, ankle: 90 },
    },
    asymmetry: {
      hip: Math.abs(leftHip - rightHip),
      knee: Math.abs(leftKnee - rightKnee),
      ankle: 0,
    },
    segments: {
      spine: { direction: spine },
    },
  };
}

function detection(label, score, originX, width, height) {
  return {
    categories: [{ categoryName: label, displayName: label, score }],
    boundingBox: {
      originX,
      originY: 20,
      width,
      height,
    },
  };
}

test("classifies camera direction with explicit center band", () => {
  assert.equal(classifyDirection(0.2), "left");
  assert.equal(classifyDirection(0.5), "ahead");
  assert.equal(classifyDirection(0.8), "right");
});

test("classifies sustained deep knee flexion without making a diagnosis", () => {
  const posture = classifyPosture(makePose({ leftKnee: 108, rightKnee: 114 }));
  assert.equal(posture.key, "knee-flexion");
  assert.match(posture.basis, /camera-derived knee angle/i);
});

test("emits one reminder after a pose remains stable for the configured duration", () => {
  const alerts = [];
  const monitor = new CrewSafetyMonitor({
    postureHoldMs: 5_000,
    onAlert: (alert) => alerts.push(alert),
  });
  const pose = makePose();

  monitor.updatePose(pose, 0);
  monitor.updatePose(pose, 2_000);
  const posture = monitor.updatePose(pose, 5_100);
  monitor.updatePose(pose, 7_000);

  assert.equal(posture.alert, true);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, "posture");
  assert.match(alerts[0].message, /reposition gently/i);
});

test("movement resets the held-posture timer", () => {
  const monitor = new CrewSafetyMonitor({ postureHoldMs: 5_000 });
  monitor.updatePose(makePose(), 0);
  monitor.updatePose(makePose(), 4_000);
  const moving = monitor.updatePose(
    makePose({ leftKnee: 150, rightKnee: 150 }),
    4_100,
  );

  assert.equal(moving.heldSeconds, 0);
  assert.equal(moving.alert, false);
});

test("tracks an approaching supported object and mirrors user-facing direction", () => {
  const alerts = [];
  const monitor = new CrewSafetyMonitor({
    onAlert: (alert) => alerts.push(alert),
  });
  const dimensions = { width: 1_000, height: 500 };

  monitor.updateObjects(
    [detection("bottle", 0.8, 100, 70, 70)],
    dimensions,
    0,
    { mirrored: true },
  );
  monitor.updateObjects(
    [detection("bottle", 0.82, 95, 100, 100)],
    dimensions,
    600,
    { mirrored: true },
  );
  const result = monitor.updateObjects(
    [detection("bottle", 0.85, 85, 145, 145)],
    dimensions,
    1_200,
    { mirrored: true },
  );

  assert.equal(result.items[0].direction, "right");
  assert.equal(result.items[0].motion, "approaching");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].voice, /possible bottle approaching from right/i);
});
