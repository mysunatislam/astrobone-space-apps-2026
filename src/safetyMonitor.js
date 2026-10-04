export const DEFAULT_POSTURE_HOLD_MS = 20_000;
export const DEFAULT_OBJECT_SCORE_THRESHOLD = 0.55;

const POSE_SETTLE_MS = 1_500;
const POSE_CHANGE_THRESHOLD = 6.5;
const OBJECT_TRACK_EXPIRY_MS = 2_500;
const OBJECT_ALERT_COOLDOWN_MS = 10_000;
const OBJECT_APPROACH_RATE = 0.18;

export class CrewSafetyMonitor {
  constructor({
    postureHoldMs = DEFAULT_POSTURE_HOLD_MS,
    objectScoreThreshold = DEFAULT_OBJECT_SCORE_THRESHOLD,
    onUpdate = () => {},
    onAlert = () => {},
  } = {}) {
    this.postureHoldMs = postureHoldMs;
    this.objectScoreThreshold = objectScoreThreshold;
    this.onUpdate = onUpdate;
    this.onAlert = onAlert;
    this.objectTracks = new Map();
    this.posture = createEmptyPostureState();
    this.objects = createEmptyObjectState();
    this.poseAnchor = null;
    this.postureStartedAt = null;
    this.postureAlerted = false;
  }

  setPostureHoldMs(value) {
    const next = Number(value);
    if (!Number.isFinite(next) || next < 5_000) return;
    this.postureHoldMs = next;
    this.resetPose();
  }

  updatePose(frame, timestamp = now()) {
    if (!frame?.usable) {
      this.resetPose({ emit: false });
      this.posture = createEmptyPostureState();
      this.emitUpdate();
      return this.posture;
    }

    const signature = buildPoseSignature(frame);
    if (!signature) {
      this.resetPose({ emit: false });
      this.posture = createEmptyPostureState();
      this.emitUpdate();
      return this.posture;
    }

    const classification = classifyPosture(frame);
    const changedPosture = this.posture.key !== classification.key;
    const changeScore = this.poseAnchor
      ? comparePoseSignatures(signature, this.poseAnchor)
      : Infinity;
    const moved = !this.poseAnchor || changeScore > POSE_CHANGE_THRESHOLD;

    if (moved || changedPosture || this.postureStartedAt === null) {
      this.poseAnchor = signature;
      this.postureStartedAt = timestamp;
      this.postureAlerted = false;
    }

    const heldMs = Math.max(0, timestamp - this.postureStartedAt);
    const settled = heldMs >= POSE_SETTLE_MS;
    this.posture = {
      visible: true,
      key: classification.key,
      label: settled ? classification.label : "Position changing",
      heldMs,
      heldSeconds: Math.floor(heldMs / 1_000),
      thresholdMs: this.postureHoldMs,
      movementScore: Number.isFinite(changeScore) ? round(changeScore, 2) : null,
      alert: settled && heldMs >= this.postureHoldMs,
      basis: classification.basis,
    };

    if (this.posture.alert && !this.postureAlerted) {
      this.postureAlerted = true;
      this.onAlert(createPostureAlert(this.posture));
    }

    this.emitUpdate();
    return this.posture;
  }

