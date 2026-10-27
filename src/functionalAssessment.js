import { buildPoseRetargetFrame } from "./poseRetargeting.js";
import { summarizeMotionGuardSamples } from "./motionGuard.js";
import { hybridKneeAngle } from "./kneeHybrid.js";

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
// Body yaw relative to the camera: below FRONT the person faces it, at or above SIDE they sit side-on.
export const CAMERA_VIEW = Object.freeze({ front: 35, side: 60 });

// Yaw of the body relative to the camera from the hip and shoulder lines in MediaPipe world coordinates,
// which keep the camera's axes (z is depth; smaller is nearer). 0 deg = facing the camera, 90 deg = side-on.
// Also names the leg nearer the camera, the only one a side-on camera sees.
export function bodyYaw(worldLandmarks) {
  const read = name => readLandmark(worldLandmarks, LANDMARK[name]);
  const pairs = [["leftHip", "rightHip"], ["leftShoulder", "rightShoulder"]].map(([a, b]) => [read(a), read(b)]);
  if (pairs.some(([a, b]) => !a || !b)) return null;
  const dx = mean(pairs.map(([a, b]) => Math.abs(b.x - a.x))), dz = mean(pairs.map(([a, b]) => Math.abs(b.z - a.z)));
  if (dx + dz <= Number.EPSILON) return null;
  const [leftHip, rightHip] = pairs[0];
  return { yawDeg: Math.atan2(dz, dx) * 180 / Math.PI, nearSide: leftHip.z <= rightHip.z ? "left" : "right" };
}

export function cameraViewFor(yawDeg) {
  if (!Number.isFinite(yawDeg)) return null;
  return yawDeg < CAMERA_VIEW.front ? "front" : yawDeg < CAMERA_VIEW.side ? "oblique" : "side";
}

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
  const sideUsable = {};
  const sideVisibility = {};
  const kneeHybrid = {};
  const yaw = bodyYaw(landmarks);
  // Image landmarks are normalized by width and height separately; the 2D knee angle needs square pixels.
  const aspect = Number(metadata.aspect);

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
    // A side-on camera sees the near leg well and the far leg poorly, so each side is gated on its own landmarks.
    sideUsable[side] = [hip, knee, ankle].every((point) => point.visibility >= ASSESSMENT_MIN_VISIBILITY);
    sideVisibility[side] = mean([hip, knee, ankle].map((point) => point.visibility));
    angles[side] = {
      hip: calculateJointAngle(shoulder, hip, knee),
      knee: calculateJointAngle(hip, knee, ankle),
      ankle: calculateJointAngle(knee, ankle, foot),
    };
    // Hybrid knee angle (src/kneeHybrid.js) from the 3D angle, the image-plane angle and the body yaw.
    if (Number.isFinite(aspect) && aspect > 0 && yaw) {
      const flat = name => { const p = readLandmark(imageLandmarks, LANDMARK[`${side}${name}`]); return p ? { x: p.x * aspect, y: p.y, z: 0 } : null; };
      const [h2, k2, a2] = ["Hip", "Knee", "Ankle"].map(flat);
      if (h2 && k2 && a2) {
        kneeHybrid[side] = hybridKneeAngle({
          angle3d: angles[side].knee, angle2d: calculateJointAngle(h2, k2, a2), yawDeg: yaw.yawDeg,
          thigh2d: Math.hypot(h2.x - k2.x, h2.y - k2.y), shank2d: Math.hypot(a2.x - k2.x, a2.y - k2.y),
          visibility: Math.min(hip.visibility, knee.visibility, ankle.visibility),
        });
      }
    }
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
    sideUsable,
    sideVisibility,
    kneeHybrid: kneeHybrid.left && kneeHybrid.right ? kneeHybrid : null,
    visibility,
    shoulderAlignmentDegrees,
    bodyYawDeg: yaw ? yaw.yawDeg : null,
    nearSide: yaw ? yaw.nearSide : null,
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

