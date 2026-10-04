import test from "node:test";
import assert from "node:assert/strict";
import { MotionGuardAnalyzer, measureMotionFrame, summarizeMotionGuardSamples } from "./motionGuard.js";

test("MotionGuard defines knee flexion as zero at full extension", () => {
  const metrics = measureMotionFrame(pose(10, 35, {
    leftHip: 15,
    rightHip: 25,
    leftShoulder: 70,
    rightShoulder: 90,
    leftElbow: 20,
    rightElbow: 40,
  }));
  assert.deepEqual(metrics.kneeFlexionDegrees, { left: 10, right: 35 });
  assert.equal(metrics.kneeDifferenceDegrees, 25);
  assert.deepEqual(metrics.jointMotionDegrees.left, {
    shoulder: 70,
    elbow: 20,
    hip: 15,
    knee: 10,
  });
  assert.deepEqual(metrics.jointDifferenceDegrees, {
    shoulder: 20,
    elbow: 20,
    hip: 10,
    knee: 25,
  });
  assert.equal(metrics.trunkAxisDeviationDegrees, 0);
});

test("untracked arms stay unavailable while lower-body motion remains usable", () => {
  const metrics = measureMotionFrame(pose(10, 12, { armsTracked: false }));
  assert.equal(metrics.jointMotionDegrees.left.shoulder, null);
  assert.equal(metrics.jointMotionDegrees.right.elbow, null);
  assert.equal(metrics.jointDifferenceDegrees.shoulder, null);
  assert.equal(metrics.kneeDifferenceDegrees, 2);
});

test("MotionGuard rejects held, missing, and invalid pose geometry", () => {
  assert.equal(measureMotionFrame({ ...pose(), detected: false }), null);
  assert.equal(measureMotionFrame(null), null);
  assert.equal(measureMotionFrame(pose(-5, 10)), null);
  const analyzer = new MotionGuardAnalyzer();
  analyzer.update(pose(), 0);
  assert.equal(analyzer.update({ ...pose(), usable: false }, 100).status, "waiting");
  assert.equal(analyzer.getSnapshot().sampleCount, 1);
});

test("a complete squat records depth and asymmetry without a clinical score", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "squat" });
  analyzer.update(pose(5, 5), 0);
  analyzer.update(pose(55, 50), 500);
  analyzer.update(pose(85, 70), 1_000);
  const result = analyzer.update(pose(10, 10), 1_500);
  assert.equal(result.repetitions, 1);
  assert.equal(result.repetitionCompleted, true);
  assert.equal(result.lastRepetition.peakKneeFlexionDegrees, 77.5);
  assert.equal(result.lastRepetition.maximumKneeDifferenceDegrees, 15);
  assert.equal(result.lastRepetition.flexedPhaseSeconds, 1);
  assert.equal(analyzer.update(pose(10, 10), 1_500).repetitionCompleted, false);
  assert.equal(Object.hasOwn(result, "injuryRisk"), false);
  assert.equal(Object.hasOwn(result, "movementQualityPercent"), false);
});

test("starting flexed or losing tracking cannot create a phantom squat", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "squat" });
  analyzer.update(pose(70, 70), 0);
  analyzer.update(pose(5, 5), 800);
  assert.equal(analyzer.getSnapshot().repetitions, 0);
  analyzer.update(pose(70, 70), 1_000);
  analyzer.update(null, 1_200);
  analyzer.update(pose(5, 5), 1_800);
  assert.equal(analyzer.getSnapshot().repetitions, 0);
});

test("brief threshold jitter and long frame gaps do not count as repetitions", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "squat" });
  analyzer.update(pose(5, 5), 0);
  analyzer.update(pose(60, 60), 100);
  analyzer.update(pose(5, 5), 200);
  analyzer.update(pose(60, 60), 300);
  analyzer.update(pose(5, 5), 2_000);
  assert.equal(analyzer.getSnapshot().repetitions, 0);
  assert.equal(analyzer.getSnapshot().kneeAngularSpeedDegreesPerSecond, null);
});

test("alternating knee cycles expose timing without labeling them verified steps", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "gait" });
  analyzer.update(pose(5, 5), 0);
  for (let cycle = 0; cycle < 4; cycle += 1) {
    analyzer.update(cycle % 2 === 0 ? pose(40, 5) : pose(5, 40), cycle * 500 + 200);
    analyzer.update(pose(5, 5), cycle * 500 + 500);
  }
  const result = analyzer.getSnapshot();
  assert.deepEqual(result.kneeCycles, { left: 2, right: 2 });
  assert.equal(result.cycleRatePerMinute, 120);
  assert.equal(result.cycleTimingVariationPercent, 0);
  assert.equal(Object.hasOwn(result, "steps"), false);
  analyzer.update(null, 2_100);
  assert.equal(analyzer.getSnapshot().cycleRatePerMinute, null);
});

