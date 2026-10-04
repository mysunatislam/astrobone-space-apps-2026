export const MOTION_GUARD_VERSION = "motionguard-kinematics-v2";

export const MOTION_GUARD_MODES = Object.freeze({
  monitor: "Movement observation",
  squat: "Squat repetitions",
  gait: "Alternating knee cycles",
  reach: "Controlled reach cycles",
});

export const MOTION_GUARD_JOINTS = Object.freeze({
  shoulder: Object.freeze({ label: "Shoulder elevation", shortLabel: "Shoulder" }),
  elbow: Object.freeze({ label: "Elbow flexion", shortLabel: "Elbow" }),
  hip: Object.freeze({ label: "Hip flexion", shortLabel: "Hip" }),
  knee: Object.freeze({ label: "Knee flexion", shortLabel: "Knee" }),
});

const SIDES = Object.freeze(["left", "right"]);
const JOINT_KEYS = Object.freeze(Object.keys(MOTION_GUARD_JOINTS));
const MAX_GAP_MS = 1_000;
const ASYMMETRY_CUE_DEGREES = 20;
const CUE_HOLD_MS = 3_000;
const CUE_COOLDOWN_MS = 30_000;
const REACH_READY_DEGREES = 45;
const REACH_ELEVATED_DEGREES = 110;

export class MotionGuardAnalyzer {
  constructor({ mode = "monitor", onUpdate = () => {}, onAlert = () => {} } = {}) {
    this.mode = normalizeMode(mode);
    this.onUpdate = onUpdate;
    this.onAlert = onAlert;
    this.reset({ emit: false });
  }

  setMode(mode) {
    this.mode = normalizeMode(mode);
    this.reset();
  }

  reset({ emit = true } = {}) {
    this.sampleCount = 0;
    this.repetitions = 0;
    this.cycles = { left: 0, right: 0 };
    this.reachCycles = { left: 0, right: 0 };
    this.cycleEvents = [];
    this.lastRepetition = null;
    this.lastCueAt = -Infinity;
    this.breakTracking();
    this.snapshot = this.waitingSnapshot();
    if (emit) this.emit();
  }

  breakTracking() {
    this.previous = null;
    this.cycleEvents = [];
    this.asymmetrySince = null;
    this.squatPhase = "unarmed";
    this.squatStartedAt = null;
    this.repMetrics = null;
    this.cyclePhase = { left: "unarmed", right: "unarmed" };
    this.cycleStartedAt = { left: null, right: null };
    this.breakReachTracking();
  }

  breakReachTracking() {
    this.reachPhase = { left: "unarmed", right: "unarmed" };
    this.reachStartedAt = { left: null, right: null };
  }

