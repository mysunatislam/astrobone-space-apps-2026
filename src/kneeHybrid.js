// Hybrid knee angle: a pretrained pose model (MediaPipe Pose) plus a small learned correction.
// On real squat and lunge video against motion capture (docs/real-video-validation.md), the model's 3D
// world-landmark angle reads a bent knee far too straight when the person faces the camera, and its 2D
// image angle is right only side-on. Gradient-boosted trees trained on both angles, the body yaw and the
// thigh foreshortening cut the knee range-of-motion error for every one of 9 people left out of training.
// Outside the feature ranges seen in training the trees are not trusted and a fixed rule is used instead:
// the 2D angle side-on, the 3D angle otherwise.
import { KNEE_HYBRID_MODEL } from "./kneeHybridModel.js";

export const KNEE_HYBRID_SIDE_YAW = 60;

// The features in training order (scripts/validation/hybrid_pose.py `features`).
export function kneeHybridFeatures({ angle2d, angle3d, yawDeg, thigh2d, shank2d, visibility }) {
  if (![angle2d, angle3d, yawDeg, thigh2d, shank2d, visibility].every(Number.isFinite)) return null;
  const s = Math.sin(Math.min(90, Math.max(0, yawDeg)) * Math.PI / 180) ** 2;
  const ratio = Math.log(Math.max(thigh2d, 1e-9) / Math.max(shank2d, 1e-9));
  return [angle2d, angle3d, angle2d * s, angle3d * s, s, ratio, ratio * s, ratio * (1 - s), visibility];
}

export function predictKneeHybrid(features, model = KNEE_HYBRID_MODEL) {
  let sum = model.baseline;
  for (const tree of model.trees) {
    let node = tree[0], i = 0;
    while (node[0] !== -1) {
      const [feature, threshold, left, right, missingLeft] = node, x = features[feature];
      i = Number.isNaN(x) ? (missingLeft ? left : right) : x <= threshold ? left : right;
      node = tree[i];
    }
    sum += node[1];
  }
  return sum;
}

// Returns { angle, method } where method is "hybrid" (the learned trees) or "rule" (outside their range).
export function hybridKneeAngle(input, model = KNEE_HYBRID_MODEL) {
  const features = kneeHybridFeatures(input);
  if (!features) return Number.isFinite(input?.angle3d) ? { angle: input.angle3d, method: "3d" } : null;
  const inside = features.every((x, i) => x >= model.ranges[i][0] && x <= model.ranges[i][1]);
  if (inside) return { angle: Math.min(180, Math.max(0, predictKneeHybrid(features, model))), method: "hybrid" };
  return { angle: input.yawDeg >= KNEE_HYBRID_SIDE_YAW ? input.angle2d : input.angle3d, method: "rule" };
}
