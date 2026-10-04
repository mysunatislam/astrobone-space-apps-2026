export const HUMAN_RIG_NAMES = Object.freeze({
  root: "root",
  spine: "spine05",
  spine1: "spine03",
  torso: "spine01",
  neck: "neck01",
  head: "head",
  leftShoulder: "clavicle.L",
  leftArm: "upperarm01.L",
  leftForeArm: "lowerarm01.L",
  leftHand: "wrist.L",
  leftHandIndex: "finger2-1.L",
  rightShoulder: "clavicle.R",
  rightArm: "upperarm01.R",
  rightForeArm: "lowerarm01.R",
  rightHand: "wrist.R",
  rightHandIndex: "finger2-1.R",
  leftUpLeg: "upperleg01.L",
  leftLeg: "lowerleg01.L",
  leftFoot: "foot.L",
  leftToeBase: "toe3-1.L",
  rightUpLeg: "upperleg01.R",
  rightLeg: "lowerleg01.R",
  rightFoot: "foot.R",
  rightToeBase: "toe3-1.R",
  jaw: "jaw",
});

export const HAND_LANDMARK_CHAINS = Object.freeze([
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
]);

export function canonicalRigName(name) {
  return String(name ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function bindHumanRig(scene) {
  const byName = new Map();
  scene.traverse((object) => {
    if (object.isBone) byName.set(canonicalRigName(object.name), object);
  });
  const get = (name) => byName.get(canonicalRigName(name)) ?? null;
  const bones = Object.fromEntries(
    Object.entries(HUMAN_RIG_NAMES).map(([key, name]) => [key, get(name)]),
  );
  if (get("headTop")) bones.headTop = get("headTop");
  const fingers = Object.fromEntries(["left", "right"].map((side) => {
    const suffix = side === "left" ? "L" : "R";
    return [side, Array.from({ length: 5 }, (_, finger) =>
      Array.from({ length: 3 }, (_, segment) => get(`finger${finger + 1}-${segment + 1}.${suffix}`)))];
  }));
  return { bones, fingers };
}
