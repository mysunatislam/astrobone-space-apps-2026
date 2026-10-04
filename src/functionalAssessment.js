import { buildPoseRetargetFrame } from "./poseRetargeting.js";
import { summarizeMotionGuardSamples } from "./motionGuard.js";

const LANDMARK = Object.freeze({
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftFoot: 31,
  rightFoot: 32,
});

const SIDES = Object.freeze(["left", "right"]);
const JOINTS = Object.freeze(["hip", "knee", "ankle"]);

export const ASSESSMENT_MIN_VISIBILITY = 0.62;
export const ASSESSMENT_MIN_SAMPLES = 12;

export function calculateJointAngle(first, vertex, third) {
  const a = toVector(first, vertex);
  const b = toVector(third, vertex);
  const magnitude = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) return null;

  const cosine = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / magnitude, -1, 1);
  return Math.acos(cosine) * (180 / Math.PI);
}

export function analyzePoseLandmarks(
  landmarks,
  imageLandmarks = landmarks,
  metadata = {},
) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return null;

  const retargetFrame = buildPoseRetargetFrame(landmarks, imageLandmarks);
  if (!retargetFrame) return null;

  const angles = {};
  const upperAngles = {};
  const upperTracking = {};
  const visibilityValues = [];

  SIDES.forEach((side) => {
    const shoulder = readLandmark(landmarks, LANDMARK[`${side}Shoulder`]);
    const elbow = readLandmark(landmarks, LANDMARK[`${side}Elbow`]);
    const wrist = readLandmark(landmarks, LANDMARK[`${side}Wrist`]);
    const hip = readLandmark(landmarks, LANDMARK[`${side}Hip`]);
    const knee = readLandmark(landmarks, LANDMARK[`${side}Knee`]);
    const ankle = readLandmark(landmarks, LANDMARK[`${side}Ankle`]);
    const foot = readLandmark(landmarks, LANDMARK[`${side}Foot`]);
    const points = [shoulder, hip, knee, ankle, foot];
    if (points.some((point) => !point)) return;

    visibilityValues.push(...points.map((point) => point.visibility));
    angles[side] = {
      hip: calculateJointAngle(shoulder, hip, knee),
      knee: calculateJointAngle(hip, knee, ankle),
      ankle: calculateJointAngle(knee, ankle, foot),
    };
    upperAngles[side] = {
      shoulder: calculateJointAngle(elbow, shoulder, hip),
      elbow: calculateJointAngle(shoulder, elbow, wrist),
    };
    upperTracking[side] = Boolean(
      retargetFrame.segments[`${side}Arm`]?.usable
      && retargetFrame.segments[`${side}ForeArm`]?.usable,
    );
  });

  if (!angles.left || !angles.right) return null;
  if (SIDES.some((side) => JOINTS.some((joint) => !Number.isFinite(angles[side][joint])))) {
    return null;
  }

  const visibility = mean(visibilityValues);
  const shoulderDy = imageLandmarks[12].y - imageLandmarks[11].y;
  const shoulderDx = imageLandmarks[12].x - imageLandmarks[11].x;
  const shoulderAlignmentDegrees = Math.atan2(Math.abs(shoulderDy), Math.abs(shoulderDx)) * 180 / Math.PI;
  return {
    ...retargetFrame,
    ...metadata,
    angles,
    upperAngles,
    upperTracking,
    visibility,
    shoulderAlignmentDegrees,
    usable:
      visibility >= ASSESSMENT_MIN_VISIBILITY
      && visibilityValues.every((value) => value >= ASSESSMENT_MIN_VISIBILITY)
      && retargetFrame.rigCoverage >= 0.64,
    asymmetry: {
      hip: Math.abs(angles.left.hip - angles.right.hip),
      knee: Math.abs(angles.left.knee - angles.right.knee),
      ankle: Math.abs(angles.left.ankle - angles.right.ankle),
    },
  };
}

export function summarizeFunctionalAssessment(
  samples,
  baseline = null,
  capture = {},
) {
  const usableSamples = (samples || []).filter(
    (sample) => sample?.usable && Number.isFinite(sample.visibility),
  );
  const captureQuality = summarizeCaptureQuality(
    capture.telemetry,
    usableSamples,
    capture.durationMs,
  );
  if (usableSamples.length < ASSESSMENT_MIN_SAMPLES) {
    return {
      status: "insufficient",
      sampleCount: usableSamples.length,
      trackingQuality: usableSamples.length ? mean(usableSamples.map((sample) => sample.visibility)) : 0,
      captureQuality,
      reason: "Keep the complete body visible and repeat the guided movement.",
    };
  }

  const rangeOfMotion = {};
  SIDES.forEach((side) => {
    rangeOfMotion[side] = {};
    JOINTS.forEach((joint) => {
      const values = usableSamples.map((sample) => sample.angles[side][joint]);
      rangeOfMotion[side][joint] = round(Math.max(...values) - Math.min(...values), 1);
    });
  });

  const asymmetry = {};
  JOINTS.forEach((joint) => {
    asymmetry[joint] = round(
      Math.abs(rangeOfMotion.left[joint] - rangeOfMotion.right[joint]),
      1,
    );
  });

  const result = {
    status: "complete",
    sampleCount: usableSamples.length,
    trackingQuality: round(mean(usableSamples.map((sample) => sample.visibility)), 3),
    captureQuality,
    rangeOfMotion,
    asymmetry,
    comparedWithBaseline: Boolean(baseline?.status === "complete"),
    baselineDelta: null,
    motionGuard: summarizeMotionGuardSamples(usableSamples),
    cameraFeatures: summarizeCameraFeatures(usableSamples),
    interpretation:
      "Camera-derived joint motion is functional evidence only; it cannot confirm or exclude fracture.",
  };

  if (baseline?.status === "complete") {
    result.baselineDelta = {};
    JOINTS.forEach((joint) => {
      const currentMean = mean([rangeOfMotion.left[joint], rangeOfMotion.right[joint]]);
      const baselineMean = mean([
        baseline.rangeOfMotion.left[joint],
        baseline.rangeOfMotion.right[joint],
      ]);
      result.baselineDelta[joint] = round(currentMean - baselineMean, 1);
    });
  }

  return result;
}

