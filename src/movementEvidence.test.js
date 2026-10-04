import test from "node:test";
import assert from "node:assert/strict";

import {
  MOVEMENT_EVIDENCE_SCHEMA_VERSION,
  VIDEO_MOVEMENT_EVIDENCE_SCHEMA_VERSION,
  createMovementEvidencePacket,
} from "./movementEvidence.js";

test("movement packet contains aggregate evidence and explicit channel isolation", () => {
  const packet = createMovementEvidencePacket({
    assessment: makeAssessment(),
    generatedAt: "2026-08-26T12:00:00.000Z",
  });

  assert.equal(packet.schemaVersion, MOVEMENT_EVIDENCE_SCHEMA_VERSION);
  assert.equal(packet.capture.model.landmarkCount, 33);
  assert.equal(packet.capture.model.mappedRigSegmentCount, 14);
  assert.equal(packet.capture.quality.usableFrameRate, 0.82);
  assert.equal(packet.privacy.rawFramesIncluded, false);
  assert.equal(packet.privacy.rawLandmarksIncluded, false);
  assert.equal(packet.channelIsolation.altersImageModelScore, false);
  assert.equal(packet.channelIsolation.altersMechanicalDemandIndex, false);
});

test("movement packet does not serialize video, image, or landmark samples", () => {
  const serialized = JSON.stringify(createMovementEvidencePacket({
    assessment: makeAssessment(),
  })).toLowerCase();

  assert.equal(serialized.includes("data:image"), false);
  assert.equal(serialized.includes("worldlandmarks"), false);
  assert.equal(serialized.includes("videoframe"), false);
});

test("movement packet rejects incomplete captures", () => {
  assert.throws(
    () => createMovementEvidencePacket({ assessment: { status: "insufficient" } }),
    /complete movement assessment/,
  );
});

test("local video export keeps its own provenance and excludes a camera baseline", () => {
  const baseline = makeAssessment();
  baseline.asBaseline = true;
  const assessment = { ...makeAssessment(), sourceKind: "video" };
  const packet = createMovementEvidencePacket({ assessment, baseline });
  assert.equal(packet.schemaVersion, VIDEO_MOVEMENT_EVIDENCE_SCHEMA_VERSION);
  assert.equal(packet.evidenceChannel, "functional-video");
  assert.equal(packet.capture.model.input, "local RGB exercise video");
  assert.deepEqual(packet.baselineReference, { available: false });
});

test("MotionGuard exports only whitelisted aggregates and keeps mechanics isolated", () => {
  const assessment = makeAssessment();
  assessment.motionGuard = {
    mode: "reach",
    freshSampleCount: 80,
    completedRepetitions: 3,
    completedReachCycles: 4,
    meanKneeDifferenceDegrees: 4.8,
    meanJointDifferenceDegrees: {
      shoulder: 7.2,
      elbow: 5.1,
      hip: 3.4,
      knee: 4.8,
      privateJoint: 999,
    },
    reachCycles: { left: 2, right: 2, privateSide: 99 },
    rawLandmarks: [{ x: 1234, y: 5678 }],
    videoFrame: "data:image/private",
  };
  const packet = createMovementEvidencePacket({ assessment });
  assert.equal(packet.movementSummary.motionGuard.completedRepetitions, 3);
  assert.equal(packet.movementSummary.motionGuard.completedReachCycles, 4);
  assert.equal(packet.movementSummary.motionGuard.meanKneeDifferenceDegrees, 4.8);
  assert.equal(packet.movementSummary.motionGuard.meanJointDifferenceDegrees.shoulder, 7.2);
  assert.equal(packet.movementSummary.motionGuard.reachCycles.left, 2);
  assert.equal(Object.hasOwn(
    packet.movementSummary.motionGuard.meanJointDifferenceDegrees,
    "privateJoint",
  ), false);
  assert.equal(Object.hasOwn(packet.movementSummary.motionGuard.reachCycles, "privateSide"), false);
  assert.equal(Object.hasOwn(packet.movementSummary.motionGuard, "rawLandmarks"), false);
  assert.equal(JSON.stringify(packet).includes("data:image/private"), false);
  assert.equal(packet.channelIsolation.altersMechanicalDemandIndex, false);
});

test("video evidence records shortened timing without exporting the source file", () => {
  const assessment = {...makeAssessment(),sourceKind:"video",videoSegment:{
    startSeconds:0,endSeconds:7,sourceDurationSeconds:7,autoTrimmed:false,
    observationStartSeconds:0,observationDurationSeconds:6.5,privateFileName:"private.mp4",
  }};
  assessment.captureQuality.durationSeconds = 6.5;
  const packet = createMovementEvidencePacket({assessment});
  assert.equal(packet.capture.quality.durationSeconds, 6.5);
  assert.equal(packet.capture.videoSegment.observationDurationSeconds, 6.5);
  assert.equal(packet.capture.videoSegment.endSeconds, 7);
  assert.equal(Object.hasOwn(packet.capture.videoSegment,"privateFileName"), false);
  assert.equal(packet.privacy.uploadedByAstroBone, false);
});

function makeAssessment() {
  return {
    status: "complete",
    asBaseline: false,
    startedAt: "2026-08-26T11:59:52.000Z",
    completedAt: "2026-08-26T12:00:00.000Z",
    sampleCount: 98,
    trackingQuality: 0.91,
    rangeOfMotion: {
      left: { hip: 24.1, knee: 38.4, ankle: 12.2 },
      right: { hip: 22.9, knee: 35.1, ankle: 11.8 },
    },
    asymmetry: { hip: 1.2, knee: 3.3, ankle: 0.4 },
    comparedWithBaseline: true,
    baselineDelta: { hip: -1.1, knee: -2.4, ankle: 0.2 },
    captureQuality: {
      durationSeconds: 8,
      frameCount: 120,
      usableFrameCount: 98,
      usableFrameRate: 0.82,
      detectedFrameRate: 0.94,
      meanRigCoverage: 0.88,
      p10RigCoverage: 0.71,
      medianFps: 24.8,
      medianInferenceMs: 18.2,
      p95InferenceMs: 27.6,
    },
  };
}