  update(frame, timestamp = globalThis.performance?.now?.() ?? Date.now()) {
    const metrics = measureMotionFrame(frame);
    if (!metrics || !Number.isFinite(timestamp)) {
      this.breakTracking();
      this.snapshot = this.waitingSnapshot();
      this.emit();
      return this.getSnapshot();
    }
    if (this.previous && timestamp <= this.previous.timestamp) {
      return {
        ...this.getSnapshot(),
        repetitionCompleted: false,
        cycleCompletedSides: [],
        reachCompletedSides: [],
      };
    }

    const gap = this.previous ? timestamp - this.previous.timestamp : null;
    if (gap > MAX_GAP_MS) this.breakTracking();

    const jointSpeeds = calculateJointSpeeds(metrics, this.previous, gap);
    const activeJoint = this.mode === "reach" ? "shoulder" : "knee";
    const reachTrackingReady = SIDES.every((side) =>
      Number.isFinite(metrics.jointMotionDegrees[side].shoulder));

    this.sampleCount += 1;
    const repetitionCompleted = this.mode === "squat"
      ? this.updateSquat(metrics, timestamp)
      : false;
    const cycleCompletedSides = this.mode === "gait"
      ? this.updateCycles(metrics, timestamp)
      : [];
    const reachCompletedSides = this.mode === "reach" && reachTrackingReady
      ? this.updateReachCycles(metrics, timestamp)
      : [];
    if (this.mode === "reach" && !reachTrackingReady) this.breakReachTracking();

    const timing = this.getCycleTiming();
    const asymmetryObserved = ["monitor", "squat"].includes(this.mode)
      && metrics.kneeDifferenceDegrees >= ASYMMETRY_CUE_DEGREES;
    const reachState = this.mode === "reach"
      ? getReachState(reachTrackingReady, reachCompletedSides)
      : null;

    this.snapshot = {
      version: MOTION_GUARD_VERSION,
      status: "tracking",
      mode: this.mode,
      modeLabel: MOTION_GUARD_MODES[this.mode],
      sampleCount: this.sampleCount,
      timestamp,
      ...metrics,
      jointAngularSpeedDegreesPerSecond: jointSpeeds,
      activeJoint,
      activeJointAngularSpeedDegreesPerSecond: jointSpeeds[activeJoint],
      kneeAngularSpeedDegreesPerSecond: jointSpeeds.knee,
      stateLabel: reachState?.stateLabel
        ?? (asymmetryObserved ? "Knee-angle difference observed" : "Live kinematics linked"),
      reviewCue: asymmetryObserved,
      repetitions: this.repetitions,
      repetitionCompleted,
      squatPhase: this.squatPhase,
      lastRepetition: this.lastRepetition ? { ...this.lastRepetition } : null,
      kneeCycles: { ...this.cycles },
      cycleCompletedSides,
      reachCycles: { ...this.reachCycles },
      reachCompletedSides,
      reachTrackingReady,
      ...timing,
      recommendation: reachState?.recommendation
        ?? (asymmetryObserved
          ? "Check camera alignment and compare the movement with the approved protocol and session baseline."
          : "Compare repeat captures under the same camera setup. Movement observations do not measure bone strength."),
      loadEstimation: "Unavailable: external loads, contacts, and a calibrated body model are not connected.",
    };
    this.previous = { metrics, timestamp };
    this.updateCue(asymmetryObserved, timestamp);
    this.emit();
    return this.getSnapshot();
  }

  updateSquat(metrics, timestamp) {
    const flexion = mean(Object.values(metrics.kneeFlexionDegrees));
    if (this.squatPhase === "unarmed") {
      if (flexion <= 20) this.squatPhase = "ready";
      return false;
    }
    if (this.squatPhase === "ready" && flexion >= 50) {
      this.squatPhase = "flexed";
      this.squatStartedAt = timestamp;
      this.repMetrics = {
        peakKneeFlexionDegrees: flexion,
        maximumKneeDifferenceDegrees: metrics.kneeDifferenceDegrees,
        maximumTrunkAxisDeviationDegrees: metrics.trunkAxisDeviationDegrees,
      };
    }
    if (this.squatPhase !== "flexed") return false;
    this.repMetrics.peakKneeFlexionDegrees = Math.max(this.repMetrics.peakKneeFlexionDegrees, flexion);
    this.repMetrics.maximumKneeDifferenceDegrees = Math.max(
      this.repMetrics.maximumKneeDifferenceDegrees, metrics.kneeDifferenceDegrees,
    );
    this.repMetrics.maximumTrunkAxisDeviationDegrees = Math.max(
      this.repMetrics.maximumTrunkAxisDeviationDegrees, metrics.trunkAxisDeviationDegrees,
    );
    const duration = timestamp - this.squatStartedAt;
    if (duration > 15_000) {
      this.squatPhase = "unarmed";
      return false;
    }
    if (flexion > 20) return false;
    this.squatPhase = "ready";
    if (duration < 600) return false;
    this.repetitions += 1;
    this.lastRepetition = {
      ...this.repMetrics,
      flexedPhaseSeconds: finiteRound(duration / 1_000, 2),
    };
    return true;
  }