// Self-check knee capture: each knee is summarized from the frames where that knee was tracked,
// so a side-on capture of one leg is usable and a loss in one knee is not hidden by the other.
// Range of motion uses the 5th-95th percentile spread, which tracking jitter inflates far less than max - min.
// Knee angles are the hybrid ones (src/kneeHybrid.js) when the capture has them, which changes the
// protocol to v3: a v3 reading is never compared with a v2 baseline.
export const KNEE_CAPTURE = Object.freeze({ minSamples: ASSESSMENT_MIN_SAMPLES, minQuality: 0.7 });

export function summarizeKneeCapture(samples) {
  const frames = (samples || []).filter(Boolean);
  // Camera view from the median body yaw. Side-on, the far leg is hidden behind the near one, so only
  // the near knee counts even when the model reports the far one as visible.
  const yaws = frames.map((frame) => frame.bodyYawDeg).filter(Number.isFinite);
  const bodyYawDeg = yaws.length ? round(percentile(yaws, 0.5), 1) : null;
  const cameraView = cameraViewFor(bodyYawDeg);
  const nearVotes = frames.map((frame) => frame.nearSide).filter(Boolean);
  const nearSide = cameraView === "side" && nearVotes.length
    ? (nearVotes.filter((side) => side === "left").length * 2 >= nearVotes.length ? "left" : "right")
    : null;
  const hybrid = frames.length > 0 && frames.every((frame) => Number.isFinite(frame.kneeHybrid?.left?.angle) && Number.isFinite(frame.kneeHybrid?.right?.angle));
  const kneeOf = (frame, side) => (hybrid ? frame.kneeHybrid[side].angle : frame.angles?.[side]?.knee);
  const sides = {};
  SIDES.forEach((side) => {
    const usable = frames.filter((frame) => frame.sideUsable?.[side] && Number.isFinite(kneeOf(frame, side)));
    const knees = usable.map((frame) => kneeOf(frame, side));
    const quality = usable.length ? mean(usable.map((frame) => frame.sideVisibility?.[side] ?? frame.visibility)) : 0;
    const hidden = nearSide !== null && side !== nearSide;
    const ok = !hidden && usable.length >= KNEE_CAPTURE.minSamples && quality >= KNEE_CAPTURE.minQuality;
    sides[side] = {
      usable: ok,
      hiddenSideOn: hidden,
      sampleCount: usable.length,
      trackingQuality: round(quality, 3),
      extension: ok ? round(percentile(knees, 0.95), 1) : null,
      rangeOfMotion: ok ? round(percentile(knees, 0.95) - percentile(knees, 0.05), 1) : null,
    };
  });
  const usableSides = SIDES.filter((side) => sides[side].usable);
  // The worse knee is the one with less extension; both knees must be usable for a bilateral result.
  const view = usableSides.length === 2 ? "bilateral" : usableSides[0] ?? null;
  const pick = view === "bilateral"
    ? (sides.left.extension <= sides.right.extension ? "left" : "right")
    : view;
  // Turned partway, the reading sits between the facing and side-on error regimes and matches neither
  // baseline (scripts/simulate-camera-view.mjs), so it is refused and repeated.
  const oblique = cameraView === "oblique";
  return {
    status: view && !oblique ? "complete" : "insufficient",
    reason: oblique ? "oblique" : view ? null : "tracking",
    view,
    cameraView,
    bodyYawDeg,
    worseSide: view === "bilateral" ? pick : null,
    sides,
    kneeExtension: pick ? sides[pick].extension : null,
    kneeRom: pick ? sides[pick].rangeOfMotion : null,
    asymmetry: view === "bilateral" ? round(Math.abs(sides.left.extension - sides.right.extension), 1) : null,
    sampleCount: pick ? sides[pick].sampleCount : Math.max(sides.left.sampleCount, sides.right.sampleCount),
    trackingQuality: pick ? sides[pick].trackingQuality : Math.max(sides.left.trackingQuality, sides.right.trackingQuality),
    angleMethod: hybrid ? "hybrid" : "3d",
    hybridShare: hybrid && pick ? round(mean(frames.filter((frame) => frame.sideUsable?.[pick]).map((frame) => (frame.kneeHybrid[pick].method === "hybrid" ? 1 : 0))), 3) : null,
    protocol: view ? `self-check-seated-knee-extension-${hybrid ? "v3" : "v2"}-${view}` : null,
  };
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