  updateObjects(
    detections,
    { width, height },
    timestamp = now(),
    { mirrored = false, inferenceMs = null } = {},
  ) {
    const frameWidth = Number(width);
    const frameHeight = Number(height);
    if (!(frameWidth > 0 && frameHeight > 0)) {
      this.clearObjects();
      return this.objects;
    }

    const normalized = normalizeDetections(
      detections,
      frameWidth,
      frameHeight,
      mirrored,
      this.objectScoreThreshold,
    );
    const bestByLabel = new Map();
    normalized.forEach((item) => {
      const previous = bestByLabel.get(item.label);
      if (!previous || item.score * item.areaFraction > previous.score * previous.areaFraction) {
        bestByLabel.set(item.label, item);
      }
    });

    const active = [];
    bestByLabel.forEach((item, label) => {
      const previous = this.objectTracks.get(label);
      const elapsedSeconds = previous
        ? Math.max((timestamp - previous.timestamp) / 1_000, 0.001)
        : null;
      const rawGrowthRate = previous && elapsedSeconds <= 2.5
        ? (item.areaFraction - previous.areaFraction)
          / Math.max(previous.areaFraction, 0.004)
          / elapsedSeconds
        : 0;
      const growthRate = previous
        ? previous.growthRate * 0.45 + rawGrowthRate * 0.55
        : 0;
      const lateralRate = previous && elapsedSeconds <= 2.5
        ? (item.centerX - previous.centerX) / elapsedSeconds
        : 0;
      const approachingNow = growthRate >= OBJECT_APPROACH_RATE
        && item.areaFraction >= 0.004;
      const approachStreak = approachingNow
        ? (previous?.approachStreak ?? 0) + 1
        : Math.max(0, (previous?.approachStreak ?? 0) - 1);
      const motion = approachStreak >= 2
        ? "approaching"
        : growthRate <= -OBJECT_APPROACH_RATE
          ? "moving away"
          : Math.abs(lateralRate) >= 0.12
            ? "crossing view"
            : "observed";
      const lastAlertAt = previous?.lastAlertAt ?? -Infinity;
      const track = {
        ...item,
        motion,
        growthRate: round(growthRate, 3),
        lateralRate: round(lateralRate, 3),
        approachStreak,
        timestamp,
        lastAlertAt,
      };

      if (
        motion === "approaching"
        && previous?.motion !== "approaching"
        && timestamp - lastAlertAt >= OBJECT_ALERT_COOLDOWN_MS
      ) {
        track.lastAlertAt = timestamp;
        this.onAlert(createObjectAlert(track));
      }

      this.objectTracks.set(label, track);
      active.push(track);
    });

    this.objectTracks.forEach((track, key) => {
      if (timestamp - track.timestamp > OBJECT_TRACK_EXPIRY_MS) {
        this.objectTracks.delete(key);
      }
    });

    active.sort((first, second) => {
      if (first.motion === "approaching" && second.motion !== "approaching") return -1;
      if (second.motion === "approaching" && first.motion !== "approaching") return 1;
      return second.areaFraction - first.areaFraction;
    });
    this.objects = {
      count: active.length,
      items: active.slice(0, 5),
      approaching: active.filter((item) => item.motion === "approaching"),
      inferenceMs: Number.isFinite(inferenceMs) ? round(inferenceMs, 1) : null,
      timestamp,
    };
    this.emitUpdate();
    return this.objects;
  }

  clearObjects({ emit = true } = {}) {
    this.objectTracks.clear();
    this.objects = createEmptyObjectState();
    if (emit) this.emitUpdate();
  }

  resetPose({ emit = true } = {}) {
    this.poseAnchor = null;
    this.postureStartedAt = null;
    this.postureAlerted = false;
    this.posture = createEmptyPostureState();
    if (emit) this.emitUpdate();
  }

  reset() {
    this.resetPose({ emit: false });
    this.clearObjects({ emit: false });
    this.emitUpdate();
  }

  getSnapshot() {
    return {
      posture: { ...this.posture },
      objects: {
        ...this.objects,
        items: this.objects.items.map((item) => ({ ...item })),
        approaching: this.objects.approaching.map((item) => ({ ...item })),
      },
    };
  }

  emitUpdate() {
    this.onUpdate(this.getSnapshot());
  }
}

export function classifyDirection(normalizedX) {
  if (normalizedX < 0.38) return "left";
  if (normalizedX > 0.62) return "right";
  return "ahead";
}

export function classifyPosture(frame) {
  const leftKnee = frame?.angles?.left?.knee;
  const rightKnee = frame?.angles?.right?.knee;
  const kneeAsymmetry = frame?.asymmetry?.knee;
  const hipAsymmetry = frame?.asymmetry?.hip;
  const spine = frame?.segments?.spine?.direction;
  const trunkTilt = spine
    ? Math.acos(clamp(Math.abs(spine.y), 0, 1)) * (180 / Math.PI)
    : 0;

  if (Number.isFinite(leftKnee) && Number.isFinite(rightKnee)
    && Math.min(leftKnee, rightKnee) < 120) {
    return {
      key: "knee-flexion",
      label: "Deep knee bend held",
      basis: `Minimum camera-derived knee angle ${Math.round(Math.min(leftKnee, rightKnee))} degrees`,
    };
  }
  if ((Number.isFinite(kneeAsymmetry) && kneeAsymmetry > 20)
    || (Number.isFinite(hipAsymmetry) && hipAsymmetry > 18)) {
    return {
      key: "asymmetric-stance",
      label: "Asymmetric stance held",
      basis: "Camera-derived left/right joint-angle difference",
    };
  }
  if (Number.isFinite(trunkTilt) && trunkTilt > 28) {
    return {
      key: "trunk-lean",
      label: "Trunk lean held",
      basis: `Estimated trunk tilt ${Math.round(trunkTilt)} degrees`,
    };
  }
  return {
    key: "static-posture",
    label: "Same posture held",
    basis: "Low change across camera-derived joint angles and trunk orientation",
  };
}