  updateCycles(metrics, timestamp) {
    const completed = [];
    for (const side of SIDES) {
      const flexion = metrics.kneeFlexionDegrees[side];
      if (this.cyclePhase[side] === "unarmed" && flexion <= 12) {
        this.cyclePhase[side] = "ready";
      } else if (this.cyclePhase[side] === "ready" && flexion >= 28) {
        this.cyclePhase[side] = "flexed";
        this.cycleStartedAt[side] = timestamp;
      } else if (this.cyclePhase[side] === "flexed" && flexion <= 12) {
        this.cyclePhase[side] = "ready";
        const duration = timestamp - this.cycleStartedAt[side];
        if (duration < 200 || duration > 5_000) continue;
        this.cycles[side] += 1;
        completed.push(side);
        this.cycleEvents.push({ side, timestamp });
        if (this.cycleEvents.length > 12) this.cycleEvents.shift();
      }
    }
    return completed;
  }

  updateReachCycles(metrics, timestamp) {
    const completed = [];
    for (const side of SIDES) {
      const elevation = metrics.jointMotionDegrees[side].shoulder;
      if (this.reachPhase[side] === "unarmed" && elevation <= REACH_READY_DEGREES) {
        this.reachPhase[side] = "ready";
      } else if (this.reachPhase[side] === "ready" && elevation >= REACH_ELEVATED_DEGREES) {
        this.reachPhase[side] = "elevated";
        this.reachStartedAt[side] = timestamp;
      } else if (this.reachPhase[side] === "elevated" && elevation <= REACH_READY_DEGREES) {
        this.reachPhase[side] = "ready";
        const duration = timestamp - this.reachStartedAt[side];
        if (duration < 300 || duration > 10_000) continue;
        this.reachCycles[side] += 1;
        completed.push(side);
      }
    }
    return completed;
  }

  getCycleTiming() {
    const events = this.cycleEvents;
    const alternates = events.slice(1).every((event, index) => event.side !== events[index].side);
    const intervals = events.slice(1).map((event, index) => event.timestamp - events[index].timestamp);
    const valid = events.length >= 4 && alternates
      && intervals.every((interval) => interval >= 200 && interval <= 5_000);
    return {
      cycleRatePerMinute: valid ? finiteRound(60_000 / mean(intervals), 1) : null,
      cycleTimingVariationPercent: valid
        ? finiteRound(standardDeviation(intervals) / mean(intervals) * 100, 1)
        : null,
      timingStatus: valid ? "Alternating cycles" : "Four alternating cycles required",
    };
  }

  updateCue(observed, timestamp) {
    if (!observed) {
      this.asymmetrySince = null;
      return;
    }
    this.asymmetrySince ??= timestamp;
    if (timestamp - this.asymmetrySince < CUE_HOLD_MS
      || timestamp - this.lastCueAt < CUE_COOLDOWN_MS) return;
    this.lastCueAt = timestamp;
    this.onAlert({
      type: "motionguard",
      key: "motionguard:knee-difference",
      severity: "reminder",
      title: "MotionGuard observation",
      message: "A persistent knee-angle difference was observed. Check camera alignment and review the approved movement protocol.",
      voice: "MotionGuard. Knee-angle difference observed. Check camera alignment and review the approved protocol.",
      cooldownMs: CUE_COOLDOWN_MS,
      timestamp: new Date().toISOString(),
    });
  }

