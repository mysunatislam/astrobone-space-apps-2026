export const MOVEMENT_EVIDENCE_SCHEMA_VERSION = "astrobone-movement-evidence-v3";
export const VIDEO_MOVEMENT_EVIDENCE_SCHEMA_VERSION = "astrobone-movement-evidence-video-v1";

const MOTION_GUARD_JOINTS = Object.freeze(["shoulder", "elbow", "hip", "knee"]);

export function createMovementEvidencePacket({
  assessment,
  baseline = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (assessment?.status !== "complete") {
    throw new TypeError("A complete movement assessment is required.");
  }
  const fromVideo = assessment.sourceKind === "video";

  return {
    schemaVersion: fromVideo ? VIDEO_MOVEMENT_EVIDENCE_SCHEMA_VERSION : MOVEMENT_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    evidenceChannel: fromVideo ? "functional-video" : "functional-camera",
    evidenceType: assessment.asBaseline ? "session-baseline" : "movement-assessment",
    intendedUse:
      "Aggregate functional-movement evidence for research comparison, trend review, and delayed-care handoff.",
    capture: {
      startedAt: assessment.startedAt ?? null,
      completedAt: assessment.completedAt ?? null,
      model: {
        task: "MediaPipe Pose Landmarker",
        variant: "lite",
        landmarkCount: 33,
        mappedRigSegmentCount: 14,
        input: fromVideo ? "local RGB exercise video" : "single RGB camera",
        processingLocation: "browser-local",
      },
      quality: copyCaptureQuality(assessment.captureQuality),
      ...(fromVideo ? {videoSegment: copyVideoSegment(assessment.videoSegment)} : {}),
    },
    movementSummary: {
      sampleCount: assessment.sampleCount,
      trackingQuality: assessment.trackingQuality,
      rangeOfMotionDegrees: cloneRecord(assessment.rangeOfMotion),
      rangeAsymmetryDegrees: cloneRecord(assessment.asymmetry),
      comparedWithBaseline: Boolean(assessment.comparedWithBaseline),
      baselineDeltaDegrees: cloneRecord(assessment.baselineDelta),
      motionGuard: copyMotionGuardSummary(assessment.motionGuard),
    },
    baselineReference: !fromVideo && baseline?.status === "complete"
      ? {
        available: true,
        completedAt: baseline.completedAt ?? null,
        sampleCount: baseline.sampleCount,
        rangeOfMotionDegrees: cloneRecord(baseline.rangeOfMotion),
        captureQuality: copyCaptureQuality(baseline.captureQuality),
      }
      : { available: false },
    privacy: {
      rawFramesIncluded: false,
      imagesIncluded: false,
      rawLandmarksIncluded: false,
      uploadedByAstroBone: false,
      aggregateMetricsOnly: true,
    },
    channelIsolation: {
      altersImageModelScore: false,
      altersMechanicalDemandIndex: false,
      diagnosticOutput: false,
    },
    limitations: [
      "Single-camera depth and joint positions are estimates, not motion-capture ground truth.",
      "The capture does not detect or exclude fracture.",
      "Lighting, clothing, framing, occlusion, and camera placement can change reliability.",
      ...(fromVideo ? ["Playback-derived motion is not directly comparable with a live-camera baseline."] : []),
      "External goniometer or motion-capture comparison is still required.",
    ],
  };
}

function copyVideoSegment(segment) {
  if (!segment || typeof segment !== "object") return null;
  return {
    startSeconds: finiteOrNull(segment.startSeconds),
    endSeconds: finiteOrNull(segment.endSeconds),
    sourceDurationSeconds: finiteOrNull(segment.sourceDurationSeconds),
    autoTrimmed: segment.autoTrimmed === true,
    observationStartSeconds: finiteOrNull(segment.observationStartSeconds),
    observationDurationSeconds: finiteOrNull(segment.observationDurationSeconds),
  };
}

function copyMotionGuardSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const numericKeys = [
    "freshSampleCount", "meanKneeDifferenceDegrees", "maximumKneeDifferenceDegrees",
    "maximumTrunkAxisDeviationDegrees", "meanKneeAngularSpeedDegreesPerSecond",
    "completedRepetitions", "completedKneeCycles", "completedReachCycles",
    "cycleRatePerMinute", "cycleTimingVariationPercent",
  ];
  return {
    version: "motionguard-kinematics-v2",
    mode: ["monitor", "squat", "gait", "reach"].includes(summary.mode) ? summary.mode : "monitor",
    ...Object.fromEntries(numericKeys.map((key) => [key, finiteOrNull(summary[key])])),
    meanJointDifferenceDegrees: copyJointRecord(summary.meanJointDifferenceDegrees),
    maximumJointDifferenceDegrees: copyJointRecord(summary.maximumJointDifferenceDegrees),
    meanJointAngularSpeedDegreesPerSecond: copyJointRecord(
      summary.meanJointAngularSpeedDegreesPerSecond,
    ),
    reachCycles: copySideCountRecord(summary.reachCycles),
    loadEstimation: "Not measured; external loads and subject-specific calibration are required.",
    diagnosticOutput: false,
  };
}

function copyJointRecord(record = {}) {
  return Object.fromEntries(
    MOTION_GUARD_JOINTS.map((joint) => [joint, finiteOrNull(record?.[joint])]),
  );
}

function copySideCountRecord(record = {}) {
  return {
    left: integerOrZero(record?.left),
    right: integerOrZero(record?.right),
  };
}

function copyCaptureQuality(quality = {}) {
  return {
    durationSeconds: finiteOrNull(quality.durationSeconds),
    frameCount: integerOrZero(quality.frameCount),
    usableFrameCount: integerOrZero(quality.usableFrameCount),
    usableFrameRate: finiteOrNull(quality.usableFrameRate),
    detectedFrameRate: finiteOrNull(quality.detectedFrameRate),
    meanRigCoverage: finiteOrNull(quality.meanRigCoverage),
    p10RigCoverage: finiteOrNull(quality.p10RigCoverage),
    medianFps: finiteOrNull(quality.medianFps),
    medianInferenceMs: finiteOrNull(quality.medianInferenceMs),
    p95InferenceMs: finiteOrNull(quality.p95InferenceMs),
  };
}

function cloneRecord(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(cloneRecord);
  if (typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneRecord(item)]),
  );
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrZero(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}