function buildPoseSignature(frame) {
  const values = [
    frame?.angles?.left?.hip,
    frame?.angles?.left?.knee,
    frame?.angles?.left?.ankle,
    frame?.angles?.right?.hip,
    frame?.angles?.right?.knee,
    frame?.angles?.right?.ankle,
    frame?.segments?.spine?.direction?.x,
    frame?.segments?.spine?.direction?.y,
    frame?.segments?.spine?.direction?.z,
  ].map(Number);
  return values.every(Number.isFinite) ? values : null;
}

function comparePoseSignatures(current, anchor) {
  const jointDifference = current
    .slice(0, 6)
    .reduce((total, value, index) => total + Math.abs(value - anchor[index]), 0)
    / 6;
  const currentSpine = current.slice(6, 9);
  const anchorSpine = anchor.slice(6, 9);
  const dot = currentSpine.reduce(
    (total, value, index) => total + value * anchorSpine[index],
    0,
  );
  const spineDifference = Math.acos(clamp(dot, -1, 1)) * (180 / Math.PI);
  return jointDifference + spineDifference * 0.65;
}

function normalizeDetections(
  detections,
  frameWidth,
  frameHeight,
  mirrored,
  scoreThreshold,
) {
  return (Array.isArray(detections) ? detections : [])
    .map((detection) => {
      const category = detection?.categories?.[0];
      const box = detection?.boundingBox;
      const score = Number(category?.score);
      if (!box || !Number.isFinite(score) || score < scoreThreshold) return null;
      const label = String(
        category.displayName || category.categoryName || "object",
      ).trim().toLowerCase();
      const centerXRaw = (Number(box.originX) + Number(box.width) / 2) / frameWidth;
      const centerX = clamp(mirrored ? 1 - centerXRaw : centerXRaw, 0, 1);
      const centerY = clamp(
        (Number(box.originY) + Number(box.height) / 2) / frameHeight,
        0,
        1,
      );
      const areaFraction = clamp(
        (Number(box.width) * Number(box.height)) / (frameWidth * frameHeight),
        0,
        1,
      );
      if (![centerX, centerY, areaFraction].every(Number.isFinite)) return null;
      return {
        label,
        score: round(score, 3),
        direction: classifyDirection(centerX),
        centerX,
        centerY,
        areaFraction,
        boundingBox: {
          originX: Number(box.originX),
          originY: Number(box.originY),
          width: Number(box.width),
          height: Number(box.height),
        },
      };
    })
    .filter(Boolean);
}

function createPostureAlert(posture) {
  const seconds = Math.max(1, Math.round(posture.heldMs / 1_000));
  const detail = posture.key === "static-posture"
    ? "You have held nearly the same posture"
    : `You have held a ${posture.label.toLowerCase()}`;
  return {
    type: "posture",
    key: `posture:${posture.key}`,
    severity: "reminder",
    title: "Movement reminder",
    message: `${detail} for ${seconds} seconds. Reposition gently if mission conditions allow.`,
    voice: `Movement reminder. ${detail} for ${seconds} seconds. Reposition gently if conditions allow.`,
    cooldownMs: Math.max(30_000, posture.thresholdMs),
    timestamp: new Date().toISOString(),
  };
}

function createObjectAlert(track) {
  return {
    type: "object",
    key: `object:${track.label}:${track.direction}`,
    severity: "caution",
    title: "Approach cue",
    message: `Possible ${track.label} approaching from ${track.direction}. Camera-only direction estimate.`,
    voice: `Caution. Possible ${track.label} approaching from ${track.direction}. Check the environment.`,
    cooldownMs: OBJECT_ALERT_COOLDOWN_MS,
    timestamp: new Date().toISOString(),
  };
}

function createEmptyPostureState() {
  return {
    visible: false,
    key: "waiting",
    label: "Body not fully visible",
    heldMs: 0,
    heldSeconds: 0,
    thresholdMs: null,
    movementScore: null,
    alert: false,
    basis: "Waiting for usable full-body landmarks",
  };
}

function createEmptyObjectState() {
  return {
    count: 0,
    items: [],
    approaching: [],
    inferenceMs: null,
    timestamp: null,
  };
}

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
