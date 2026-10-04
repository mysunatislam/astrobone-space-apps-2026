export const POSE_LANDMARK = Object.freeze({
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
});

export const RIG_SEGMENT_KEYS = Object.freeze([
  "spine",
  "neck",
  "leftShoulder",
  "rightShoulder",
  "leftArm",
  "leftForeArm",
  "leftHand",
  "rightArm",
  "rightForeArm",
  "rightHand",
  "leftUpLeg",
  "leftLeg",
  "leftFoot",
  "rightUpLeg",
  "rightLeg",
  "rightFoot",
]);

const SEGMENT_MIN_VISIBILITY = 0.56;

export class PoseLandmarkFilter {
  constructor({ minimumAlpha = 0.24, maximumAlpha = 0.72 } = {}) {
    this.minimumAlpha = minimumAlpha;
    this.maximumAlpha = maximumAlpha;
    this.previous = [];
  }

  update(landmarks) {
    if (!Array.isArray(landmarks)) {
      this.previous = this.previous.map((point) => point ? ({
        ...point,
        visibility: point.visibility * 0.82,
      }) : null);
      return this.previous.length ? cloneLandmarks(this.previous) : null;
    }

    const next = landmarks.map((landmark, index) => {
      const current = sanitizeLandmark(landmark);
      const previous = this.previous[index];
      if (!current) {
        return previous
          ? { ...previous, visibility: previous.visibility * 0.82 }
          : null;
      }
      if (!previous) return current;

      const movement = distance(current, previous);
      const alpha = clamp(
        this.minimumAlpha + movement * 3.6,
        this.minimumAlpha,
        this.maximumAlpha,
      );
      const visibility = lerp(previous.visibility, current.visibility, 0.4);
      if (current.visibility < 0.18 && previous.visibility > current.visibility) {
        return {
          ...previous,
          visibility: Math.max(current.visibility, previous.visibility * 0.9),
        };
      }

      return {
        x: lerp(previous.x, current.x, alpha),
        y: lerp(previous.y, current.y, alpha),
        z: lerp(previous.z, current.z, alpha),
        visibility,
      };
    });

    this.previous = next;
    return cloneLandmarks(next);
  }

  reset() {
    this.previous = [];
  }
}

export function buildPoseRetargetFrame(worldLandmarks, imageLandmarks = worldLandmarks) {
  const world = readNamedLandmarks(worldLandmarks);
  const image = readNamedLandmarks(imageLandmarks);
  if (!world || !image) return null;

  const worldDerived = derivePosePoints(world);
  const imageDerived = derivePosePoints(image);
  const points = { ...world, ...worldDerived };
  const segments = {
    spine: createSegment(points.hipCenter, points.shoulderCenter),
    neck: createSegment(points.shoulderCenter, points.headCenter),
    leftShoulder: createSegment(points.shoulderCenter, points.leftShoulder),
    rightShoulder: createSegment(points.shoulderCenter, points.rightShoulder),
    leftArm: createSegment(points.leftShoulder, points.leftElbow),
    leftForeArm: createSegment(points.leftElbow, points.leftWrist),
    leftHand: createSegment(points.leftWrist, points.leftHandCenter),
    rightArm: createSegment(points.rightShoulder, points.rightElbow),
    rightForeArm: createSegment(points.rightElbow, points.rightWrist),
    rightHand: createSegment(points.rightWrist, points.rightHandCenter),
    leftUpLeg: createSegment(points.leftHip, points.leftKnee),
    leftLeg: createSegment(points.leftKnee, points.leftAnkle),
    leftFoot: createSegment(points.leftAnkle, points.leftFoot),
    rightUpLeg: createSegment(points.rightHip, points.rightKnee),
    rightLeg: createSegment(points.rightKnee, points.rightAnkle),
    rightFoot: createSegment(points.rightAnkle, points.rightFoot),
  };

  const trackedSegmentCount = RIG_SEGMENT_KEYS.reduce(
    (count, key) => count + Number(segments[key]?.usable),
    0,
  );
  const bodyScale = mean([
    distance(image.leftShoulder, image.rightShoulder),
    distance(image.leftHip, image.rightHip),
    distance(imageDerived.shoulderCenter, imageDerived.hipCenter),
  ]);

  return {
    points,
    segments,
    trackedSegmentCount,
    totalSegmentCount: RIG_SEGMENT_KEYS.length,
    rigCoverage: trackedSegmentCount / RIG_SEGMENT_KEYS.length,
    imageCenter: {
      x: imageDerived.hipCenter.x,
      y: imageDerived.hipCenter.y,
      z: imageDerived.hipCenter.z,
    },
    bodyScale,
  };
}

function readNamedLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length < 33) return null;
  const named = {};
  for (const [name, index] of Object.entries(POSE_LANDMARK)) {
    const point = sanitizeLandmark(landmarks[index]);
    if (!point) return null;
    named[name] = point;
  }
  return named;
}

function derivePosePoints(points) {
  return {
    shoulderCenter: midpoint(points.leftShoulder, points.rightShoulder),
    hipCenter: midpoint(points.leftHip, points.rightHip),
    headCenter: weightedMean([points.leftEar, points.rightEar, points.nose]),
    leftHandCenter: weightedMean([
      points.leftIndex,
      points.leftPinky,
      points.leftThumb,
    ]),
    rightHandCenter: weightedMean([
      points.rightIndex,
      points.rightPinky,
      points.rightThumb,
    ]),
  };
}

function createSegment(from, to) {
  if (!from || !to) return null;
  const direction = subtract(to, from);
  const length = Math.hypot(direction.x, direction.y, direction.z);
  const visibility = Math.min(from.visibility, to.visibility);
  if (!Number.isFinite(length) || length <= 1e-6) {
    return { direction: null, length: 0, visibility, usable: false };
  }
  return {
    direction: {
      x: direction.x / length,
      y: direction.y / length,
      z: direction.z / length,
    },
    length,
    visibility,
    usable: visibility >= SEGMENT_MIN_VISIBILITY,
  };
}

function sanitizeLandmark(landmark) {
  if (!landmark) return null;
  const x = Number(landmark.x);
  const y = Number(landmark.y);
  const z = Number(landmark.z ?? 0);
  const visibility = Number(landmark.visibility ?? 1);
  if (![x, y, z, visibility].every(Number.isFinite)) return null;
  return { x, y, z, visibility: clamp(visibility, 0, 1) };
}

function cloneLandmarks(landmarks) {
  return landmarks.map((point) => (point ? { ...point } : null));
}

function midpoint(first, second) {
  return weightedMean([first, second]);
}

function weightedMean(points) {
  const valid = points.filter(Boolean);
  const totalWeight = valid.reduce(
    (total, point) => total + Math.max(point.visibility, 0.05),
    0,
  );
  return {
    x: valid.reduce((total, point) => total + point.x * point.visibility, 0) / totalWeight,
    y: valid.reduce((total, point) => total + point.y * point.visibility, 0) / totalWeight,
    z: valid.reduce((total, point) => total + point.z * point.visibility, 0) / totalWeight,
    visibility: Math.min(...valid.map((point) => point.visibility)),
  };
}

function subtract(point, origin) {
  return {
    x: point.x - origin.x,
    y: point.y - origin.y,
    z: point.z - origin.z,
  };
}

function distance(first, second) {
  const vector = subtract(first, second);
  return Math.hypot(vector.x, vector.y, vector.z);
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