  waitingSnapshot() {
    const nullJointRecord = Object.fromEntries(JOINT_KEYS.map((joint) => [joint, null]));
    return {
      version: MOTION_GUARD_VERSION,
      status: "waiting",
      mode: this.mode,
      modeLabel: MOTION_GUARD_MODES[this.mode],
      sampleCount: this.sampleCount,
      jointMotionDegrees: {
        left: { ...nullJointRecord },
        right: { ...nullJointRecord },
      },
      jointDifferenceDegrees: { ...nullJointRecord },
      jointAngularSpeedDegreesPerSecond: { ...nullJointRecord },
      activeJoint: this.mode === "reach" ? "shoulder" : "knee",
      activeJointAngularSpeedDegreesPerSecond: null,
      kneeFlexionDegrees: { left: null, right: null },
      kneeDifferenceDegrees: null,
      trunkAxisDeviationDegrees: null,
      kneeAngularSpeedDegreesPerSecond: null,
      stateLabel: "Waiting for fresh full-body tracking",
      reviewCue: false,
      repetitions: this.repetitions,
      repetitionCompleted: false,
      kneeCycles: { ...this.cycles },
      cycleCompletedSides: [],
      reachCycles: { ...this.reachCycles },
      reachCompletedSides: [],
      reachTrackingReady: false,
      lastRepetition: this.lastRepetition ? { ...this.lastRepetition } : null,
      cycleRatePerMinute: null,
      cycleTimingVariationPercent: null,
      timingStatus: "Tracking required",
      recommendation: "Keep the complete body visible. Held or missing pose frames do not count as observed movement.",
      loadEstimation: "Unavailable: external loads, contacts, and a calibrated body model are not connected.",
    };
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.snapshot));
  }

  emit() {
    this.onUpdate(this.getSnapshot());
  }
}

export function measureMotionFrame(frame) {
  if (!frame?.usable || frame.detected === false) return null;
  const spine = frame.segments?.spine?.direction;
  const lowerAngles = SIDES.flatMap((side) => [
    frame.angles?.[side]?.hip,
    frame.angles?.[side]?.knee,
  ]);
  if (![...lowerAngles, spine?.x, spine?.y, spine?.z].every(Number.isFinite)) return null;
  if (lowerAngles.some((angle) => angle < 0 || angle > 180)) return null;
  const length = Math.hypot(spine.x, spine.y, spine.z);
  if (length <= Number.EPSILON) return null;

  const jointMotionDegrees = Object.fromEntries(SIDES.map((side) => {
    const upperTracked = frame.upperTracking?.[side]
      ?? Boolean(frame.upperAngles?.[side]);
    const shoulder = upperTracked
      ? validAngle(frame.upperAngles?.[side]?.shoulder)
      : null;
    const elbowInterior = upperTracked
      ? validAngle(frame.upperAngles?.[side]?.elbow)
      : null;
    return [side, {
      shoulder: finiteRound(shoulder, 1),
      elbow: finiteRound(Number.isFinite(elbowInterior) ? 180 - elbowInterior : null, 1),
      hip: finiteRound(180 - frame.angles[side].hip, 1),
      knee: finiteRound(180 - frame.angles[side].knee, 1),
    }];
  }));
  const jointDifferenceDegrees = Object.fromEntries(JOINT_KEYS.map((joint) => {
    const left = jointMotionDegrees.left[joint];
    const right = jointMotionDegrees.right[joint];
    return [joint, Number.isFinite(left) && Number.isFinite(right)
      ? finiteRound(Math.abs(left - right), 1)
      : null];
  }));

  return {
    jointMotionDegrees,
    jointDifferenceDegrees,
    kneeFlexionDegrees: {
      left: jointMotionDegrees.left.knee,
      right: jointMotionDegrees.right.knee,
    },
    kneeDifferenceDegrees: jointDifferenceDegrees.knee,
    trunkAxisDeviationDegrees: finiteRound(
      Math.acos(Math.min(1, Math.abs(spine.y) / length)) * 180 / Math.PI,
      1,
    ),
  };
}

