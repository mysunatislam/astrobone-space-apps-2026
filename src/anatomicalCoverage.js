import { RIG_SEGMENT_KEYS } from "./poseRetargeting.js";
import { hasLiveSegments, canRetargetSegment } from "./skeletalRetargeter.js";
import { HAND_LANDMARK_CHAINS } from "./humanRig.js";

export function anatomicalCoverage(frame, now, tracking) {
  const fresh = tracking && hasLiveSegments(frame, now);
  const observed = fresh ? RIG_SEGMENT_KEYS.filter(key => canRetargetSegment(frame, key)) : [];
  const detailFresh = fresh && Number.isFinite(frame.detailTimestamp) && now - frame.detailTimestamp >= -50 && now - frame.detailTimestamp < 900;
  const hands = new Set(); let fingers = 0;
  if (detailFresh) for (const hand of frame.detailHands ?? []) {
    if (["left", "right"].includes(hand.side) && hand.worldLandmarks?.length === 21
      && !hands.has(hand.side) && hand.worldLandmarks.every(point => [point.x, point.y, point.z].every(Number.isFinite))) {
      hands.add(hand.side);
      for (const chain of HAND_LANDMARK_CHAINS) for (let segment = 0; segment < 3; segment++) {
        const a = hand.worldLandmarks[chain[segment]], b = hand.worldLandmarks[chain[segment + 1]];
        if (Math.hypot(a.x-b.x, a.y-b.y, a.z-b.z) >= 1e-6) fingers++;
      }
    }
  }
  return { state: !tracking ? "reference" : !fresh ? "held" : frame.usable ? "live" : "partial",
    body: observed.length, bodyTotal: RIG_SEGMENT_KEYS.length, fingers, fingerTotal: 30,
    jaw: Boolean(detailFresh && Number.isFinite(frame.detailFace?.blendshapes?.jawOpen)),
    observed, muscleActivation: "not measured", individualBoneMotion: "reference coupling, not measured" };
}