function summarizeCameraFeatures(samples) {
  const extensions = samples.flatMap((sample) => [sample.angles.left.knee, sample.angles.right.knee]);
  const alignment = samples.map((sample) => sample.shoulderAlignmentDegrees).filter(Number.isFinite);
  const centers = samples.filter((sample) => sample.imageCenter && sample.bodyScale > 0);
  let hipSwayRmsBodyScale = null;
  if (centers.length >= ASSESSMENT_MIN_SAMPLES) {
    const centerX = mean(centers.map((sample) => sample.imageCenter.x));
    const scale = mean(centers.map((sample) => sample.bodyScale));
    hipSwayRmsBodyScale = round(Math.sqrt(mean(centers.map((sample) => ((sample.imageCenter.x - centerX) / scale) ** 2))), 4);
  }
  return {
    kneeExtensionP95Degrees: round(percentile(extensions, 0.95), 2),
    shoulderAlignmentMeanDegrees: alignment.length ? round(mean(alignment), 2) : null,
    hipSwayRmsBodyScale,
    distanceCalibration: false,
    gaitSpeedMetersPerSecond: null,
    stepLengthMeters: null,
    interpretation: "Image-plane shoulder alignment and normalized hip sway are observational proxies, not validated balance or strength scores. Knee extension is the 95th percentile interior angle, with 180 degrees representing a straight knee.",
  };
}

function summarizeCaptureQuality(telemetry, usableSamples, durationMs) {
  const frames = Array.isArray(telemetry) && telemetry.length
    ? telemetry
    : usableSamples.map((sample) => ({
      detected: sample.detected ?? true,
      usable: sample.usable,
      rigCoverage: sample.rigCoverage,
      frameRate: sample.frameRate,
      inferenceMs: sample.inferenceMs,
    }));
  const frameCount = frames.length;
  const finiteValues = (key) => frames
    .map((frame) => frame?.[key])
    .filter(Number.isFinite);
  const rigCoverage = finiteValues("rigCoverage");
  const frameRates = finiteValues("frameRate");
  const inferenceTimes = finiteValues("inferenceMs");
  const usableFrameCount = frames.filter((frame) => frame?.usable).length;
  const detectedFrameCount = frames.filter((frame) => frame?.detected).length;

  return {
    durationSeconds: Number.isFinite(durationMs)
      ? round(durationMs / 1_000, 2)
      : null,
    frameCount,
    usableFrameCount,
    usableFrameRate: frameCount ? round(usableFrameCount / frameCount, 3) : 0,
    detectedFrameRate: frameCount ? round(detectedFrameCount / frameCount, 3) : 0,
    meanRigCoverage: rigCoverage.length ? round(mean(rigCoverage), 3) : null,
    p10RigCoverage: rigCoverage.length ? round(percentile(rigCoverage, 0.1), 3) : null,
    medianFps: frameRates.length ? round(percentile(frameRates, 0.5), 1) : null,
    medianInferenceMs: inferenceTimes.length
      ? round(percentile(inferenceTimes, 0.5), 1)
      : null,
    p95InferenceMs: inferenceTimes.length
      ? round(percentile(inferenceTimes, 0.95), 1)
      : null,
  };
}

function readLandmark(landmarks, index) {
  const point = landmarks[index];
  if (!point) return null;
  const x = Number(point.x);
  const y = Number(point.y);
  const z = Number(point.z ?? 0);
  const visibility = Number(point.visibility ?? 1);
  if (![x, y, z, visibility].every(Number.isFinite)) return null;
  return { x, y, z, visibility: clamp(visibility, 0, 1) };
}

function toVector(point, origin) {
  return {
    x: point.x - origin.x,
    y: point.y - origin.y,
    z: (point.z ?? 0) - (origin.z ?? 0),
  };
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((first, second) => first - second);
  if (sorted.length === 1) return sorted[0];
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return lerp(sorted[lower], sorted[upper], position - lower);
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