export function summarizeMotionGuardSamples(samples) {
  const snapshots = (samples ?? []).map((sample) => sample?.motionGuard)
    .filter((item) => item?.status === "tracking");
  if (!snapshots.length) return null;
  const last = snapshots.at(-1);
  const meanJointDifferenceDegrees = aggregateJointRecord(
    snapshots,
    (item, joint) => item.jointDifferenceDegrees?.[joint],
    (values) => finiteRound(mean(values), 1),
  );
  const maximumJointDifferenceDegrees = aggregateJointRecord(
    snapshots,
    (item, joint) => item.jointDifferenceDegrees?.[joint],
    (values) => finiteRound(Math.max(...values), 1),
  );
  const meanJointAngularSpeedDegreesPerSecond = aggregateJointRecord(
    snapshots,
    (item, joint) => item.jointAngularSpeedDegreesPerSecond?.[joint],
    (values) => finiteRound(mean(values), 1),
  );

  return {
    version: MOTION_GUARD_VERSION,
    mode: last.mode,
    freshSampleCount: snapshots.length,
    meanJointDifferenceDegrees,
    maximumJointDifferenceDegrees,
    meanJointAngularSpeedDegreesPerSecond,
    meanKneeDifferenceDegrees: meanJointDifferenceDegrees.knee,
    maximumKneeDifferenceDegrees: maximumJointDifferenceDegrees.knee,
    maximumTrunkAxisDeviationDegrees: finiteRound(
      Math.max(...snapshots.map((item) => item.trunkAxisDeviationDegrees)),
      1,
    ),
    meanKneeAngularSpeedDegreesPerSecond: meanJointAngularSpeedDegreesPerSecond.knee,
    completedRepetitions: snapshots.filter((item) => item.repetitionCompleted).length,
    completedKneeCycles: snapshots.reduce(
      (sum, item) => sum + (item.cycleCompletedSides?.length ?? 0),
      0,
    ),
    completedReachCycles: snapshots.reduce(
      (sum, item) => sum + (item.reachCompletedSides?.length ?? 0),
      0,
    ),
    reachCycles: { ...last.reachCycles },
    lastRepetition: snapshots.filter((item) => item.repetitionCompleted).at(-1)?.lastRepetition ?? null,
    cycleRatePerMinute: last.cycleRatePerMinute,
    cycleTimingVariationPercent: last.cycleTimingVariationPercent,
    loadEstimation: last.loadEstimation,
    interpretation: "Observed kinematics only. No bone-strength, force, stress, fall-risk, or fracture estimate is derived from this camera channel.",
  };
}

function getReachState(trackingReady, completedSides) {
  if (!trackingReady) {
    return {
      stateLabel: "Bring both arms into frame",
      recommendation: "Keep shoulders, elbows, and wrists visible before starting a controlled reach cycle.",
    };
  }
  if (completedSides.length) {
    return {
      stateLabel: "Controlled reach cycle recorded",
      recommendation: "Repeat under the same camera position for a comparable kinematic record.",
    };
  }
  return {
    stateLabel: "Shoulder motion linked",
    recommendation: "Begin with both arms lowered, raise in a controlled motion, then return to the start position.",
  };
}

function calculateJointSpeeds(metrics, previous, gap) {
  return Object.fromEntries(JOINT_KEYS.map((joint) => {
    if (!previous || gap < 20 || gap > MAX_GAP_MS) return [joint, null];
    const values = SIDES.map((side) => {
      const current = metrics.jointMotionDegrees[side][joint];
      const prior = previous.metrics.jointMotionDegrees[side][joint];
      return Number.isFinite(current) && Number.isFinite(prior)
        ? Math.abs(current - prior) / (gap / 1_000)
        : null;
    }).filter(Number.isFinite);
    return [joint, values.length ? finiteRound(mean(values), 1) : null];
  }));
}

function aggregateJointRecord(snapshots, read, aggregate) {
  return Object.fromEntries(JOINT_KEYS.map((joint) => {
    const values = snapshots.map((item) => read(item, joint)).filter(Number.isFinite);
    return [joint, values.length ? aggregate(values) : null];
  }));
}

function validAngle(value) {
  return Number.isFinite(value) && value >= 0 && value <= 180 ? value : null;
}

function normalizeMode(mode) {
  return Object.hasOwn(MOTION_GUARD_MODES, mode) ? mode : "monitor";
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function finiteRound(value, digits) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