test("controlled reach cycles count a raised-and-returned arm on each side", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "reach" });
  analyzer.update(pose(5, 5, { leftShoulder: 20, rightShoulder: 25 }), 0);
  analyzer.update(pose(5, 5, { leftShoulder: 120, rightShoulder: 125 }), 400);
  const result = analyzer.update(
    pose(5, 5, { leftShoulder: 25, rightShoulder: 20 }),
    1_000,
  );
  assert.deepEqual(result.reachCycles, { left: 1, right: 1 });
  assert.deepEqual(result.reachCompletedSides, ["left", "right"]);
  assert.equal(result.stateLabel, "Controlled reach cycle recorded");
  assert.equal(result.activeJoint, "shoulder");
  assert.equal(Object.hasOwn(result, "exerciseQuality"), false);
});

test("starting raised or losing tracking cannot create a phantom reach cycle", () => {
  const analyzer = new MotionGuardAnalyzer({ mode: "reach" });
  analyzer.update(pose(5, 5, { leftShoulder: 125, rightShoulder: 125 }), 0);
  analyzer.update(pose(5, 5, { leftShoulder: 20, rightShoulder: 20 }), 700);
  assert.deepEqual(analyzer.getSnapshot().reachCycles, { left: 0, right: 0 });
  analyzer.update(pose(5, 5, { leftShoulder: 125, rightShoulder: 125 }), 1_000);
  analyzer.update(null, 1_200);
  analyzer.update(pose(5, 5, { leftShoulder: 20, rightShoulder: 20 }), 1_700);
  assert.deepEqual(analyzer.getSnapshot().reachCycles, { left: 0, right: 0 });
});

test("asymmetry cues require persistence and respect cooldown", () => {
  const alerts = [];
  const analyzer = new MotionGuardAnalyzer({ onAlert: (alert) => alerts.push(alert) });
  for (let time = 0; time <= 6_000; time += 500) analyzer.update(pose(5, 35), time);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /camera alignment/);
  const gait = new MotionGuardAnalyzer({ mode: "gait", onAlert: (alert) => alerts.push(alert) });
  for (let time = 0; time <= 4_000; time += 500) gait.update(pose(5, 35), time);
  assert.equal(alerts.length, 1);
  const reach = new MotionGuardAnalyzer({ mode: "reach", onAlert: (alert) => alerts.push(alert) });
  for (let time = 0; time <= 4_000; time += 500) reach.update(pose(5, 35), time);
  assert.equal(alerts.length, 1);
});

test("MotionGuard capture summaries contain aggregates and explicit load limitations", () => {
  const analyzer = new MotionGuardAnalyzer();
  const samples = [0, 100, 200].map((time) => ({ motionGuard: analyzer.update(pose(5, 15), time) }));
  const summary = summarizeMotionGuardSamples(samples);
  assert.equal(summary.freshSampleCount, 3);
  assert.equal(summary.meanKneeDifferenceDegrees, 10);
  assert.equal(summary.meanJointDifferenceDegrees.knee, 10);
  assert.equal(summary.meanJointDifferenceDegrees.shoulder, 0);
  assert.equal(summary.completedReachCycles, 0);
  assert.match(summary.loadEstimation, /external loads/);
  assert.equal(JSON.stringify(summary).includes("landmarks"), false);
  assert.equal(summary.lastRepetition, null);
  assert.equal(summarizeMotionGuardSamples([]), null);
});

function pose(leftFlexion = 5, rightFlexion = leftFlexion, {
  leftHip = 5,
  rightHip = leftHip,
  leftShoulder = 30,
  rightShoulder = leftShoulder,
  leftElbow = 25,
  rightElbow = leftElbow,
  armsTracked = true,
} = {}) {
  return {
    usable: true,
    detected: true,
    angles: {
      left: { hip: 180 - leftHip, knee: 180 - leftFlexion },
      right: { hip: 180 - rightHip, knee: 180 - rightFlexion },
    },
    upperAngles: {
      left: { shoulder: leftShoulder, elbow: 180 - leftElbow },
      right: { shoulder: rightShoulder, elbow: 180 - rightElbow },
    },
    upperTracking: { left: armsTracked, right: armsTracked },
    segments: { spine: { direction: { x: 0, y: -1, z: 0 } } },
  };
}
